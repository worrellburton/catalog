import { supabase } from '~/utils/supabase';

/**
 * Client session tracking — feeds /admin/analytics.
 *
 * Lifecycle:
 *   • On auth, insert a `user_sessions` row and stash its id in
 *     sessionStorage so reloads stay in the same session window.
 *   • Every 15s, send a heartbeat: bump last_seen_at + accumulate
 *     active_ms (input within the last 30s) and idle_ms (visible but
 *     no input). The two counters live on the session row so the
 *     admin can compare engaged vs. abandoned visits.
 *   • On visibilitychange to hidden, flush a final heartbeat. We
 *     don't `endSession` proactively — the next visit re-uses the
 *     row when it's <5 minutes old, otherwise opens a new one.
 *
 * RLS: user_sessions has owner-rw for authenticated users, so the
 * client writes directly. Service-role isn't needed for normal flow.
 */

const SESSION_STORAGE_KEY = 'catalog:session-id:v1';
const SESSION_RESUME_WINDOW_MS = 5 * 60 * 1000;   // resume same row within 5 min
const HEARTBEAT_INTERVAL_MS    = 15 * 1000;       // 15 s between flushes
const ACTIVE_INPUT_WINDOW_MS   = 30 * 1000;       // input within 30 s = active

type Tracker = {
  stop: () => void;
  emit: (eventType: 'impression' | 'click' | 'clickout', target?: { type?: string; id?: string; uuid?: string; context?: string }) => void;
  sessionId: () => string | null;
};

let activeTracker: Tracker | null = null;

/**
 * Start a session tracker for the authenticated user. Idempotent —
 * calling again returns the existing tracker.
 */
export function startSessionTracker(userId: string): Tracker {
  if (activeTracker) return activeTracker;
  if (typeof window === 'undefined' || !supabase) {
    return { stop: () => {}, emit: () => {}, sessionId: () => null };
  }

  let sessionId: string | null = null;
  let lastInputAt = Date.now();
  let lastFlushAt = Date.now();
  let userAgent = '';
  try { userAgent = navigator.userAgent.slice(0, 250); } catch { /* SSR / locked-down */ }
  let viewport = '';
  try { viewport = `${window.innerWidth}x${window.innerHeight}`; } catch { /* */ }

  const noteInput = () => { lastInputAt = Date.now(); };
  const inputEvents: (keyof DocumentEventMap)[] = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'];
  inputEvents.forEach(ev => document.addEventListener(ev, noteInput, { passive: true }));

  // Resume the prior session if it was last seen <5min ago, else
  // start a new row. We store {id, lastSeenAt} so the resume check
  // is local and doesn't need a round trip.
  function loadResumable(): { id: string; lastSeenAt: number } | null {
    try {
      const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { id?: string; lastSeenAt?: number; userId?: string };
      if (!parsed.id || parsed.userId !== userId) return null;
      if (typeof parsed.lastSeenAt !== 'number') return null;
      if (Date.now() - parsed.lastSeenAt > SESSION_RESUME_WINDOW_MS) return null;
      return { id: parsed.id, lastSeenAt: parsed.lastSeenAt };
    } catch { return null; }
  }
  function saveResumable(id: string) {
    try {
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ id, userId, lastSeenAt: Date.now() }));
    } catch { /* quota */ }
  }

  async function startOrResume() {
    const resumable = loadResumable();
    if (resumable) {
      sessionId = resumable.id;
      saveResumable(sessionId);
      return;
    }
    const { data, error } = await supabase!
      .from('user_sessions')
      .insert({ user_id: userId, user_agent: userAgent, viewport })
      .select('id')
      .single();
    if (error || !data) {
      // RLS may not be live yet on a stale deploy; degrade silently
      // so analytics being broken can't take the consumer site down.
      console.warn('[session-tracker] insert failed:', error?.message);
      return;
    }
    sessionId = (data as { id: string }).id;
    saveResumable(sessionId);
  }

  void startOrResume();

  async function flush() {
    if (!sessionId) return;
    const now = Date.now();
    const elapsedMs = now - lastFlushAt;
    lastFlushAt = now;
    if (elapsedMs <= 0) return;
    // Page hidden the whole interval → don't credit any time.
    if (document.visibilityState === 'hidden') return;
    // Within ACTIVE_INPUT_WINDOW_MS of any input → all active; else all idle.
    const activeMs = (now - lastInputAt) <= ACTIVE_INPUT_WINDOW_MS ? elapsedMs : 0;
    const idleMs = elapsedMs - activeMs;

    // Server-side accumulate via SQL increment (no read-then-write
    // race). Supabase JS doesn't expose `.update().rpc()`-style
    // increment, so we fetch+set with an optimistic merge. Cheap on
    // a row the user already owns.
    const { data, error: readErr } = await supabase!
      .from('user_sessions').select('active_ms, idle_ms').eq('id', sessionId).maybeSingle();
    if (readErr || !data) { sessionId = null; return; }
    await supabase!.from('user_sessions').update({
      active_ms: (data.active_ms ?? 0) + activeMs,
      idle_ms:   (data.idle_ms   ?? 0) + idleMs,
      last_seen_at: new Date(now).toISOString(),
    }).eq('id', sessionId);
    saveResumable(sessionId);
  }

  const interval = window.setInterval(flush, HEARTBEAT_INTERVAL_MS);
  const onVisibility = () => { if (document.visibilityState === 'hidden') void flush(); };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('beforeunload', () => { void flush(); });

  function stop() {
    inputEvents.forEach(ev => document.removeEventListener(ev, noteInput));
    document.removeEventListener('visibilitychange', onVisibility);
    window.clearInterval(interval);
    activeTracker = null;
  }

  function emit(eventType: 'impression' | 'click' | 'clickout', target?: { type?: string; id?: string; uuid?: string; context?: string }) {
    if (!supabase) return;
    // Surface RLS / network errors via console so a misconfigured
    // policy doesn't silently swallow every analytics event. The
    // request itself is still fire-and-forget.
    supabase.from('user_events').insert({
      user_id: userId,
      session_id: sessionId,
      event_type: eventType,
      target_type: target?.type ?? null,
      target_id: target?.id ?? null,
      // target_uuid is the canonical join key for server-side
      // attribution (e.g. "events on user X's looks"). target_id
      // stays as the client-side synthetic numeric id for backward
      // compat with existing analytics queries.
      target_uuid: target?.uuid ?? null,
      context: target?.context ?? null,
    }).then(({ error }) => {
      if (error) console.warn('[session-tracker] event insert failed:', eventType, error.message);
    });
  }

  activeTracker = {
    stop,
    emit,
    sessionId: () => sessionId,
  };
  return activeTracker;
}

/** Convenience wrappers for the consumer site. Buffer events when
 *  the tracker isn't ready yet (auth still resolving, session row
 *  still being inserted) — flushed automatically once the tracker
 *  comes online so we never drop the first few impressions of a
 *  fresh session. */
type QueuedEvent = { eventType: 'impression' | 'click' | 'clickout'; target?: { type?: string; id?: string; uuid?: string; context?: string } };
const eventQueue: QueuedEvent[] = [];
const QUEUE_FLUSH_INTERVAL_MS = 250;
let queueFlushTimer: number | null = null;

function scheduleFlush() {
  if (typeof window === 'undefined') return;
  if (queueFlushTimer != null) return;
  queueFlushTimer = window.setInterval(() => {
    if (!activeTracker) return;
    while (eventQueue.length > 0) {
      const ev = eventQueue.shift();
      if (ev) activeTracker.emit(ev.eventType, ev.target);
    }
    if (queueFlushTimer != null) {
      window.clearInterval(queueFlushTimer);
      queueFlushTimer = null;
    }
  }, QUEUE_FLUSH_INTERVAL_MS);
}

function fireOrQueue(eventType: 'impression' | 'click' | 'clickout', target?: { type?: string; id?: string; uuid?: string; context?: string }) {
  if (activeTracker) { activeTracker.emit(eventType, target); return; }
  eventQueue.push({ eventType, target });
  scheduleFlush();
}

export function trackImpression(target?: { type?: string; id?: string; uuid?: string; context?: string }) {
  fireOrQueue('impression', target);
}
export function trackClick(target?: { type?: string; id?: string; uuid?: string; context?: string }) {
  fireOrQueue('click', target);
}
export function trackClickout(target?: { type?: string; id?: string; uuid?: string; context?: string }) {
  fireOrQueue('clickout', target);
}

/**
 * Resolve a `products.url` to its row id so per-product analytics can
 * key on the canonical UUID. Cached per-process — the products table
 * is effectively append-only at runtime, so we never invalidate.
 */
const productIdByUrl = new Map<string, string | null>();
export async function resolveProductIdByUrl(url: string): Promise<string | null> {
  if (!url || !supabase) return null;
  if (productIdByUrl.has(url)) return productIdByUrl.get(url) ?? null;
  const { data } = await supabase
    .from('products')
    .select('id')
    .eq('url', url)
    .maybeSingle();
  const id = (data as { id?: string } | null)?.id ?? null;
  productIdByUrl.set(url, id);
  return id;
}

/**
 * Tracker convenience for product clickouts. Looks up the canonical
 * product id by url so the event lands as `target_type='product'`
 * (which feeds the per-product analytics rollup), and falls back to
 * `target_type='product_url'` when the row isn't in the products
 * table yet — user-level clickout count still increments.
 */
export async function trackProductClickout(url: string | null | undefined, brand: string | null | undefined, name: string | null | undefined): Promise<void> {
  const context = [brand, name].filter(Boolean).join(' · ').slice(0, 200);
  if (!url) {
    fireOrQueue('clickout', { type: 'product_url', id: undefined, context });
    return;
  }
  const id = await resolveProductIdByUrl(url);
  // Route through fireOrQueue (not activeTracker.emit directly) so a
  // clickout fired during the auth-resolving window still lands when
  // the tracker comes online. The previous "if (!activeTracker)
  // return" early-bail dropped every clickout fired in that window —
  // including the most common one: the user taps Shop on their first
  // page load before the auth bootstrap finishes.
  fireOrQueue('clickout', id
    ? { type: 'product', id, uuid: id, context }
    : { type: 'product_url', id: url.slice(0, 200), context });
}

/**
 * Fire impression events for all products associated with a creative open.
 *
 * - Always fires for the primary product (`primaryId`).
 * - If the creative has a `look_id`, also fires for every other product
 *   in that look (via the `look_products` junction table) so all visible
 *   products get credited, not just the one the creative was made for.
 *
 * Fire-and-forget — awaiting is optional. Errors are swallowed so a
 * failing analytics write can never break the UI open path.
 */
export async function trackCreativeImpressions(
  primaryId: string | null | undefined,
  lookId: string | null | undefined,
  context: string,
): Promise<void> {
  const seen = new Set<string>();

  // Primary product — fire immediately without waiting for any lookup.
  if (primaryId) {
    seen.add(primaryId);
    fireOrQueue('impression', { type: 'product', id: primaryId, uuid: primaryId, context });
  }

  // Remaining products in the associated look.
  if (lookId && supabase) {
    try {
      const { data } = await supabase
        .from('look_products')
        .select('product_id')
        .eq('look_id', lookId);
      for (const row of (data ?? []) as Array<{ product_id: string }>) {
        const id = row.product_id;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        fireOrQueue('impression', { type: 'product', id, uuid: id, context });
      }
    } catch { /* swallow — analytics must not break product navigation */ }
  }
}

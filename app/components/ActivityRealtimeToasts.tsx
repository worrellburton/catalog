import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from '@remix-run/react';
import { supabase } from '~/utils/supabase';
import { useAuth } from '~/hooks/useAuth';
import { useCountUp } from '~/utils/useCountUp';

/**
 * Activity — single notification pipeline for engagement events.
 *
 * Drives two flavours of toast in the same right-aligned pill stack:
 *
 *   1. **Realtime** — Supabase postgres_changes subscriptions on
 *      user_events INSERT (target = my looks) and creator_follows
 *      INSERT (followee = my handle). One toast per event, with
 *      the actor's display name + the look's title resolved before
 *      render so the message reads "<name> tapped <look title>".
 *
 *   2. **Catch-up** — on mount and whenever the tab becomes visible
 *      after being hidden, queries events that landed while I was
 *      away and pushes a SUMMARY toast per kind ("+12 new taps").
 *      Keeps a multi-week absence from spamming 1,000 individual
 *      toasts but still informs me of the volume.
 *
 * Last-seen bookkeeping lives in localStorage so it survives tab
 * refreshes. On the very first visit we fall back to
 * profiles.previous_sign_in_at; if that's null too we skip the
 * catch-up (no baseline to compare against).
 */

type ActivityKind = 'impression' | 'click' | 'clickout' | 'follow';

interface ActivityToast {
  id: string;
  kind: ActivityKind;
  /** For per-event toasts: free-form message ("John tapped your look").
   *  For summary toasts: undefined — the toast renders {count} + label. */
  message?: string;
  /** Avatar of the actor whose event triggered this toast. */
  avatarUrl?: string | null;
  /** Thumbnail of the look the actor engaged with. */
  thumbnailUrl?: string | null;
  fallbackInitial?: string;
  /** Summary-toast number (animated count-up). Undefined for per-event. */
  count?: number;
  /** True during the exit window so the row plays its fade-out before removal. */
  leaving?: boolean;
}

const MAX_VISIBLE = 4;
const TOAST_LIFESPAN_MS = 6000;
const SUMMARY_TOAST_LIFESPAN_MS = 9000;
const LAST_SEEN_KEY = 'activity:last-seen-at';
// Exit-animation window: a toast is marked `leaving` this long before it's
// dropped from the stack, so the CSS fade-out can play out.
const EXIT_MS = 300;

// Two-phase removal: mark `leaving` near the end (triggers the fade-out), then
// drop the row once the animation has played. Replaces the old hard filter so
// every toast eases out instead of vanishing.
function scheduleDismiss(
  setToasts: React.Dispatch<React.SetStateAction<ActivityToast[]>>,
  id: string,
  lifespanMs: number,
) {
  window.setTimeout(() => setToasts(prev => prev.map(t => (t.id === id ? { ...t, leaving: true } : t))), Math.max(0, lifespanMs - EXIT_MS));
  window.setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), lifespanMs);
}

// SVG icon per kind. Rendered inside the toast's accent disc.
function KindIcon({ kind }: { kind: ActivityKind }) {
  const common = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (kind === 'impression') {
    return (<svg {...common}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>);
  }
  if (kind === 'click') {
    return (<svg {...common}><path d="M9 11.24V7.5a2.5 2.5 0 0 1 5 0v6.74" /><path d="M14 13.5V9.5a2.5 2.5 0 0 1 5 0v6c0 3.5-2.5 6-6 6h-1.5a4 4 0 0 1-3.6-2.2L4.6 14a2 2 0 0 1 3.4-2.1L9 13" /></svg>);
  }
  if (kind === 'clickout') {
    return (<svg {...common}><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" /></svg>);
  }
  // follow
  return (<svg {...common}><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" /></svg>);
}

function summaryNoun(kind: ActivityKind, n: number): string {
  if (kind === 'impression') return n === 1 ? 'new view'    : 'new views';
  if (kind === 'click')      return n === 1 ? 'new tap'     : 'new taps';
  if (kind === 'clickout')   return n === 1 ? 'new checkout': 'new checkouts';
  return n === 1 ? 'new follower' : 'new followers';
}

// Push a summary toast with an animated count (used by catch-up).
function pushSummary(
  setToasts: React.Dispatch<React.SetStateAction<ActivityToast[]>>,
  kind: ActivityKind,
  count: number,
) {
  if (count <= 0) return;
  // Mirror every push to the shared activity bus so HeaderActivityPill
  // (mobile-only indicator left of the wallet) bumps its unseen count.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('catalog:activity-bump', { detail: { count } }));
  }
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  setToasts(prev => {
    const merged: ActivityToast[] = [...prev, { id, kind, count }];
    return merged.length > MAX_VISIBLE ? merged.slice(-MAX_VISIBLE) : merged;
  });
  scheduleDismiss(setToasts, id, SUMMARY_TOAST_LIFESPAN_MS);
}

export default function ActivityRealtimeToasts() {
  const { user, loading } = useAuth();
  const [toasts, setToasts] = useState<ActivityToast[]>([]);
  // Suppress all toasts until the cinematic cold-open splash finishes —
  // engagement notifications popping over the splash animation looked
  // chaotic. _index dispatches a 'catalog:splash-done' window event once
  // SplashHost.onDone fires (or never, if the splash is disabled, in
  // which case we initialise to true via the same flag SplashHost reads).
  const [splashDone, setSplashDone] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    // If the cold-open splash never armed for this tab — disabled in
    // admin config, returning visit (sessionStorage gate), or running
    // inside the Flutter shell — the gate is open from the start.
    try {
      if (sessionStorage.getItem('catalog:cold-open-done') === '1') return true;
    } catch { /* ignore */ }
    if (document.documentElement.dataset.shell === 'catalog-app') return true;
    return false;
  });
  useEffect(() => {
    if (splashDone) return;
    // After the splash finishes, give the shopper an extra beat to
    // settle into the feed before the first toast pops in.
    const SETTLE_AFTER_SPLASH_MS = 1500;
    let openTimer = 0;
    const onDone = () => {
      window.clearTimeout(openTimer);
      openTimer = window.setTimeout(() => setSplashDone(true), SETTLE_AFTER_SPLASH_MS);
    };
    window.addEventListener('catalog:splash-done', onDone);
    // Safety net: if no splash event fires within a generous window
    // (config disabled mid-load, etc.) open the gate so toasts aren't
    // lost forever.
    const guard = window.setTimeout(() => setSplashDone(true), 8000);
    return () => {
      window.removeEventListener('catalog:splash-done', onDone);
      window.clearTimeout(openTimer);
      window.clearTimeout(guard);
    };
  }, [splashDone]);

  const pushToast = useCallback((kind: ActivityKind, message: string, lifespanMs = TOAST_LIFESPAN_MS) => {
    if (!message) return;
    // Bump the shared activity bus so HeaderActivityPill (mobile) ticks
    // even when the desktop toast stack is invisible. Per-event pushes
    // always count as +1; summary toasts pass their own count via
    // pushSummary (see top of file).
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('catalog:activity-bump', { detail: { count: 1 } }));
    }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts(prev => {
      const merged = [...prev, { id, kind, message }];
      return merged.length > MAX_VISIBLE ? merged.slice(-MAX_VISIBLE) : merged;
    });
    scheduleDismiss(setToasts, id, lifespanMs);
  }, []);

  const pushRef = useRef(pushToast);
  pushRef.current = pushToast;
  // Dedup realtime deliveries — Supabase can deliver the same INSERT
  // twice, which previously stacked identical toasts.
  const seenEventIdsRef = useRef<Set<string>>(new Set());

  // Hold all toast pushes until AFTER the page has settled. The feed
  // dispatches `catalog:feed-ready` on its first non-empty paint;
  // listen for that, otherwise fall back to a 1.2s timer so anonymous
  // / non-home routes don't sit silent forever. The activity toasts
  // are reactions to in-product activity, so they read as junk when
  // they fire DURING the splash → grid handoff.
  const [postPaint, setPostPaint] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let fired = false;
    const fire = () => { if (!fired) { fired = true; setPostPaint(true); } };
    const t = window.setTimeout(fire, 1200);
    window.addEventListener('catalog:feed-ready', fire, { once: true });
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('catalog:feed-ready', fire);
    };
  }, []);

  useEffect(() => {
    if (loading || !user || !supabase) return;
    if (!postPaint) return; // wait for the page to settle
    // Capture into a non-nullable local so the inner closures don't
    // need to re-narrow user — TS can't track the outer narrowing
    // across the async IIFE + per-payload callbacks below.
    const userId: string = user.id;
    let cancelled = false;

    type Channel = ReturnType<NonNullable<typeof supabase>['channel']>;
    let eventChannel: Channel | null = null;
    let followChannel: Channel | null = null;
    let visibilityCleanup: (() => void) | null = null;

    // Per-event lookups: actor display name + look title. Cache so
    // the same actor doesn't trigger a profile fetch on every toast.
    interface LookInfo { title: string; thumbnailUrl: string | null }
    interface ActorInfo { name: string; avatarUrl: string | null }
    const lookInfoById = new Map<string, LookInfo>();
    const actorInfoCache = new Map<string, ActorInfo>();

    async function resolveActorInfo(actorId: string): Promise<ActorInfo> {
      const cached = actorInfoCache.get(actorId);
      if (cached) return cached;
      let name = 'Someone';
      let avatarUrl: string | null = null;
      if (supabase) {
        // Prefer the creators row (display_name + custom avatar) for
        // anyone who has one; fall back to the profile for everyone
        // else. The avatar_url from either source is fine — both write
        // to the same supabase storage in practice.
        const [profRes, creatorRes] = await Promise.all([
          supabase.from('profiles').select('full_name, avatar_url').eq('id', actorId).maybeSingle(),
          supabase.from('creators').select('display_name, handle, avatar_url').eq('id', actorId).maybeSingle(),
        ]);
        const fromCreator = creatorRes.data?.display_name || creatorRes.data?.handle;
        const fromProfile = profRes.data?.full_name;
        name = (fromCreator || fromProfile || 'Someone').toString().trim() || 'Someone';
        avatarUrl = (creatorRes.data?.avatar_url || profRes.data?.avatar_url || null);
      }
      const info: ActorInfo = { name, avatarUrl };
      actorInfoCache.set(actorId, info);
      return info;
    }

    // Resolve a look's title + thumbnail, cache-first. Lets a realtime
    // event for a look created AFTER mount still render an accurate
    // message instead of a generic "your look".
    async function resolveLookInfo(lookId: string): Promise<LookInfo> {
      const cached = lookInfoById.get(lookId);
      if (cached) return cached;
      let info: LookInfo = { title: 'your look', thumbnailUrl: null };
      if (supabase) {
        const { data } = await supabase
          .from('looks').select('title, thumbnail_url').eq('id', lookId).maybeSingle();
        if (data) info = { title: data.title || 'your look', thumbnailUrl: data.thumbnail_url || null };
      }
      lookInfoById.set(lookId, info);
      return info;
    }

    (async () => {
      // 1. Find my looks + their titles + my handle.
      const [looksRes, creatorRes] = await Promise.all([
        supabase.from('looks').select('id, title, thumbnail_url').eq('user_id', userId),
        supabase.from('creators').select('handle').eq('id', userId).maybeSingle(),
      ]);
      if (cancelled) return;
      for (const r of ((looksRes.data ?? []) as { id: string; title: string | null; thumbnail_url: string | null }[])) {
        lookInfoById.set(r.id, { title: r.title || 'your look', thumbnailUrl: r.thumbnail_url || null });
      }
      const myHandle = creatorRes.data?.handle ?? null;

      // 2. Catch-up helper. Pushes one SUMMARY toast per kind.
      //    Scoped by target_owner_id (the denormalized look owner) so it
      //    covers every look I own — including ones created after mount —
      //    and doesn't depend on the lookIds snapshot.
      async function pushCatchupSince(sinceIso: string) {
        if (!supabase) return;
        const [{ data: events }, { data: follows }] = await Promise.all([
          supabase
            .from('user_events')
            .select('event_type')
            .gt('created_at', sinceIso)
            .neq('user_id', userId)
            .eq('target_owner_id', userId),
          myHandle
            ? supabase
                .from('creator_follows')
                .select('follower_id')
                .gt('created_at', sinceIso)
                .eq('followee_handle', myHandle)
                .neq('follower_id', userId)
            : Promise.resolve({ data: [] as Array<{ follower_id: string }> }),
        ]);
        // Only meaningful intent: look taps + product checkouts. Views
        // (impressions) are intentionally excluded — they over-counted.
        let clicks = 0, clickouts = 0;
        for (const e of (events ?? []) as Array<{ event_type: string }>) {
          if (e.event_type === 'click')      clicks    += 1;
          if (e.event_type === 'clickout')   clickouts += 1;
        }
        const followers = (follows ?? []).length;
        if (clickouts > 0) pushSummary(setToasts, 'clickout',   clickouts);
        if (clicks    > 0) pushSummary(setToasts, 'click',      clicks);
        if (followers > 0) pushSummary(setToasts, 'follow',     followers);
      }

      // 3. Mount-time catch-up.
      const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(LAST_SEEN_KEY) : null;
      let sinceIso: string | null = stored;
      if (!sinceIso) {
        const { data: prof } = await supabase
          .from('profiles').select('previous_sign_in_at').eq('id', userId).maybeSingle();
        sinceIso = (prof?.previous_sign_in_at as string | null) ?? null;
      }
      if (sinceIso) await pushCatchupSince(sinceIso);
      try { localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString()); } catch { /* */ }

      // 4. Visibility tracking. On hidden → record now; on visible →
      //    catch-up since the hidden moment, then stamp now again.
      let lastHiddenAt: string | null = null;
      const onVis = () => {
        if (document.visibilityState === 'hidden') {
          lastHiddenAt = new Date().toISOString();
        } else if (document.visibilityState === 'visible' && lastHiddenAt) {
          const since = lastHiddenAt;
          lastHiddenAt = null;
          void pushCatchupSince(since);
          try { localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString()); } catch { /* */ }
        }
      };
      document.addEventListener('visibilitychange', onVis);
      visibilityCleanup = () => document.removeEventListener('visibilitychange', onVis);

      // 5. Realtime channels. Per-event toasts now include the
      //    actor's name + the look title. We resolve names lazily
      //    so the first paint of a toast might switch from
      //    "Someone tapped your X" to "John tapped your X" after
      //    the profile fetch lands — but the toast renders
      //    immediately rather than waiting on the lookup.
      // Server-side filter on the denormalized owner column means
      // Realtime only sends events that target MY looks — no platform-
      // wide firehose, and it authorizes cleanly via the simple
      // `auth.uid() = target_owner_id` policy (a cross-table-subquery
      // policy isn't reliably evaluated by Realtime, which is what
      // silently broke this toast before).
      {
        eventChannel = supabase
          .channel(`activity-events-${userId}`)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'user_events',
              filter: `target_owner_id=eq.${userId}`,
            },
            (payload) => {
              const row = payload.new as {
                id?: string | null;
                user_id?: string | null;
                event_type?: string | null;
                target_type?: string | null;
                target_uuid?: string | null;
              };
              if (!row) return;
              if (row.user_id === userId) return;       // skip my own activity
              if (!row.target_uuid) return;
              const k = row.event_type;
              // Only discrete intent: a LOOK tapped open, or a PRODUCT
              // checked out. Impressions ('viewed') are excluded — they
              // fired on every scroll and spammed duplicate toasts.
              const isLookClick = row.target_type === 'look' && k === 'click';
              const isProductClickout = row.target_type === 'product' && k === 'clickout';
              if (!isLookClick && !isProductClickout) return;
              // Dedup repeated realtime deliveries of the same row.
              if (row.id) {
                if (seenEventIdsRef.current.has(row.id)) return;
                seenEventIdsRef.current.add(row.id);
              }
              const kind: ActivityKind = k as ActivityKind;
              const lookId = row.target_uuid;
              const verb  = isProductClickout ? 'checked out' : 'tapped';
              const noun = isProductClickout ? 'your product' : 'your look';
              const cachedLook = isProductClickout ? undefined : lookInfoById.get(lookId);
              const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              setToasts(prev => {
                const merged: ActivityToast[] = [...prev, {
                  id, kind,
                  message: `Someone ${verb} ${cachedLook?.title ?? noun}`,
                  avatarUrl: null,
                  thumbnailUrl: cachedLook?.thumbnailUrl ?? null,
                  fallbackInitial: '?',
                }];
                return merged.length > MAX_VISIBLE ? merged.slice(-MAX_VISIBLE) : merged;
              });
              scheduleDismiss(setToasts, id, TOAST_LIFESPAN_MS);
              // Resolve actor (+ look details for look taps) and upgrade the
              // toast in place once they land.
              void Promise.all([
                row.user_id ? resolveActorInfo(row.user_id) : Promise.resolve<ActorInfo>({ name: 'Someone', avatarUrl: null }),
                isProductClickout ? Promise.resolve(null) : resolveLookInfo(lookId),
              ]).then(([actor, look]) => {
                setToasts(prev => prev.map(t =>
                  t.id === id
                    ? {
                        ...t,
                        message: `${actor.name} ${verb} ${look?.title ?? noun}`,
                        avatarUrl: actor.avatarUrl,
                        thumbnailUrl: look?.thumbnailUrl ?? t.thumbnailUrl,
                        fallbackInitial: actor.name.charAt(0).toUpperCase() || '?',
                      }
                    : t,
                ));
              });
              try { localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString()); } catch { /* */ }
            },
          )
          .subscribe();
      }
      if (myHandle) {
        followChannel = supabase
          .channel(`activity-follows-${userId}`)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'creator_follows',
              filter: `followee_handle=eq.${myHandle}`,
            },
            (payload) => {
              const row = payload.new as { follower_id?: string | null };
              if (!row) return;
              if (row.follower_id === userId) return;
              const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              setToasts(prev => {
                const merged: ActivityToast[] = [...prev, {
                  id,
                  kind: 'follow',
                  message: 'Someone followed you',
                  avatarUrl: null,
                  thumbnailUrl: null,
                  fallbackInitial: '?',
                }];
                return merged.length > MAX_VISIBLE ? merged.slice(-MAX_VISIBLE) : merged;
              });
              scheduleDismiss(setToasts, id, TOAST_LIFESPAN_MS);
              if (row.follower_id) {
                void resolveActorInfo(row.follower_id).then(info => {
                  setToasts(prev => prev.map(t =>
                    t.id === id
                      ? {
                          ...t,
                          message: `${info.name} followed you`,
                          avatarUrl: info.avatarUrl,
                          fallbackInitial: info.name.charAt(0).toUpperCase() || '?',
                        }
                      : t,
                  ));
                });
              }
              try { localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString()); } catch { /* */ }
            },
          )
          .subscribe();
      }
    })();

    return () => {
      cancelled = true;
      if (eventChannel  && supabase) supabase.removeChannel(eventChannel);
      if (followChannel && supabase) supabase.removeChannel(followChannel);
      if (visibilityCleanup) visibilityCleanup();
    };
  }, [user, loading, postPaint]);

  // Anchor the stack under the analytics icon (.header-activity-pill) so the
  // toast + notch read as coming FROM it. Measured live so it survives layout
  // shifts / resize; falls back to the CSS default (top-right) if not found.
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  useEffect(() => {
    if (toasts.length === 0) return;
    const measure = () => {
      const el = (document.querySelector('.header-activity-pill')
        || document.querySelector('.header-wallet-pill')) as HTMLElement | null;
      const r = el?.getBoundingClientRect();
      if (!r || r.width === 0) { setAnchor(null); return; }
      setAnchor({ top: Math.round(r.bottom + 10), right: Math.max(8, Math.round(window.innerWidth - r.right)) });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [toasts.length]);

  const navigate = useNavigate();
  const openInsights = useCallback(() => {
    // Deep-linkable URL — _index detects /earnings and opens the wallet
    // (insights + earnings). useNavigate pushes a history entry, so
    // browser-back returns to whatever in-app screen the user was on.
    navigate('/earnings');
  }, [navigate]);

  // Wait for the cinematic splash to finish before showing any
  // engagement toasts (we still collect them in the background so the
  // catch-up queue and realtime listeners stay armed — only the visible
  // surface is gated).
  if (!splashDone) return null;
  if (toasts.length === 0) return null;
  return (
    <div
      className="activity-toasts"
      role="status"
      aria-live="polite"
      style={anchor ? { top: anchor.top, right: anchor.right } : undefined}
    >
      {toasts.map(t => <ActivityToastRow key={t.id} toast={t} onClick={openInsights} />)}
    </div>
  );
}

// Single toast row. Centered glass pill in catalog branding; SVG icon
// on the left, animated count on summary toasts, click anywhere to
// jump into Insights/Earnings.
function ActivityToastRow({ toast, onClick }: { toast: ActivityToast; onClick: () => void }) {
  const isSummary = typeof toast.count === 'number';
  const animated = useCountUp(toast.count ?? 0, 900);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`activity-toast activity-toast--${toast.kind}${isSummary ? ' activity-toast--summary' : ' activity-toast--rich'}${toast.leaving ? ' activity-toast--leaving' : ''}`}
      aria-label="Open insights"
    >
      <span className="activity-toast-icon-disc" aria-hidden>
        <KindIcon kind={toast.kind} />
      </span>
      {isSummary ? (
        <span className="activity-toast-summary">
          <span className="activity-toast-count">+{animated.toLocaleString()}</span>
          <span className="activity-toast-summary-label">{summaryNoun(toast.kind, toast.count ?? 0)}</span>
        </span>
      ) : (
        <>
          {toast.avatarUrl ? (
            <img className="activity-toast-avatar" src={toast.avatarUrl} alt="" />
          ) : (
            <span className="activity-toast-avatar activity-toast-avatar--initial" aria-hidden>{toast.fallbackInitial || '?'}</span>
          )}
          <span className="activity-toast-message">{toast.message}</span>
          {toast.thumbnailUrl && <img className="activity-toast-thumb" src={toast.thumbnailUrl} alt="" />}
        </>
      )}
    </button>
  );
}

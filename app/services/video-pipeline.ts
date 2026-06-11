import { supabase } from '~/utils/supabase';

/**
 * Video delivery pipeline dial — the ONE remaining video setting for the feed.
 *
 * Switches every consumer playback surface (feed, look cards, overlays, product
 * heroes — anything routed through pickPlaybackSource) between two independent
 * delivery paths:
 *
 *   'hls' (default) — adaptive ladder. pickPlaybackSource prefers
 *         hls_url/primary_hls_url, playback runs through hls.js / native HLS,
 *         and prewarm warms the manifest head (prefetchHlsHead).
 *   'mp4'           — the legacy progressive path. hls_url columns are ignored
 *         everywhere, playback is plain `el.src = mp4`, and prewarm is a
 *         full-file byte fetch into the HTTP cache.
 *
 * Everything ELSE about warming — prewarm on/off, concurrency, queue depth,
 * cache mode, HLS head-segment count — used to be admin dials and has been
 * REMOVED. Those values are now hardcoded for best performance in
 * services/video-loading.ts (see the PREWARM_* / HLS_WARM_SEGMENTS consts).
 * Only the delivery pipeline stays user-switchable.
 *
 * The mode lives in app_settings (key 'video_pipeline_mode') and is read
 * SYNCHRONOUSLY from a module cache because pickPlaybackSource runs in
 * render/scroll hot paths. The cache hydrates from a localStorage snapshot at
 * module init (so a returning session boots straight onto the right pipeline),
 * then from a Supabase read, then stays live via one realtime channel.
 */

export type VideoPipelineMode = 'hls' | 'mp4';

export const VIDEO_PIPELINE_MODE_KEY = 'video_pipeline_mode';
export const DEFAULT_VIDEO_PIPELINE_MODE: VideoPipelineMode = 'hls';

// Snapshot of the last-known mode so the NEXT boot starts on the right pipeline
// before the network round-trip resolves (first-ever visit falls back to the
// default for ~one feed paint, then corrects).
const SNAPSHOT_KEY = 'catalog:video-pipeline-mode';

function parseMode(raw: string | null | undefined): VideoPipelineMode {
  return (raw || '').trim().toLowerCase() === 'mp4' ? 'mp4' : 'hls';
}

function readSnapshot(): VideoPipelineMode {
  if (typeof localStorage === 'undefined') return DEFAULT_VIDEO_PIPELINE_MODE;
  try {
    return parseMode(localStorage.getItem(SNAPSHOT_KEY));
  } catch {
    return DEFAULT_VIDEO_PIPELINE_MODE;
  }
}

function writeSnapshot(m: VideoPipelineMode): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(SNAPSHOT_KEY, m); } catch { /* quota/private mode — non-fatal */ }
}

// ── Module state ──────────────────────────────────────────────────────
let mode: VideoPipelineMode = readSnapshot();
const subscribers = new Set<(m: VideoPipelineMode) => void>();
let hydratePromise: Promise<VideoPipelineMode> | null = null;
let hydrateRetryTimer: ReturnType<typeof setTimeout> | null = null;
let channelOpen = false;

function setMode(next: VideoPipelineMode): void {
  if (next === mode) return;
  mode = next;
  writeSnapshot(mode);
  for (const cb of subscribers) cb(mode);
}

// ── Sync read (hot path: pickPlaybackSource) ──────────────────────────
export function videoPipelineMode(): VideoPipelineMode {
  return mode;
}

// ── Hydration + realtime ──────────────────────────────────────────────

function openChannelOnce(): void {
  if (channelOpen || !supabase) return;
  channelOpen = true;
  supabase
    .channel('dials:video_pipeline')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'app_settings',
        filter: `key=eq.${VIDEO_PIPELINE_MODE_KEY}`,
      },
      (payload) => {
        const row = payload.new as { key?: string; value?: string } | null;
        if (row?.key === VIDEO_PIPELINE_MODE_KEY) setMode(parseMode(row.value));
      },
    )
    .subscribe();
  // Channel lives for the page lifetime — the mode is global and consumed by
  // non-React modules (video-loading, trailPrefetch), so there's no idle
  // teardown like the per-hook dial channels.
}

/** Read the pipeline mode once and keep the cache live via realtime.
 *  Memoized; call early in app boot (next to prefetchDials) and from the admin
 *  card. Never throws — on failure the snapshot/default stands. */
export function hydrateVideoPipeline(): Promise<VideoPipelineMode> {
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    if (!supabase) return mode;
    openChannelOnce();
    const { data, error } = await supabase
      .from('app_settings').select('value').eq('key', VIDEO_PIPELINE_MODE_KEY).maybeSingle();
    if (error) {
      console.warn('[video-pipeline] hydrate failed:', error.message);
      // Don't clear the memo immediately: useVideoPipelineMode() calls hydrate
      // on every card mount, so clear-on-error would fan out one failed query
      // per card across an infinite feed. Keep the memo and schedule ONE delayed
      // reset so recovery is still possible without the retry storm. Realtime
      // updates still flow via the already-open channel meanwhile.
      if (typeof window !== 'undefined' && hydrateRetryTimer == null) {
        hydrateRetryTimer = setTimeout(() => {
          hydrateRetryTimer = null;
          hydratePromise = null;
        }, 60_000);
      }
      return mode;
    }
    if (hydrateRetryTimer != null) { clearTimeout(hydrateRetryTimer); hydrateRetryTimer = null; }
    setMode(parseMode((data as { value?: string } | null)?.value));
    return mode;
  })();
  return hydratePromise;
}

/** Re-render hook plumbing: fires with the new mode on any change (hydrate
 *  resolve, realtime push, local admin save). */
export function subscribeVideoPipeline(cb: (m: VideoPipelineMode) => void): () => void {
  subscribers.add(cb);
  return () => { subscribers.delete(cb); };
}

// ── Admin write ───────────────────────────────────────────────────────

/** Persist the pipeline mode and apply it locally right away (the admin's own
 *  device shouldn't wait for the realtime echo). Throws on failure so the dial
 *  card can surface an error. */
export async function saveVideoPipelineMode(next: VideoPipelineMode): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from('app_settings').upsert([{ key: VIDEO_PIPELINE_MODE_KEY, value: next }], { onConflict: 'key' });
  if (error) throw error;
  setMode(next);
}

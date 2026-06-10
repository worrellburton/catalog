import { supabase } from '~/utils/supabase';

/**
 * Global video-delivery pipeline config — the admin dial that switches the
 * whole app between two independent playback paths:
 *
 *   'hls' (default) — adaptive ladder. pickPlaybackSource prefers
 *         hls_url/primary_hls_url, playback goes through hls.js / native
 *         HLS, and prewarm uses prefetchHlsHead (manifest + first segments).
 *   'mp4'           — the legacy progressive path. hls_url columns are
 *         ignored everywhere, playback is plain `el.src = mp4`, and prewarm
 *         uses prefetchVideoBytes (full-file GET into the HTTP cache).
 *
 * Plus the prewarm/cache knobs both paths share. Values live in
 * app_settings (one text row per key, same table as services/dials.ts) and
 * are read SYNCHRONOUSLY from a module cache because the consumers
 * (pickPlaybackSource, prefetchVideoBytes) run in render/scroll hot paths.
 * The cache hydrates from a localStorage snapshot at module init (so a
 * returning session boots straight into the right pipeline), then from a
 * batched Supabase read, then stays live via one realtime channel.
 */

export type VideoPipelineMode = 'hls' | 'mp4';
/** RequestCache subset used for prewarm fetches: 'default' = normal HTTP
 *  cache, 'reload' = always revalidate with the server, 'no-store' = bypass
 *  the cache entirely (turns prewarming into pure connection warming). */
export type PrewarmCacheMode = 'default' | 'reload' | 'no-store';

export interface VideoPipelineConfig {
  mode: VideoPipelineMode;
  /** Master switch for ALL video prewarming (MP4 byte prefetch, HLS head
   *  warm, trail <link rel=preload as=video>). Posters are unaffected. */
  prewarmEnabled: boolean;
  /** Max concurrent MP4 full-file prefetches (1..8). */
  prewarmConcurrency: number;
  /** Max queued MP4 prefetch URLs before the oldest are dropped (2..30). */
  prewarmQueueCap: number;
  /** Media segments warmed per HLS clip head, 0..4 (0 = manifest+init only). */
  hlsWarmSegments: number;
  /** fetch() cache mode for prewarm requests. */
  cacheMode: PrewarmCacheMode;
}

export const VIDEO_PIPELINE_MODE_KEY        = 'video_pipeline_mode';
export const VIDEO_PREWARM_ENABLED_KEY      = 'video_prewarm_enabled';
export const VIDEO_PREWARM_CONCURRENCY_KEY  = 'video_prewarm_concurrency';
export const VIDEO_PREWARM_QUEUE_CAP_KEY    = 'video_prewarm_queue_cap';
export const VIDEO_HLS_WARM_SEGMENTS_KEY    = 'video_hls_warm_segments';
export const VIDEO_PREWARM_CACHE_MODE_KEY   = 'video_prewarm_cache_mode';

const ALL_KEYS = [
  VIDEO_PIPELINE_MODE_KEY,
  VIDEO_PREWARM_ENABLED_KEY,
  VIDEO_PREWARM_CONCURRENCY_KEY,
  VIDEO_PREWARM_QUEUE_CAP_KEY,
  VIDEO_HLS_WARM_SEGMENTS_KEY,
  VIDEO_PREWARM_CACHE_MODE_KEY,
] as const;

export const DEFAULT_VIDEO_PIPELINE: VideoPipelineConfig = {
  mode: 'hls',
  prewarmEnabled: true,
  prewarmConcurrency: 4,
  prewarmQueueCap: 10,
  hlsWarmSegments: 2,
  cacheMode: 'default',
};

// Snapshot of the last-known config so the NEXT boot starts on the right
// pipeline before the network round-trip resolves (first-ever visit falls
// back to defaults for ~one feed paint, then corrects).
const SNAPSHOT_KEY = 'catalog:video-pipeline';

function clampInt(raw: string | null | undefined, fallback: number, min: number, max: number): number {
  if (raw == null) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function parseConfig(byKey: Map<string, string | null>): VideoPipelineConfig {
  const modeRaw = (byKey.get(VIDEO_PIPELINE_MODE_KEY) || '').trim().toLowerCase();
  const cacheRaw = (byKey.get(VIDEO_PREWARM_CACHE_MODE_KEY) || '').trim().toLowerCase();
  const enabledRaw = byKey.get(VIDEO_PREWARM_ENABLED_KEY);
  return {
    mode: modeRaw === 'mp4' ? 'mp4' : 'hls',
    prewarmEnabled: enabledRaw == null
      ? DEFAULT_VIDEO_PIPELINE.prewarmEnabled
      : enabledRaw.trim().toLowerCase() === 'true',
    prewarmConcurrency: clampInt(byKey.get(VIDEO_PREWARM_CONCURRENCY_KEY), DEFAULT_VIDEO_PIPELINE.prewarmConcurrency, 1, 8),
    prewarmQueueCap: clampInt(byKey.get(VIDEO_PREWARM_QUEUE_CAP_KEY), DEFAULT_VIDEO_PIPELINE.prewarmQueueCap, 2, 30),
    hlsWarmSegments: clampInt(byKey.get(VIDEO_HLS_WARM_SEGMENTS_KEY), DEFAULT_VIDEO_PIPELINE.hlsWarmSegments, 0, 4),
    cacheMode: cacheRaw === 'reload' || cacheRaw === 'no-store' ? cacheRaw : 'default',
  };
}

function readSnapshotRaw(): Map<string, string | null> | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw) as Record<string, string | null>;
    const m = new Map<string, string | null>();
    // Only trust known keys so a corrupt/old snapshot can't inject junk.
    for (const k of ALL_KEYS) if (k in obj) m.set(k, obj[k] ?? null);
    return m;
  } catch {
    return null;
  }
}

function writeSnapshot(byKey: Map<string, string | null>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(Object.fromEntries(byKey)));
  } catch { /* quota/private mode — non-fatal */ }
}

// ── Module state ──────────────────────────────────────────────────────
// rawByKey keeps the raw text values so realtime single-key updates and the
// snapshot don't lose keys that arrived earlier. SEED it from the snapshot
// before computing config: a partial update (single-key realtime push or a
// local save) that lands before the batch hydrate must merge onto the
// snapshot's keys — otherwise parseConfig(rawByKey) would recompute the whole
// config from one key and silently reset every other dial to its default
// (and writeSnapshot would then persist that one-key map, corrupting the boot
// snapshot for the next session too).
const rawByKey = new Map<string, string | null>();
const _snapshot = readSnapshotRaw();
if (_snapshot) _snapshot.forEach((v, k) => rawByKey.set(k, v));
let config: VideoPipelineConfig = parseConfig(rawByKey);
const subscribers = new Set<(cfg: VideoPipelineConfig) => void>();
let hydratePromise: Promise<VideoPipelineConfig> | null = null;
let hydrateRetryTimer: ReturnType<typeof setTimeout> | null = null;
let channelOpen = false;

function notify(): void {
  for (const cb of subscribers) cb(config);
}

function applyRaw(updates: Map<string, string | null>): void {
  updates.forEach((v, k) => rawByKey.set(k, v));
  config = parseConfig(rawByKey);
  writeSnapshot(rawByKey);
  notify();
}

// ── Sync reads (hot paths: pickPlaybackSource, prewarm queues) ────────

export function getVideoPipelineConfig(): VideoPipelineConfig {
  return config;
}

export function videoPipelineMode(): VideoPipelineMode {
  return config.mode;
}

export function videoPrewarmEnabled(): boolean {
  return config.prewarmEnabled;
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
        filter: `key=in.(${ALL_KEYS.join(',')})`,
      },
      (payload) => {
        const row = payload.new as { key?: string; value?: string } | null;
        if (!row?.key) return;
        applyRaw(new Map([[row.key, row.value ?? null]]));
      },
    )
    .subscribe();
  // Channel lives for the page lifetime — the pipeline config is global and
  // consumed by non-React modules (video-loading, trailPrefetch), so there is
  // no idle teardown like the per-hook dial channels.
}

/** Batch-read every pipeline key once and keep the cache live via realtime.
 *  Memoized; call early in app boot (next to prefetchDials) and from the
 *  admin card. Never throws — on failure the snapshot/defaults stand. */
export function hydrateVideoPipeline(): Promise<VideoPipelineConfig> {
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    if (!supabase) return config;
    openChannelOnce();
    const { data, error } = await supabase
      .from('app_settings').select('key, value').in('key', ALL_KEYS as unknown as string[]);
    if (error) {
      console.warn('[video-pipeline] hydrate failed:', error.message);
      // Don't clear the memo immediately: useVideoPipelineMode() calls hydrate
      // on every card mount, so clear-on-error would fan out one failed query
      // per card across an infinite feed. Keep the memo and schedule ONE
      // delayed reset so recovery is still possible without the retry storm.
      // Realtime updates still flow via the already-open channel meanwhile.
      if (typeof window !== 'undefined' && hydrateRetryTimer == null) {
        hydrateRetryTimer = setTimeout(() => {
          hydrateRetryTimer = null;
          hydratePromise = null;
        }, 60_000);
      }
      return config;
    }
    // Success — cancel any pending retry from a previous failed attempt.
    if (hydrateRetryTimer != null) { clearTimeout(hydrateRetryTimer); hydrateRetryTimer = null; }
    const updates = new Map<string, string | null>();
    const fetched = new Map(
      ((data as { key: string; value: string | null }[]) || []).map(r => [r.key, r.value ?? null]),
    );
    // Seed every key — a missing row records as null so parseConfig falls
    // back to that field's default instead of a stale snapshot value.
    for (const k of ALL_KEYS) updates.set(k, fetched.get(k) ?? null);
    applyRaw(updates);
    return config;
  })();
  return hydratePromise;
}

/** Re-render hook plumbing: fires with the full config on any change
 *  (hydrate resolve, realtime push, local admin save). */
export function subscribeVideoPipeline(cb: (cfg: VideoPipelineConfig) => void): () => void {
  subscribers.add(cb);
  return () => { subscribers.delete(cb); };
}

// ── Admin writes ──────────────────────────────────────────────────────

const KEY_BY_FIELD: Record<keyof VideoPipelineConfig, string> = {
  mode: VIDEO_PIPELINE_MODE_KEY,
  prewarmEnabled: VIDEO_PREWARM_ENABLED_KEY,
  prewarmConcurrency: VIDEO_PREWARM_CONCURRENCY_KEY,
  prewarmQueueCap: VIDEO_PREWARM_QUEUE_CAP_KEY,
  hlsWarmSegments: VIDEO_HLS_WARM_SEGMENTS_KEY,
  cacheMode: VIDEO_PREWARM_CACHE_MODE_KEY,
};

/** Persist a partial config change and apply it locally right away (the
 *  admin's own device shouldn't wait for the realtime echo). Throws on
 *  failure so the dial card can surface an error. */
export async function saveVideoPipelineConfig(partial: Partial<VideoPipelineConfig>): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const rows: { key: string; value: string }[] = [];
  for (const [field, value] of Object.entries(partial)) {
    if (value === undefined) continue;
    rows.push({ key: KEY_BY_FIELD[field as keyof VideoPipelineConfig], value: String(value) });
  }
  if (rows.length === 0) return;
  const { error } = await supabase.from('app_settings').upsert(rows, { onConflict: 'key' });
  if (error) throw error;
  applyRaw(new Map(rows.map(r => [r.key, r.value])));
}

import { supabase } from '~/utils/supabase';

/**
 * Video delivery pipeline dial — now split per device.
 *
 * Every consumer playback surface (feed, look cards, overlays, product heroes,
 * creator profiles — anything routed through pickPlaybackSource / the gated
 * `videoPipelineMode()` reads) runs on one of two independent delivery paths:
 *
 *   'hls' — adaptive ladder. pickPlaybackSource prefers hls_url/primary_hls_url,
 *           playback runs through hls.js / native HLS, and prewarm warms the
 *           manifest head (prefetchHlsHead).
 *   'mp4' — the legacy progressive path. hls_url columns are ignored everywhere,
 *           playback is plain `el.src = mp4`, and prewarm is a full-file byte
 *           fetch into the HTTP cache.
 *
 * The path is chosen PER DEVICE so we can run, e.g., HLS on phones (native HLS
 * on iOS, instant first frame on thin cellular) while desktop browsers stay on
 * progressive MP4:
 *
 *   • Desktop (>768px) → app_settings key 'video_pipeline_mode'        (default mp4)
 *   • Mobile  (≤768px) → app_settings key 'video_pipeline_mode_mobile' (default hls)
 *
 * `videoPipelineMode()` is the single sync read every hot path uses; it returns
 * the EFFECTIVE mode for the current viewport, so making it device-aware here
 * routes every existing consumer with no change at the call sites.
 *
 * Each device's mode is read SYNCHRONOUSLY from a module cache because
 * pickPlaybackSource runs in render/scroll hot paths. The cache hydrates from a
 * localStorage snapshot at module init (so a returning session boots straight
 * onto the right pipeline), then from a Supabase read, then stays live via one
 * realtime channel per device.
 *
 * Everything ELSE about warming — prewarm on/off, concurrency, queue depth,
 * cache mode, HLS head-segment count — is hardcoded for best performance in
 * services/video-loading.ts (PREWARM_* / HLS_WARM_SEGMENTS). Only the delivery
 * pipeline stays user-switchable.
 */

export type VideoPipelineMode = 'hls' | 'mp4';
export type PipelineDevice = 'desktop' | 'mobile';

export const VIDEO_PIPELINE_MODE_KEY = 'video_pipeline_mode';                  // desktop (legacy key — kept)
export const VIDEO_PIPELINE_MODE_MOBILE_KEY = 'video_pipeline_mode_mobile';    // mobile

export const DEFAULT_DESKTOP_PIPELINE_MODE: VideoPipelineMode = 'mp4';
export const DEFAULT_MOBILE_PIPELINE_MODE: VideoPipelineMode = 'hls';

// Mobile breakpoint — kept in sync with isMobileViewport() in video-loading.ts.
// Inlined here (not imported) to avoid a video-pipeline ⇄ video-loading import
// cycle, since video-loading imports videoPipelineMode() from this module.
const MOBILE_MAX_WIDTH = 768;
function isMobileViewportWidth(): boolean {
  if (typeof window === 'undefined') return false; // SSR → desktop pipeline
  return window.innerWidth <= MOBILE_MAX_WIDTH;
}

function parseMode(raw: string | null | undefined, fallback: VideoPipelineMode): VideoPipelineMode {
  const v = (raw || '').trim().toLowerCase();
  if (v === 'mp4') return 'mp4';
  if (v === 'hls') return 'hls';
  return fallback;
}

// ── Per-device channel state ──────────────────────────────────────────
// One record per device: the cached mode, its own snapshot/settings keys,
// hydration memo, realtime channel flag, and device-specific subscribers
// (the admin dial cards). Consumer surfaces don't subscribe per-device —
// they use the effective-mode subscription below.

interface DeviceChannel {
  device: PipelineDevice;
  settingsKey: string;
  snapshotKey: string;
  defaultMode: VideoPipelineMode;
  mode: VideoPipelineMode;
  subscribers: Set<(m: VideoPipelineMode) => void>;
  hydratePromise: Promise<VideoPipelineMode> | null;
  hydrateRetryTimer: ReturnType<typeof setTimeout> | null;
  channelOpen: boolean;
}

function readSnapshot(ch: DeviceChannel): VideoPipelineMode {
  if (typeof localStorage === 'undefined') return ch.defaultMode;
  try {
    return parseMode(localStorage.getItem(ch.snapshotKey), ch.defaultMode);
  } catch {
    return ch.defaultMode;
  }
}

function writeSnapshot(ch: DeviceChannel, m: VideoPipelineMode): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(ch.snapshotKey, m); } catch { /* quota/private mode — non-fatal */ }
}

function makeChannel(
  device: PipelineDevice,
  settingsKey: string,
  snapshotKey: string,
  defaultMode: VideoPipelineMode,
): DeviceChannel {
  const ch: DeviceChannel = {
    device, settingsKey, snapshotKey, defaultMode,
    mode: defaultMode,
    subscribers: new Set(),
    hydratePromise: null,
    hydrateRetryTimer: null,
    channelOpen: false,
  };
  // Boot the NEXT session straight onto the last-known mode for this device,
  // before the network round-trip resolves (first-ever visit falls back to the
  // default for ~one feed paint, then corrects).
  ch.mode = readSnapshot(ch);
  return ch;
}

const DESKTOP = makeChannel('desktop', VIDEO_PIPELINE_MODE_KEY, 'catalog:video-pipeline-mode', DEFAULT_DESKTOP_PIPELINE_MODE);
const MOBILE = makeChannel('mobile', VIDEO_PIPELINE_MODE_MOBILE_KEY, 'catalog:video-pipeline-mode-mobile', DEFAULT_MOBILE_PIPELINE_MODE);

function channelFor(device: PipelineDevice): DeviceChannel {
  return device === 'mobile' ? MOBILE : DESKTOP;
}

// Effective-mode subscribers — the consumer hook re-renders here on ANY device
// change (it re-reads videoPipelineMode() itself, so a change to the inactive
// device is a harmless no-op re-render).
const effectiveSubscribers = new Set<(m: VideoPipelineMode) => void>();

// One shared resize watcher (armed when the first consumer subscribes) flips the
// effective mode when the viewport crosses the mobile breakpoint and fans the
// change out through effectiveSubscribers. ONE listener for the whole app, not
// one per mounted card — the mobile feed keeps ~160 cards live, and iOS Safari
// fires 'resize' on address-bar collapse during normal scroll, so a per-hook
// listener would invoke ~160 callbacks on every scroll wobble. We early-out
// unless the EFFECTIVE mode actually changed, so non-crossing resizes cost ~O(1).
let resizeWatcherInstalled = false;
let lastEffectiveMode: VideoPipelineMode | null = null;
function installResizeWatcherOnce(): void {
  if (resizeWatcherInstalled || typeof window === 'undefined') return;
  resizeWatcherInstalled = true;
  lastEffectiveMode = videoPipelineMode();
  window.addEventListener('resize', () => {
    const eff = videoPipelineMode();
    if (eff === lastEffectiveMode) return; // no breakpoint crossing — nothing to do
    lastEffectiveMode = eff;
    for (const cb of effectiveSubscribers) cb(eff);
  });
}

function setChannelMode(ch: DeviceChannel, next: VideoPipelineMode): void {
  if (next === ch.mode) return;
  ch.mode = next;
  writeSnapshot(ch, next);
  for (const cb of ch.subscribers) cb(next);
  const eff = videoPipelineMode();
  lastEffectiveMode = eff; // keep the resize watcher's baseline in sync after a dial flip
  for (const cb of effectiveSubscribers) cb(eff);
}

// ── Sync reads (hot path: pickPlaybackSource) ─────────────────────────

/** The EFFECTIVE pipeline mode for the current viewport — mobile (≤768px) reads
 *  the mobile dial, everything else the desktop dial. Every consumer hot path
 *  funnels through this, so the device split needs no call-site changes. */
export function videoPipelineMode(): VideoPipelineMode {
  return (isMobileViewportWidth() ? MOBILE : DESKTOP).mode;
}

/** The raw mode configured for a specific device (admin dial cards). */
export function pipelineModeForDevice(device: PipelineDevice): VideoPipelineMode {
  return channelFor(device).mode;
}

// ── Hydration + realtime ──────────────────────────────────────────────

function openChannelOnce(ch: DeviceChannel): void {
  if (ch.channelOpen || !supabase) return;
  ch.channelOpen = true;
  supabase
    .channel(`dials:${ch.settingsKey}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'app_settings',
        filter: `key=eq.${ch.settingsKey}`,
      },
      (payload) => {
        const row = payload.new as { key?: string; value?: string } | null;
        if (row?.key === ch.settingsKey) setChannelMode(ch, parseMode(row.value, ch.defaultMode));
      },
    )
    .subscribe();
  // Channel lives for the page lifetime — the mode is global and consumed by
  // non-React modules (video-loading, trailPrefetch), so there's no idle
  // teardown like the per-hook dial channels.
}

/** Read one device's pipeline mode once and keep the cache live via realtime.
 *  Memoized per device; never throws — on failure the snapshot/default stands. */
function hydrateChannel(ch: DeviceChannel): Promise<VideoPipelineMode> {
  if (ch.hydratePromise) return ch.hydratePromise;
  ch.hydratePromise = (async () => {
    if (!supabase) return ch.mode;
    openChannelOnce(ch);
    const { data, error } = await supabase
      .from('app_settings').select('value').eq('key', ch.settingsKey).maybeSingle();
    if (error) {
      console.warn(`[video-pipeline] hydrate ${ch.device} failed:`, error.message);
      // Don't clear the memo immediately: the consumer hook + admin cards call
      // hydrate on every mount, so clear-on-error would fan out one failed query
      // per mount across an infinite feed. Keep the memo and schedule ONE delayed
      // reset so recovery is still possible without the retry storm. Realtime
      // updates still flow via the already-open channel meanwhile.
      if (typeof window !== 'undefined' && ch.hydrateRetryTimer == null) {
        ch.hydrateRetryTimer = setTimeout(() => {
          ch.hydrateRetryTimer = null;
          ch.hydratePromise = null;
        }, 60_000);
      }
      return ch.mode;
    }
    if (ch.hydrateRetryTimer != null) { clearTimeout(ch.hydrateRetryTimer); ch.hydrateRetryTimer = null; }
    setChannelMode(ch, parseMode((data as { value?: string } | null)?.value, ch.defaultMode));
    return ch.mode;
  })();
  return ch.hydratePromise;
}

/** Hydrate BOTH device pipelines and keep them live. Memoized per device; call
 *  early in app boot (next to prefetchDials). Never throws. */
export function hydrateVideoPipeline(): Promise<void> {
  return Promise.all([hydrateChannel(DESKTOP), hydrateChannel(MOBILE)]).then(() => {});
}

/** Hydrate a single device's pipeline (admin dial cards await this to render
 *  their loaded state). */
export function hydratePipelineDevice(device: PipelineDevice): Promise<VideoPipelineMode> {
  return hydrateChannel(channelFor(device));
}

// ── Re-render plumbing ────────────────────────────────────────────────

/** Consumer surfaces: fires with the device-aware EFFECTIVE mode whenever
 *  EITHER device's setting changes (hydrate resolve, realtime push, local admin
 *  save) OR the viewport crosses the mobile breakpoint (via one shared resize
 *  watcher armed on the first subscribe — no per-card listener). */
export function subscribeVideoPipeline(cb: (m: VideoPipelineMode) => void): () => void {
  effectiveSubscribers.add(cb);
  installResizeWatcherOnce();
  return () => { effectiveSubscribers.delete(cb); };
}

/** Admin dial cards: fires with the device-specific mode on changes to that
 *  device only. */
export function subscribePipelineDevice(device: PipelineDevice, cb: (m: VideoPipelineMode) => void): () => void {
  const ch = channelFor(device);
  ch.subscribers.add(cb);
  return () => { ch.subscribers.delete(cb); };
}

// ── Admin write ───────────────────────────────────────────────────────

/** Persist a device's pipeline mode and apply it locally right away (the
 *  admin's own device shouldn't wait for the realtime echo). Throws on failure
 *  so the dial card can surface an error. */
export async function savePipelineMode(device: PipelineDevice, next: VideoPipelineMode): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const ch = channelFor(device);
  const { error } = await supabase
    .from('app_settings').upsert([{ key: ch.settingsKey, value: next }], { onConflict: 'key' });
  if (error) throw error;
  setChannelMode(ch, next);
}

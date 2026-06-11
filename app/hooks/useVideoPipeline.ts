import { useEffect, useState } from 'react';
import {
  videoPipelineMode,
  hydrateVideoPipeline,
  subscribeVideoPipeline,
  type VideoPipelineMode,
} from '~/services/video-pipeline';

/**
 * Returns the EFFECTIVE video pipeline mode ('hls' | 'mp4') for THIS device and
 * re-renders the caller when it could change: the admin flips either dial
 * (hydrate resolve / realtime push) OR the viewport crosses the mobile
 * breakpoint (desktop window resize), since the mode is device-aware (mobile →
 * mobile dial, desktop → desktop dial). The service module owns the single
 * fetch + single realtime channel per device, so the LookCard/CreativeCardV2
 * fan-out costs nothing extra per mount.
 *
 * Components that pick a playback source during render (pickPlaybackSource,
 * inline hls_url reads) MUST call this so a mid-session mode switch — or a
 * resize across 768px — re-routes their <video> source instead of leaving a
 * stale pipeline live.
 */
export function useVideoPipelineMode(): VideoPipelineMode {
  const [mode, setMode] = useState<VideoPipelineMode>(videoPipelineMode());

  useEffect(() => {
    const sync = () => setMode(videoPipelineMode());
    // subscribeVideoPipeline fires on any dial change AND on a viewport
    // breakpoint crossing (the service arms ONE shared resize watcher), so the
    // device-aware effective mode stays live without a per-card resize listener.
    const unsub = subscribeVideoPipeline(sync);
    // Sync once on mount in case the cached/effective mode changed between the
    // lazy initial state read and this effect firing.
    sync();
    void hydrateVideoPipeline();
    return unsub;
  }, []);

  return mode;
}

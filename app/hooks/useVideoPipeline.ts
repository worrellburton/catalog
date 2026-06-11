import { useEffect, useState } from 'react';
import {
  videoPipelineMode,
  hydrateVideoPipeline,
  subscribeVideoPipeline,
  type VideoPipelineMode,
} from '~/services/video-pipeline';

/**
 * Returns the current video pipeline mode ('hls' | 'mp4') and re-renders the
 * caller when the admin flips the dial (hydrate resolve or realtime push).
 * The service module owns the single fetch + single realtime channel, so
 * the LookCard/CreativeCardV2 fan-out costs nothing extra per mount.
 *
 * Components that pick a playback source during render (pickPlaybackSource,
 * inline hls_url reads) MUST call this so a mid-session mode switch
 * re-routes their <video> source instead of leaving a stale pipeline live.
 */
export function useVideoPipelineMode(): VideoPipelineMode {
  const [mode, setMode] = useState<VideoPipelineMode>(videoPipelineMode());

  useEffect(() => {
    const unsub = subscribeVideoPipeline(setMode);
    // Sync once on mount in case the cached mode changed between the lazy
    // initial state read and this effect firing.
    setMode(videoPipelineMode());
    void hydrateVideoPipeline();
    return unsub;
  }, []);

  return mode;
}

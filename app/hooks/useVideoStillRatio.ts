import { useEffect, useState } from 'react';
import {
  getVideoStillRatio,
  subscribeVideoStillRatio,
  DEFAULT_VIDEO_STILL_RATIO,
} from '~/services/dials';

// Module-level singleton cache + subscriber set. Lots of LookCards
// will call useVideoStillRatio() — we don't want N round-trips on
// mount or N Supabase channels, so the first hook fetches + opens
// the channel and every subsequent hook just subscribes to the
// in-memory value.
let cachedRatio = DEFAULT_VIDEO_STILL_RATIO;
let hydrated = false;
let inflightHydrate: Promise<void> | null = null;
let channelUnsub: (() => void) | null = null;
const subscribers = new Set<(v: number) => void>();

function notify() {
  for (const cb of subscribers) cb(cachedRatio);
}

function hydrate() {
  if (hydrated || inflightHydrate) return inflightHydrate ?? Promise.resolve();
  inflightHydrate = getVideoStillRatio().then(v => {
    cachedRatio = v;
    hydrated = true;
    inflightHydrate = null;
    notify();
  });
  return inflightHydrate;
}

function openChannelIfNeeded() {
  if (channelUnsub) return;
  channelUnsub = subscribeVideoStillRatio(v => {
    cachedRatio = v;
    notify();
  });
}

function closeChannelIfIdle() {
  if (channelUnsub && subscribers.size === 0) {
    channelUnsub();
    channelUnsub = null;
  }
}

/**
 * Returns the current Video → Still image ratio (0..100) and
 * re-renders the caller when it changes (either via initial fetch
 * or a realtime push). All callers share a single fetch + a single
 * Supabase channel — the module-level singleton above guards against
 * the LookCard fan-out hitting the network N times on mount.
 *
 * Cards should compute shouldBeVideo(cardId, ratio) (Phase 6) to
 * decide whether to render as video or still.
 */
export function useVideoStillRatio(): number {
  const [ratio, setRatio] = useState<number>(cachedRatio);

  useEffect(() => {
    subscribers.add(setRatio);
    openChannelIfNeeded();
    // Always sync once on mount in case cachedRatio changed
    // between the lazy initial state read and this effect firing.
    setRatio(cachedRatio);
    void hydrate();
    return () => {
      subscribers.delete(setRatio);
      closeChannelIfIdle();
    };
  }, []);

  return ratio;
}

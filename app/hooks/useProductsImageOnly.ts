import { useEffect, useState } from 'react';
import {
  getProductsImageOnly,
  subscribeProductsImageOnly,
  DEFAULT_PRODUCTS_IMAGE_ONLY,
} from '~/services/dials';

/**
 * Returns the current "products image-only" dial value (boolean) and
 * re-renders the caller when it changes via realtime push.
 *
 * When TRUE, the consumer feed renders product tiles as static
 * images — looks (cards with a look_id) still play video. Mirrors
 * the useVideoStillRatio singleton pattern: one Supabase channel
 * shared across every CreativeCard, no N+1 round-trips on mount.
 */
let cached = DEFAULT_PRODUCTS_IMAGE_ONLY;
let hydrated = false;
let inflightHydrate: Promise<void> | null = null;
let channelUnsub: (() => void) | null = null;
const subscribers = new Set<(v: boolean) => void>();

function notify() {
  for (const cb of subscribers) cb(cached);
}

function hydrate() {
  if (hydrated || inflightHydrate) return inflightHydrate ?? Promise.resolve();
  inflightHydrate = getProductsImageOnly().then(v => {
    cached = v;
    hydrated = true;
    inflightHydrate = null;
    notify();
  });
  return inflightHydrate;
}

function openChannelIfNeeded() {
  if (channelUnsub) return;
  channelUnsub = subscribeProductsImageOnly(v => {
    cached = v;
    notify();
  });
}

function closeChannelIfIdle() {
  if (channelUnsub && subscribers.size === 0) {
    channelUnsub();
    channelUnsub = null;
  }
}

export function useProductsImageOnly(): boolean {
  const [value, setValue] = useState<boolean>(cached);
  useEffect(() => {
    subscribers.add(setValue);
    openChannelIfNeeded();
    setValue(cached);
    void hydrate();
    return () => {
      subscribers.delete(setValue);
      closeChannelIfIdle();
    };
  }, []);
  return value;
}

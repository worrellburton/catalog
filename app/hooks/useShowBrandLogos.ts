import { useEffect, useState } from 'react';
import {
  getShowBrandLogos,
  subscribeShowBrandLogos,
  DEFAULT_SHOW_BRAND_LOGOS,
} from '~/services/dials';

/**
 * Returns the current "show brand logos" dial value (boolean) and
 * re-renders the caller when it changes via realtime push. Mirrors
 * the singleton pattern in useVideoStillRatio + useProductsImageOnly
 * so the consumer feed doesn't fan out N supabase channels.
 */
let cached = DEFAULT_SHOW_BRAND_LOGOS;
let hydrated = false;
let inflightHydrate: Promise<void> | null = null;
let channelUnsub: (() => void) | null = null;
const subscribers = new Set<(v: boolean) => void>();

function notify() { for (const cb of subscribers) cb(cached); }

function hydrate() {
  if (hydrated || inflightHydrate) return inflightHydrate ?? Promise.resolve();
  inflightHydrate = getShowBrandLogos().then(v => {
    cached = v; hydrated = true; inflightHydrate = null; notify();
  });
  return inflightHydrate;
}

function openChannelIfNeeded() {
  if (channelUnsub) return;
  channelUnsub = subscribeShowBrandLogos(v => { cached = v; notify(); });
}

function closeChannelIfIdle() {
  if (channelUnsub && subscribers.size === 0) { channelUnsub(); channelUnsub = null; }
}

export function useShowBrandLogos(): boolean {
  const [value, setValue] = useState<boolean>(cached);
  useEffect(() => {
    subscribers.add(setValue);
    openChannelIfNeeded();
    setValue(cached);
    void hydrate();
    return () => { subscribers.delete(setValue); closeChannelIfIdle(); };
  }, []);
  return value;
}

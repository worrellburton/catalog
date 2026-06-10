import { useEffect, useState } from 'react';
import {
  getCommentsEnabled,
  subscribeCommentsEnabled,
  DEFAULT_COMMENTS_ENABLED,
} from '~/services/dials';

/**
 * Returns the current "comments enabled" dial value and re-renders the
 * caller when an admin flips it (realtime). Singleton store so the feed's
 * many product/look surfaces share ONE supabase channel rather than
 * fanning out N subscriptions — mirrors useShowBrandLogos.
 */
let cached = DEFAULT_COMMENTS_ENABLED;
let hydrated = false;
let inflightHydrate: Promise<void> | null = null;
let channelUnsub: (() => void) | null = null;
const subscribers = new Set<(v: boolean) => void>();

function notify() { for (const cb of subscribers) cb(cached); }

function hydrate() {
  if (hydrated || inflightHydrate) return inflightHydrate ?? Promise.resolve();
  inflightHydrate = getCommentsEnabled().then(v => {
    cached = v; hydrated = true; inflightHydrate = null; notify();
  });
  return inflightHydrate;
}

function openChannelIfNeeded() {
  if (channelUnsub) return;
  channelUnsub = subscribeCommentsEnabled(v => { cached = v; notify(); });
}

function closeChannelIfIdle() {
  if (channelUnsub && subscribers.size === 0) { channelUnsub(); channelUnsub = null; }
}

export function useCommentsEnabled(): boolean {
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

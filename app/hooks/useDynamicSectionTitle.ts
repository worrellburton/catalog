// useDynamicSectionTitle — supplies the heading for the personalized
// "you might also like" feed. Re-rolls a fresh joke-y line every time the
// section is shown (per `regenKey`), instantly from the local generator, and
// transparently upgrades to a Claude-written line when the edge function is
// deployed. See services/dynamic-feed-name.ts.

import { useEffect, useState } from 'react';
import type { UserAffinity } from '~/services/user-affinity';
import {
  DEFAULT_FEED_NAME,
  generateLocalFeedName,
  fetchClaudeFeedName,
} from '~/services/dynamic-feed-name';

// Session cache of Claude lines, keyed by dominant category, so we ask Claude
// at most once per category per session instead of on every product open.
const claudeCache = new Map<string, string>();

/**
 * @param affinity  the shopper's category affinity
 * @param regenKey  changes (e.g. product/look id) trigger a fresh title roll
 */
export function useDynamicSectionTitle(affinity: UserAffinity, regenKey: string | number): string {
  const [title, setTitle] = useState<string>(() => generateLocalFeedName(affinity));

  useEffect(() => {
    let cancelled = false;
    // Instant local line — fresh on every view so the heading reads as a new
    // joke even before (or without) the Claude upgrade.
    setTitle(generateLocalFeedName(affinity));

    const dominant = affinity.dominant;
    if (!dominant) return;

    const cached = claudeCache.get(dominant);
    if (cached) {
      setTitle(cached);
      return;
    }

    fetchClaudeFeedName(affinity).then(name => {
      if (cancelled || !name) return;
      claudeCache.set(dominant, name);
      setTitle(name);
    });

    return () => {
      cancelled = true;
    };
    // affinity.dominant/total capture the signal; regenKey forces a re-roll.
  }, [affinity, regenKey]);

  return title || DEFAULT_FEED_NAME;
}

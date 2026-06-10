// dynamic-feed-name — names the personalized "you might also like" feed.
//
// Robert's brief: keep the infinite feed, but reframe it as a section whose
// title changes every time the shopper sees it — "kind of a joke about what
// it is about." The joke is the shopper's own behaviour: if they keep tapping
// shoes, the section leans into that ("Yes, more shoes. We get you. 👟").
//
// Two layers:
//   • generateLocalFeedName() — instant, offline, varied. Always available so
//     the heading never blocks on the network and still feels fresh per view.
//   • fetchClaudeFeedName() — optional upgrade. Calls the `dynamic-feed-name`
//     edge function (Claude) for a sharper one-off line, degrading silently to
//     the local generator if the function isn't deployed / errors out (same
//     pattern as catalog-brainstorm).

import { supabase } from '~/utils/supabase';
import type { UserAffinity } from '~/services/user-affinity';

/** Neutral fallback when there's no behavioural signal yet. */
export const DEFAULT_FEED_NAME = 'You might also like';

// Joke-y line pools keyed by dominant category. {n} interpolates a friendly
// label for the category. Generic pool covers anything without a bespoke set.
const CATEGORY_LABELS: Record<string, string> = {
  shoes: 'shoes',
  sneakers: 'sneakers',
  boots: 'boots',
  sandals: 'sandals',
  bag: 'bags',
  bags: 'bags',
  top: 'tops',
  tops: 'tops',
  dress: 'dresses',
  dresses: 'dresses',
  pants: 'pants',
  jacket: 'jackets',
  jackets: 'jackets',
  jewelry: 'jewelry',
  eyewear: 'eyewear',
  sunglasses: 'sunglasses',
  accessory: 'accessories',
  accessories: 'accessories',
  hat: 'hats',
};

const CATEGORY_LINES = [
  'Yes, more {n}. We get you.',
  'You + {n} = 🫶',
  "Because you can't stop looking at {n}",
  'The {n} rabbit hole, continued',
  'Okay but have you seen these {n}?',
  'Your {n} obsession, fully enabled',
  'More {n}, since you asked (you did ask)',
  'A wild amount of {n}, just for you',
];

const GENERIC_LINES = [
  'Picked because of your taste',
  'Stuff you keep gravitating toward',
  'Curated from your scroll history',
  'More of what caught your eye',
  'Things that are very you',
  'Tuned to whatever you’re into lately',
];

function labelFor(type: string | null): string | null {
  if (!type) return null;
  return CATEGORY_LABELS[type] ?? (type.length <= 14 ? type : null);
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Build a witty section name from the shopper's affinity. Returns a fresh line
 * on each call (random pick) so the heading reads as a new joke every view.
 * Falls back to DEFAULT_FEED_NAME when affinity is cold.
 */
export function generateLocalFeedName(affinity: UserAffinity): string {
  const label = labelFor(affinity.dominant);
  if (!label || affinity.total < 1.5) {
    // Cold-ish: either neutral default or a soft generic line.
    return affinity.total >= 1 ? pick(GENERIC_LINES) : DEFAULT_FEED_NAME;
  }
  return pick(CATEGORY_LINES).replace('{n}', label);
}

interface ClaudeNameResponse {
  success?: boolean;
  name?: string;
  source?: string;
}

/**
 * Ask Claude (via the `dynamic-feed-name` edge function) for a sharper, one-off
 * section title. Resolves to null on any failure (function not deployed,
 * network error, empty result) — callers should fall back to the local name.
 */
export async function fetchClaudeFeedName(affinity: UserAffinity): Promise<string | null> {
  if (!supabase || !affinity.dominant) return null;
  try {
    const { data, error } = await supabase.functions.invoke<ClaudeNameResponse>('dynamic-feed-name', {
      body: { topTypes: affinity.topTypes.slice(0, 4), dominant: affinity.dominant },
    });
    if (error || !data?.success) return null;
    const name = (data.name || '').trim();
    return name.length > 0 && name.length <= 60 ? name : null;
  } catch {
    return null;
  }
}

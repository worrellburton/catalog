// user-affinity — derives a per-shopper category affinity from local signals
// (products tapped + searches run) so the feed can lean toward what they
// actually engage with. Robert's brief: "the user clicks on a lot of shoes →
// show shoes." This is the signal layer; the feed re-rank lives in
// rankCreativesByAffinity below, consumed by ContinuousFeed.
//
// Pure functions only — no React, no I/O. The hook (hooks/useUserAffinity.ts)
// reads localStorage and feeds the raw arrays in here.

import type { Product } from '~/data/looks';
import { resolveCatalogTypes } from '~/services/product-creative';

// ── Types ──────────────────────────────────────────────────────────────────

export interface AffinityEntry {
  /** Normalized broad category, e.g. "shoes", "top", "bag". */
  type: string;
  /** Recency-weighted score (higher = stronger lean). */
  weight: number;
}

export interface UserAffinity {
  /** All categories the shopper has touched, strongest first. */
  entries: AffinityEntry[];
  /** Convenience: the top category labels, strongest first. */
  topTypes: string[];
  /** The single dominant category, or null when there's no signal yet. */
  dominant: string | null;
  /** Total weighted signal — used as a confidence gate before re-ranking. */
  total: number;
}

const EMPTY_AFFINITY: UserAffinity = { entries: [], topTypes: [], dominant: null, total: 0 };

// Per-step recency decay applied down the newest-first lists. The most recent
// interaction counts ~1.0, the 10th ~0.6, so old behaviour fades without ever
// fully disappearing.
const RECENCY_DECAY = 0.95;
// A search term is a weaker intent signal than an actual product tap, so it
// contributes a fraction of a tap's weight.
const SEARCH_WEIGHT = 0.5;
// Below this much total signal we treat affinity as "cold" and leave the feed
// in its natural order (avoids a 2-tap fluke reshaping the whole feed).
export const AFFINITY_MIN_SIGNAL = 1.5;

const normalizeType = (t: string | null | undefined): string =>
  (t || '').trim().toLowerCase();

// ── Compute ─────────────────────────────────────────────────────────────────

/**
 * Build a category affinity from the shopper's recent products (newest-first)
 * and recent searches (newest-first). Searches are mapped to canonical product
 * types via the same `resolveCatalogTypes` table the search bar uses, so a run
 * of "sneakers" / "running shoes" searches reinforces the Shoes lean.
 */
export function computeAffinity(recentProducts: Product[], recentSearches: string[] = []): UserAffinity {
  const weights = new Map<string, number>();
  const add = (type: string, w: number) => {
    if (!type) return;
    weights.set(type, (weights.get(type) ?? 0) + w);
  };

  recentProducts.forEach((p, i) => {
    const type = normalizeType(p?.type) || normalizeType(p?.subtype);
    if (!type) return;
    add(type, Math.pow(RECENCY_DECAY, i));
  });

  recentSearches.forEach((q, i) => {
    const types = resolveCatalogTypes(q);
    if (!types || types.length === 0) return;
    const w = Math.pow(RECENCY_DECAY, i) * SEARCH_WEIGHT;
    // A query can map to several canonical types ("shoes" → footwear set);
    // split the weight so a multi-type term doesn't outweigh a precise one.
    const share = w / types.length;
    types.forEach(t => add(normalizeType(t), share));
  });

  if (weights.size === 0) return EMPTY_AFFINITY;

  const entries: AffinityEntry[] = [...weights.entries()]
    .map(([type, weight]) => ({ type, weight }))
    .sort((a, b) => b.weight - a.weight);
  const total = entries.reduce((sum, e) => sum + e.weight, 0);

  return {
    entries,
    topTypes: entries.map(e => e.type),
    dominant: entries[0]?.type ?? null,
    total,
  };
}

// ── Re-rank ──────────────────────────────────────────────────────────────────

// How many positions a maximally-favoured item can climb. Kept small on
// purpose: a soft nudge that surfaces more of what the shopper likes near the
// top while preserving the feed's variety (it never collapses into an
// all-one-category wall). Exported so the super-admin "why" debug panel can
// report the exact climb each category earns.
export const MAX_PROMOTION = 6;

interface RankableCreative {
  product?: { type?: string | null } | null;
}

/**
 * Soft, variety-preserving affinity re-rank. Each item's effective position is
 * pulled forward by an amount proportional to how strongly the shopper leans
 * toward its category (capped at MAX_PROMOTION). A stable sort on the adjusted
 * position keeps same-score items in their original relative order, so the feed
 * stays diverse instead of clustering every favoured item at the very top.
 *
 * Returns the input untouched when the signal is too weak to act on.
 */
export function rankCreativesByAffinity<T extends RankableCreative>(items: T[], affinity: UserAffinity): T[] {
  if (affinity.total < AFFINITY_MIN_SIGNAL || items.length < 4) return items;

  // Normalize weights to 0..1 against the strongest category so the dominant
  // lean gets the full MAX_PROMOTION and weaker ones a proportional slice.
  const maxWeight = affinity.entries[0]?.weight ?? 0;
  if (maxWeight <= 0) return items;
  const boostFor = (type: string | null | undefined): number => {
    const t = normalizeType(type);
    if (!t) return 0;
    const entry = affinity.entries.find(e => e.type === t);
    if (!entry) return 0;
    return (entry.weight / maxWeight) * MAX_PROMOTION;
  };

  return items
    .map((item, index) => ({ item, index, score: index - boostFor(item.product?.type) }))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map(x => x.item);
}

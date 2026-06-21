// Shared "weave looks + products by feed_rank" ordering — the SINGLE source of
// truth used by both the live home feed (FeedSection's initial deck) and the
// admin Daily Feed preview (DailyFeedPreview), so the preview can never drift
// from what shoppers actually see.
//
// Rule (matches apply_feed_order's unified rank space — looks + products share
// one feed_rank line):
//   1. Sort by feed_rank ascending (the admin's arranged order). A null/
//      undefined rank → Infinity, so unranked items fall to the back.
//   2. On a rank tie, LOOKS lead products (creator content first).
//   3. Still tied → keep input order (stable), so each lane's own order
//      (personalized / fit / feed_rank) is preserved among the unranked.
//   4. Guarantee a look near the very top: if the first look sits at or past
//      `frontLook`, pull it up to index 1 so the feed never reads product-only
//      (the #1 cause of "I don't see any looks").
//
// Pass looks FIRST so they win the step-3 stable tie (lower input index).

export function weaveByFeedRank<T>(
  looks: T[],
  products: T[],
  rankOf: (item: T) => number | null | undefined,
  isLook: (item: T) => boolean,
  frontLook = 4,
): T[] {
  const entries = [...looks, ...products];
  const rank = (e: T): number => {
    const r = rankOf(e);
    return typeof r === 'number' ? r : Number.POSITIVE_INFINITY;
  };
  const typeRank = (e: T): number => (isLook(e) ? 0 : 1);
  const sorted = entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const d = rank(a.e) - rank(b.e);
      if (d !== 0) return d;
      const t = typeRank(a.e) - typeRank(b.e);
      return t !== 0 ? t : a.i - b.i;
    })
    .map(x => x.e);
  const firstLookIdx = sorted.findIndex(isLook);
  if (firstLookIdx >= frontLook) {
    const [lk] = sorted.splice(firstLookIdx, 1);
    sorted.splice(1, 0, lk);
  }
  return sorted;
}

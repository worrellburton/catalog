import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import CreativeCardV2 from './CreativeCardV2';
import type { Look } from '~/data/looks';
import type { ProductAd } from '~/services/product-creative';
import { seededShuffle, hashSeed } from '~/utils/seededShuffle';

interface FeedSectionProps {
  looks: Look[];
  onOpenLook: (look: Look) => void;
  onOpenCreator: (name: string) => void;
  onCreateCatalog?: (query: string) => void;
  onOpenCreativeProduct?: (creative: ProductAd) => void;
  creatives?: ProductAd[];
  creativesLoading?: boolean;
  canDeleteCreative?: boolean;
  onDeleteCreative?: (id: string) => void;
  onDeleteLook?: (look: Look) => void;
  title?: string;
  batchSize?: number;
  isInitial?: boolean;
  layoutMode?: number;
  /**
   * When true the pool is built once (no cycling) so the user sees each
   * creative exactly once. When the sentinel fires at the pool end,
   * `onLoadMore` is called instead of cycling back to the start.
   */
  searchMode?: boolean;
  /** Called when the user scrolls to the end of the current pool in search mode. */
  onLoadMore?: () => void;
  /**
   * Optional scroll container to use as the IntersectionObserver root for
   * the load-more sentinel. When omitted, the default viewport is used
   * (the home/feed case where the document itself scrolls). When the
   * feed is nested inside an overflow:auto overlay (ProductPage,
   * LookOverlay), pass the overlay's scroll element so the sentinel
   * triggers based on that container's edges instead of the viewport's.
   */
  scrollRoot?: HTMLElement | null;
  /**
   * Prefix applied to every CreativeCardV2 `slotId` in this section.
   * Use a unique value (e.g. `"look:${look.id}"`) for feeds inside overlays
   * so their director registrations never collide with the main feed's
   * entries. Without a prefix the same creative at the same display-index
   * produces identical slotIds across feeds, causing the overlay's
   * `unregister()` call on close to delete the main feed's entry and freeze
   * that card permanently.
   */
  slotPrefix?: string;
}

// When we know creatives are still fetching, reserve roughly this share of
// cells as creative placeholders so looks don't fill the whole first screen.
const LOADING_CREATIVE_RATIO = 0.6;

const LAYOUT_CONFIGS = [
  { name: 'grid', columns: 5 },
  { name: 'editorial', columns: 4 },
  { name: 'mosaic', columns: 6 },
  { name: 'spotlight', columns: 3 },
];

// First-paint batch. Sized to over-fill the first screen on a wide desktop
// grid (up to 6 columns) so there's no half-empty first viewport waiting on a
// scroll-triggered grow. Subsequent grows add `batch` more at a time.
const DEFAULT_BATCH = 24;
const SUB_BATCH = 8;

// (Math.random shuffle removed - seeded shuffle below means the same
// inputs always produce the same output, which is what useMemo needs to
// avoid identity churn on unrelated re-renders.)

function FeedSection({
  looks,
  onOpenLook,
  onOpenCreator,
  onCreateCatalog,
  onOpenCreativeProduct,
  creatives,
  creativesLoading = false,
  canDeleteCreative = false,
  onDeleteCreative,
  onDeleteLook,
  title,
  batchSize,
  isInitial = false,
  layoutMode = 0,
  searchMode = false,
  onLoadMore,
  scrollRoot = null,
  slotPrefix,
}: FeedSectionProps) {
  const batch = batchSize ?? (isInitial ? DEFAULT_BATCH : SUB_BATCH);
  const [visibleCount, setVisibleCount] = useState(batch);
  // Initial segment grows the pool in cycles for true infinite scroll.
  // Each cycle adds CYCLE_SIZE more items by rebuilding/re-shuffling the
  // deck; concurrent video decode is bounded by the playback director
  // (viewport-distance promotion + pool cap) so DOM card count is safe to
  // grow. Sub-segments render a fixed `looks.length` and don't cycle.
  const [poolCycles, setPoolCycles] = useState(1);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const layout = LAYOUT_CONFIGS[layoutMode % LAYOUT_CONFIGS.length];

  const gridStyle = useMemo(() => {
    if (typeof window !== 'undefined' && window.innerWidth <= 768) {
      return {};
    }
    return { gridTemplateColumns: `repeat(${layout.columns}, 1fr)` };
  }, [layout.columns]);

  // Pick a tile size variant deterministically from (layoutMode, index).
  // layoutMode steps the seed so the Remix button visibly rearranges the
  // mosaic (different cells become featured/wide/tall). Desktop only - mobile
  // keeps the uniform 3:4 grid.
  const getCardClass = useCallback((globalIndex: number) => {
    const isDesktop = typeof window !== 'undefined' && window.innerWidth > 768;
    if (!isDesktop) return 'look-card';
    // Hash the seed so distribution doesn't cluster at regular intervals.
    const seed = ((layoutMode + 1) * 31 + globalIndex * 127) % 100;
    if (seed < 8) return 'look-card look-card-featured';  // ~8%  2x2
    if (seed < 22) return 'look-card look-card-wide';     // ~14% 2x1
    return 'look-card';                                   // ~78% 1x1
    // look-card-tall (1x2, 3/8) retired — its extreme portrait ratio
    // clashed with the primary 3/4 grid cell.
  }, [layoutMode]);

  // Build the pool by treating looks + creatives as one combined deck.
  // Each cycle emits every unique item once (shuffled); when the deck
  // runs out we re-shuffle and start another cycle. This guarantees
  // that nothing - neither a look nor a creative - repeats until every
  // other unique item in the library has been shown.
  //
  // While creatives are still being fetched we instead interleave
  // placeholder tiles so the grid doesn't fill the first screen with
  // duplicate looks. Once the fetch resolves this memo recomputes and
  // the placeholders are replaced with real creative cards.
  type PoolItem =
    | { type: 'look'; look: Look & { displayIndex: number } }
    | { type: 'creative'; creative: ProductAd }
    | { type: 'placeholder'; key: string };

  const pool = useMemo<PoolItem[]>(() => {
    const creativeList = isInitial ? (creatives ?? []) : [];
    // The initial segment is creative-only, so it should render even when
    // looks haven't resolved yet. Sub-segments need looks to draw similars.
    if (!isInitial && looks.length === 0) return [];
    // Sub-segments (More like this) show the exact looks array — no cycling
    // beyond the input so the section stays at exactly 8 items.
    // Initial segment grows in cycles of CYCLE_SIZE; sentinel bumps poolCycles
    // when the user nears the end so the feed scrolls indefinitely.
    const CYCLE_SIZE = 80;
    const targetCells = isInitial ? CYCLE_SIZE * poolCycles : looks.length;

    if (isInitial && creativesLoading) {
      // First paint while elite creatives are still loading - render *only*
      // shimmer placeholders. The static look pool used to leak in here; now
      // it stays off-screen until the real feed resolves.
      const items: PoolItem[] = [];
      for (let i = 0; i < targetCells; i++) {
        items.push({ type: 'placeholder', key: `ph-${i}` });
      }
      return items;
    }

    // Both initial and sub-segments pull from a mixed looks + creatives deck.
    // The initial segment now includes look cards so creators' looks are
    // discoverable from the main feed.
    type DeckEntry = { type: 'look'; look: Look } | { type: 'creative'; creative: ProductAd };
    // Seed combines layoutMode + sizes of the input arrays so the shuffle
    // is stable for a given (layoutMode, looks, creatives) but visibly
    // different across deck cycles (cycleSeed below salts each pass).
    const baseSeed = hashSeed(layoutMode, looks.length, creativeList.length, isInitial ? 1 : 0);
    let cycleSeed = baseSeed;
    const buildDeck = (): DeckEntry[] => {
      cycleSeed = (cycleSeed * 31 + 7) | 0;
      const entries: DeckEntry[] = [
        ...looks.map(look => ({ type: 'look' as const, look })),
        ...creativeList.map(creative => ({ type: 'creative' as const, creative })),
      ];
      // The initial home feed (not search) honours the admin's UNIFIED
      // feed_rank order — looks AND products share one rank space
      // (apply_feed_order), so sorting the combined deck by feed_rank
      // reproduces the /admin/catalogs FEED arrangement exactly. Search
      // results and later cycles still shuffle (relevance / variety).
      if (isInitial && !searchMode) {
        const rankOf = (e: DeckEntry) => {
          const r = e.type === 'look' ? e.look.feed_rank : e.creative.feed_rank;
          return typeof r === 'number' ? r : Number.POSITIVE_INFINITY;
        };
        // Looks lead on any rank tie. The admin writes a unified, dense
        // feed_rank (no collisions), so ties only happen in the UNRANKED
        // group (feed_rank null → Infinity) — there we keep looks first,
        // matching the "looks go first" rule, then fall back to input order.
        const typeRank = (e: DeckEntry) => (e.type === 'look' ? 0 : 1);
        const sorted = entries
          .map((e, i) => ({ e, i }))
          .sort((a, b) => {
            const d = rankOf(a.e) - rankOf(b.e);
            if (d !== 0) return d;
            const t = typeRank(a.e) - typeRank(b.e);
            return t !== 0 ? t : a.i - b.i;
          })
          .map(x => x.e);
        // Guarantee creator looks lead the home feed. The unified feed_rank
        // can place products ahead of every gender-surviving look (with 0
        // unisex looks, a gendered shopper only ever sees half the looks),
        // which makes the feed read as product-only — the #1 reason "I don't
        // see any looks". If no look lands in the first FRONT cells, pull the
        // highest-ranked surviving look forward to just behind the lead item.
        // Everything else keeps the admin's exact feed_rank order.
        const FRONT = 4;
        const firstLookIdx = sorted.findIndex(e => e.type === 'look');
        if (firstLookIdx >= FRONT) {
          const [lookEntry] = sorted.splice(firstLookIdx, 1);
          sorted.splice(1, 0, lookEntry);
        }
        return sorted;
      }
      return seededShuffle<DeckEntry>(entries, cycleSeed);
    };

    const items: PoolItem[] = [];
    let deck = buildDeck();
    let displayIndex = 0;

    // Empty deck (no looks and no creatives available yet) - nothing to render.
    if (deck.length === 0) return items;

    // In search mode: render each creative exactly once (no cycling).
    // The sentinel fires onLoadMore() when the user reaches the end.
    if (searchMode) {
      while (deck.length > 0) {
        const next = deck.shift()!;
        if (next.type === 'look') {
          items.push({ type: 'look', look: { ...next.look, displayIndex: displayIndex++ } });
        } else {
          items.push({ type: 'creative', creative: next.creative });
        }
      }
      return items;
    }

    while (items.length < targetCells) {
      if (deck.length === 0) {
        deck = buildDeck();
        // Cycle-boundary guard: when the new shuffle's first few entries
        // happen to match the last items already rendered, the user reads
        // it as "this product just showed up again". Rotate the deck so
        // the first entry is distinct from the last LOOKBACK rendered
        // items. Bounded to avoid an infinite loop on tiny pools.
        const LOOKBACK = Math.min(items.length, deck.length - 1);
        if (LOOKBACK > 0) {
          const recentKeys = new Set<string>();
          for (let r = items.length - LOOKBACK; r < items.length; r++) {
            const it = items[r];
            recentKeys.add(it.type === 'look' ? `look:${it.look.id}` : it.type === 'creative' ? `creative:${it.creative.product_id || it.creative.id}` : `ph`);
          }
          let rotations = 0;
          while (rotations < deck.length) {
            const head = deck[0];
            const headKey = head.type === 'look' ? `look:${head.look.id}` : `creative:${head.creative.product_id || head.creative.id}`;
            if (!recentKeys.has(headKey)) break;
            // Rotate: pop head, push to the back of the deck.
            deck.push(deck.shift()!);
            rotations++;
          }
        }
      }
      const next = deck.shift()!;
      if (next.type === 'look') {
        items.push({ type: 'look', look: { ...next.look, displayIndex: displayIndex++ } });
      } else {
        items.push({ type: 'creative', creative: next.creative });
      }
    }

    return items;
  }, [looks, creatives, creativesLoading, isInitial, layoutMode, searchMode, poolCycles]);

  const displayItems = useMemo(() => pool.slice(0, visibleCount), [pool, visibleCount]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;

        if (searchMode) {
          // Search mode: grow the rendered set, and page in the next batch of
          // results once we're at the end of what's loaded.
          if (visibleCount < pool.length) {
            setVisibleCount(prev => Math.min(prev + batch, pool.length));
          } else {
            onLoadMore?.();
          }
          return;
        }

        // Home/initial + sub-segments: grow what's rendered every time the
        // sentinel comes near.
        setVisibleCount(prev => Math.min(prev + batch, pool.length));

        // Keep the pool comfortably AHEAD of the rendered set so the grid
        // never catches the pool's end. The old code only extended the pool
        // AFTER visibleCount had already reached pool.length — at that moment
        // there were no more items to render, so the user scrolled into a
        // blank gap until the next observer cycle rebuilt a bigger pool and
        // re-rendered. Extending while we're still a few batches short means
        // there's always rendered (or instantly-renderable) content below the
        // fold — no empty space, no fill-in pop. Only the initial home segment
        // cycles infinitely; bounded sub-segments (similar looks) keep their
        // fixed pool and simply stop. The director caps concurrent video
        // decode regardless of how many cards are mounted.
        if (isInitial && pool.length - visibleCount <= batch * 3) {
          setPoolCycles(c => c + 1);
        }
      },
      // Wide lookahead: start filling well before the sentinel is on screen so
      // rows are already mounted (and warming/playing) by the time they scroll
      // into view.
      { root: scrollRoot ?? null, rootMargin: '1600px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [batch, pool.length, visibleCount, searchMode, onLoadMore, scrollRoot, isInitial]);

  useEffect(() => {
    setVisibleCount(batch);
    setPoolCycles(1);
  }, [looks, batch]);

  // Hide only when both inputs are empty. Initial sections show creatives
  // before looks resolve; sub-segments render the looks-driven similars.
  if (pool.length === 0) return null;

  return (
    <div className={`feed-section layout-${layout.name}`}>
      {title && <div className="feed-section-header">{title}</div>}
      <div className="feed-section-grid" id={isInitial ? 'grid-container' : undefined} style={gridStyle}>
        {displayItems.map((item, idx) => {
          if (item.type === 'placeholder') {
            return (
              <div key={item.key} className="look-card promo-card creative-placeholder" aria-hidden="true">
                <div className="card-inner">
                  <div className="card-shimmer" />
                  {/* Skeleton scaffold so the placeholder reads as
                      "content coming" instead of an empty rectangle.
                      Mirrors the brand / name / price block real cards
                      render in their bottom-left corner. */}
                  <div className="card-skeleton">
                    <span className="card-skeleton-bar card-skeleton-bar--brand" />
                    <span className="card-skeleton-bar card-skeleton-bar--name" />
                    <span className="card-skeleton-bar card-skeleton-bar--price" />
                  </div>
                </div>
              </div>
            );
          }
          if (item.type === 'creative') {
            return (
              <CreativeCardV2
                key={`creative-${item.creative.id}-${idx}`}
                slotId={`${slotPrefix ? `${slotPrefix}:` : ''}creative-${item.creative.id}-${idx}`}
                creative={item.creative}
                className={getCardClass(idx)}
                onOpenProduct={onOpenCreativeProduct}
                canDelete={canDeleteCreative}
                onDelete={onDeleteCreative}
                priority={idx < 6}
              />
            );
          }
          return (
            <CreativeCardV2
              key={`${item.look.id}-${item.look.displayIndex}`}
              slotId={`${slotPrefix ? `${slotPrefix}:` : ''}look-${item.look.id}-${item.look.displayIndex}`}
              look={item.look}
              className={getCardClass(idx)}
              onOpenLook={onOpenLook}
              onOpenCreator={onOpenCreator}
              canDelete={canDeleteCreative}
              onDeleteLook={onDeleteLook}
              priority={idx < 6}
            />
          );
        })}
      </div>
      <div ref={sentinelRef} style={{ height: 1 }} />
    </div>
  );
}

// Memoized - ContinuousFeed re-renders on every search keystroke, but each
// FeedSection only depends on its own props. With memo + stable callbacks
// from the parent, sections skip re-render entirely when the user types.
export default memo(FeedSection);

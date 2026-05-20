import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import LookCard from './LookCard';
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

const DEFAULT_BATCH = 12;
const SUB_BATCH = 6;

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
    if (seed < 36) return 'look-card look-card-tall';     // ~14% 1x2
    return 'look-card';                                   // ~64% 1x1
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
    const targetCells = isInitial ? 200 : looks.length;

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

    // Initial segment is elite-creative-only - no static looks mixed in.
    // Secondary "More like this" segments (isInitial=false) still pull from
    // their look set since that's where look-driven discovery lives.
    type DeckEntry = { type: 'look'; look: Look } | { type: 'creative'; creative: ProductAd };
    // Seed combines layoutMode + sizes of the input arrays so the shuffle
    // is stable for a given (layoutMode, looks, creatives) but visibly
    // different across deck cycles (cycleSeed below salts each pass).
    const baseSeed = hashSeed(layoutMode, looks.length, creativeList.length, isInitial ? 1 : 0);
    let cycleSeed = baseSeed;
    const buildDeck = (): DeckEntry[] => {
      cycleSeed = (cycleSeed * 31 + 7) | 0;
      return seededShuffle<DeckEntry>(
        isInitial
          ? creativeList.map(creative => ({ type: 'creative' as const, creative }))
          : [
              ...looks.map(look => ({ type: 'look' as const, look })),
              ...creativeList.map(creative => ({ type: 'creative' as const, creative })),
            ],
        cycleSeed,
      );
    };

    const items: PoolItem[] = [];
    let deck = buildDeck();
    let displayIndex = 0;

    // Empty deck (e.g. no elite creatives flagged yet on the initial segment)
    // - leave the grid empty rather than falling back to looks.
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
  }, [looks, creatives, creativesLoading, isInitial, layoutMode, searchMode]);

  const displayItems = useMemo(() => pool.slice(0, visibleCount), [pool, visibleCount]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (visibleCount >= pool.length && searchMode && onLoadMore) {
            // We've shown all current results - ask the parent for more.
            onLoadMore();
          } else {
            setVisibleCount(prev => Math.min(prev + batch, pool.length));
          }
        }
      },
      { root: scrollRoot ?? null, rootMargin: '400px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [batch, pool.length, visibleCount, searchMode, onLoadMore, scrollRoot]);

  useEffect(() => {
    setVisibleCount(batch);
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
            <LookCard
              key={`${item.look.id}-${item.look.displayIndex}`}
              look={item.look}
              className={getCardClass(item.look.displayIndex)}
              onOpenLook={onOpenLook}
              onOpenCreator={onOpenCreator}
              onCreateCatalog={onCreateCatalog}
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

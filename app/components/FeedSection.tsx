import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import LookCard from './LookCard';
import CreativeCard from './CreativeCard';
import type { Look } from '~/data/looks';
import type { ProductAd } from '~/services/product-ads';

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

function shuffled<T>(arr: T[]): T[] {
  const next = arr.slice();
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

export default function FeedSection({
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
  // mosaic (different cells become featured/wide/tall). Desktop only — mobile
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
  // that nothing — neither a look nor a creative — repeats until every
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
    // Catalog-scoped searches can produce zero matching looks but a rich set
    // of creatives. Only bail when there's truly nothing to show and nothing
    // in flight.
    if (looks.length === 0 && creativeList.length === 0 && !(isInitial && creativesLoading)) {
      return [];
    }
    const targetCells = isInitial ? 200 : 50;

    if (isInitial && creativesLoading) {
      // First paint while elite creatives are still loading — render *only*
      // shimmer placeholders. The static look pool used to leak in here; now
      // it stays off-screen until the real feed resolves.
      const items: PoolItem[] = [];
      for (let i = 0; i < targetCells; i++) {
        items.push({ type: 'placeholder', key: `ph-${i}` });
      }
      return items;
    }

    // Initial segment is elite-creative-only — no static looks mixed in.
    // Secondary "More like this" segments (isInitial=false) still pull from
    // their look set since that's where look-driven discovery lives.
    type DeckEntry = { type: 'look'; look: Look } | { type: 'creative'; creative: ProductAd };
    const buildDeck = (): DeckEntry[] => shuffled<DeckEntry>(
      isInitial
        ? creativeList.map(creative => ({ type: 'creative' as const, creative }))
        : [
            ...looks.map(look => ({ type: 'look' as const, look })),
            ...creativeList.map(creative => ({ type: 'creative' as const, creative })),
          ],
    );

    const items: PoolItem[] = [];
    let deck = buildDeck();
    let displayIndex = 0;

    // Empty deck (e.g. no elite creatives flagged yet on the initial segment)
    // — leave the grid empty rather than falling back to looks.
    if (deck.length === 0) return items;

    while (items.length < targetCells) {
      if (deck.length === 0) deck = buildDeck();
      const next = deck.shift()!;
      if (next.type === 'look') {
        items.push({ type: 'look', look: { ...next.look, displayIndex: displayIndex++ } });
      } else {
        items.push({ type: 'creative', creative: next.creative });
      }
    }

    return items;
  }, [looks, creatives, creativesLoading, isInitial]);

  const displayItems = useMemo(() => pool.slice(0, visibleCount), [pool, visibleCount]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisibleCount(prev => Math.min(prev + batch, pool.length));
        }
      },
      { rootMargin: '400px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [batch, pool.length]);

  useEffect(() => {
    setVisibleCount(batch);
  }, [looks, batch]);

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
                </div>
              </div>
            );
          }
          if (item.type === 'creative') {
            return (
              <CreativeCard
                key={`creative-${item.creative.id}-${idx}`}
                creative={item.creative}
                className={getCardClass(idx)}
                onOpenProduct={onOpenCreativeProduct}
                canDelete={canDeleteCreative}
                onDelete={onDeleteCreative}
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

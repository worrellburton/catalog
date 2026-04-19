import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import LookCard from './LookCard';
import AdCard from './AdCard';
import type { Look } from '~/data/looks';
import type { ProductAd } from '~/services/product-ads';

const AD_INTERVAL = 2; // Insert an ad every N looks

interface FeedSectionProps {
  looks: Look[];
  onOpenLook: (look: Look) => void;
  onOpenCreator: (name: string) => void;
  onCreateCatalog?: (query: string) => void;
  onOpenAdProduct?: (ad: ProductAd) => void;
  ads?: ProductAd[];
  title?: string;
  batchSize?: number;
  isInitial?: boolean;
  layoutMode?: number;
}

const LAYOUT_CONFIGS = [
  { name: 'grid', columns: 5 },
  { name: 'editorial', columns: 4 },
  { name: 'mosaic', columns: 6 },
  { name: 'spotlight', columns: 3 },
];

const DEFAULT_BATCH = 12;
const SUB_BATCH = 6;

export default function FeedSection({
  looks,
  onOpenLook,
  onOpenCreator,
  onCreateCatalog,
  onOpenAdProduct,
  ads,
  title,
  batchSize,
  isInitial = false,
  layoutMode = 0,
}: FeedSectionProps) {
  const batch = batchSize ?? (isInitial ? DEFAULT_BATCH : SUB_BATCH);
  const [visibleCount, setVisibleCount] = useState(batch);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const layout = LAYOUT_CONFIGS[layoutMode % LAYOUT_CONFIGS.length];

  // Grid style based on layout mode - full width with fixed columns
  const gridStyle = useMemo(() => {
    if (typeof window !== 'undefined' && window.innerWidth <= 768) {
      return {};
    }
    return { gridTemplateColumns: `repeat(${layout.columns}, 1fr)` };
  }, [layout.columns]);

  // Get varied card classes for visual interest
  const getCardClass = useCallback((globalIndex: number) => {
    const isDesktop = typeof window !== 'undefined' && window.innerWidth > 768;
    if (!isDesktop || layoutMode === 0) return 'look-card';
    const seed = (layoutMode * 7 + globalIndex * 13) % 20;
    if (seed === 0) return 'look-card look-card-featured';
    if (seed === 3 || seed === 7) return 'look-card look-card-wide';
    return 'look-card';
  }, [layoutMode]);

  // Create infinite pool by repeating looks
  const pool = useMemo(() => {
    if (looks.length === 0) return [];
    const poolSize = isInitial ? 200 : 50;
    const result: (Look & { displayIndex: number })[] = [];
    for (let i = 0; i < poolSize; i++) {
      result.push({ ...looks[i % looks.length], displayIndex: i });
    }
    return result;
  }, [looks, isInitial]);

  const displayLooks = useMemo(() => pool.slice(0, visibleCount), [pool, visibleCount]);

  // IntersectionObserver for infinite scroll within this section
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

  // Reset visible count when looks change
  useEffect(() => {
    setVisibleCount(batch);
  }, [looks, batch]);

  // Build display items: intersperse ads every AD_INTERVAL looks
  const displayItems = useMemo(() => {
    const items: ({ type: 'look'; look: Look & { displayIndex: number } } | { type: 'ad'; ad: ProductAd })[] = [];
    let adIdx = 0;
    const adList = ads && ads.length > 0 ? ads : [];

    console.log('[FeedSection] building displayItems — isInitial:', isInitial, 'ads prop length:', ads?.length, 'adList length:', adList.length, 'displayLooks:', displayLooks.length);

    for (let i = 0; i < displayLooks.length; i++) {
      items.push({ type: 'look', look: displayLooks[i] });
      // Insert ad after every AD_INTERVAL looks (only for initial feed sections)
      if (isInitial && adList.length > 0 && (i + 1) % AD_INTERVAL === 0) {
        console.log('[FeedSection] inserting ad at position', i + 1, '— ad id:', adList[adIdx % adList.length]?.id);
        items.push({ type: 'ad', ad: adList[adIdx % adList.length] });
        adIdx++;
      }
    }
    console.log('[FeedSection] total items:', items.length, 'ads inserted:', adIdx);
    return items;
  }, [displayLooks, ads, isInitial]);

  if (looks.length === 0) return null;

  return (
    <div className={`feed-section layout-${layout.name}`}>
      {title && <div className="feed-section-header">{title}</div>}
      <div className="feed-section-grid" id={isInitial ? 'grid-container' : undefined} style={gridStyle}>
        {displayItems.map((item, idx) => {
          if (item.type === 'ad') {
            return (
              <AdCard
                key={`ad-${item.ad.id}-${idx}`}
                ad={item.ad}
                className="look-card"
                onOpenProduct={onOpenAdProduct}
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

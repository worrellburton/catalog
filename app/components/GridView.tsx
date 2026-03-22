
import { useMemo, useRef, useCallback } from 'react';
import { looks, creators, Look } from '~/data/looks';
import LookCard from './LookCard';

interface GridViewProps {
  activeFilter: 'all' | 'men' | 'women';
  searchQuery: string;
  onOpenLook: (look: Look) => void;
  onOpenCreator: (creatorName: string) => void;
  isLightMode: boolean;
  shuffleKey?: number;
  layoutMode?: number;
}

const LAYOUT_CONFIGS = [
  { name: 'grid', maxCards: 48, minWidth: 240 },
  { name: 'editorial', maxCards: 6, minWidth: 300 },
  { name: 'mosaic', maxCards: 24, minWidth: 160 },
  { name: 'spotlight', maxCards: 8, minWidth: 400 },
];

export default function GridView({ activeFilter, searchQuery, onOpenLook, onOpenCreator, isLightMode, shuffleKey = 0, layoutMode = 0 }: GridViewProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const layout = LAYOUT_CONFIGS[layoutMode % LAYOUT_CONFIGS.length];

  const filteredLooks = useMemo(() => {
    let filtered = activeFilter === 'all' ? looks : looks.filter(l => l.gender === activeFilter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(l =>
        l.title.toLowerCase().includes(q) ||
        l.creator.toLowerCase().includes(q) ||
        l.description.toLowerCase().includes(q) ||
        l.products.some(p => p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q))
      );
    }
    return filtered;
  }, [activeFilter, searchQuery]);

  const displayLooks = useMemo(() => {
    if (filteredLooks.length === 0) return [];
    const maxCards = layout.maxCards;
    const repeatCount = Math.max(1, Math.ceil(maxCards / filteredLooks.length));
    const result: (Look & { displayIndex: number })[] = [];
    for (let r = 0; r < repeatCount; r++) {
      filteredLooks.forEach((look, i) => {
        result.push({ ...look, displayIndex: r * filteredLooks.length + i });
      });
    }
    // Always shuffle on remix
    if (shuffleKey > 0) {
      for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
      }
    }
    // Trim to max
    const trimmed = result.slice(0, maxCards);
    trimmed.forEach((look, i) => { look.displayIndex = i; });
    return trimmed;
  }, [filteredLooks, shuffleKey, layout.maxCards]);

  const gridStyle = useMemo(() => {
    if (typeof window !== 'undefined' && window.innerWidth <= 768) {
      return {};
    }
    return { gridTemplateColumns: `repeat(auto-fill, minmax(${layout.minWidth}px, 1fr))` };
  }, [layout.minWidth]);

  const isDesktop = typeof window !== 'undefined' && window.innerWidth > 768;

  const getCardClass = useCallback((globalIndex: number) => {
    if (!isDesktop || shuffleKey === 0) return 'look-card';
    // Deterministic pattern based on shuffleKey + index
    const seed = (shuffleKey * 7 + globalIndex * 13) % 20;
    if (seed === 0) return 'look-card look-card-featured';
    if (seed === 3 || seed === 7) return 'look-card look-card-wide';
    return 'look-card';
  }, [shuffleKey, isDesktop]);

  if (filteredLooks.length === 0 && searchQuery) {
    return (
      <div className="grid-viewport" id="grid-viewport">
        <div className="no-results-container">
          <div className="no-results">
            <div className="no-results-icon">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            </div>
            <h3>No content matches &ldquo;{searchQuery}&rdquo;</h3>
            <p>Try a different search or browse all looks</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`grid-viewport layout-${layout.name}`} id="grid-viewport">
      <div className="grid-container" id="grid-container" ref={gridRef} style={gridStyle}>
        {displayLooks.map((look) => (
          <LookCard
            key={`${look.id}-${look.displayIndex}-${shuffleKey}`}
            look={look}
            className={getCardClass(look.displayIndex)}
            onOpenLook={onOpenLook}
            onOpenCreator={onOpenCreator}
          />
        ))}
      </div>
    </div>
  );
}

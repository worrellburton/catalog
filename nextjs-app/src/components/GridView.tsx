'use client';

import { useMemo, useRef, useEffect, useCallback } from 'react';
import { looks, creators, Look } from '@/data/looks';
import LookCard from './LookCard';

interface GridViewProps {
  activeFilter: 'all' | 'men' | 'women';
  searchQuery: string;
  cardWidth: number;
  onOpenLook: (look: Look) => void;
  onOpenCreator: (creatorName: string) => void;
  isLightMode: boolean;
}

export default function GridView({ activeFilter, searchQuery, cardWidth, onOpenLook, onOpenCreator, isLightMode }: GridViewProps) {
  const gridRef = useRef<HTMLDivElement>(null);

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
    const maxCards = 48;
    const repeatCount = Math.max(1, Math.ceil(maxCards / filteredLooks.length));
    const result: (Look & { displayIndex: number })[] = [];
    for (let r = 0; r < repeatCount; r++) {
      filteredLooks.forEach((look, i) => {
        result.push({ ...look, displayIndex: r * filteredLooks.length + i });
      });
    }
    return result;
  }, [filteredLooks]);

  const gridStyle = useMemo(() => {
    if (typeof window !== 'undefined' && window.innerWidth <= 768) {
      return {};
    }
    return { gridTemplateColumns: `repeat(auto-fill, minmax(${cardWidth}px, 1fr))` };
  }, [cardWidth]);

  const getCardClass = useCallback((globalIndex: number) => {
    const classes = ['look-card'];
    if (globalIndex % 5 === 0) classes.push('look-card-featured');
    else if (globalIndex % 7 === 0 || globalIndex % 11 === 0) classes.push('look-card-wide');
    return classes.join(' ');
  }, []);

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
    <div className="grid-viewport" id="grid-viewport">
      <div className="grid-container" ref={gridRef} style={gridStyle}>
        {displayLooks.map((look, i) => (
          <LookCard
            key={`${look.id}-${look.displayIndex}`}
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

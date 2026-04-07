import { useState, useEffect, useRef, useMemo } from 'react';
import LookCard from './LookCard';
import type { Look } from '~/data/looks';

interface FeedSectionProps {
  looks: Look[];
  onOpenLook: (look: Look) => void;
  onOpenCreator: (name: string) => void;
  onCreateCatalog?: (query: string) => void;
  title?: string;
  batchSize?: number;
  isInitial?: boolean;
}

const DEFAULT_BATCH = 12;
const SUB_BATCH = 6;

export default function FeedSection({
  looks,
  onOpenLook,
  onOpenCreator,
  onCreateCatalog,
  title,
  batchSize,
  isInitial = false,
}: FeedSectionProps) {
  const batch = batchSize ?? (isInitial ? DEFAULT_BATCH : SUB_BATCH);
  const [visibleCount, setVisibleCount] = useState(batch);
  const sentinelRef = useRef<HTMLDivElement>(null);

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

  if (looks.length === 0) return null;

  return (
    <div className="feed-section">
      {title && <div className="feed-section-header">{title}</div>}
      <div className="feed-section-grid" id={isInitial ? 'grid-container' : undefined}>
        {displayLooks.map((look) => (
          <LookCard
            key={`${look.id}-${look.displayIndex}`}
            look={look}
            onOpenLook={onOpenLook}
            onOpenCreator={onOpenCreator}
            onCreateCatalog={onCreateCatalog}
          />
        ))}
      </div>
      <div ref={sentinelRef} style={{ height: 1 }} />
    </div>
  );
}

import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { looks as allLooks, type Look, type Product } from '~/data/looks';
import FeedSection from './FeedSection';

interface BookmarksInterface {
  isLookBookmarked: (id: number) => boolean;
  toggleLookBookmark: (id: number) => void;
  isProductBookmarked: (p: Product) => boolean;
  toggleProductBookmark: (p: Product) => void;
}

interface ContinuousFeedProps {
  activeFilter: 'all' | 'men' | 'women';
  searchQuery: string;
  shuffleKey: number;
  layoutMode: number;
  onOpenLook: (look: Look) => void;
  onOpenCreator: (name: string) => void;
  onOpenBrowser: (url: string, title: string) => void;
  onOpenProduct?: (product: Product) => void;
  onCreateCatalog?: (query: string) => void;
  bookmarks: BookmarksInterface;
}

export default function ContinuousFeed({
  activeFilter,
  searchQuery,
  shuffleKey,
  layoutMode,
  onOpenLook,
  onOpenCreator,
  onOpenBrowser,
  onOpenProduct,
  onCreateCatalog,
  bookmarks,
}: ContinuousFeedProps) {
  const filteredLooks = useMemo(() => {
    let filtered = activeFilter === 'all' ? allLooks : allLooks.filter(l => l.gender === activeFilter);
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

  const [segmentId, setSegmentId] = useState(() => `initial-${Date.now()}`);

  // Reset segment ID when filters change so FeedSection remounts
  const prevRef = useRef({ activeFilter, searchQuery, shuffleKey });
  useEffect(() => {
    const prev = prevRef.current;
    if (
      prev.activeFilter !== activeFilter ||
      prev.searchQuery !== searchQuery ||
      prev.shuffleKey !== shuffleKey
    ) {
      setSegmentId(`feed-${Date.now()}`);
      prevRef.current = { activeFilter, searchQuery, shuffleKey };
    }
  }, [activeFilter, searchQuery, shuffleKey]);

  const handleOpenLook = useCallback((look: Look, _segmentId: string) => {
    onOpenLook(look);
  }, [onOpenLook]);

  return (
    <div className="continuous-feed" id="grid-viewport">
      <FeedSection
        key={segmentId}
        segmentId={segmentId}
        looks={filteredLooks}
        onOpenLook={handleOpenLook}
        onOpenCreator={onOpenCreator}
        onCreateCatalog={onCreateCatalog}
        isInitial
      />
    </div>
  );
}

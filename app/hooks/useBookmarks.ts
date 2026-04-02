
import { useState, useCallback } from 'react';
import { Product } from '~/data/looks';

const LOOKS_KEY = 'catalog_bookmarked_looks';
const PRODUCTS_KEY = 'catalog_bookmarked_products';
const CREATORS_KEY = 'catalog_followed_creators';

function productKey(p: Product): string {
  return `${p.brand}::${p.name}`;
}

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      return JSON.parse(raw) as T;
    }
  } catch {
    // ignore parse errors
  }
  return fallback;
}

export interface UseBookmarks {
  bookmarkedLooks: number[];
  bookmarkedProducts: Product[];
  followedCreators: string[];
  isLookBookmarked: (lookId: number) => boolean;
  toggleLookBookmark: (lookId: number) => void;
  isProductBookmarked: (p: Product) => boolean;
  toggleProductBookmark: (p: Product) => void;
  isCreatorFollowed: (handle: string) => boolean;
  toggleCreatorFollow: (handle: string) => void;
  totalCount: number;
}

export function useBookmarks(): UseBookmarks {
  const [bookmarkedLooks, setBookmarkedLooks] = useState<number[]>(() =>
    loadFromStorage<number[]>(LOOKS_KEY, [])
  );

  const [bookmarkedProducts, setBookmarkedProducts] = useState<Product[]>(() =>
    loadFromStorage<Product[]>(PRODUCTS_KEY, [])
  );

  const [followedCreators, setFollowedCreators] = useState<string[]>(() =>
    loadFromStorage<string[]>(CREATORS_KEY, [])
  );

  const isLookBookmarked = useCallback(
    (lookId: number): boolean => bookmarkedLooks.includes(lookId),
    [bookmarkedLooks]
  );

  const toggleLookBookmark = useCallback(
    (lookId: number): void => {
      setBookmarkedLooks((prev) => {
        const next = prev.includes(lookId)
          ? prev.filter((id) => id !== lookId)
          : [...prev, lookId];
        localStorage.setItem(LOOKS_KEY, JSON.stringify(next));
        return next;
      });
    },
    []
  );

  const isProductBookmarked = useCallback(
    (p: Product): boolean => {
      const key = productKey(p);
      return bookmarkedProducts.some((bp) => productKey(bp) === key);
    },
    [bookmarkedProducts]
  );

  const toggleProductBookmark = useCallback(
    (p: Product): void => {
      setBookmarkedProducts((prev) => {
        const key = productKey(p);
        const exists = prev.some((bp) => productKey(bp) === key);
        const next = exists
          ? prev.filter((bp) => productKey(bp) !== key)
          : [...prev, p];
        localStorage.setItem(PRODUCTS_KEY, JSON.stringify(next));
        return next;
      });
    },
    []
  );

  const isCreatorFollowed = useCallback(
    (handle: string): boolean => followedCreators.includes(handle),
    [followedCreators]
  );

  const toggleCreatorFollow = useCallback(
    (handle: string): void => {
      setFollowedCreators((prev) => {
        const next = prev.includes(handle)
          ? prev.filter((h) => h !== handle)
          : [...prev, handle];
        localStorage.setItem(CREATORS_KEY, JSON.stringify(next));
        return next;
      });
    },
    []
  );

  const totalCount = bookmarkedLooks.length + bookmarkedProducts.length + followedCreators.length;

  return {
    bookmarkedLooks,
    bookmarkedProducts,
    followedCreators,
    isLookBookmarked,
    toggleLookBookmark,
    isProductBookmarked,
    toggleProductBookmark,
    isCreatorFollowed,
    toggleCreatorFollow,
    totalCount,
  };
}

// useRecentProducts — tracks the last N products the shopper opened so the
// user-menu can render thumbnail strips ("Recently viewed"). Persisted to
// localStorage so it survives reloads / new sessions on the same device.
//
// We dedupe by `${brand}|${name}` (the same key the bookmarks layer uses)
// and move existing entries to the front on re-tap, so a freshly tapped
// product always becomes the leftmost thumbnail.

import { useCallback, useEffect, useState } from 'react';
import type { Product } from '~/data/looks';

const STORAGE_KEY = 'catalog.recentProducts';
const MAX_RECENT = 12;

const productKey = (p: Product) => `${p.brand || ''}|${p.name || ''}`;

function readStored(): Product[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(p => p && typeof p.name === 'string') : [];
  } catch {
    return [];
  }
}

export interface UseRecentProducts {
  recentProducts: Product[];
  pushRecent: (p: Product) => void;
  clearRecent: () => void;
}

export function useRecentProducts(): UseRecentProducts {
  const [recentProducts, setRecentProducts] = useState<Product[]>(() => readStored());

  const persist = useCallback((next: Product[]) => {
    setRecentProducts(next);
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* quota / private mode */ }
  }, []);

  const pushRecent = useCallback((p: Product) => {
    if (!p?.name) return;
    const key = productKey(p);
    setRecentProducts(prev => {
      const filtered = prev.filter(x => productKey(x) !== key);
      const next = [p, ...filtered].slice(0, MAX_RECENT);
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const clearRecent = useCallback(() => persist([]), [persist]);

  // Cross-tab sync: another tab may push a recent — mirror it here so the
  // menu doesn't go stale when the user has the app open twice.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      setRecentProducts(readStored());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return { recentProducts, pushRecent, clearRecent };
}

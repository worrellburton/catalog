import { useCallback, useMemo, useState } from 'react';
import type { Product } from '~/data/looks';

/**
 * Saved-screen layout persistence. The saved items themselves live in
 * useBookmarks (localStorage); this layer adds the *arrangement* on top:
 *
 *   • collections      — named buckets the shopper groups saves into
 *   • custom order      — drag-to-reorder order for looks and products
 *
 * All localStorage-backed (matching useBookmarks) so it works signed-in
 * or not, with no backend round-trip. Edits are held in a working draft;
 * `save()` commits the draft to storage and clears `dirty` — that's the
 * "save your screen" button in the SavedScreen header.
 */

const COLLECTIONS_KEY = 'catalog_saved_collections_v1';
const ORDER_LOOKS_KEY = 'catalog_saved_order_looks_v1';
const ORDER_PRODUCTS_KEY = 'catalog_saved_order_products_v1';

export interface SavedCollection {
  id: string;
  name: string;
  lookIds: number[];
  productKeys: string[];
}

export function productKeyOf(p: Product): string {
  return `${p.brand}::${p.name}`;
}

interface Snapshot {
  collections: SavedCollection[];
  lookOrder: number[];
  productOrder: string[];
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch { /* ignore */ }
  return fallback;
}

function newId(): string {
  return `col_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Merge a custom order with the live set of keys: keep the saved order for
 * keys that still exist, drop stale ones, and append newly-saved items
 * (not yet ordered) at the end so a fresh bookmark always shows up.
 */
function reconcileOrder<T>(saved: T[], live: T[]): T[] {
  const liveSet = new Set(live);
  const kept = saved.filter(k => liveSet.has(k));
  const keptSet = new Set(kept);
  const appended = live.filter(k => !keptSet.has(k));
  return [...kept, ...appended];
}

export interface UseSavedLayout {
  collections: SavedCollection[];
  /** Look ids in the shopper's custom order (reconciled against live saves). */
  orderedLookIds: number[];
  /** Product keys in custom order (reconciled against live saves). */
  orderedProductKeys: string[];
  createCollection: (name: string) => string;
  renameCollection: (id: string, name: string) => void;
  deleteCollection: (id: string) => void;
  isInCollection: (collectionId: string, key: { lookId?: number; productKey?: string }) => boolean;
  toggleInCollection: (collectionId: string, key: { lookId?: number; productKey?: string }) => void;
  reorderLooks: (fromId: number, toId: number) => void;
  reorderProducts: (fromKey: string, toKey: string) => void;
  dirty: boolean;
  save: () => void;
}

export function useSavedLayout(
  liveLookIds: number[],
  liveProductKeys: string[],
): UseSavedLayout {
  const [collections, setCollections] = useState<SavedCollection[]>(() => load(COLLECTIONS_KEY, []));
  const [lookOrder, setLookOrder] = useState<number[]>(() => load(ORDER_LOOKS_KEY, []));
  const [productOrder, setProductOrder] = useState<string[]>(() => load(ORDER_PRODUCTS_KEY, []));
  // Last-persisted snapshot, used to compute `dirty`.
  const [saved, setSaved] = useState<Snapshot>(() => ({
    collections: load(COLLECTIONS_KEY, []),
    lookOrder: load(ORDER_LOOKS_KEY, []),
    productOrder: load(ORDER_PRODUCTS_KEY, []),
  }));

  const orderedLookIds = useMemo(
    () => reconcileOrder(lookOrder, liveLookIds),
    [lookOrder, liveLookIds],
  );
  const orderedProductKeys = useMemo(
    () => reconcileOrder(productOrder, liveProductKeys),
    [productOrder, liveProductKeys],
  );

  const createCollection = useCallback((name: string): string => {
    const id = newId();
    setCollections(prev => [...prev, { id, name: name.trim() || 'Untitled', lookIds: [], productKeys: [] }]);
    return id;
  }, []);

  const renameCollection = useCallback((id: string, name: string) => {
    setCollections(prev => prev.map(c => (c.id === id ? { ...c, name: name.trim() || c.name } : c)));
  }, []);

  const deleteCollection = useCallback((id: string) => {
    setCollections(prev => prev.filter(c => c.id !== id));
  }, []);

  const isInCollection = useCallback(
    (collectionId: string, key: { lookId?: number; productKey?: string }): boolean => {
      const col = collections.find(c => c.id === collectionId);
      if (!col) return false;
      if (key.lookId != null) return col.lookIds.includes(key.lookId);
      if (key.productKey != null) return col.productKeys.includes(key.productKey);
      return false;
    },
    [collections],
  );

  const toggleInCollection = useCallback(
    (collectionId: string, key: { lookId?: number; productKey?: string }) => {
      setCollections(prev => prev.map(c => {
        if (c.id !== collectionId) return c;
        if (key.lookId != null) {
          const has = c.lookIds.includes(key.lookId);
          return { ...c, lookIds: has ? c.lookIds.filter(i => i !== key.lookId) : [...c.lookIds, key.lookId] };
        }
        if (key.productKey != null) {
          const has = c.productKeys.includes(key.productKey);
          return { ...c, productKeys: has ? c.productKeys.filter(k => k !== key.productKey) : [...c.productKeys, key.productKey] };
        }
        return c;
      }));
    },
    [],
  );

  const reorderLooks = useCallback((fromId: number, toId: number) => {
    if (fromId === toId) return;
    setLookOrder(() => {
      const base = reconcileOrder(lookOrder, liveLookIds);
      const from = base.indexOf(fromId);
      const to = base.indexOf(toId);
      if (from < 0 || to < 0) return base;
      const next = [...base];
      next.splice(to, 0, next.splice(from, 1)[0]);
      return next;
    });
  }, [lookOrder, liveLookIds]);

  const reorderProducts = useCallback((fromKey: string, toKey: string) => {
    if (fromKey === toKey) return;
    setProductOrder(() => {
      const base = reconcileOrder(productOrder, liveProductKeys);
      const from = base.indexOf(fromKey);
      const to = base.indexOf(toKey);
      if (from < 0 || to < 0) return base;
      const next = [...base];
      next.splice(to, 0, next.splice(from, 1)[0]);
      return next;
    });
  }, [productOrder, liveProductKeys]);

  const dirty = useMemo(() => {
    return (
      JSON.stringify(collections) !== JSON.stringify(saved.collections)
      || JSON.stringify(orderedLookIds) !== JSON.stringify(saved.lookOrder)
      || JSON.stringify(orderedProductKeys) !== JSON.stringify(saved.productOrder)
    );
  }, [collections, orderedLookIds, orderedProductKeys, saved]);

  const save = useCallback(() => {
    try {
      localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(collections));
      localStorage.setItem(ORDER_LOOKS_KEY, JSON.stringify(orderedLookIds));
      localStorage.setItem(ORDER_PRODUCTS_KEY, JSON.stringify(orderedProductKeys));
    } catch { /* storage full / disabled — keep working in-memory */ }
    setSaved({ collections, lookOrder: orderedLookIds, productOrder: orderedProductKeys });
  }, [collections, orderedLookIds, orderedProductKeys]);

  return {
    collections,
    orderedLookIds,
    orderedProductKeys,
    createCollection,
    renameCollection,
    deleteCollection,
    isInCollection,
    toggleInCollection,
    reorderLooks,
    reorderProducts,
    dirty,
    save,
  };
}

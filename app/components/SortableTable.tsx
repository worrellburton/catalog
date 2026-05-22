import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  getSharedSort,
  setSharedSort,
  subscribeSharedSort,
  type SharedSortState,
} from '~/services/admin-table-settings';

type SortDirection = 'asc' | 'desc';

interface SortState {
  key: string;
  direction: SortDirection;
}

interface SortOptions<T> {
  defaultSort?: { key: keyof T; direction: SortDirection };
  /** Opt in to cross-admin shared sort state. When set, the hook
   *  hydrates from app_settings on mount, persists every sort change
   *  back, and subscribes to realtime updates so admins watching the
   *  same table see each other's clicks. Pass a stable string id like
   *  `'products'` or `'creatives'`. */
  sharedTableId?: string;
}

function sameSort(a: SortState | null, b: SortState | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.key === b.key && a.direction === b.direction;
}

export function useSortableTable<T>(
  data: T[],
  defaultSortOrOptions?: { key: keyof T; direction: SortDirection } | SortOptions<T>,
) {
  // Backwards-compatible: callers passing the old `{ key, direction }`
  // shape stay working. New callers can pass `{ defaultSort, sharedTableId }`.
  const opts: SortOptions<T> = defaultSortOrOptions && 'sharedTableId' in defaultSortOrOptions
    ? defaultSortOrOptions
    : { defaultSort: defaultSortOrOptions as { key: keyof T; direction: SortDirection } | undefined };

  const [sort, setSort] = useState<SortState | null>(
    opts.defaultSort
      ? { key: String(opts.defaultSort.key), direction: opts.defaultSort.direction }
      : null,
  );

  // Hydrate from shared storage on mount + subscribe to other admins'
  // changes. The localApplyingRef guards against echo loops — when we
  // write our own change, the subscribe callback would fire too; we
  // just bypass setState if the incoming state already matches.
  const sharedTableId = opts.sharedTableId;
  const localApplyingRef = useRef(false);
  useEffect(() => {
    if (!sharedTableId) return;
    let cancelled = false;
    getSharedSort(sharedTableId).then(remote => {
      if (cancelled) return;
      if (remote) setSort(prev => sameSort(prev, remote) ? prev : remote);
    });
    const unsub = subscribeSharedSort(sharedTableId, (remote) => {
      setSort(prev => {
        const next = remote as SortState | null;
        if (sameSort(prev, next)) return prev;
        // Mark this state change as remotely-sourced so the
        // persist-effect below skips writing it back out.
        localApplyingRef.current = true;
        return next;
      });
    });
    return () => { cancelled = true; unsub(); };
  }, [sharedTableId]);

  // Persist local changes back to the shared row. Skipped when the
  // change just landed via the subscribe callback (echo guard).
  useEffect(() => {
    if (!sharedTableId) return;
    if (localApplyingRef.current) {
      localApplyingRef.current = false;
      return;
    }
    // Fire-and-forget — the local UI is already in the new state and
    // the realtime channel will sync other tabs.
    void setSharedSort(sharedTableId, sort as SharedSortState | null);
  }, [sharedTableId, sort]);

  const handleSort = useCallback((key: string) => {
    setSort(prev => {
      if (prev?.key === key) {
        if (prev.direction === 'asc') return { key, direction: 'desc' as const };
        return null; // third click clears sort
      }
      return { key, direction: 'asc' as const };
    });
  }, []);

  const sortedData = useMemo(() => {
    if (!sort) return data;
    const { key, direction } = sort;
    return [...data].sort((a, b) => {
      const aVal = (a as Record<string, unknown>)[key];
      const bVal = (b as Record<string, unknown>)[key];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return direction === 'asc' ? aVal - bVal : bVal - aVal;
      }
      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      if (aStr < bStr) return direction === 'asc' ? -1 : 1;
      if (aStr > bStr) return direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [data, sort]);

  return { sortedData, sort, handleSort };
}

interface SortableThProps {
  label: string;
  sortKey: string;
  currentSort: SortState | null;
  onSort: (key: string) => void;
  className?: string;
}

export function SortableTh({ label, sortKey, currentSort, onSort, className }: SortableThProps) {
  const isActive = currentSort?.key === sortKey;
  const direction = isActive ? currentSort.direction : null;

  return (
    <th className={`admin-th-sortable${className ? ` ${className}` : ''}`} onClick={() => onSort(sortKey)}>
      <span className="admin-th-sortable-inner">
        {label}
        <span className={`admin-sort-icon ${isActive ? 'active' : ''}`}>
          {direction === 'asc' ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
          ) : direction === 'desc' ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15" opacity="0.4"/></svg>
          )}
        </span>
      </span>
    </th>
  );
}

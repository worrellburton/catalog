import { useState, useMemo, useCallback } from 'react';

type SortDirection = 'asc' | 'desc';

interface SortState {
  key: string;
  direction: SortDirection;
}

export function useSortableTable<T>(data: T[], defaultSort?: { key: keyof T; direction: SortDirection }) {
  const [sort, setSort] = useState<SortState | null>(
    defaultSort ? { key: String(defaultSort.key), direction: defaultSort.direction } : null
  );

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
}

export function SortableTh({ label, sortKey, currentSort, onSort }: SortableThProps) {
  const isActive = currentSort?.key === sortKey;
  const direction = isActive ? currentSort.direction : null;

  return (
    <th className="admin-th-sortable" onClick={() => onSort(sortKey)}>
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

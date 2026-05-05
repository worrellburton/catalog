// useSearch — debounced V3 search hook.
//
// Calls the `search` edge function after a short debounce (or immediately on
// Enter when `trigger` increments). Returns ranked results plus loading /
// error / pagination state. Replaces useSemanticSearch.

import { useCallback, useEffect, useRef, useState } from 'react';
import { search, SemanticCreative } from '~/services/search';

const MIN_QUERY_LENGTH = 3;
const DEBOUNCE_MS      = 200;
const PAGE_SIZE        = 24;

export interface SearchHookState {
  /** Ranked creatives + product placeholders. The feed renders these. */
  creatives: SemanticCreative[];
  /** True while the edge function is in flight (initial fetch or loadMore). */
  loading: boolean;
  /** True when the last successful query returned zero results. */
  coldMiss: boolean;
  /** Non-null when the last request failed. */
  error: string | null;
  /** Probably more results behind the last fetch (= got a full page). */
  hasMore: boolean;
  /** Append the next page. No-op while loading or when !hasMore. */
  loadMore: () => void;
}

export function useSearch(
  query: string,
  options: { gender?: string | null; trigger?: number; enabled?: boolean } = {}
): SearchHookState {
  const { gender = null, trigger = 0, enabled = true } = options;

  const [creatives, setCreatives] = useState<SemanticCreative[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [coldMiss,  setColdMiss]  = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [hasMore,   setHasMore]   = useState(false);

  const abortRef    = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committedRef = useRef('');
  const seenProductsRef = useRef<Set<string>>(new Set());
  const triggerRef = useRef(0);

  const runSearch = useCallback(async (q: string, append: boolean) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const resp = await search(q, {
        k:          PAGE_SIZE,
        gender,
        exclude_ids: append ? Array.from(seenProductsRef.current) : undefined,
        signal:      controller.signal,
      });

      if (controller.signal.aborted) return;

      if (!resp.ok) {
        setLoading(false);
        setError(resp.error ?? 'Search failed');
        return;
      }

      setCreatives(prev => {
        const next = append ? [...prev] : [];
        const seenIds       = new Set(next.map(c => c.id));
        const seenProducts  = append ? new Set(seenProductsRef.current) : new Set<string>();
        for (const c of resp.results) {
          if (seenIds.has(c.id)) continue;
          if (seenProducts.has(c.product_id)) continue;
          seenIds.add(c.id);
          seenProducts.add(c.product_id);
          next.push(c);
        }
        seenProductsRef.current = seenProducts;
        return next;
      });

      setColdMiss(!append && resp.results.length === 0);
      setHasMore(resp.results.length >= PAGE_SIZE);
      setLoading(false);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setLoading(false);
      setError('Search unavailable');
    }
  }, [gender]);

  // Reset + fire on query change.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!enabled || query.trim().length < MIN_QUERY_LENGTH) {
      abortRef.current?.abort();
      setCreatives([]);
      setLoading(false);
      setColdMiss(false);
      setError(null);
      setHasMore(false);
      seenProductsRef.current = new Set();
      committedRef.current = '';
      return;
    }

    const q = query.trim();
    committedRef.current = q;
    seenProductsRef.current = new Set();
    setCreatives([]);

    const immediate = trigger !== triggerRef.current;
    triggerRef.current = trigger;
    debounceRef.current = setTimeout(() => runSearch(q, false), immediate ? 0 : DEBOUNCE_MS);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, runSearch, trigger, enabled]);

  const loadMore = useCallback(() => {
    if (loading || !hasMore) return;
    const q = committedRef.current;
    if (!q || q.length < MIN_QUERY_LENGTH) return;
    runSearch(q, true);
  }, [loading, hasMore, runSearch]);

  // Abort on unmount.
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  return { creatives, loading, coldMiss, error, hasMore, loadMore };
}

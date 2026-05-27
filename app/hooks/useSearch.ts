// useSearch — debounced V3 search hook.
//
// Calls the `search` edge function after a short debounce (or immediately on
// Enter when `trigger` increments). Returns ranked product creatives + look
// hits plus loading / error / pagination state.

import { useCallback, useEffect, useRef, useState } from 'react';
import { search, SemanticCreative, SemanticLook } from '~/services/search';

const MIN_QUERY_LENGTH = 3;
const DEBOUNCE_MS      = 200;
const PAGE_SIZE        = 24;

export interface SearchHookState {
  /** Ranked creatives + product placeholders. The feed renders these. */
  creatives: SemanticCreative[];
  /** Ranked look hits from hybrid search. */
  looks: SemanticLook[];
  /** True while the edge function is in flight (initial fetch or loadMore). */
  loading: boolean;
  /** True when the last successful query returned zero results (both lanes). */
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
  const [looks,     setLooks]     = useState<SemanticLook[]>([]);
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
        const indexByProduct = new Map<string, number>();
        for (let i = 0; i < next.length; i++) {
          indexByProduct.set(next[i].product_id, i);
        }
        for (const c of resp.results) {
          if (seenIds.has(c.id)) continue;
          const existing = indexByProduct.get(c.product_id);
          if (existing !== undefined) {
            const cur = next[existing];
            if (!cur.video_url && c.video_url) {
              seenIds.delete(cur.id);
              seenIds.add(c.id);
              next[existing] = c;
            }
            continue;
          }
          seenIds.add(c.id);
          indexByProduct.set(c.product_id, next.length);
          next.push(c);
        }
        seenProductsRef.current = new Set(indexByProduct.keys());
        next.sort((a, b) => {
          const av = a.video_url ? 0 : 1;
          const bv = b.video_url ? 0 : 1;
          return av - bv;
        });
        return next;
      });

      // Looks: replace on fresh search, ignore on append (looks don't paginate).
      if (!append) {
        setLooks(resp.looks);
      }

      setColdMiss(!append && resp.results.length === 0 && resp.looks.length === 0);
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
      setLooks([]);
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
    setLooks([]);

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

  return { creatives, looks, loading, coldMiss, error, hasMore, loadMore };
}

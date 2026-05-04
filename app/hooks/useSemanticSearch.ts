// useSemanticSearch - debounced natural-language search hook.
//
// Calls the nl-search edge function after the user stops typing (200 ms debounce,
// or immediately on Enter when `trigger` increments). Returns ranked creative
// results plus loading / cold-miss / queryPlan state so the calling component
// can render without an extra fetch.
//
// Only fires for queries of 3+ characters. Short queries fall back to the
// existing local text filter in GridView (no API call).

import { useState, useEffect, useRef, useCallback } from 'react';
import { nlSearch, SemanticCreative, QueryPlan } from '~/services/semantic-search';

const MIN_QUERY_LENGTH = 3;
const DEBOUNCE_MS = 200;

// A stable session ID for anonymous query logging (generated once per page load).
function getSessionId(): string {
  const key = 'catalog:search-session';
  let sid = sessionStorage.getItem(key);
  if (!sid) {
    sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem(key, sid);
  }
  return sid;
}

export interface SemanticSearchState {
  /** Ranked creative results returned directly from nl-search. The feed renders these. */
  creatives: SemanticCreative[];
  /** True while the edge function is in flight (initial fetch OR loadMore). */
  loading: boolean;
  /** True when the query matched fewer than 3 results or had a very low score.
   *  The backfill agent will pick this up automatically. */
  coldMiss: boolean;
  /** The classified intent and rewrites - useful for displaying context hints. */
  queryPlan: QueryPlan | null;
  /** The logged query_id - caller can subscribe to realtime updates on it. */
  queryId: string | null;
  /** Non-null when the last request failed. */
  error: string | null;
  /** Load the next page of results (appends to creatives). Safe to call while loading. */
  loadMore: () => void;
  /** True when there are likely more results to load (last fetch returned a full page). */
  hasMore: boolean;
}

const PAGE_SIZE = 24;

const EMPTY_STATE: Omit<SemanticSearchState, 'loadMore'> = {
  creatives: [],
  loading: false,
  coldMiss: false,
  queryPlan: null,
  queryId: null,
  error: null,
  hasMore: false,
};

export function useSemanticSearch(
  query: string,
  options: { gender?: string; userId?: string; k?: number; trigger?: number; enabled?: boolean } = {}
): SemanticSearchState {
  const { gender, userId, trigger = 0, enabled = true } = options;
  const [baseCreatives, setBaseCreatives] = useState<SemanticCreative[]>([]);
  const [loading, setLoading] = useState(false);
  const [coldMiss, setColdMiss] = useState(false);
  const [queryPlan, setQueryPlan] = useState<QueryPlan | null>(null);
  const [queryId, setQueryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const abortRef  = useRef<AbortController | null>(null);
  const timerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionId = useRef(getSessionId());
  const committedQueryRef = useRef('');
  // Snapshot the IDs at request-time so async resolution can't deduplicate
  // against a stale baseCreatives reference.
  const seenIdsRef = useRef<Set<string>>(new Set());
  // Tracks the last trigger value seen; when it changes, skip debounce and
  // fire immediately so Enter press results feel instant.
  const triggerRef = useRef(0);

  const runSearch = useCallback(async (q: string, append: boolean) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const resp = await nlSearch(q, {
        k:           PAGE_SIZE,
        gender,
        user_id:     userId,
        session_id:  sessionId.current,
        // On loadMore, ask the DB to skip everything we already have so we
        // get a true fresh page instead of paying the full pipeline cost
        // just to dedupe overlap on the client.
        exclude_ids: append ? Array.from(seenIdsRef.current) : undefined,
        signal:      controller.signal,
      });

      if (controller.signal.aborted) return;

      if (!resp.ok) {
        setLoading(false);
        setError(resp.error ?? 'Search failed');
        return;
      }

      const incoming = resp.results.filter((r): r is SemanticCreative => r.entity_type === 'creative');

      setBaseCreatives(prev => {
        const next = append ? [...prev] : [];
        const seen = new Set(next.map(c => c.id));
        for (const c of incoming) {
          if (seen.has(c.id)) continue;
          seen.add(c.id);
          next.push(c);
        }
        seenIdsRef.current = seen;
        return next;
      });
      setColdMiss(resp.cold_miss);
      setQueryPlan(resp.query_plan);
      setQueryId(resp.query_id);
      // Full page back ⇒ probably more results behind it. An empty page (or
      // partial) means we've drained the candidate pool for this query.
      setHasMore(incoming.length >= PAGE_SIZE);
      setLoading(false);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setLoading(false);
      setError('Search unavailable');
    }
  }, [gender, userId]);

  // When query changes: reset everything and run fresh search.
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    if (!enabled || query.trim().length < MIN_QUERY_LENGTH) {
      abortRef.current?.abort();
      setBaseCreatives([]);
      setLoading(false);
      setColdMiss(false);
      setQueryPlan(null);
      setQueryId(null);
      setError(null);
      setHasMore(false);
      seenIdsRef.current = new Set();
      committedQueryRef.current = '';
      return;
    }

    const q = query.trim();
    committedQueryRef.current = q;
    seenIdsRef.current = new Set();
    setBaseCreatives([]);

    // Enter press increments trigger - skip debounce so search fires immediately.
    const immediate = trigger !== triggerRef.current;
    triggerRef.current = trigger;
    timerRef.current = setTimeout(() => runSearch(q, false), immediate ? 0 : DEBOUNCE_MS);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [query, runSearch, trigger, enabled]);

  const loadMore = useCallback(() => {
    if (loading) return;
    if (!hasMore) return;
    const q = committedQueryRef.current;
    if (!q || q.length < MIN_QUERY_LENGTH) return;
    runSearch(q, true);
  }, [loading, hasMore, runSearch]);

  // Abort on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  return {
    creatives: baseCreatives,
    loading,
    coldMiss,
    queryPlan,
    queryId,
    error,
    hasMore,
    loadMore,
  };
}

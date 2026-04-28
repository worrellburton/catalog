// useSemanticSearch — debounced natural-language search hook.
//
// Calls the nl-search edge function after the user stops typing (500 ms debounce).
// Returns ranked look IDs and product IDs along with loading/cold-miss state so
// the calling component can reorder its local data without an extra fetch.
//
// Only fires for queries of 3+ characters. Short queries fall back to the
// existing local text filter in GridView (no API call).

import { useState, useEffect, useRef, useCallback } from 'react';
import { nlSearch, SemanticLook, SemanticProduct, QueryPlan } from '~/services/semantic-search';

const MIN_QUERY_LENGTH = 3;
const DEBOUNCE_MS = 500;

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
  /** Ordered look UUIDs from the semantic search. Use to reorder GridView. */
  lookIds: string[];
  /** Ranked product results (UUID + display data) for a "products found" rail. */
  products: SemanticProduct[];
  /** Raw look objects from the search — enough to render preview cards. */
  looks: SemanticLook[];
  /** True while the edge function is in flight. */
  loading: boolean;
  /** True when the query matched fewer than 3 results or had a very low score.
   *  The backfill agent will pick this up automatically. */
  coldMiss: boolean;
  /** The classified intent and rewrites — useful for displaying context hints. */
  queryPlan: QueryPlan | null;
  /** The logged query_id — caller can subscribe to realtime updates on it. */
  queryId: string | null;
  /** Non-null when the last request failed. */
  error: string | null;
}

const EMPTY_STATE: SemanticSearchState = {
  lookIds: [],
  products: [],
  looks: [],
  loading: false,
  coldMiss: false,
  queryPlan: null,
  queryId: null,
  error: null,
};

export function useSemanticSearch(
  query: string,
  options: { gender?: string; userId?: string; k?: number } = {}
): SemanticSearchState {
  const { gender, userId, k = 20 } = options;
  const [state, setState] = useState<SemanticSearchState>(EMPTY_STATE);
  const abortRef  = useRef<AbortController | null>(null);
  const timerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionId = useRef(getSessionId());

  const runSearch = useCallback(async (q: string) => {
    // Cancel any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState(prev => ({ ...prev, loading: true, error: null }));

    const resp = await nlSearch(q, {
      k,
      gender,
      user_id:    userId,
      session_id: sessionId.current,
      signal:     controller.signal,
    });

    if (controller.signal.aborted) return;

    if (!resp.ok) {
      setState(prev => ({ ...prev, loading: false, error: resp.error ?? 'Search failed' }));
      return;
    }

    const looks    = resp.results.filter((r): r is SemanticLook    => r.entity_type === 'look');
    const products = resp.results.filter((r): r is SemanticProduct => r.entity_type === 'product');

    setState({
      lookIds:    looks.map(l => l.id),
      products,
      looks,
      loading:    false,
      coldMiss:   resp.cold_miss,
      queryPlan:  resp.query_plan,
      queryId:    resp.query_id,
      error:      null,
    });
  }, [k, gender, userId]);

  useEffect(() => {
    // Clear any pending debounce
    if (timerRef.current) clearTimeout(timerRef.current);

    // Short queries → reset to empty (local filter takes over)
    if (query.trim().length < MIN_QUERY_LENGTH) {
      abortRef.current?.abort();
      setState(EMPTY_STATE);
      return;
    }

    timerRef.current = setTimeout(() => runSearch(query.trim()), DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, runSearch]);

  // Abort on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  return state;
}

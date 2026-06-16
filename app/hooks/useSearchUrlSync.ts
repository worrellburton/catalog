import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';

interface UseSearchUrlSyncResult {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searchTrigger: number;
  bumpSearchTrigger: () => void;
  /** Why searchTrigger last changed: 'user' = an explicit commit (Enter /
   *  suggestion / brand) → play the search ceremony; 'pop' = a back/forward
   *  restore → re-run the search silently (NO ceremony). Read at trigger time. */
  triggerSource: MutableRefObject<'user' | 'pop'>;
}

// Two-way binding between the ?q= URL param and a local searchQuery
// state. Each committed search is its own history entry, so the back
// button walks the user through their search history.
//
// Push direction: debounce searchQuery by 350 ms so we don't blow the
// history stack on every keystroke. Only push when the URL would
// actually change, so a re-typed identical query doesn't add a
// redundant entry. The isApplyingUrlChange ref guards against echo
// when the change came from popstate.
//
// Pop direction: listen for popstate and read ?q=. When it differs
// from the current state, set isApplyingUrlChange before updating so
// the push effect's diff check skips the rebound, then bump
// searchTrigger so consumers (the feed) re-run the search rather than
// waiting for the user to type.
export function useSearchUrlSync(): UseSearchUrlSyncResult {
  // Initial searchQuery comes from the URL ?q= param so a deep-linked
  // search lands in the right state on first paint.
  const initialUrlQuery = (() => {
    if (typeof window === 'undefined') return '';
    try { return new URLSearchParams(window.location.search).get('q') ?? ''; }
    catch { return ''; }
  })();
  const [searchQuery, setSearchQueryState] = useState(initialUrlQuery);
  // searchTrigger is bumped on Enter / suggestion-click for an immediate
  // commit (bypassing the debounce inside ContinuousFeed). The
  // initial-mount value is non-zero when the URL already has ?q=, so
  // the feed knows to fire the search on first render rather than wait
  // for typing.
  const [searchTrigger, setSearchTrigger] = useState(initialUrlQuery ? 1 : 0);
  const isApplyingUrlChange = useRef(false);
  const triggerSource = useRef<'user' | 'pop'>('user');

  const setSearchQuery = useCallback((q: string) => {
    setSearchQueryState(q);
  }, []);
  const bumpSearchTrigger = useCallback(() => {
    triggerSource.current = 'user';
    setSearchTrigger(t => t + 1);
  }, []);

  // Push direction: debounced URL update
  useEffect(() => {
    if (isApplyingUrlChange.current) {
      isApplyingUrlChange.current = false;
      return;
    }
    const t = window.setTimeout(() => {
      const url = new URL(window.location.href);
      const current = url.searchParams.get('q') ?? '';
      const next = searchQuery;
      if (current === next) return;
      if (next) url.searchParams.set('q', next);
      else      url.searchParams.delete('q');
      window.history.pushState({ q: next }, '', url.toString());
    }, 350);
    return () => window.clearTimeout(t);
  }, [searchQuery]);

  // Pop direction: listen for popstate
  useEffect(() => {
    const onPop = () => {
      try {
        const q = new URLSearchParams(window.location.search).get('q') ?? '';
        if (q !== searchQuery) {
          isApplyingUrlChange.current = true;
          // Back/forward restore — re-run the search to repaint results, but
          // mark it so consumers DON'T replay the search ceremony.
          triggerSource.current = 'pop';
          setSearchQueryState(q);
          setSearchTrigger(t => t + 1);
        }
      } catch { /* malformed URL - ignore */ }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [searchQuery]);

  return { searchQuery, setSearchQuery, searchTrigger, bumpSearchTrigger, triggerSource };
}

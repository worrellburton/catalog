// useSearchBeam - single source of truth for which animated beam
// variant the bottom-bar renders. Persists to localStorage so the
// choice survives reloads, and listens for cross-tab changes so an
// admin picking a variant in one tab updates every other tab's
// search bar instantly. Mirrors the pattern useBrandLogo uses for
// the wordmark variant.

import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SEARCH_BEAM, type SearchBeamId } from '~/utils/searchBeams';

const STORAGE_KEY = 'catalog.searchBeam';

function read(): SearchBeamId {
  if (typeof window === 'undefined') return DEFAULT_SEARCH_BEAM;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return (raw as SearchBeamId | null) || DEFAULT_SEARCH_BEAM;
  } catch {
    return DEFAULT_SEARCH_BEAM;
  }
}

export function useSearchBeam(): {
  beam: SearchBeamId;
  setBeam: (id: SearchBeamId) => void;
  reset: () => void;
} {
  const [beam, setBeamState] = useState<SearchBeamId>(() => read());

  // Cross-tab sync via the standard storage event.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      setBeamState((e.newValue as SearchBeamId | null) || DEFAULT_SEARCH_BEAM);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Same-tab sync via a custom event so other components mounting
  // useSearchBeam re-render when the active variant changes.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<SearchBeamId>).detail;
      if (next && next !== beam) setBeamState(next);
    };
    window.addEventListener('search-beam:change', onChange);
    return () => window.removeEventListener('search-beam:change', onChange);
  }, [beam]);

  const setBeam = useCallback((id: SearchBeamId) => {
    setBeamState(id);
    try { window.localStorage.setItem(STORAGE_KEY, id); } catch { /* quota / private mode */ }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('search-beam:change', { detail: id }));
    }
  }, []);

  const reset = useCallback(() => setBeam(DEFAULT_SEARCH_BEAM), [setBeam]);

  return { beam, setBeam, reset };
}

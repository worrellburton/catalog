import { useEffect, useState } from 'react';
import {
  getStylistEngineMethod,
  subscribeStylistEngineMethod,
  DEFAULT_STYLIST_ENGINE_METHOD,
  type StylistEngineMethod,
} from '~/services/dials';

// The /style catalog stylist's retrieval method, read live from the
// stylist_engine_method dial (app_settings). Flipping it on /admin/dials
// switches every open stylist chat between the Stylist engine (default) and the
// legacy recency behavior without a refresh.
export function useStylistEngineMethod(): { method: StylistEngineMethod; loading: boolean } {
  const [method, setMethod] = useState<StylistEngineMethod>(DEFAULT_STYLIST_ENGINE_METHOD);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getStylistEngineMethod().then(v => { if (!cancelled) { setMethod(v); setLoading(false); } });
    const unsub = subscribeStylistEngineMethod(v => { if (!cancelled) setMethod(v); });
    return () => { cancelled = true; unsub(); };
  }, []);

  return { method, loading };
}

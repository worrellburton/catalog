import { useEffect, useState } from 'react';
import { supabase } from '~/utils/supabase';

/**
 * Lookup a brand's logo URL from public.brand_logos. Used by the
 * consumer feed when the "show brand logos" dial is ON. Results are
 * memoised module-level so 100 tiles for the same brand share a
 * single fetch.
 *
 * Returns `null` while loading and when no logo is registered for
 * the brand — callers should fall back to text in either case.
 */

interface CacheEntry { url: string | null; loading: boolean }
const cache = new Map<string, CacheEntry>();
const subscribers = new Map<string, Set<(url: string | null) => void>>();

function notify(key: string, url: string | null) {
  const set = subscribers.get(key);
  if (!set) return;
  for (const cb of set) cb(url);
}

async function fetchLogo(key: string): Promise<void> {
  if (!supabase) { cache.set(key, { url: null, loading: false }); notify(key, null); return; }
  const { data } = await supabase
    .from('brand_logos')
    .select('logo_url')
    .eq('brand', key)
    .maybeSingle();
  const url = (data?.logo_url as string | null) ?? null;
  cache.set(key, { url, loading: false });
  notify(key, url);
}

export function useBrandLogo(brand: string | null | undefined): string | null {
  const key = (brand || '').toLowerCase().trim();
  const [url, setUrl] = useState<string | null>(() => cache.get(key)?.url ?? null);

  useEffect(() => {
    if (!key) { setUrl(null); return; }
    const existing = cache.get(key);
    if (existing && !existing.loading) {
      setUrl(existing.url);
      return;
    }
    const set = subscribers.get(key) ?? new Set();
    set.add(setUrl);
    subscribers.set(key, set);
    if (!existing) {
      cache.set(key, { url: null, loading: true });
      void fetchLogo(key);
    }
    return () => { set.delete(setUrl); };
  }, [key]);

  return url;
}

import { useEffect, useState } from 'react';
import { supabase } from '~/utils/supabase';

// Fetches the set of look ids hidden by admins so the consumer feed can
// filter them out. Falls back to localStorage (written by the admin Content
// page) when Supabase isn't reachable, so deletions still propagate for a
// single-user admin even without the migration applied.
export function useHiddenLooks(): Set<number> {
  const [hidden, setHidden] = useState<Set<number>>(() => {
    try {
      const raw = typeof window !== 'undefined'
        ? window.localStorage.getItem('admin:hiddenLookIds')
        : null;
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return new Set(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('admin_hidden_looks')
        .select('look_id');
      if (cancelled || error || !data) return;
      const ids = new Set<number>(
        (data as { look_id: number }[]).map(r => r.look_id).filter(n => Number.isFinite(n)),
      );
      setHidden(prev => {
        // Merge with any localStorage entries so admin deletes made while
        // offline still take effect after the Supabase fetch completes.
        const merged = new Set(prev);
        ids.forEach(id => merged.add(id));
        return merged;
      });
    })();
    return () => { cancelled = true; };
  }, []);

  return hidden;
}

export function useHiddenProductKeys(): Set<string> {
  const [hidden, setHidden] = useState<Set<string>>(() => {
    try {
      const raw = typeof window !== 'undefined'
        ? window.localStorage.getItem('admin:hiddenProductKeys')
        : null;
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return new Set(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('admin_hidden_products')
        .select('brand, name');
      if (cancelled || error || !data) return;
      const keys = new Set<string>(
        (data as { brand: string; name: string }[]).map(r => `${r.brand}-${r.name}`),
      );
      setHidden(prev => {
        const merged = new Set(prev);
        keys.forEach(k => merged.add(k));
        return merged;
      });
    })();
    return () => { cancelled = true; };
  }, []);

  return hidden;
}

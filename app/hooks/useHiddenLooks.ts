import { useEffect, useState } from 'react';
import { supabase } from '~/utils/supabase';

// Simple in-process pub/sub so a `hideLookId()` call from e.g. the feed's
// right-click admin menu immediately propagates to every component that's
// read the hidden set via useHiddenLooks / useHiddenProductKeys.
type Listener = () => void;
const lookListeners = new Set<Listener>();
const productListeners = new Set<Listener>();
const notify = (set: Set<Listener>) => set.forEach(l => l());

function readLocalLookIds(): Set<number> {
  try {
    const raw = typeof window !== 'undefined'
      ? window.localStorage.getItem('admin:hiddenLookIds')
      : null;
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.map(Number).filter(Number.isFinite) : []);
  } catch {
    return new Set();
  }
}

function readLocalProductKeys(): Set<string> {
  try {
    const raw = typeof window !== 'undefined'
      ? window.localStorage.getItem('admin:hiddenProductKeys')
      : null;
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeLocalLookIds(set: Set<number>) {
  try { window.localStorage.setItem('admin:hiddenLookIds', JSON.stringify([...set])); } catch { /* quota */ }
}

export async function hideLookId(id: number): Promise<void> {
  const current = readLocalLookIds();
  current.add(id);
  writeLocalLookIds(current);
  notify(lookListeners);
  if (supabase) {
    // Best-effort cloud persist. Ignore "table missing" errors — localStorage
    // already made the hide stick for this browser.
    await supabase.from('admin_hidden_looks').upsert({ look_id: id }, { onConflict: 'look_id' });
  }
}

// Fetches the set of look ids hidden by admins so the consumer feed can
// filter them out. Falls back to localStorage (written by the admin Content
// page) when Supabase isn't reachable, so deletions still propagate for a
// single-user admin even without the migration applied.
export function useHiddenLooks(): Set<number> {
  const [hidden, setHidden] = useState<Set<number>>(() => readLocalLookIds());

  // Refresh from localStorage whenever hideLookId() fires.
  useEffect(() => {
    const listener = () => setHidden(readLocalLookIds());
    lookListeners.add(listener);
    return () => { lookListeners.delete(listener); };
  }, []);

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
      // Admin-hidden products (soft delete)
      const { data: hiddenData } = await supabase
        .from('admin_hidden_products')
        .select('brand, name');
      // Deactivated products (admin toggle off) — treat as hidden from feed
      const { data: inactiveData } = await supabase
        .from('products')
        .select('brand, name')
        .eq('is_active', false);
      if (cancelled) return;
      const keys = new Set<string>();
      if (hiddenData) {
        for (const r of hiddenData as { brand: string; name: string }[]) {
          keys.add(`${r.brand}-${r.name}`);
        }
      }
      if (inactiveData) {
        for (const r of inactiveData as { brand: string; name: string }[]) {
          keys.add(`${r.brand}-${r.name}`);
        }
      }
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

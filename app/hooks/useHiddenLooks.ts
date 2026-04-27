import { useEffect, useState } from 'react';
import { supabase } from '~/utils/supabase';

// Simple in-process pub/sub so a `hideLookId()` call from e.g. the feed's
// right-click admin menu immediately propagates to every component that's
// read the hidden set via useHiddenLooks / useHiddenProductKeys.
type Listener = () => void;
const lookListeners = new Set<Listener>();
const productListeners = new Set<Listener>();
const notify = (set: Set<Listener>) => set.forEach(l => l());

// Singleton in-flight caches. Both hooks fire from ContinuousFeed and
// GridView at minimum — without sharing, a fresh consumer mount issues
// 3 Supabase round-trips (admin_hidden_looks, admin_hidden_products,
// products?is_active=eq.false) for each component. Pooling collapses
// those into one fetch each, regardless of how many components ask.
let hiddenLookIdsPromise: Promise<Set<number>> | null = null;
let hiddenProductKeysPromise: Promise<Set<string>> | null = null;

async function fetchHiddenLookIds(): Promise<Set<number>> {
  if (!supabase) return new Set();
  const { data, error } = await supabase.from('admin_hidden_looks').select('look_id');
  if (error || !data) return new Set();
  return new Set<number>(
    (data as { look_id: number }[]).map(r => r.look_id).filter(n => Number.isFinite(n)),
  );
}

async function fetchHiddenProductKeys(): Promise<Set<string>> {
  if (!supabase) return new Set();
  // Run both queries in parallel — they're independent.
  const [hiddenRes, inactiveRes] = await Promise.all([
    supabase.from('admin_hidden_products').select('brand, name'),
    supabase.from('products').select('brand, name').eq('is_active', false),
  ]);
  const keys = new Set<string>();
  if (hiddenRes.data) {
    for (const r of hiddenRes.data as { brand: string; name: string }[]) {
      keys.add(`${r.brand}-${r.name}`);
    }
  }
  if (inactiveRes.data) {
    for (const r of inactiveRes.data as { brand: string; name: string }[]) {
      keys.add(`${r.brand}-${r.name}`);
    }
  }
  return keys;
}

function getHiddenLookIds(): Promise<Set<number>> {
  if (!hiddenLookIdsPromise) {
    hiddenLookIdsPromise = fetchHiddenLookIds().catch(err => {
      hiddenLookIdsPromise = null;
      throw err;
    });
  }
  return hiddenLookIdsPromise;
}

function getHiddenProductKeys(): Promise<Set<string>> {
  if (!hiddenProductKeysPromise) {
    hiddenProductKeysPromise = fetchHiddenProductKeys().catch(err => {
      hiddenProductKeysPromise = null;
      throw err;
    });
  }
  return hiddenProductKeysPromise;
}

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
    let cancelled = false;
    getHiddenLookIds().then(ids => {
      if (cancelled) return;
      setHidden(prev => {
        // Merge with any localStorage entries so admin deletes made while
        // offline still take effect after the Supabase fetch completes.
        const merged = new Set(prev);
        ids.forEach(id => merged.add(id));
        return merged;
      });
    }).catch(() => { /* offline / RLS — keep localStorage view */ });
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
    let cancelled = false;
    getHiddenProductKeys().then(keys => {
      if (cancelled) return;
      setHidden(prev => {
        const merged = new Set(prev);
        keys.forEach(k => merged.add(k));
        return merged;
      });
    }).catch(() => { /* offline — keep localStorage view */ });
    return () => { cancelled = true; };
  }, []);

  return hidden;
}

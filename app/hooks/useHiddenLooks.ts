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
// GridView at minimum - without sharing, a fresh consumer mount issues
// 3 Supabase round-trips (admin_hidden_looks, admin_hidden_products,
// products?is_active=eq.false) for each component. Pooling collapses
// those into one fetch each, regardless of how many components ask.
let hiddenLookIdsPromise: Promise<Set<number>> | null = null;
let hiddenLookUuidsPromise: Promise<Set<string>> | null = null;
let hiddenProductKeysPromise: Promise<Set<string>> | null = null;

async function fetchHiddenLookIds(): Promise<Set<number>> {
  if (!supabase) return new Set();
  const { data, error } = await supabase.from('admin_hidden_looks').select('look_id');
  if (error || !data) return new Set();
  return new Set<number>(
    (data as { look_id: number }[]).map(r => r.look_id).filter(n => Number.isFinite(n)),
  );
}

async function fetchHiddenLookUuids(): Promise<Set<string>> {
  if (!supabase) return new Set();
  const { data, error } = await supabase.from('admin_hidden_looks').select('look_uuid');
  if (error || !data) return new Set();
  return new Set<string>(
    (data as { look_uuid: string | null }[]).map(r => r.look_uuid).filter((s): s is string => !!s),
  );
}

async function fetchHiddenProductKeys(): Promise<Set<string>> {
  if (!supabase) return new Set();
  // Run both queries in parallel - they're independent.
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

function getHiddenLookUuids(): Promise<Set<string>> {
  if (!hiddenLookUuidsPromise) {
    hiddenLookUuidsPromise = fetchHiddenLookUuids().catch(err => {
      hiddenLookUuidsPromise = null;
      throw err;
    });
  }
  return hiddenLookUuidsPromise;
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

/**
 * Whether a look should be hidden from the consumer feed.
 *
 * A look is hidden by its stable `uuid` (DB looks) or — only when it has a
 * real, stable numeric id (`id >= 0`, i.e. a legacy seed look) — by that
 * numeric id. The synthetic negative ids assigned to DB rows with no
 * `legacy_id` are deliberately NEVER matched against the numeric set:
 * those ids are fetch-order-derived and unstable, so a stale entry would
 * otherwise suppress arbitrary (or all) looks.
 */
export function isLookHidden(
  look: { id: number; uuid?: string | null },
  hiddenIds: Set<number>,
  hiddenUuids: Set<string>,
): boolean {
  if (look.uuid && hiddenUuids.has(look.uuid)) return true;
  if (look.id >= 0 && hiddenIds.has(look.id)) return true;
  return false;
}

/**
 * Warm the admin-hidden look/product sets at boot so they load in parallel
 * with the feed fetch instead of serializing after the first GridView mount.
 * Reuses the singleton in-flight caches above, so it's safe to call repeatedly.
 */
export function prefetchHiddenContent(): void {
  void getHiddenLookIds();
  void getHiddenProductKeys();
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

function readLocalLookUuids(): Set<string> {
  try {
    const raw = typeof window !== 'undefined'
      ? window.localStorage.getItem('admin:hiddenLookUuids')
      : null;
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeLocalLookUuids(set: Set<string>) {
  try { window.localStorage.setItem('admin:hiddenLookUuids', JSON.stringify([...set])); } catch { /* quota */ }
}

/**
 * Soft-hide a look from the consumer feed.
 *
 * Looks that came from Supabase carry a stable `uuid` but their numeric
 * `id` is a synthetic, fetch-order-derived value (`-(index+1)` when the
 * row has no `legacy_id` — which is every DB look today). Keying a hide on
 * that numeric id is a bug: the id reshuffles on the next fetch, so the
 * stored value ends up matching a *different* look (or none), and a few
 * stale entries can suppress the entire feed. So we hide by `uuid` whenever
 * one exists, and only fall back to the numeric id for true legacy seed
 * looks (positive, stable ids, no uuid).
 */
export async function hideLookId(look: { id: number; uuid?: string | null }): Promise<void> {
  const uuid = look.uuid ?? null;
  if (uuid) {
    const current = readLocalLookUuids();
    current.add(uuid);
    writeLocalLookUuids(current);
    notify(lookListeners);
    if (supabase) {
      // Best-effort cloud persist. Ignore "table/column missing" errors -
      // localStorage already made the hide stick for this browser.
      await supabase.from('admin_hidden_looks').upsert({ look_uuid: uuid }, { onConflict: 'look_uuid' });
    }
    return;
  }
  const current = readLocalLookIds();
  current.add(look.id);
  writeLocalLookIds(current);
  notify(lookListeners);
  if (supabase) {
    await supabase.from('admin_hidden_looks').upsert({ look_id: look.id }, { onConflict: 'look_id' });
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
    }).catch(() => { /* offline / RLS - keep localStorage view */ });
    return () => { cancelled = true; };
  }, []);

  return hidden;
}

// uuid-keyed companion to useHiddenLooks. DB-backed looks are hidden by
// their stable uuid (see hideLookId) so a hide survives the fetch-order
// reshuffle that scrambles the synthetic numeric id.
export function useHiddenLookUuids(): Set<string> {
  const [hidden, setHidden] = useState<Set<string>>(() => readLocalLookUuids());

  useEffect(() => {
    const listener = () => setHidden(readLocalLookUuids());
    lookListeners.add(listener);
    return () => { lookListeners.delete(listener); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getHiddenLookUuids().then(uuids => {
      if (cancelled) return;
      setHidden(prev => {
        const merged = new Set(prev);
        uuids.forEach(u => merged.add(u));
        return merged;
      });
    }).catch(() => { /* offline / RLS - keep localStorage view */ });
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
    }).catch(() => { /* offline - keep localStorage view */ });
    return () => { cancelled = true; };
  }, []);

  return hidden;
}

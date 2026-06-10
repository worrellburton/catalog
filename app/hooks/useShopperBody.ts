import { useEffect, useState, useSyncExternalStore } from 'react';
import { supabase } from '~/utils/supabase';
import { loadBrandFitProfiles, type ShopperBody } from '~/services/size-match';

const EMPTY_BODY: ShopperBody = { gender: 'unknown', heightCm: null, weightKg: null };

// Singleton store so every component shares one fetch.
let cachedBody: ShopperBody = EMPTY_BODY;
let fetchedForUserId: string | null = null;
const listeners = new Set<() => void>();

function notify() { for (const l of listeners) l(); }

async function fetchBody(userId: string): Promise<ShopperBody> {
  if (!supabase) return EMPTY_BODY;
  const { data } = await supabase
    .from('profiles')
    .select('gender, height_cm, weight_kg')
    .eq('id', userId)
    .maybeSingle();
  if (!data) return EMPTY_BODY;
  const g = (data.gender as string)?.toLowerCase();
  return {
    gender: g === 'male' || g === 'men' || g === 'm' ? 'male'
      : g === 'female' || g === 'women' || g === 'f' ? 'female'
      : 'unknown',
    heightCm: typeof data.height_cm === 'number' ? data.height_cm : null,
    weightKg: typeof data.weight_kg === 'number' ? data.weight_kg : null,
  };
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function getSnapshot(): ShopperBody { return cachedBody; }
function getServerSnapshot(): ShopperBody { return EMPTY_BODY; }

export function useShopperBody(userId: string | null | undefined): ShopperBody {
  const body = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (!userId) {
      if (cachedBody !== EMPTY_BODY) {
        cachedBody = EMPTY_BODY;
        fetchedForUserId = null;
        notify();
      }
      return;
    }
    if (fetchedForUserId === userId) return;
    fetchedForUserId = userId;

    let cancelled = false;
    Promise.all([fetchBody(userId), loadBrandFitProfiles()]).then(([b]) => {
      if (cancelled) return;
      cachedBody = b;
      notify();
    });
    return () => { cancelled = true; };
  }, [userId]);

  return body;
}

export function invalidateShopperBody(): void {
  fetchedForUserId = null;
  cachedBody = EMPTY_BODY;
  notify();
}

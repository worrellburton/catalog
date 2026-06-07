import { useEffect, useRef, useState } from 'react';
import { supabase } from '~/utils/supabase';
import { type OpexItem, OPEX_STORAGE_KEY, defaultOpexItems } from '~/services/opex';

// Shared, real-time OpEx line items — one app_settings row (key OPEX_KEY)
// holds the list, mirroring useSharedModelSettings so the OpEx builder and
// the model read/write the same plan and broadcast edits live.

const OPEX_KEY = 'model:opex:v1';

export interface SharedOpex {
  items: OpexItem[];
  setItems: React.Dispatch<React.SetStateAction<OpexItem[]>>;
  live: boolean;
}

function readLocal(): OpexItem[] {
  if (typeof window === 'undefined') return defaultOpexItems();
  try {
    const raw = window.localStorage.getItem(OPEX_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch { /* fall through */ }
  return defaultOpexItems();
}

export function useSharedOpex(): SharedOpex {
  const [items, setItems] = useState<OpexItem[]>(() => readLocal());
  const [live, setLive] = useState(false);
  const hydratedRef = useRef(false);
  const lastSyncedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!supabase) { hydratedRef.current = true; return; }
    let cancelled = false;

    (async () => {
      const { data } = await supabase!
        .from('app_settings')
        .select('value')
        .eq('key', OPEX_KEY)
        .maybeSingle();
      if (cancelled) return;
      if (data?.value) {
        try {
          const parsed = JSON.parse(data.value);
          if (Array.isArray(parsed)) {
            lastSyncedRef.current = data.value;
            setItems(parsed);
          }
        } catch { /* keep local */ }
      }
      hydratedRef.current = true;
    })();

    const channel = supabase
      .channel('app-settings-opex')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'app_settings', filter: `key=eq.${OPEX_KEY}` },
        (payload: { new?: { value?: string } }) => {
          const value = payload.new?.value;
          if (!value || value === lastSyncedRef.current) return;
          try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) {
              lastSyncedRef.current = value;
              setItems(parsed);
            }
          } catch { /* ignore */ }
        },
      )
      .subscribe((status) => { if (status === 'SUBSCRIBED') setLive(true); });

    return () => { cancelled = true; if (supabase) supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem(OPEX_STORAGE_KEY, JSON.stringify(items)); } catch { /* quota */ }
    if (!hydratedRef.current || !supabase) return;
    const value = JSON.stringify(items);
    if (value === lastSyncedRef.current) return;
    const t = setTimeout(() => {
      lastSyncedRef.current = value;
      void supabase!
        .from('app_settings')
        .upsert({ key: OPEX_KEY, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    }, 400);
    return () => clearTimeout(t);
  }, [items]);

  return { items, setItems, live };
}

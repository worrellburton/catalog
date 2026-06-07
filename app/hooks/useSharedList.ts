import { useEffect, useRef, useState } from 'react';
import { supabase } from '~/utils/supabase';

// Generic shared, real-time array stored as one app_settings row. Powers
// the OpEx line items and payroll lists (same pattern as the model doc):
// every admin reads the same list, edits persist (debounced) and broadcast
// over Supabase Realtime; localStorage is the offline cache / first paint.

export interface SharedList<T> {
  items: T[];
  setItems: React.Dispatch<React.SetStateAction<T[]>>;
  live: boolean;
}

export function useSharedList<T>(sharedKey: string, storageKey: string, fallback: () => T[]): SharedList<T> {
  const [items, setItems] = useState<T[]>(() => {
    if (typeof window === 'undefined') return fallback();
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed as T[];
      }
    } catch { /* fall through */ }
    return fallback();
  });
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
        .eq('key', sharedKey)
        .maybeSingle();
      if (cancelled) return;
      if (data?.value) {
        try {
          const parsed = JSON.parse(data.value);
          if (Array.isArray(parsed)) {
            lastSyncedRef.current = data.value;
            setItems(parsed as T[]);
          }
        } catch { /* keep local */ }
      }
      hydratedRef.current = true;
    })();

    const channel = supabase
      .channel(`app-settings-${sharedKey}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'app_settings', filter: `key=eq.${sharedKey}` },
        (payload: { new?: { value?: string } }) => {
          const value = payload.new?.value;
          if (!value || value === lastSyncedRef.current) return;
          try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) {
              lastSyncedRef.current = value;
              setItems(parsed as T[]);
            }
          } catch { /* ignore */ }
        },
      )
      .subscribe((status) => { if (status === 'SUBSCRIBED') setLive(true); });

    return () => { cancelled = true; if (supabase) supabase.removeChannel(channel); };
  }, [sharedKey]);

  useEffect(() => {
    try { window.localStorage.setItem(storageKey, JSON.stringify(items)); } catch { /* quota */ }
    if (!hydratedRef.current || !supabase) return;
    const value = JSON.stringify(items);
    if (value === lastSyncedRef.current) return;
    const t = setTimeout(() => {
      lastSyncedRef.current = value;
      void supabase!
        .from('app_settings')
        .upsert({ key: sharedKey, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    }, 400);
    return () => clearTimeout(t);
  }, [items, sharedKey, storageKey]);

  return { items, setItems, live };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, upsertAppSettingKeepalive } from '~/utils/supabase';
import { type EquityState, EQUITY_STORAGE_KEY, mergeEquity, readEquityStored } from '~/services/equity';

// Same shared-document pattern as useSharedModelSettings: one
// app_settings row, every admin reads/writes the same numbers, edits
// broadcast over Realtime, localStorage is the offline cache.

const EQUITY_KEY = 'equity:state:v1';

export function useSharedEquity(): {
  equity: EquityState;
  setEquity: React.Dispatch<React.SetStateAction<EquityState>>;
  live: boolean;
} {
  const [equity, setEquity] = useState<EquityState>(() => readEquityStored());
  const [live, setLive] = useState(false);
  const hydratedRef = useRef(false);
  const lastSyncedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!supabase) { hydratedRef.current = true; return; }
    let cancelled = false;
    const hydrateGuard = setTimeout(() => { hydratedRef.current = true; }, 2500);

    (async () => {
      try {
        const { data } = await supabase!
          .from('app_settings')
          .select('value')
          .eq('key', EQUITY_KEY)
          .maybeSingle();
        if (!cancelled && data?.value) {
          const merged = mergeEquity(JSON.parse(data.value));
          lastSyncedRef.current = JSON.stringify(merged);
          setEquity(merged);
        }
      } catch { /* keep local cache — never block writes on a failed read */ }
      if (!cancelled) hydratedRef.current = true;
    })();

    const channel = supabase
      .channel('app-settings-equity')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'app_settings', filter: `key=eq.${EQUITY_KEY}` },
        (payload: { new?: { value?: string } }) => {
          const value = payload.new?.value;
          if (!value || value === lastSyncedRef.current) return; // our own echo
          try {
            const merged = mergeEquity(JSON.parse(value));
            lastSyncedRef.current = JSON.stringify(merged);
            setEquity(merged);
          } catch { /* ignore malformed */ }
        },
      )
      .subscribe((status) => { if (status === 'SUBSCRIBED') setLive(true); });

    return () => { cancelled = true; clearTimeout(hydrateGuard); if (supabase) supabase.removeChannel(channel); };
  }, []);

  const pendingRef = useRef<string | null>(null);
  const flush = useCallback(() => {
    const value = pendingRef.current;
    if (!value || value === lastSyncedRef.current) return;
    lastSyncedRef.current = value;
    pendingRef.current = null;
    upsertAppSettingKeepalive(EQUITY_KEY, value);
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem(EQUITY_STORAGE_KEY, JSON.stringify(equity)); } catch { /* quota */ }
    if (!hydratedRef.current || !supabase) return;
    const value = JSON.stringify(equity);
    if (value === lastSyncedRef.current) return;
    pendingRef.current = value;
    const t = setTimeout(flush, 400);
    return () => clearTimeout(t);
  }, [equity, flush]);

  useEffect(() => {
    const onHide = () => flush();
    window.addEventListener('pagehide', onHide);
    return () => { window.removeEventListener('pagehide', onHide); flush(); };
  }, [flush]);

  return { equity, setEquity, live };
}

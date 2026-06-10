import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, upsertAppSettingKeepalive } from '~/utils/supabase';

// Generic shared, real-time array stored as one app_settings row. Powers
// the OpEx line items and payroll lists (same pattern as the model doc):
// every admin reads the same list, edits persist (debounced) and broadcast
// over Supabase Realtime; localStorage is the offline cache / first paint.

export interface SharedList<T> {
  items: T[];
  setItems: React.Dispatch<React.SetStateAction<T[]>>;
  live: boolean;
}

export interface SharedValue<T> {
  value: T;
  setValue: React.Dispatch<React.SetStateAction<T>>;
  live: boolean;
}

// Single shared object (vs. a list). Same realtime/echo-guard logic.
export function useSharedValue<T extends object>(sharedKey: string, storageKey: string, fallback: () => T): SharedValue<T> {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return fallback();
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) return { ...fallback(), ...JSON.parse(raw) };
    } catch { /* fall through */ }
    return fallback();
  });
  const [live, setLive] = useState(false);
  const hydratedRef = useRef(false);
  const lastSyncedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!supabase) { hydratedRef.current = true; return; }
    let cancelled = false;
    // Enable writes even if the read errors/hangs (else the save gate blocks
    // every server write — the "edits don't persist" root cause).
    const hydrateGuard = setTimeout(() => { hydratedRef.current = true; }, 2500);
    (async () => {
      try {
        const { data } = await supabase!.from('app_settings').select('value').eq('key', sharedKey).maybeSingle();
        if (!cancelled && data?.value) {
          const merged = { ...fallback(), ...JSON.parse(data.value) };
          lastSyncedRef.current = JSON.stringify(merged);
          setValue(merged);
        }
      } catch { /* keep local */ }
      if (!cancelled) hydratedRef.current = true;
    })();
    const channel = supabase
      .channel(`app-settings-${sharedKey}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings', filter: `key=eq.${sharedKey}` }, (payload: { new?: { value?: string } }) => {
        const v = payload.new?.value;
        if (!v) return;
        try {
          const merged = { ...fallback(), ...JSON.parse(v) };
          const s = JSON.stringify(merged);
          if (s === lastSyncedRef.current) return;
          lastSyncedRef.current = s;
          setValue(merged);
        } catch { /* ignore */ }
      })
      .subscribe((status) => { if (status === 'SUBSCRIBED') setLive(true); });
    return () => { cancelled = true; clearTimeout(hydrateGuard); if (supabase) supabase.removeChannel(channel); };
  }, [sharedKey]);

  const pendingRef = useRef<string | null>(null);
  const flush = useCallback(() => {
    const s = pendingRef.current;
    if (!s || s === lastSyncedRef.current) return;
    lastSyncedRef.current = s;
    pendingRef.current = null;
    upsertAppSettingKeepalive(sharedKey, s);
  }, [sharedKey]);

  useEffect(() => {
    try { window.localStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* quota */ }
    if (!hydratedRef.current || !supabase) return;
    const s = JSON.stringify(value);
    if (s === lastSyncedRef.current) return;
    pendingRef.current = s;
    const t = setTimeout(flush, 400);
    return () => clearTimeout(t);
  }, [value, storageKey, flush]);

  // Never drop a pending write when navigating away or closing the tab.
  useEffect(() => {
    const onHide = () => flush();
    window.addEventListener('pagehide', onHide);
    return () => { window.removeEventListener('pagehide', onHide); flush(); };
  }, [flush]);

  return { value, setValue, live };
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
    const hydrateGuard = setTimeout(() => { hydratedRef.current = true; }, 2500);

    (async () => {
      try {
        const { data } = await supabase!
          .from('app_settings')
          .select('value')
          .eq('key', sharedKey)
          .maybeSingle();
        if (!cancelled && data?.value) {
          const parsed = JSON.parse(data.value);
          if (Array.isArray(parsed)) {
            lastSyncedRef.current = data.value;
            setItems(parsed as T[]);
          }
        }
      } catch { /* keep local — never block writes on a failed read */ }
      if (!cancelled) hydratedRef.current = true;
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

    return () => { cancelled = true; clearTimeout(hydrateGuard); if (supabase) supabase.removeChannel(channel); };
  }, [sharedKey]);

  const pendingRef = useRef<string | null>(null);
  const flush = useCallback(() => {
    const value = pendingRef.current;
    if (!value || value === lastSyncedRef.current) return;
    lastSyncedRef.current = value;
    pendingRef.current = null;
    upsertAppSettingKeepalive(sharedKey, value);
  }, [sharedKey]);

  useEffect(() => {
    try { window.localStorage.setItem(storageKey, JSON.stringify(items)); } catch { /* quota */ }
    if (!hydratedRef.current || !supabase) return;
    const value = JSON.stringify(items);
    if (value === lastSyncedRef.current) return;
    pendingRef.current = value;
    const t = setTimeout(flush, 400);
    return () => clearTimeout(t);
  }, [items, storageKey, flush]);

  // Never drop a pending write when navigating away or closing the tab.
  useEffect(() => {
    const onHide = () => flush();
    window.addEventListener('pagehide', onHide);
    return () => { window.removeEventListener('pagehide', onHide); flush(); };
  }, [flush]);

  return { items, setItems, live };
}

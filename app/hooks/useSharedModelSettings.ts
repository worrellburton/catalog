import { useEffect, useRef, useState } from 'react';
import { supabase } from '~/utils/supabase';
import { type Assumptions, DEFAULTS, STORAGE_KEY, readStored } from '~/services/projections';
import { type GtmAssumptions, GTM_DEFAULTS, GTM_STORAGE_KEY, readGtmStored } from '~/services/go-to-market';
import { type EconAssumptions, ECON_DEFAULTS, ECON_STORAGE_KEY, readEconStored } from '~/services/model-metrics';

// The financial-model numbers are a single SHARED, real-time document:
// one row in app_settings (key = MODEL_KEY) holds all three assumption
// sets. Every admin reads the same values on load, writes are persisted
// (debounced), and a change in one session broadcasts to every other open
// session over Supabase Realtime. localStorage is kept as an offline
// cache / instant first paint and as a fallback when Supabase is absent.

const MODEL_KEY = 'model:state:v1';

const serialize = (rev: Assumptions, acq: GtmAssumptions, econ: EconAssumptions): string =>
  JSON.stringify({ rev, acq, econ });

export interface SharedModelSettings {
  rev: Assumptions;
  acq: GtmAssumptions;
  econ: EconAssumptions;
  setRev: React.Dispatch<React.SetStateAction<Assumptions>>;
  setAcq: React.Dispatch<React.SetStateAction<GtmAssumptions>>;
  setEcon: React.Dispatch<React.SetStateAction<EconAssumptions>>;
  /** True once a realtime channel is connected (shows the "live" pill). */
  live: boolean;
}

export function useSharedModelSettings(): SharedModelSettings {
  const [rev, setRev] = useState<Assumptions>(() => readStored());
  const [acq, setAcq] = useState<GtmAssumptions>(() => readGtmStored());
  const [econ, setEcon] = useState<EconAssumptions>(() => readEconStored());
  const [live, setLive] = useState(false);

  const hydratedRef = useRef(false);
  // The value we last know to be in sync with the server. Used in both
  // directions so we never (a) write back a value we just received, nor
  // (b) react to the realtime echo of our own write.
  const lastSyncedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!supabase) { hydratedRef.current = true; return; }
    let cancelled = false;

    (async () => {
      const { data } = await supabase!
        .from('app_settings')
        .select('value')
        .eq('key', MODEL_KEY)
        .maybeSingle();
      if (cancelled) return;
      if (data?.value) {
        try {
          const p = JSON.parse(data.value);
          const r = { ...DEFAULTS, ...p.rev };
          const a = { ...GTM_DEFAULTS, ...p.acq };
          const e = { ...ECON_DEFAULTS, ...p.econ };
          lastSyncedRef.current = serialize(r, a, e);
          setRev(r); setAcq(a); setEcon(e);
        } catch { /* keep local */ }
      }
      hydratedRef.current = true;
    })();

    const channel = supabase
      .channel('app-settings-model')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'app_settings', filter: `key=eq.${MODEL_KEY}` },
        (payload: { new?: { value?: string } }) => {
          const value = payload.new?.value;
          if (!value || value === lastSyncedRef.current) return; // our own echo
          try {
            const p = JSON.parse(value);
            const r = { ...DEFAULTS, ...p.rev };
            const a = { ...GTM_DEFAULTS, ...p.acq };
            const e = { ...ECON_DEFAULTS, ...p.econ };
            lastSyncedRef.current = serialize(r, a, e);
            setRev(r); setAcq(a); setEcon(e);
          } catch { /* ignore malformed */ }
        },
      )
      .subscribe((status) => { if (status === 'SUBSCRIBED') setLive(true); });

    return () => { cancelled = true; if (supabase) supabase.removeChannel(channel); };
  }, []);

  // Cache locally always; push to the shared row (debounced) once hydrated.
  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rev)); } catch { /* quota */ }
    try { window.localStorage.setItem(GTM_STORAGE_KEY, JSON.stringify(acq)); } catch { /* quota */ }
    try { window.localStorage.setItem(ECON_STORAGE_KEY, JSON.stringify(econ)); } catch { /* quota */ }

    if (!hydratedRef.current || !supabase) return;
    const value = serialize(rev, acq, econ);
    if (value === lastSyncedRef.current) return;

    const t = setTimeout(() => {
      lastSyncedRef.current = value;
      void supabase!
        .from('app_settings')
        .upsert({ key: MODEL_KEY, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    }, 400);
    return () => clearTimeout(t);
  }, [rev, acq, econ]);

  return { rev, acq, econ, setRev, setAcq, setEcon, live };
}

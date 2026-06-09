import { useEffect, useState } from 'react';
import { getWaitlistMode, subscribeWaitlistMode, DEFAULT_WAITLIST_MODE } from '~/services/dials';

// Launch master switch, read app-wide. The source of truth is the global
// waitlist_mode dial (app_settings), so flipping it on the dials page
// re-routes every visitor in real time.
//
// Per-device preview override: because dev + prod share one Supabase
// project (one app_settings row), an admin can preview either flow on a
// single device WITHOUT changing the global value, via ?flow=open |
// ?flow=waitlist (cleared with ?flow=clear). The override is stored in
// localStorage and always wins over the global dial on that device.

const OVERRIDE_KEY = 'catalog:flow-override';

function readOverride(): boolean | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.localStorage.getItem(OVERRIDE_KEY);
    if (v === 'open') return false;
    if (v === 'waitlist') return true;
  } catch { /* private mode */ }
  return null;
}

/** Consume a ?flow= param into the localStorage override, then strip it so
 *  the URL stays clean. Call once early in boot. Returns nothing. */
export function applyFlowOverrideFromUrl(): void {
  if (typeof window === 'undefined') return;
  try {
    const params = new URLSearchParams(window.location.search);
    const flow = params.get('flow');
    if (!flow) return;
    if (flow === 'open' || flow === 'waitlist') window.localStorage.setItem(OVERRIDE_KEY, flow);
    else if (flow === 'clear') window.localStorage.removeItem(OVERRIDE_KEY);
    params.delete('flow');
    const rest = params.toString();
    const url = `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash || ''}`;
    window.history.replaceState(null, '', url);
  } catch { /* ignore */ }
}

export function useWaitlistMode(): { waitlistMode: boolean; loading: boolean } {
  const override = readOverride();
  const [waitlistMode, setMode] = useState<boolean>(override ?? DEFAULT_WAITLIST_MODE);
  const [loading, setLoading] = useState<boolean>(override == null);

  useEffect(() => {
    // A local preview override pins the mode — don't read or subscribe.
    if (override != null) { setMode(override); setLoading(false); return; }
    let cancelled = false;
    getWaitlistMode().then(v => { if (!cancelled) { setMode(v); setLoading(false); } });
    const unsub = subscribeWaitlistMode(v => { if (!cancelled) setMode(v); });
    return () => { cancelled = true; unsub(); };
  }, [override]);

  return { waitlistMode, loading };
}

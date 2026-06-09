import { supabase } from '~/utils/supabase';

// Guest activity heartbeat. The signed-in session tracker (session-tracker.ts)
// only logs authenticated users, so guests were invisible to the admin DAU
// number. This pings a per-device id (kept in localStorage) through the
// guest_ping RPC so admin home can split active users into registered vs
// unregistered. Cheap: one upsert on start, then every few minutes while the
// tab is visible. No PII — the id is a random string the device generates.

const CLIENT_ID_KEY = 'catalog:guest:cid:v1';
const PING_INTERVAL_MS = 4 * 60 * 1000; // every 4 min while active

let started = false;
let intervalId: number | null = null;

function getClientId(): string {
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = (crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    // Private mode / no storage — fall back to an ephemeral per-load id so a
    // ping still lands (counts the visit, just not de-duped across reloads).
    return Math.random().toString(36).slice(2);
  }
}

function ping(clientId: string): void {
  if (!supabase) return;
  supabase.rpc('guest_ping', { p_client_id: clientId }).then(({ error }) => {
    if (error) console.warn('[guest-tracker] ping failed:', error.message);
  });
}

/** Begin pinging guest activity. Idempotent — safe to call on every render.
 *  Call only for signed-out visitors (authenticated users are tracked by
 *  session-tracker). */
export function startGuestTracker(): void {
  if (started || typeof window === 'undefined' || !supabase) return;
  started = true;
  const clientId = getClientId();
  ping(clientId);
  const tick = () => { if (document.visibilityState === 'visible') ping(clientId); };
  intervalId = window.setInterval(tick, PING_INTERVAL_MS);
  // Catch a backgrounded tab coming back so a long-idle guest re-registers.
  document.addEventListener('visibilitychange', tick);
}

/** Stop pinging (e.g. once the visitor signs in). */
export function stopGuestTracker(): void {
  if (intervalId != null) { window.clearInterval(intervalId); intervalId = null; }
  started = false;
}

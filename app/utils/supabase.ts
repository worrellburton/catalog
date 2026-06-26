import { createClient } from '@supabase/supabase-js';

// Public Supabase credentials - anon key is designed to be exposed in client bundles.
// RLS enforces access control.
const DEFAULT_SUPABASE_URL = 'https://vtarjrnqvcqbhoclvcur.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0YXJqcm5xdmNxYmhvY2x2Y3VyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MTIzNzksImV4cCI6MjA5MDM4ODM3OX0.OMoLmVDtXLw5hL0k7icaBJlIbLPnN9UeCzv8C-o4III';

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_URL ||
  DEFAULT_SUPABASE_URL;

const supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  DEFAULT_SUPABASE_ANON_KEY;

// Inside the native shell (Flutter webview) the native app owns the Supabase
// session — it logs the user in, auto-refreshes, and re-seeds the rotated
// token into our localStorage. If THIS client ALSO auto-refreshed, both would
// rotate the same single-use refresh token; whichever refreshes second gets
// "Invalid Refresh Token: Already Used", which breaks the web session on the
// next reload (the "stuck on the logo splash" report). So in the shell we
// leave refreshing to the native app and just consume the token it seeds.
// ponytail: the seeded access token is valid for ~1h, refreshed on every
// reload via the shell's re-seed. A >1h actively-used session with no reload
// would expire — add a native→web setSession push if that ever bites.
const inShell =
  typeof document !== 'undefined' &&
  document.documentElement.dataset.shell === 'catalog-app';

// Explicit auth config so mobile Safari (and the Flutter webview) get a
// reliable OAuth flow regardless of browser default. PKCE is required
// for the code-exchange path that catches the Google redirect on
// devices where Safari ITP would otherwise drop the access_token from
// the URL hash. detectSessionInUrl + persistSession let supabase-js
// auto-handle the ?code=… callback and stash the resulting session in
// localStorage so a hard reload picks the user back up.
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    flowType: 'pkce',
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: !inShell,
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    storageKey: 'sb-vtarjrnqvcqbhoclvcur-auth-token',
  },
});

// Re-exported for the few call sites (e.g. XHR-based storage upload with
// progress events) that need to talk to the Storage REST API directly.
// supabase-js's StorageClient.url and .supabaseKey are technically
// private and not safe to read off the client object.
export const SUPABASE_URL = supabaseUrl;
export const SUPABASE_ANON_KEY = supabaseKey;

/**
 * Upsert one `app_settings` row via a `keepalive` fetch.
 *
 * supabase-js's normal `.upsert()` uses a regular fetch that the browser
 * ABORTS the moment the page unloads — so a value typed and then immediately
 * refreshed (or navigated away from) never reaches the server. `keepalive`
 * lets the request outlive the page, which is exactly what the shared-model
 * "save on refresh" path needs. Fire-and-forget; failures are best-effort.
 *
 * Auth: the app_settings upsert policies grant the anon role, so the anon key
 * works for both `apikey` and `Authorization` here regardless of session.
 */
export function upsertAppSettingKeepalive(key: string, value: string): void {
  if (typeof fetch === 'undefined') return;
  try {
    void fetch(`${SUPABASE_URL}/rest/v1/app_settings?on_conflict=key`, {
      method: 'POST',
      keepalive: true,
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
    }).catch(() => { /* best-effort */ });
  } catch { /* best-effort */ }
}


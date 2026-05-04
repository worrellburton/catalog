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

console.log('[Supabase] init url:', supabaseUrl?.substring(0, 30) + '...', 'key present:', !!supabaseKey, 'key length:', supabaseKey?.length);

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
    autoRefreshToken: true,
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

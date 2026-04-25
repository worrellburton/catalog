import { createClient } from '@supabase/supabase-js';

// Public Supabase credentials — anon key is designed to be exposed in client bundles.
// RLS enforces access control.
const DEFAULT_SUPABASE_URL = 'https://vtarjrnqvcqbhoclvcur.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0YXJqcm5xdmNxYmhvY2x2Y3VyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MTIzNzksImV4cCI6MjA5MDM4ODM3OX0.OMoLmVDtXLw5hL0k7icaBJlIbLPnN9UeCzv8C-o4III';

// Read overrides from the page URL so QA / preview links can point the SPA at
// a different Supabase project without a rebuild, e.g.
//   https://…/catalog/?supabase_url=https://abc.supabase.co&supabase_key=ey…
// Only an https://*.supabase.co URL is accepted to prevent pointing the
// client at an attacker-controlled host via a crafted link.
function readUrlOverrides(): { url?: string; key?: string } {
  if (typeof window === 'undefined') return {};
  try {
    const params = new URLSearchParams(window.location.search);
    const rawUrl = params.get('supabase_url') ?? undefined;
    const key = params.get('supabase_key') ?? undefined;
    let url: string | undefined;
    if (rawUrl) {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === 'https:' && parsed.hostname.endsWith('.supabase.co')) {
        url = parsed.origin;
      } else {
        console.warn('[Supabase] ignoring supabase_url override (not an https *.supabase.co URL):', rawUrl);
      }
    }
    return { url, key };
  } catch (err) {
    console.warn('[Supabase] failed to parse URL overrides:', err);
    return {};
  }
}

const urlOverrides = readUrlOverrides();

const supabaseUrl =
  urlOverrides.url ||
  import.meta.env.VITE_SUPABASE_URL ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_URL ||
  DEFAULT_SUPABASE_URL;

const supabaseKey =
  urlOverrides.key ||
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  DEFAULT_SUPABASE_ANON_KEY;

console.log('[Supabase] init url:', supabaseUrl?.substring(0, 30) + '...', 'key present:', !!supabaseKey, 'key length:', supabaseKey?.length);

export const supabase = createClient(supabaseUrl, supabaseKey);

// Re-exported for the few call sites (e.g. XHR-based storage upload with
// progress events) that need to talk to the Storage REST API directly.
// supabase-js's StorageClient.url and .supabaseKey are technically
// private and not safe to read off the client object.
export const SUPABASE_URL = supabaseUrl;
export const SUPABASE_ANON_KEY = supabaseKey;

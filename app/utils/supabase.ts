import { createClient } from '@supabase/supabase-js';

// Public Supabase credentials — anon key is designed to be exposed in client bundles.
// RLS enforces access control.
const DEFAULT_SUPABASE_URL = 'https://hmgnrowqjrxvesmdshnp.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhtZ25yb3dxanJ4dmVzbWRzaG5wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4NzkwMTAsImV4cCI6MjA5MDQ1NTAxMH0.XI1-XJtaTEu2rMBwmsUUGMUG3wWhnbiy-qW0Mx2c-zI';

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

export const supabase = createClient(supabaseUrl, supabaseKey);

// Re-exported for the few call sites (e.g. XHR-based storage upload with
// progress events) that need to talk to the Storage REST API directly.
// supabase-js's StorageClient.url and .supabaseKey are technically
// private and not safe to read off the client object.
export const SUPABASE_URL = supabaseUrl;
export const SUPABASE_ANON_KEY = supabaseKey;

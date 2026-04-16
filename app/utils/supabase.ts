import { createClient } from '@supabase/supabase-js';

// Public Supabase credentials — anon key is safe to expose (RLS enforces security)
const SUPABASE_URL = 'https://vtarjrnqvcqbhoclvcur.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0YXJqcm5xdmNxYmhvY2x2Y3VyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MTIzNzksImV4cCI6MjA5MDM4ODM3OX0.OMoLmVDtXLw5hL0k7icaBJlIbLPnN9UeCzv8C-o4III';

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_URL ||
  SUPABASE_URL;

const supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);

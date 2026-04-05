import { supabase } from '~/utils/supabase';

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  provider: string | null;
  created_at: string;
  last_sign_in_at: string | null;
}

export async function getProfiles(): Promise<Profile[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, avatar_url, provider, created_at, last_sign_in_at')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('Failed to load profiles', error);
    return [];
  }
  return data || [];
}

import { supabase } from '~/utils/supabase';
import type { UserRole } from '~/types/roles';

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  provider: string | null;
  role: UserRole;
  created_at: string;
  last_sign_in_at: string | null;
}

export async function getProfiles(): Promise<Profile[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, avatar_url, provider, role, created_at, last_sign_in_at')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('Failed to load profiles', error);
    return [];
  }
  return (data || []).map(p => ({ ...p, role: p.role || 'shopper' }));
}

export async function getProfilesByRole(role: UserRole): Promise<Profile[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, avatar_url, provider, role, created_at, last_sign_in_at')
    .eq('role', role)
    .order('created_at', { ascending: false });
  if (error) {
    console.error(`Failed to load ${role} profiles`, error);
    return [];
  }
  return (data || []).map(p => ({ ...p, role: p.role || 'shopper' }));
}

export async function updateUserRole(userId: string, role: UserRole): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const { error } = await supabase
    .from('profiles')
    .update({ role })
    .eq('id', userId);
  if (error) return { error: error.message };
  return {};
}

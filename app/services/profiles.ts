import { supabase } from '~/utils/supabase';
import type { UserRole } from '~/types/roles';

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  provider: string | null;
  role: UserRole;
  is_admin: boolean;
  gender: 'male' | 'female' | 'unknown';
  created_at: string;
  last_sign_in_at: string | null;
}

const PROFILE_SELECT = 'id, email, full_name, avatar_url, provider, role, is_admin, gender, created_at, last_sign_in_at';

export async function getProfiles(): Promise<Profile[]> {
  if (!supabase) return [];
  // Try with the full column set first; fall back if older deploys
  // haven't run the role / is_admin migrations yet.
  let result = await supabase
    .from('profiles')
    .select(PROFILE_SELECT)
    .order('created_at', { ascending: false });
  if (result.error) {
    const fallback = await supabase
      .from('profiles')
      .select('id, email, full_name, avatar_url, provider, created_at, last_sign_in_at')
      .order('created_at', { ascending: false });
    if (fallback.error) {
      console.error('Failed to load profiles', fallback.error);
      return [];
    }
    result = fallback as unknown as typeof result;
  }
  const rows = (result.data || []) as unknown as Record<string, unknown>[];
  return rows.map(p => ({
    id: p.id as string,
    email: (p.email as string) || null,
    full_name: (p.full_name as string) || null,
    avatar_url: (p.avatar_url as string) || null,
    provider: (p.provider as string) || null,
    role: (p.role as UserRole) || 'shopper',
    is_admin: (p.is_admin as boolean) ?? (p.role === 'admin' || p.role === 'super_admin'),
    gender: ((p.gender as string) === 'male' || (p.gender as string) === 'female')
      ? (p.gender as 'male' | 'female')
      : 'unknown',
    created_at: p.created_at as string,
    last_sign_in_at: (p.last_sign_in_at as string) || null,
  }));
}

export async function getProfilesByRole(role: UserRole): Promise<Profile[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_SELECT)
    .eq('role', role)
    .order('created_at', { ascending: false });
  if (error) {
    console.error(`Failed to load ${role} profiles`, error);
    return [];
  }
  return (data || []).map(p => {
    const g = (p as { gender?: string }).gender;
    return {
      ...p,
      role: p.role || 'shopper',
      is_admin: (p as { is_admin?: boolean }).is_admin ?? (p.role === 'admin' || p.role === 'super_admin'),
      gender: (g === 'male' || g === 'female') ? g : 'unknown',
    };
  });
}

export async function updateUserRole(userId: string, role: UserRole): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const { data, error } = await supabase
    .from('profiles')
    .update({ role })
    .eq('id', userId)
    .select('id, role');
  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: 'Update blocked by RLS. You must be signed in as admin/super_admin to change another user\'s role.' };
  }
  if (data[0].role !== role) {
    return { error: `Role did not persist (got ${data[0].role}, expected ${role}).` };
  }
  return {};
}

/**
 * Toggle the explicit admin flag on a profile. Source-of-truth for
 * the admin gate going forward; the Admins tab in /admin/users
 * filters on this column.
 */
export async function updateUserIsAdmin(
  userId: string,
  isAdmin: boolean,
): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const { data, error } = await supabase
    .from('profiles')
    .update({ is_admin: isAdmin })
    .eq('id', userId)
    .select('id, is_admin');
  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: 'Update blocked by RLS. Sign in as an admin to toggle this.' };
  }
  if (data[0].is_admin !== isAdmin) {
    return { error: 'Toggle did not persist.' };
  }
  return {};
}

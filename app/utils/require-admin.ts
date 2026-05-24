/**
 * Server-side admin assertion. Use at the top of any edge function
 * or RPC that mutates admin-scoped data. Returns the authenticated
 * user's profile when they're an admin; throws (with the right
 * HTTP-style status hint) otherwise.
 *
 * The DB layer is the source of truth via the RLS policies +
 * profiles_block_privilege_escalation trigger — this helper exists
 * so edge functions can fail fast with a clear error instead of
 * relying on RLS to swallow the request silently.
 */

import { supabase } from '~/utils/supabase';

export interface AdminProfile {
  id: string;
  email: string | null;
  full_name: string | null;
  is_admin: boolean;
  role: string | null;
}

export class AdminGateError extends Error {
  constructor(message: string, public readonly status: number = 403) {
    super(message);
    this.name = 'AdminGateError';
  }
}

export async function requireAdmin(): Promise<AdminProfile> {
  if (!supabase) throw new AdminGateError('Supabase not configured', 500);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) throw new AdminGateError('Not signed in', 401);
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, is_admin, role')
    .eq('id', user.id)
    .single();
  if (error || !profile) {
    throw new AdminGateError('Profile not found', 403);
  }
  const isAdmin = profile.is_admin === true
    || profile.role === 'admin'
    || profile.role === 'super_admin';
  if (!isAdmin) throw new AdminGateError('Admin privileges required', 403);
  return profile as AdminProfile;
}

/** Convenience wrapper for client-side guards. Returns true/false
 *  instead of throwing so React routes can show a nicer UI than a
 *  crash. The trigger + RLS still enforce the policy server-side; this
 *  is just for the UI fast-path. */
export async function isCurrentUserAdmin(): Promise<boolean> {
  try {
    await requireAdmin();
    return true;
  } catch {
    return false;
  }
}

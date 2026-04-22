import { supabase } from '~/utils/supabase';
import type { AuthUser } from './auth';

export interface WaitlistEntry {
  id: string;
  position: number;
  email: string | null;
  phone: string | null;
  full_name: string | null;
  avatar_url: string | null;
  provider: string | null;
  approved: boolean;
  created_at: string;
  approved_at: string | null;
}

export interface WaitlistStatus {
  position: number;
  total: number;
  approved: boolean;
}

export async function getWaitlistStatus(userId: string): Promise<WaitlistStatus | null> {
  if (!supabase) return null;

  const [{ data: entry }, { data: total }] = await Promise.all([
    supabase
      .from('waitlist')
      .select('position, approved')
      .eq('id', userId)
      .maybeSingle(),
    supabase.rpc('get_waitlist_total'),
  ]);

  if (!entry) return null;
  return {
    position: entry.position as number,
    total: typeof total === 'number' ? total : 0,
    approved: !!entry.approved,
  };
}

export async function joinWaitlist(user: AuthUser): Promise<WaitlistStatus | null> {
  if (!supabase) return null;

  const provider = user.email ? 'google' : user.phone ? 'phone' : null;

  const { error: insertError } = await supabase.from('waitlist').insert({
    id: user.id,
    email: user.email || null,
    phone: user.phone || null,
    full_name: user.displayName || null,
    avatar_url: user.avatarUrl || null,
    provider,
  });

  // Row may already exist (duplicate sign-in race) — that's fine, just re-fetch.
  if (insertError && insertError.code !== '23505') {
    console.error('Failed to join waitlist', insertError);
    return null;
  }

  return getWaitlistStatus(user.id);
}

export async function getWaitlist(): Promise<WaitlistEntry[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('waitlist')
    .select('id, position, email, phone, full_name, avatar_url, provider, approved, created_at, approved_at')
    .order('position', { ascending: true });
  if (error) {
    console.error('Failed to load waitlist', error);
    return [];
  }
  return (data || []) as WaitlistEntry[];
}

export async function approveWaitlistEntry(entryId: string): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const { error } = await supabase.rpc('approve_waitlist_entry', { entry_id: entryId });
  if (error) return { error: error.message };
  return {};
}

export async function removeWaitlistEntry(entryId: string): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const { error } = await supabase.from('waitlist').delete().eq('id', entryId);
  if (error) return { error: error.message };
  return {};
}

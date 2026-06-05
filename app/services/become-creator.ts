// Shopper → creator applications. Shoppers file one request; admins review
// it from the Incoming Creators queue. Approval promotes profiles.role to
// 'creator' via the admin-gated review_creator_request RPC.

import { supabase } from '~/utils/supabase';

export type CreatorRequestStatus = 'pending' | 'approved' | 'denied';

export interface CreatorRequest {
  id: string;
  user_id: string;
  status: CreatorRequestStatus;
  message: string | null;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

export interface CreatorRequestWithProfile extends CreatorRequest {
  profile: { full_name: string | null; avatar_url: string | null; role: string | null } | null;
}

/** The signed-in user's own request, or null if they haven't applied. */
export async function getMyCreatorRequest(): Promise<CreatorRequest | null> {
  if (!supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('become_creator_requests')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();
  return (data as CreatorRequest | null) ?? null;
}

/** File a request to become a creator. One per user (insert-once). */
export async function submitCreatorRequest(message?: string): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Not configured' };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not signed in' };
  const { error } = await supabase
    .from('become_creator_requests')
    .insert({ user_id: user.id, message: message?.trim() || null });
  if (error) {
    // Unique violation → they already have a request on file.
    if (error.code === '23505') return { error: 'You already applied.' };
    return { error: error.message };
  }
  return {};
}

/** Admin: list requests (optionally filtered by status) with requester profile. */
export async function listCreatorRequests(status?: CreatorRequestStatus): Promise<CreatorRequestWithProfile[]> {
  if (!supabase) return [];
  let q = supabase
    .from('become_creator_requests')
    .select('*')
    .order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error || !data) return [];
  const rows = data as CreatorRequest[];

  const ids = Array.from(new Set(rows.map(r => r.user_id)));
  const profileById = new Map<string, { full_name: string | null; avatar_url: string | null; role: string | null }>();
  if (ids.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url, role')
      .in('id', ids);
    for (const p of (profiles as Array<{ id: string; full_name: string | null; avatar_url: string | null; role: string | null }> | null) || []) {
      profileById.set(p.id, { full_name: p.full_name, avatar_url: p.avatar_url, role: p.role });
    }
  }
  return rows.map(r => ({ ...r, profile: profileById.get(r.user_id) ?? null }));
}

/** Admin: approve (promotes to creator) or deny a request. */
export async function reviewCreatorRequest(requestId: string, approve: boolean): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Not configured' };
  const { error } = await supabase.rpc('review_creator_request', {
    p_request_id: requestId,
    p_approve: approve,
  });
  return error ? { error: error.message } : {};
}

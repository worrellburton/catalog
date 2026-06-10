import { supabase } from '~/utils/supabase';

/**
 * Comments on products and looks. Keyed by the shareable slug
 * (target_id) so a thread attaches to a product/look independent of how
 * it was reached. See supabase/migrations/20260604000002_comments.sql.
 *
 * The consumer thread page (/comments/<type>/<slug>) and the admin
 * Comments table both read through here. Realtime keeps the open thread
 * and the admin table live without polling.
 */

export type CommentTargetType = 'product' | 'look';

export interface CommentAuthor {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  is_ai: boolean;
}

export interface CommentRow {
  id: string;
  user_id: string;
  target_type: CommentTargetType;
  target_id: string;
  target_label: string | null;
  body: string;
  hidden: boolean;
  created_at: string;
  author: CommentAuthor | null;
}

const SELECT_WITH_AUTHOR =
  'id, user_id, target_type, target_id, target_label, body, hidden, created_at, ' +
  'author:profiles!comments_user_id_fkey ( id, full_name, avatar_url, is_ai )';

function normalize(row: Record<string, unknown>): CommentRow {
  const a = (row.author ?? null) as Record<string, unknown> | null;
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    target_type: row.target_type as CommentTargetType,
    target_id: row.target_id as string,
    target_label: (row.target_label as string | null) ?? null,
    body: (row.body as string) ?? '',
    hidden: (row.hidden as boolean) ?? false,
    created_at: row.created_at as string,
    author: a
      ? {
          id: a.id as string,
          full_name: (a.full_name as string | null) ?? null,
          avatar_url: (a.avatar_url as string | null) ?? null,
          is_ai: (a.is_ai as boolean) === true,
        }
      : null,
  };
}

/** Visible (non-hidden) comments for one target, oldest first. */
export async function listComments(
  targetType: CommentTargetType,
  targetId: string,
): Promise<CommentRow[]> {
  if (!supabase || !targetId) return [];
  const { data, error } = await supabase
    .from('comments')
    .select(SELECT_WITH_AUTHOR)
    .eq('target_type', targetType)
    .eq('target_id', targetId)
    .eq('hidden', false)
    .order('created_at', { ascending: true });
  if (error) {
    console.warn('[comments] list failed:', error.message);
    return [];
  }
  return ((data as unknown as Record<string, unknown>[]) || []).map(normalize);
}

/** Count of visible comments for a target — used on the Comment button. */
export async function getCommentCount(
  targetType: CommentTargetType,
  targetId: string,
): Promise<number> {
  if (!supabase || !targetId) return 0;
  const { count, error } = await supabase
    .from('comments')
    .select('id', { count: 'exact', head: true })
    .eq('target_type', targetType)
    .eq('target_id', targetId)
    .eq('hidden', false);
  if (error) return 0;
  return count ?? 0;
}

export async function addComment(input: {
  userId: string;
  targetType: CommentTargetType;
  targetId: string;
  targetLabel?: string | null;
  body: string;
}): Promise<{ data?: CommentRow; error?: string }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const body = input.body.trim();
  if (!body) return { error: 'Comment cannot be empty' };
  if (body.length > 2000) return { error: 'Comment is too long (2000 characters max)' };
  const { data, error } = await supabase
    .from('comments')
    .insert({
      user_id: input.userId,
      target_type: input.targetType,
      target_id: input.targetId,
      target_label: input.targetLabel ?? null,
      body,
    })
    .select(SELECT_WITH_AUTHOR)
    .single();
  if (error) return { error: error.message };
  return { data: normalize(data as unknown as Record<string, unknown>) };
}

export async function deleteComment(id: string): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const { data, error } = await supabase.from('comments').delete().eq('id', id).select('id');
  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: 'Delete blocked by RLS. Sign in as the author or an admin.' };
  }
  return {};
}

/**
 * Live-subscribe to comment changes for one target. The callback fires
 * on any insert/update/delete touching this target_id; the caller
 * re-reads the list (the realtime payload doesn't carry the joined
 * author, so a refetch is simplest and always correct).
 */
export function subscribeComments(
  targetType: CommentTargetType,
  targetId: string,
  onChange: () => void,
): () => void {
  if (!supabase || !targetId) return () => {};
  const channel = supabase
    .channel(`comments:${targetType}:${targetId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'comments', filter: `target_id=eq.${targetId}` },
      () => onChange(),
    )
    .subscribe();
  return () => { void supabase!.removeChannel(channel); };
}

// ── Admin ───────────────────────────────────────────────────────────

/** Every comment across the platform (incl. hidden), newest first. */
export async function listAllComments(limit = 1000): Promise<CommentRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('comments')
    .select(SELECT_WITH_AUTHOR)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn('[comments] admin list failed:', error.message);
    return [];
  }
  return ((data as unknown as Record<string, unknown>[]) || []).map(normalize);
}

export async function setCommentHidden(
  id: string,
  hidden: boolean,
): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase not configured' };
  const { data, error } = await supabase
    .from('comments')
    .update({ hidden })
    .eq('id', id)
    .select('id, hidden');
  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: 'Update blocked by RLS. Sign in as an admin.' };
  }
  return {};
}

/** Subscribe to all comment changes (admin table live refresh). */
export function subscribeAllComments(onChange: () => void): () => void {
  if (!supabase) return () => {};
  const channel = supabase
    .channel('comments:all')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, () => onChange())
    .subscribe();
  return () => { void supabase!.removeChannel(channel); };
}

// ── 🔥 reactions ────────────────────────────────────────────────────
//
// A single reaction kind ("fire") per (comment, user). Tapping toggles
// it on/off. See supabase/migrations/…_comment_reactions.sql. We report
// per-comment counts + whether the current user has reacted so the UI
// can render a filled/active state and the running total. Hitting five
// fires is a milestone the Activity surface celebrates.

const FIRE = 'fire';

export interface ReactionState {
  /** Total fire reactions on the comment. */
  count: number;
  /** Whether the current user has fired this comment. */
  mine: boolean;
}

/**
 * Fire counts (+ whether the current user reacted) for a batch of
 * comments. Returns a map keyed by comment_id; comments with no
 * reactions are simply absent (callers default to {count:0,mine:false}).
 */
export async function getReactionsForComments(
  commentIds: string[],
  selfUserId: string | null,
): Promise<Record<string, ReactionState>> {
  const out: Record<string, ReactionState> = {};
  if (!supabase || commentIds.length === 0) return out;
  const { data, error } = await supabase
    .from('comment_reactions')
    .select('comment_id, user_id')
    .eq('kind', FIRE)
    .in('comment_id', commentIds);
  if (error) {
    console.warn('[comments] reactions fetch failed:', error.message);
    return out;
  }
  for (const r of (data as unknown as Record<string, unknown>[]) || []) {
    const cid = r.comment_id as string;
    const uid = r.user_id as string;
    const cur = out[cid] || { count: 0, mine: false };
    cur.count += 1;
    if (selfUserId && uid === selfUserId) cur.mine = true;
    out[cid] = cur;
  }
  return out;
}

/**
 * Toggle the current user's fire on a comment. Returns the new state
 * (count delta applied optimistically by the caller; we return `mine`
 * so the caller can reconcile). `milestone` is true when this action
 * pushes the comment to exactly five fires — the Activity celebration
 * trigger.
 */
export async function toggleFire(
  commentId: string,
  userId: string,
): Promise<{ mine: boolean; count: number; milestone: boolean; error?: string }> {
  if (!supabase) return { mine: false, count: 0, milestone: false, error: 'Supabase not configured' };
  // Does the user already have a fire on this comment?
  const { data: existing } = await supabase
    .from('comment_reactions')
    .select('id')
    .eq('comment_id', commentId)
    .eq('user_id', userId)
    .eq('kind', FIRE)
    .maybeSingle();
  if (existing) {
    const { error } = await supabase
      .from('comment_reactions')
      .delete()
      .eq('comment_id', commentId)
      .eq('user_id', userId)
      .eq('kind', FIRE);
    if (error) return { mine: true, count: 0, milestone: false, error: error.message };
  } else {
    const { error } = await supabase
      .from('comment_reactions')
      .insert({ comment_id: commentId, user_id: userId, kind: FIRE });
    if (error) return { mine: false, count: 0, milestone: false, error: error.message };
  }
  // Re-count authoritatively after the write.
  const { count } = await supabase
    .from('comment_reactions')
    .select('id', { count: 'exact', head: true })
    .eq('comment_id', commentId)
    .eq('kind', FIRE);
  const total = count ?? 0;
  return { mine: !existing, count: total, milestone: !existing && total === 5 };
}

/** Live-subscribe to fire reactions for a set of comments (one target). */
export function subscribeReactions(
  targetId: string,
  onChange: () => void,
): () => void {
  if (!supabase || !targetId) return () => {};
  const channel = supabase
    .channel(`comment_reactions:${targetId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'comment_reactions' },
      () => onChange(),
    )
    .subscribe();
  return () => { void supabase!.removeChannel(channel); };
}

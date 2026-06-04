import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import { supabase } from '~/utils/supabase';
import { useAuth } from '~/hooks/useAuth';
import { extractIdPrefix, extractLookId } from '~/utils/slug';
import { looks as seedLooks } from '~/data/looks';
import {
  listComments,
  addComment,
  deleteComment,
  subscribeComments,
  type CommentRow,
  type CommentTargetType,
} from '~/services/comments';
import CommentParticles from './CommentParticles';

interface CommentsPageProps {
  targetType: CommentTargetType;
  slug: string;
}

interface ResolvedTarget {
  title: string;
  subtitle: string;
  image: string | null;
  href: string;
}

/** Increment an 8-char hex prefix (for the UUID range lookup). */
function nextHexPrefix(prefix: string): string | null {
  const n = parseInt(prefix, 16) + 1;
  if (n > 0xffffffff) return null;
  return n.toString(16).padStart(8, '0');
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Resolve a product slug → header fields via the same lookup the overlay
 *  router uses (8-char UUID prefix range query, name-search fallback). */
async function resolveProduct(slug: string): Promise<ResolvedTarget | null> {
  if (!supabase) return null;
  const prefix = extractIdPrefix(slug);
  let row: Record<string, unknown> | null = null;
  if (prefix) {
    const next = nextHexPrefix(prefix);
    let q = supabase
      .from('products')
      .select('id, name, brand, price, image_url')
      .gte('id', `${prefix}-0000-0000-0000-000000000000`);
    if (next) q = q.lt('id', `${next}-0000-0000-0000-000000000000`);
    const { data } = await q.limit(1);
    row = data?.[0] ?? null;
  }
  if (!row) {
    const nameQuery = slug.replace(/-[0-9a-f]{8}$/i, '').replace(/-/g, '%');
    const { data } = await supabase
      .from('products')
      .select('id, name, brand, price, image_url')
      .ilike('name', `%${nameQuery}%`)
      .limit(1);
    row = data?.[0] ?? null;
  }
  if (!row) return null;
  return {
    title: (row.name as string) || 'Product',
    subtitle: [(row.brand as string) || '', (row.price as string) || ''].filter(Boolean).join(' · '),
    image: (row.image_url as string) || null,
    href: `/p/${slug}`,
  };
}

/** Resolve a look slug → header fields (numeric seed id, then DB uuid prefix). */
async function resolveLook(slug: string): Promise<ResolvedTarget | null> {
  const numericId = extractLookId(slug);
  if (numericId != null) {
    const look = seedLooks.find(l => l.id === numericId);
    if (look) {
      return {
        title: look.title || 'Look',
        subtitle: look.creatorDisplayName || look.creator || '',
        image: look.creatorAvatar || null,
        href: `/l/${slug}`,
      };
    }
  }
  if (!supabase) return null;
  const prefix = extractIdPrefix(slug);
  if (!prefix) return null;
  const next = nextHexPrefix(prefix);
  let q = supabase
    .from('looks_creative')
    .select('uuid, title, creator, thumbnail_url')
    .gte('uuid', `${prefix}-0000-0000-0000-000000000000`);
  if (next) q = q.lt('uuid', `${next}-0000-0000-0000-000000000000`);
  const { data } = await q.limit(1);
  const row = data?.[0];
  if (!row) return null;
  return {
    title: (row.title as string) || 'Look',
    subtitle: (row.creator as string) || '',
    image: (row.thumbnail_url as string) || null,
    href: `/l/${slug}`,
  };
}

export default function CommentsPage({ targetType, slug }: CommentsPageProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [target, setTarget] = useState<ResolvedTarget | null>(null);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listEndRef = useRef<HTMLDivElement>(null);

  // Resolve the product/look header once.
  useEffect(() => {
    let cancelled = false;
    (targetType === 'product' ? resolveProduct(slug) : resolveLook(slug)).then(t => {
      if (!cancelled) setTarget(t);
    });
    return () => { cancelled = true; };
  }, [targetType, slug]);

  // Load + live-subscribe to the thread.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      listComments(targetType, slug).then(rows => {
        if (!cancelled) { setComments(rows); setLoading(false); }
      });
    };
    refresh();
    const unsub = subscribeComments(targetType, slug, refresh);
    return () => { cancelled = true; unsub(); };
  }, [targetType, slug]);

  const avatars = useMemo(
    () => comments.map(c => c.author?.avatar_url).filter((a): a is string => !!a),
    [comments],
  );

  const handlePost = async () => {
    if (!user) { setError('Sign in to comment.'); return; }
    const body = draft.trim();
    if (!body) return;
    setPosting(true);
    setError(null);
    const { data, error: postErr } = await addComment({
      userId: user.id,
      targetType,
      targetId: slug,
      targetLabel: target?.title ?? null,
      body,
    });
    setPosting(false);
    if (postErr) { setError(postErr); return; }
    setDraft('');
    if (data) {
      // Optimistic append (realtime will reconcile shortly after).
      setComments(prev => (prev.some(c => c.id === data.id) ? prev : [...prev, data]));
      requestAnimationFrame(() => listEndRef.current?.scrollIntoView({ behavior: 'smooth' }));
    }
  };

  const handleDelete = async (id: string) => {
    const prev = comments;
    setComments(cs => cs.filter(c => c.id !== id));
    const { error: delErr } = await deleteComment(id);
    if (delErr) { setError(delErr); setComments(prev); }
  };

  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate(target?.href ?? '/', { replace: true });
  };

  return (
    <div className="comments-page">
      <div className="comments-particles">
        <CommentParticles avatars={avatars} className="comments-particles-canvas" />
      </div>

      <div className="comments-shell">
        <button className="comments-back" onClick={goBack} aria-label="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span>Back</span>
        </button>

        {/* The product / look this thread is about, pinned at the top. */}
        <a className="comments-target" href={target?.href ?? '#'}>
          {target?.image
            ? <img className="comments-target-img" src={target.image} alt="" />
            : <span className="comments-target-img comments-target-img--blank" aria-hidden="true" />}
          <span className="comments-target-text">
            <span className="comments-target-kind">{targetType === 'product' ? 'Product' : 'Look'}</span>
            <span className="comments-target-title">{target?.title ?? 'Loading…'}</span>
            {target?.subtitle && <span className="comments-target-sub">{target.subtitle}</span>}
          </span>
        </a>

        <h2 className="comments-heading">
          Comments {comments.length > 0 && <span className="comments-count">{comments.length}</span>}
        </h2>

        <div className="comments-list">
          {loading ? (
            <div className="comments-empty">Loading…</div>
          ) : comments.length === 0 ? (
            <div className="comments-empty">No comments yet. Be the first to say something.</div>
          ) : (
            comments.map(c => (
              <div key={c.id} className="comment-row">
                {c.author?.avatar_url
                  ? <img className="comment-avatar" src={c.author.avatar_url} alt="" />
                  : <span className="comment-avatar comment-avatar--initial">
                      {(c.author?.full_name || 'U').charAt(0).toUpperCase()}
                    </span>}
                <div className="comment-body">
                  <div className="comment-meta">
                    <span className="comment-name">{c.author?.full_name || 'Someone'}</span>
                    <span className="comment-time">{relativeTime(c.created_at)}</span>
                    {user?.id === c.user_id && (
                      <button className="comment-delete" onClick={() => handleDelete(c.id)} aria-label="Delete comment">
                        Delete
                      </button>
                    )}
                  </div>
                  <p className="comment-text">{c.body}</p>
                </div>
              </div>
            ))
          )}
          <div ref={listEndRef} />
        </div>

        <div className="comments-composer">
          {user ? (
            <>
              <textarea
                className="comments-input"
                placeholder="Add a comment…"
                value={draft}
                maxLength={2000}
                rows={2}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void handlePost(); }
                }}
              />
              <button
                className="comments-post-btn"
                onClick={() => void handlePost()}
                disabled={posting || !draft.trim()}
              >
                {posting ? 'Posting…' : 'Post'}
              </button>
            </>
          ) : (
            <div className="comments-signin-hint">
              <button className="comments-post-btn" onClick={() => navigate('/')}>Sign in to comment</button>
            </div>
          )}
        </div>
        {error && <div className="comments-error">{error}</div>}
      </div>
    </div>
  );
}

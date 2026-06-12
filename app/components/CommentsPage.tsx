import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import { supabase } from '~/utils/supabase';
import { useAuth } from '~/hooks/useAuth';
import { requireSignup } from '~/services/guest';
import { extractIdPrefix, extractLookId, nextHexPrefix } from '~/utils/slug';
import { looks as seedLooks } from '~/data/looks';
import { lookPoster } from '~/services/media-resolver';
import {
  listComments,
  addComment,
  deleteComment,
  subscribeComments,
  getReactionsForComments,
  toggleFire,
  subscribeReactions,
  type CommentRow,
  type CommentTargetType,
  type ReactionState,
} from '~/services/comments';
import CommentParticles from './CommentParticles';
import ParticleBackground from './ParticleBackground';
import { isMobileViewport, pickVideoUrl } from '~/services/video-loading';
import { getCreativesByProductIds } from '~/services/product-creative';
import { useTrailVideo } from '~/components/TrailVideoHost';
import { useCommentTyping } from '~/hooks/useCommentTyping';
import '~/styles/comments.css';

interface CommentsPageProps {
  targetType: CommentTargetType;
  slug: string;
  /** When rendered as an in-app overlay, the host passes this so Back pops
   *  the pushed /comments URL and reveals the product/look underneath
   *  unchanged. Standalone route mount omits it and falls back to history. */
  onClose?: () => void;
  /** Open a commenter's catalog/profile. Passed by the overlay host so
   *  tapping an author closes comments and opens their creator page. */
  onOpenCreator?: (handle: string) => void;
  /** Collapse the thread to a docked bar without losing the host's place
   *  (e.g. the Activity "Conversations" pager). Renders a minimize button. */
  onMinimize?: () => void;
  /** Step to the previous / next thread in the host's list. When provided,
   *  prev/next controls render so the user can tab through conversations. */
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

/** Human title from a slug when the product/look row can't be resolved
 *  (e.g. opened from a creative with no products row) — beats a stuck
 *  "Loading…". Drops the trailing 8-char id and title-cases the words. */
function titleFromSlug(slug: string): string {
  const words = slug.replace(/-[0-9a-f]{8}$/i, '').replace(/-\d+$/, '').split('-').filter(Boolean);
  if (words.length === 0) return 'This item';
  return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

interface ResolvedTarget {
  title: string;
  subtitle: string;
  image: string | null;
  /** The target's clip — looks AND products play in the thread header
   *  (poster paints first, the video fades over it). */
  video: string | null;
  /** product_creatives.id when the product has a live creative: the header
   *  registers a trail-video slot under this id, the SAME id the product
   *  page hero uses, so clicking through hands the playing element over
   *  and the clip never restarts. */
  trailId: string | null;
  href: string;
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
  const FIELDS = 'id, name, brand, price, image_url, primary_image_url, primary_video_url, primary_video_poster_url';
  if (prefix) {
    const next = nextHexPrefix(prefix);
    let q = supabase
      .from('products')
      .select(FIELDS)
      .gte('id', `${prefix}-0000-0000-0000-000000000000`);
    if (next) q = q.lt('id', `${next}-0000-0000-0000-000000000000`);
    const { data } = await q.limit(1);
    row = data?.[0] ?? null;
  }
  if (!row) {
    const nameQuery = slug.replace(/-[0-9a-f]{8}$/i, '').replace(/-/g, '%');
    const { data } = await supabase
      .from('products')
      .select(FIELDS)
      .ilike('name', `%${nameQuery}%`)
      .limit(1);
    row = data?.[0] ?? null;
  }
  if (!row) return null;
  // The product's live creative — same id + source the product page hero
  // keys its trail-video slot with, so the header's playing element is
  // handed over on click-through instead of restarting.
  const creatives = await getCreativesByProductIds([row.id as string]).catch(() => []);
  const creative = creatives[0] ?? null;
  return {
    title: (row.name as string) || 'Product',
    subtitle: [(row.brand as string) || '', (row.price as string) || ''].filter(Boolean).join(' · '),
    image: (row.primary_video_poster_url as string)
      || (row.primary_image_url as string)
      || (row.image_url as string) || null,
    video: creative ? pickVideoUrl(creative) : (row.primary_video_url as string) || null,
    trailId: creative?.id ?? null,
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
        // Canonical poster fallback (thumbnail → cover → first product image)
        // so the comments header matches the feed card, then creator avatar.
        image: lookPoster(look) || look.creatorAvatar || null,
        video: look.video || null,
        trailId: null,
        href: `/l/${slug}`,
      };
    }
  }
  if (!supabase) return null;
  // The look slug carries the `looks.id` UUID prefix (see lookSlug → uuid:
  // row.id in services/looks.ts), so resolve against the `looks` table —
  // NOT `looks_creative`, whose `uuid` is a different identifier. Join the
  // primary creative for video/poster and the look's products so the poster
  // can fall back to the first product image, mirroring `lookPoster`
  // (thumbnail → cover → first product image) used everywhere else.
  const prefix = extractIdPrefix(slug);
  if (!prefix) return null;
  const next = nextHexPrefix(prefix);
  let q = supabase
    .from('looks')
    .select(`
      id,
      title,
      creator_handle,
      looks_creative ( video_url, thumbnail_url, is_primary ),
      look_products ( sort_order, products ( image_url, primary_image_url, primary_video_poster_url ) )
    `)
    .gte('id', `${prefix}-0000-0000-0000-000000000000`);
  if (next) q = q.lt('id', `${next}-0000-0000-0000-000000000000`);
  const { data } = await q.limit(1);
  const row = data?.[0] as {
    title: string | null;
    creator_handle: string | null;
    looks_creative?: Array<{ video_url: string | null; thumbnail_url: string | null; is_primary: boolean | null }>;
    look_products?: Array<{ sort_order: number | null; products?: { image_url: string | null; primary_image_url: string | null; primary_video_poster_url: string | null } | null }>;
  } | undefined;
  if (!row) return null;
  const creative = row.looks_creative?.find(c => c.is_primary) || row.looks_creative?.[0] || null;
  const firstProduct = [...(row.look_products || [])]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))[0]?.products || null;
  const poster = creative?.thumbnail_url
    || firstProduct?.primary_video_poster_url
    || firstProduct?.primary_image_url
    || firstProduct?.image_url
    || null;
  return {
    title: (row.title as string) || 'Look',
    subtitle: (row.creator_handle as string) || '',
    image: poster,
    video: creative?.video_url || null,
    trailId: null,
    href: `/l/${slug}`,
  };
}

export default function CommentsPage({ targetType, slug, onClose, onOpenCreator, onMinimize, onPrev, onNext, hasPrev, hasNext }: CommentsPageProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [target, setTarget] = useState<ResolvedTarget | null>(null);
  // Product header clip lives in the shared trail-video pool under the
  // product page hero's id — click-through adopts the SAME element, so
  // playback continues instead of restarting.
  const setTrailSlot = useTrailVideo(
    target?.trailId ?? undefined,
    target?.trailId ? target?.video ?? undefined : undefined,
    target?.image ?? undefined,
  );
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 🔥 reactions, keyed by comment id. Live-synced alongside the thread.
  const [reactions, setReactions] = useState<Record<string, ReactionState>>({});
  const [milestone, setMilestone] = useState<string | null>(null);
  // Comment ids whose author avatar failed to load → fall back to initial.
  const [avatarErrored, setAvatarErrored] = useState<Set<string>>(new Set());
  const listEndRef = useRef<HTMLDivElement>(null);
  const commentIdsKey = comments.map(c => c.id).join(',');

  // Live "someone is typing…" presence over Supabase broadcast.
  const { typingNames, notifyTyping } = useCommentTyping(
    targetType,
    slug,
    user ? { id: user.id, name: user.displayName || 'Someone' } : null,
  );

  // Resolve the product/look header once.
  const [resolved, setResolved] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setResolved(false);
    (targetType === 'product' ? resolveProduct(slug) : resolveLook(slug)).then(t => {
      if (!cancelled) { setTarget(t); setResolved(true); }
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

  // Load + live-subscribe to 🔥 counts for the visible comments.
  useEffect(() => {
    let cancelled = false;
    const ids = commentIdsKey ? commentIdsKey.split(',') : [];
    if (ids.length === 0) { setReactions({}); return; }
    const refresh = () => {
      getReactionsForComments(ids, user?.id ?? null).then(map => {
        if (!cancelled) setReactions(map);
      });
    };
    refresh();
    const unsub = subscribeReactions(slug, refresh);
    return () => { cancelled = true; unsub(); };
  }, [commentIdsKey, slug, user?.id]);

  const handleFire = async (commentId: string) => {
    if (!user) { requireSignup(); return; }
    // Optimistic toggle.
    const prev = reactions[commentId] || { count: 0, mine: false };
    const optimistic: ReactionState = prev.mine
      ? { count: Math.max(0, prev.count - 1), mine: false }
      : { count: prev.count + 1, mine: true };
    setReactions(r => ({ ...r, [commentId]: optimistic }));
    const res = await toggleFire(commentId, user.id);
    if (res.error) {
      setReactions(r => ({ ...r, [commentId]: prev }));
      setError(res.error);
      return;
    }
    setReactions(r => ({ ...r, [commentId]: { count: res.count, mine: res.mine } }));
    if (res.milestone) {
      setMilestone('🔥 This comment just hit 5 fires!');
      window.setTimeout(() => setMilestone(null), 4000);
      // Surface it on the Activity pill too.
      try {
        window.dispatchEvent(new CustomEvent('catalog:activity-bump', { detail: { count: 1 } }));
      } catch { /* no-op */ }
    }
  };

  const avatars = useMemo(
    () => comments.map(c => c.author?.avatar_url).filter((a): a is string => !!a),
    [comments],
  );

  const handlePost = async () => {
    if (!user) { requireSignup(); return; }
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
    // Overlay mode: let the host pop the pushed /comments URL so the
    // product/look underneath is revealed untouched (no re-resolve).
    if (onClose) { onClose(); return; }
    if (window.history.length > 1) navigate(-1);
    else navigate(target?.href ?? '/', { replace: true });
  };

  // Drag-to-dismiss for the bottom sheet. The grab handle is also a button:
  // a tap closes; a downward drag past the threshold closes; a short drag
  // snaps back. dy is mirrored in a ref so pointerup reads the latest value.
  const [dragOffset, setDragOffset] = useState(0);
  // Ease the sheet out before it unmounts: set `closing` (plays the slide-down
  // + backdrop fade), then call the real close once the animation finishes.
  const [closing, setClosing] = useState(false);
  const requestClose = () => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => { if (onClose) onClose(); else goBack(); }, 360);
  };
  // Minimize eases the sheet down (same animation as close) then hands back
  // to the host, which docks a restore bar instead of unmounting outright.
  const requestMinimize = () => {
    if (!onMinimize || closing) return;
    setClosing(true);
    window.setTimeout(() => { onMinimize(); }, 360);
  };
  const dragRef = useRef<{ startY: number; active: boolean; dy: number }>({ startY: 0, active: false, dy: 0 });
  const onHandlePointerDown = (e: React.PointerEvent) => {
    dragRef.current = { startY: e.clientY, active: true, dy: 0 };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const onHandlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current.active) return;
    const dy = Math.max(0, e.clientY - dragRef.current.startY);
    dragRef.current.dy = dy;
    setDragOffset(dy);
  };
  const onHandlePointerUp = () => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    const dy = dragRef.current.dy;
    setDragOffset(0);
    if (dy > 110 || dy < 6) requestClose(); // big drag OR a tap → dismiss
  };

  // Swipe-down-to-dismiss on the whole sheet (not just the handle). Arms only
  // when the comment list is scrolled to its top and the touch didn't start on
  // the composer input — so scrolling the thread or typing never dismisses.
  const commentsListRef = useRef<HTMLDivElement>(null);
  const onSheetTouchStart = (e: React.TouchEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('textarea, input, .comments-drawer-handle-btn')) return;
    if ((commentsListRef.current?.scrollTop ?? 0) > 0) return;
    dragRef.current = { startY: e.touches[0].clientY, active: true, dy: 0 };
  };
  const onSheetTouchMove = (e: React.TouchEvent) => {
    if (!dragRef.current.active) return;
    const dy = Math.max(0, e.touches[0].clientY - dragRef.current.startY);
    dragRef.current.dy = dy;
    setDragOffset(dy);
  };
  const onSheetTouchEnd = () => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    const dy = dragRef.current.dy;
    setDragOffset(0);
    if (dy > 100) requestClose();
  };

  return (
    <>
    {/* Dim scrim behind the sheet — tap to dismiss (TikTok-style). */}
    <div className={`comments-drawer-backdrop${closing ? ' is-closing' : ''}`} onClick={requestClose} aria-hidden="true" />
    <div
      className={`comments-page comments-page--drawer${closing ? ' is-closing' : ''}`}
      style={dragOffset ? { transform: `translateY(${dragOffset}px)`, transition: 'none' } : undefined}
      onTouchStart={onSheetTouchStart}
      onTouchMove={onSheetTouchMove}
      onTouchEnd={onSheetTouchEnd}
      onTouchCancel={onSheetTouchEnd}
    >
      <button
        type="button"
        className="comments-drawer-handle-btn"
        aria-label="Close comments"
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
      >
        <span className="comments-drawer-handle" aria-hidden="true" />
      </button>
      {/* Ambient WebGL field behind everything — the same singleton
          particle backdrop used on create-a-look / add-product, so the
          comments surface isn't a flat black screen when the thread is
          empty. The avatar-driven CommentParticles layer sits on top. */}
      {/* Desktop only — see LookOverlay: spares mobile a scarce WebGL context
          + GPU draw. The avatar-driven CommentParticles layer below still renders. */}
      <div className="comments-webgl" aria-hidden="true">
        {!isMobileViewport() && <ParticleBackground />}
      </div>
      <div className="comments-particles">
        <CommentParticles avatars={avatars} className="comments-particles-canvas" />
      </div>

      {milestone && (
        <div className="comments-milestone" role="status">{milestone}</div>
      )}

      <div className="comments-shell">
        <button className="comments-back comments-back--down" onClick={requestClose} aria-label="Close">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {/* Host pager chrome — prev/next steps through the host's thread list
            (Activity "Conversations"); minimize docks the sheet. Only renders
            when the host wires the callbacks. */}
        {(onPrev || onNext || onMinimize) && (
          <div className="comments-host-nav">
            {(onPrev || onNext) && (
              <>
                <button
                  type="button"
                  className="comments-host-btn"
                  onClick={onPrev}
                  disabled={!hasPrev}
                  aria-label="Previous conversation"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                </button>
                <button
                  type="button"
                  className="comments-host-btn"
                  onClick={onNext}
                  disabled={!hasNext}
                  aria-label="Next conversation"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                </button>
              </>
            )}
            {onMinimize && (
              <button
                type="button"
                className="comments-host-btn"
                onClick={requestMinimize}
                aria-label="Minimize"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /></svg>
              </button>
            )}
          </div>
        )}

        {/* The product / look this thread is about, pinned at the top.
            SPA-navigated (raw href reloads the app through the splash). */}
        <a
          className="comments-target"
          href={target?.href ?? `/${targetType === 'product' ? 'p' : 'l'}/${slug}`}
          onClick={(e) => {
            e.preventDefault();
            navigate(target?.href ?? `/${targetType === 'product' ? 'p' : 'l'}/${slug}`);
          }}
        >
          {target?.video && target.trailId
            // Poster paints instantly underneath; the pooled trail video
            // mounts into the slot and fades over it once frames decode.
            ? <span className="comments-target-img comments-target-live" ref={setTrailSlot}>
                {target.image && <img className="comments-target-poster" src={target.image} alt="" />}
              </span>
            : target?.video
              ? <video
                  className="comments-target-img"
                  src={target.video}
                  poster={target.image ?? undefined}
                  autoPlay
                  muted
                  loop
                  playsInline
                />
              : target?.image
                ? <img className="comments-target-img" src={target.image} alt="" />
                : <span className="comments-target-img comments-target-img--blank" aria-hidden="true" />}
          <span className="comments-target-text">
            <span className="comments-target-kind">{targetType === 'product' ? 'Product' : 'Look'}</span>
            {/* Looks don't get a title line here — it's noisy and often just
                repeats the creator. Products keep their name. */}
            {targetType === 'product' && (
              <span className="comments-target-title">{target?.title ?? (resolved ? titleFromSlug(slug) : 'Loading…')}</span>
            )}
            {target?.subtitle && <span className="comments-target-sub">{target.subtitle}</span>}
          </span>
        </a>

        <h2 className="comments-heading">
          Comments {comments.length > 0 && <span className="comments-count">{comments.length}</span>}
        </h2>

        <div className="comments-list" ref={commentsListRef}>
          {loading ? (
            <div className="comments-empty">Loading…</div>
          ) : comments.length === 0 ? (
            <div className="comments-empty">No comments yet. Be the first to say something.</div>
          ) : (
            comments.map(c => {
              const own = user?.id === c.user_id;
              const openAuthor = onOpenCreator ? () => onOpenCreator(`user:${c.user_id}`) : undefined;
              return (
                <div key={c.id} className={`comment-row${own ? ' is-own' : ''}`}>
                  <button
                    type="button"
                    className="comment-avatar-btn"
                    onClick={openAuthor}
                    disabled={!openAuthor}
                    aria-label={`Open ${c.author?.full_name || 'user'}'s catalog`}
                  >
                    {c.author?.avatar_url && !avatarErrored.has(c.id)
                      ? <img
                          className="comment-avatar"
                          src={c.author.avatar_url}
                          alt=""
                          onError={() => setAvatarErrored(prev => new Set(prev).add(c.id))}
                        />
                      : <span className="comment-avatar comment-avatar--initial">
                          {(c.author?.full_name || 'U').charAt(0).toUpperCase()}
                        </span>}
                  </button>
                  <div className="comment-body">
                    <div className="comment-meta">
                      <button type="button" className="comment-name" onClick={openAuthor} disabled={!openAuthor}>
                        {own ? 'You' : (c.author?.full_name || 'Someone')}
                      </button>
                      <span className="comment-time">{relativeTime(c.created_at)}</span>
                      {own && (
                        <button className="comment-delete" onClick={() => handleDelete(c.id)} aria-label="Delete comment">
                          Delete
                        </button>
                      )}
                    </div>
                    <p className="comment-bubble">{c.body}</p>
                    <div className="comment-react-row">
                      <button
                        type="button"
                        className={`comment-fire${reactions[c.id]?.mine ? ' is-lit' : ''}`}
                        onClick={() => void handleFire(c.id)}
                        aria-pressed={reactions[c.id]?.mine || false}
                        aria-label={reactions[c.id]?.mine ? 'Remove fire' : 'Add fire'}
                      >
                        <span className="comment-fire-emoji" aria-hidden="true">🔥</span>
                        {(reactions[c.id]?.count ?? 0) > 0 && (
                          <span className="comment-fire-count">{reactions[c.id].count}</span>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
          {typingNames.length > 0 && (
            <div className="comment-typing" aria-live="polite">
              <span className="comment-typing-dots"><i /><i /><i /></span>
              <span className="comment-typing-label">
                {typingNames.length === 1
                  ? `${typingNames[0]} is typing…`
                  : typingNames.length === 2
                    ? `${typingNames[0]} and ${typingNames[1]} are typing…`
                    : 'Several people are typing…'}
              </span>
            </div>
          )}
          <div ref={listEndRef} />
        </div>

        {user ? (
          <div className="comments-composer">
            <textarea
              className="comments-input"
              placeholder="Add a comment…"
              value={draft}
              maxLength={2000}
              rows={1}
              onChange={e => { setDraft(e.target.value); notifyTyping(); }}
              onKeyDown={e => {
                if ((e.metaKey || e.ctrlKey || !e.shiftKey) && e.key === 'Enter') { e.preventDefault(); void handlePost(); }
              }}
            />
            <button
              className="comments-send"
              onClick={() => void handlePost()}
              disabled={posting || !draft.trim()}
              aria-label="Send comment"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          </div>
        ) : (
          <div className="comments-composer comments-composer--signin">
            <button className="comments-send comments-send--signin" onClick={() => requireSignup()}>Sign in to comment</button>
          </div>
        )}
        {error && <div className="comments-error">{error}</div>}
      </div>
    </div>
    </>
  );
}

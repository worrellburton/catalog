import { useEffect, useState } from 'react';
import { useFollowState, toggleFollowShared } from '~/hooks/useFollowState';
import { useAuth } from '~/hooks/useAuth';
import { supabase } from '~/utils/supabase';

// Shared, cached avatar resolver. Some looks/products don't carry the
// creator's avatar inline; rather than render an initial, look it up once
// per handle (profiles for user:<uuid> keys, creators table for real
// handles) and cache the result for the session.
const avatarCache = new Map<string, string | null>();
const avatarInflight = new Map<string, Promise<string | null>>();
function resolveCreatorAvatar(handle: string): Promise<string | null> {
  if (!handle || !supabase) return Promise.resolve(null);
  if (avatarCache.has(handle)) return Promise.resolve(avatarCache.get(handle)!);
  const existing = avatarInflight.get(handle);
  if (existing) return existing;
  const p = (async (): Promise<string | null> => {
    try {
      if (handle.startsWith('user:')) {
        const { data } = await supabase!.from('profiles').select('avatar_url').eq('id', handle.slice(5)).maybeSingle();
        return (data?.avatar_url as string) || null;
      }
      const { data } = await supabase!.from('creators').select('avatar_url').ilike('handle', handle.replace(/^@/, '')).limit(1).maybeSingle();
      return (data?.avatar_url as string) || null;
    } catch { return null; }
  })().then(v => { avatarCache.set(handle, v); avatarInflight.delete(handle); return v; });
  avatarInflight.set(handle, p);
  return p;
}

/**
 * Creator identity on feed/detail cards, reduced to just the profile
 * picture — no name. A "+" badge in the upper-right of the avatar follows
 * the creator; once following it becomes a "−" to unfollow, and the avatar
 * gets a lit ring. Tapping the avatar itself opens the creator's catalog.
 *
 * One component used everywhere a creator chip used to live (look cards,
 * product-page look tiles, the look overlay) so follow state + styling
 * stay consistent across the app.
 *
 * Placeholder handles ("user:<uuid>") can't be followed, so the badge is
 * suppressed for them — the avatar still opens the catalog.
 */

interface Props {
  handle: string;
  avatarUrl?: string | null;
  /** Used for alt text / initial fallback only — never rendered as text. */
  displayName?: string | null;
  /** Avatar diameter in px. Default 40. */
  size?: number;
  onOpenCreator?: (handle: string) => void;
  /** When false, tapping the avatar does nothing (taps fall through to the
   *  card so the look/product opens) — only the +/− badge acts. Used on feed
   *  cards + tiles where the whole tile opens the item. Default true. */
  avatarOpensCreator?: boolean;
  className?: string;
}

export default function CreatorAvatarFollow({
  handle,
  avatarUrl,
  displayName,
  size = 40,
  onOpenCreator,
  avatarOpensCreator = true,
  className,
}: Props) {
  const following = useFollowState(handle);
  const [busy, setBusy] = useState(false);
  const { user } = useAuth();
  // The signed-in shopper's own avatar. Their looks carry a
  // `user:<uuid>` creator handle, so a match means "this is me".
  const isSelf = !!user && handle === `user:${user.id}`;
  // Tapping your OWN circle always jumps to your catalog — even on feed
  // cards where every other avatar falls through to open the look
  // (avatarOpensCreator=false). Everyone else keeps the passed behavior.
  const navigates = (avatarOpensCreator || isSelf) && !!onOpenCreator;

  // Fall back to a looked-up avatar when one wasn't passed inline.
  const [resolvedAvatar, setResolvedAvatar] = useState<string | null>(null);
  useEffect(() => {
    if (avatarUrl) { setResolvedAvatar(null); return; }
    let cancelled = false;
    resolveCreatorAvatar(handle).then(v => { if (!cancelled && v) setResolvedAvatar(v); });
    return () => { cancelled = true; };
  }, [avatarUrl, handle]);
  const shownAvatar = avatarUrl || resolvedAvatar || '';

  const isPlaceholder = !handle || handle.startsWith('user:');
  // Show the badge only once the shared cache has resolved (avoids a
  // +/− flicker on first paint) and never for placeholder handles.
  const showBadge = !isPlaceholder && following !== null;
  const badgeSize = Math.max(18, Math.round(size * 0.46));
  const initial = (displayName || handle || '?').charAt(0).toUpperCase();

  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy || isPlaceholder) return;
    const wasFollowing = following;
    setBusy(true);
    try {
      await toggleFollowShared(handle);
      // Celebrate a NEW follow with a global toast (avatar + name). Skip
      // it on unfollow. FollowToastHost (mounted at root) renders it.
      if (!wasFollowing) {
        window.dispatchEvent(new CustomEvent('catalog:followed', {
          detail: { name: displayName || handle, avatarUrl: shownAvatar || null },
        }));
      }
    }
    catch { /* shared cache reverts itself */ }
    finally { setBusy(false); }
  };

  return (
    <div
      className={`creator-avatar-follow${following ? ' is-following' : ''}${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size }}
      {...(navigates
        ? {
            onClick: (e: React.MouseEvent) => { e.stopPropagation(); onOpenCreator!(handle); },
            role: 'button' as const,
            tabIndex: 0,
            onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenCreator!(handle); } },
            title: displayName ? `Open ${displayName}'s catalog` : 'Open creator catalog',
            'aria-label': displayName ? `Open ${displayName}'s catalog` : 'Open creator catalog',
          }
        : {})}
    >
      {shownAvatar ? (
        <img className="creator-avatar-follow__img" src={shownAvatar} alt={displayName || ''} loading="lazy" />
      ) : (
        <span className="creator-avatar-follow__img creator-avatar-follow__img--initial" aria-hidden="true">{initial}</span>
      )}
      {showBadge && (
        <button
          type="button"
          className={`creator-avatar-follow__badge${following ? ' is-following' : ''}`}
          style={{ width: badgeSize, height: badgeSize }}
          onClick={toggle}
          disabled={busy}
          aria-label={following ? `Unfollow ${displayName || handle}` : `Follow ${displayName || handle}`}
          title={following ? 'Following — tap to unfollow' : 'Follow this creator'}
        >
          <svg width={Math.round(badgeSize * 0.55)} height={Math.round(badgeSize * 0.55)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {following
              ? <line x1="5" y1="12" x2="19" y2="12" />
              : <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>}
          </svg>
        </button>
      )}
    </div>
  );
}

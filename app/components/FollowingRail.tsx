import { useEffect, useRef, useState } from 'react';
import { getMyFollowing, getMyFollowers, type FollowerInfo } from '~/services/follows';
import { subscribeFollowingChanges } from '~/hooks/useFollowState';
import { supabase } from '~/utils/supabase';

interface FollowingRailProps {
  onOpenCreator: (handle: string) => void;
  /** Which rail this mount shows.
   *    'following' = creators I follow (left-aligned in the header)
   *    'followers' = people who follow me (right-aligned in the header)
   *    'both'      = legacy stacked layout (unused but kept for callers
   *                  that haven't been split yet) */
  mode?: 'following' | 'followers' | 'both';
  /** Optional click handler for the "Make a catalog of who I follow"
   *  button at the top of the popover. Receives the full list of
   *  followed handles so the parent can scope the feed to them. */
  onCreateFollowingCatalog?: (handles: string[]) => void;
}

interface RailEntry {
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  /** ms-since-epoch ts powering the per-entry tooltip + new-pop
   *  animation. For Following rows we pass the look's last-post ts;
   *  for Followers rows we pass the follow's created_at. */
  ts: number;
}

/** Up to 25 stacked avatars in each rail; anything beyond gets a
 *  "+N" pill so the row stays a fixed width. */
const MAX_VISIBLE = 25;

/** A freshly-detected follower keeps its pop-in animation class for
 *  this many ms before reverting to a normal avatar. */
const NEW_FOLLOWER_PULSE_MS = 5000;

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7)  return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5)  return `${w}w ago`;
  return new Date(ms).toLocaleDateString();
}

/**
 * Header rails for "creators I follow" + "people who follow me".
 * Each row is a stack of overlapping avatar circles capped at 25
 * with a "+N" overflow pill. Click a row to open a popover listing
 * everyone in that bucket; click an avatar inside the popover to
 * open that creator's page.
 *
 * Followers row gets two extras the Following row doesn't:
 *   - "Followed Xm ago" tooltip per avatar.
 *   - Pop-in CSS animation when a new follower appears (compared
 *     to the previous fetch). The animation persists for a few
 *     seconds so the user catches it even if they were tabbed out.
 *
 * Hidden when both rails are empty.
 */
export default function FollowingRail({ onOpenCreator, mode = 'both', onCreateFollowingCatalog: _onCreateFollowingCatalog }: FollowingRailProps) {
  const showFollowing = mode === 'following' || mode === 'both';
  const showFollowers = mode === 'followers' || mode === 'both';
  const [followingEntries, setFollowingEntries] = useState<RailEntry[] | null>(null);
  const [followerEntries, setFollowerEntries] = useState<FollowerInfo[] | null>(null);
  const [newFollowerHandles, setNewFollowerHandles] = useState<Set<string>>(new Set());
  const [openPopover, setOpenPopover] = useState<'following' | 'followers' | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const prevFollowerHandlesRef = useRef<Set<string> | null>(null);

  useEffect(() => subscribeFollowingChanges(() => setRefreshKey(k => k + 1)), []);

  // Following list: handle → display name + avatar + last-post ts.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const handles = await getMyFollowing();
      if (cancelled) return;
      if (handles.length === 0) { setFollowingEntries([]); return; }
      if (!supabase) {
        setFollowingEntries(handles.map(h => ({ handle: h, displayName: null, avatarUrl: null, ts: 0 })));
        return;
      }
      const [creatorRows, lookRows] = await Promise.all([
        supabase.from('creators').select('handle, display_name, avatar_url').in('handle', handles),
        supabase.from('looks')
          .select('creator_handle, user_id, created_at')
          .in('creator_handle', handles)
          .order('created_at', { ascending: false })
          .limit(handles.length * 6),
      ]);
      type CRow = { handle: string; display_name: string | null; avatar_url: string | null };
      type LRow = { creator_handle: string; user_id: string | null; created_at: string | null };
      const creatorByHandle = new Map<string, CRow>(
        ((creatorRows.data || []) as CRow[]).map(r => [r.handle, r]),
      );
      const userIdByHandle = new Map<string, string>();
      const lastPostByHandle = new Map<string, number>();
      for (const l of (lookRows.data || []) as LRow[]) {
        if (l.user_id && !userIdByHandle.has(l.creator_handle)) {
          userIdByHandle.set(l.creator_handle, l.user_id);
        }
        if (l.created_at && !lastPostByHandle.has(l.creator_handle)) {
          const ts = Date.parse(l.created_at);
          if (Number.isFinite(ts)) lastPostByHandle.set(l.creator_handle, ts);
        }
      }
      const profileNeeded = Array.from(new Set(
        handles
          .filter(h => !creatorByHandle.get(h)?.avatar_url)
          .map(h => userIdByHandle.get(h))
          .filter((u): u is string => !!u),
      ));
      const profileByUserId = new Map<string, { full_name: string | null; avatar_url: string | null }>();
      if (profileNeeded.length > 0) {
        const { data: profs } = await supabase
          .from('profiles').select('id, full_name, avatar_url').in('id', profileNeeded);
        for (const p of (profs || []) as { id: string; full_name: string | null; avatar_url: string | null }[]) {
          profileByUserId.set(p.id, { full_name: p.full_name, avatar_url: p.avatar_url });
        }
      }
      if (cancelled) return;
      const resolved: RailEntry[] = handles.map(h => {
        const cr = creatorByHandle.get(h);
        const uid = userIdByHandle.get(h);
        const prof = uid ? profileByUserId.get(uid) : undefined;
        return {
          handle: h,
          displayName: cr?.display_name || prof?.full_name || null,
          avatarUrl: cr?.avatar_url || prof?.avatar_url || null,
          ts: lastPostByHandle.get(h) ?? 0,
        };
      });
      resolved.sort((a, b) => b.ts - a.ts);
      setFollowingEntries(resolved);
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  // Followers list. On every refresh we diff against the previous
  // snapshot — any handle that wasn't in the prior set is "new" and
  // gets the pop-in animation. After NEW_FOLLOWER_PULSE_MS the new
  // class is dropped so the row settles.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fresh = await getMyFollowers();
      if (cancelled) return;
      const prevSet = prevFollowerHandlesRef.current;
      const currentSet = new Set(fresh.map(f => f.handle));
      let nextNew: Set<string> = new Set();
      if (prevSet) {
        for (const f of fresh) {
          if (!prevSet.has(f.handle)) nextNew.add(f.handle);
        }
      }
      prevFollowerHandlesRef.current = currentSet;
      setFollowerEntries(fresh);
      if (nextNew.size > 0) {
        setNewFollowerHandles(nextNew);
        setTimeout(() => {
          if (cancelled) return;
          setNewFollowerHandles(new Set());
        }, NEW_FOLLOWER_PULSE_MS);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  // Click-outside collapses whichever popover is open.
  useEffect(() => {
    if (!openPopover) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpenPopover(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [openPopover]);

  const followingReady = followingEntries !== null;
  const followersReady = followerEntries !== null;
  if (!followingReady && !followersReady) return null;
  const hasFollowing = (followingEntries?.length ?? 0) > 0;
  const hasFollowers = (followerEntries?.length ?? 0) > 0;
  // If this mount is scoped to one side and that side is empty, render
  // nothing — the other side is handled by its own mount elsewhere.
  if (mode === 'following' && !hasFollowing) return null;
  if (mode === 'followers' && !hasFollowers) return null;
  if (mode === 'both' && !hasFollowing && !hasFollowers) return null;

  const followerRailEntries: RailEntry[] = (followerEntries ?? []).map(f => ({
    handle: f.handle,
    displayName: f.displayName,
    avatarUrl: f.avatarUrl,
    ts: f.followedAt,
  }));

  return (
    <div
      ref={wrapperRef}
      className="follow-rail-wrap"
      style={{
        position: 'relative',
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
      }}
    >
      {/* Followers rendered first → on top on desktop (column),
          on the LEFT on mobile (row). Following rendered second →
          below on desktop, on the RIGHT on mobile. */}
      {showFollowers && hasFollowers && (
        <AvatarRow
          ariaLabel="Followers"
          titleText={`${followerEntries!.length} follower${followerEntries!.length === 1 ? '' : 's'}`}
          entries={followerRailEntries}
          newSet={newFollowerHandles}
          isOpen={openPopover === 'followers'}
          onToggle={() => setOpenPopover(v => v === 'followers' ? null : 'followers')}
          onSelect={(h) => { setOpenPopover(null); onOpenCreator(h); }}
          popoverTitle={`Followers · ${followerEntries!.length}`}
          tooltipPrefix="Followed"
        />
      )}
      {showFollowing && hasFollowing && (
        <AvatarRow
          ariaLabel="Following"
          titleText={`Following ${followingEntries!.length} creator${followingEntries!.length === 1 ? '' : 's'}`}
          entries={followingEntries!}
          newSet={null}
          isOpen={openPopover === 'following'}
          onToggle={() => setOpenPopover(v => v === 'following' ? null : 'following')}
          onSelect={(h) => { setOpenPopover(null); onOpenCreator(h); }}
          popoverTitle={`Following · ${followingEntries!.length}`}
          tooltipPrefix={null}
        />
      )}
    </div>
  );
}

// ─── internal AvatarRow ─────────────────────────────────────────────

interface AvatarRowProps {
  ariaLabel: string;
  titleText: string;
  entries: RailEntry[];
  /** Handles that should pop-in with the new-follower animation.
   *  null for rows that don't animate (Following). */
  newSet: Set<string> | null;
  isOpen: boolean;
  onToggle: () => void;
  onSelect: (handle: string) => void;
  popoverTitle: string;
  /** When set, the per-avatar tooltip reads `${tooltipPrefix} ${timeAgo}`. */
  tooltipPrefix: string | null;
}

function AvatarRow({
  ariaLabel, titleText, entries, newSet, isOpen, onToggle, onSelect, popoverTitle, tooltipPrefix,
}: AvatarRowProps) {
  const visible = entries.slice(0, MAX_VISIBLE);
  const overflow = Math.max(0, entries.length - MAX_VISIBLE);
  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }} className="follow-rail">
      <button
        type="button"
        onClick={onToggle}
        aria-label={ariaLabel}
        title={titleText}
        className="follow-rail-trigger"
        style={{
          background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center',
        }}
      >
        <span className="follow-rail-stack" style={{ position: 'relative', display: 'inline-flex', height: 28 }}>
          {visible.map((c, i) => {
            const isNew = !!newSet?.has(c.handle);
            const tip = tooltipPrefix && c.ts
              ? `${c.displayName || c.handle} · ${tooltipPrefix} ${timeAgo(c.ts)}`
              : (c.displayName || c.handle);
            return (
              <span
                key={c.handle}
                className={`follow-rail-avatar${isNew ? ' follow-rail-avatar--new' : ''}`}
                title={tip}
                style={{
                  width: 28, height: 28, borderRadius: '50%',
                  border: '2px solid #fff',
                  background: '#e2e8f0',
                  overflow: 'hidden',
                  marginLeft: i === 0 ? 0 : -10,
                  zIndex: 50 - i,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#475569',
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {c.avatarUrl
                  ? <img src={c.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : (c.displayName || c.handle).charAt(0).toUpperCase()}
              </span>
            );
          })}
          {overflow > 0 && (
            <span
              className="follow-rail-avatar follow-rail-overflow"
              style={{
                width: 28, height: 28, borderRadius: '50%',
                border: '2px solid #fff',
                background: '#0f172a',
                color: '#fff',
                overflow: 'hidden',
                marginLeft: -10,
                zIndex: 50 - visible.length,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.3px',
              }}
              title={`+${overflow} more`}
            >
              +{overflow}
            </span>
          )}
        </span>
      </button>

      {isOpen && (
        <div className="follow-rail-popover" style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          left: '50%',
          transform: 'translateX(-50%)',
          minWidth: 240,
          maxWidth: 320,
          background: '#fff',
          color: '#0f172a',
          borderRadius: 10,
          boxShadow: '0 18px 40px rgba(15,23,42,0.25)',
          border: '1px solid #e5e7eb',
          padding: 8,
          zIndex: 100,
        }}>
          <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700, padding: '4px 6px 6px' }}>
            {popoverTitle}
          </div>
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {entries.map(c => (
              <button
                key={c.handle}
                type="button"
                onClick={() => onSelect(c.handle)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '6px 8px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  textAlign: 'left',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#f1f5f9'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
              >
                <span style={{
                  width: 30, height: 30, borderRadius: '50%',
                  background: '#e2e8f0', overflow: 'hidden',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  color: '#475569', fontSize: 12, fontWeight: 700, flexShrink: 0,
                }}>
                  {c.avatarUrl
                    ? <img src={c.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : (c.displayName || c.handle).charAt(0).toUpperCase()}
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.displayName || c.handle}
                  </span>
                  <span style={{ fontSize: 11, color: '#64748b' }}>
                    {tooltipPrefix && c.ts
                      ? `${tooltipPrefix} ${timeAgo(c.ts)}`
                      : `@${c.handle}`}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

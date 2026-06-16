import { useEffect, useRef, useState, memo } from 'react';
import { getMyFollowing, getMyFollowers, getPopularCreators, type FollowerInfo } from '~/services/follows';
import { subscribeFollowingChanges } from '~/hooks/useFollowState';
import { subscribeOnline } from '~/services/presence';
import { supabase } from '~/utils/supabase';
import { getShopperGender } from '~/services/product-creative';
import { useAuth } from '~/hooks/useAuth';
import { highResAvatarUrl } from '~/utils/avatarSrc';
import { getLooks, fetchSeenLookIds, subscribeToLooksChange } from '~/services/looks';

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
  /** When provided, tapping the "Following" row on mobile opens this full
   *  list-view page instead of the inline popover. Desktop keeps the quick
   *  popover. */
  onOpenFollowingList?: () => void;
  /** When the viewer is a creator, their own entry to pin FIRST in the
   *  following rail (even if they don't follow themselves). */
  selfEntry?: RailEntry | null;
  /** Tapping the pinned self entry opens the viewer's own My Catalog
   *  (creator management view) instead of the shopper-facing creator page. */
  onOpenSelf?: () => void;
}

interface RailEntry {
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  /** ms-since-epoch ts powering the per-entry tooltip + new-pop
   *  animation. For Following rows we pass the look's last-post ts;
   *  for Followers rows we pass the follow's created_at. */
  ts: number;
  /** Poster of the creator's most-recent look, shown as a thumbnail on
   *  the right of each Following popover row. Following rows only. */
  lastThumb?: string | null;
}

/** Up to 5 stacked avatars in the rail; anything beyond gets a
 *  "+N" pill so the row stays a fixed width. */
const MAX_VISIBLE = 5;

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
function FollowingRail({ onOpenCreator, mode = 'both', onCreateFollowingCatalog: _onCreateFollowingCatalog, onOpenFollowingList, selfEntry, onOpenSelf }: FollowingRailProps) {
  const showFollowing = mode === 'following' || mode === 'both';
  const showFollowers = mode === 'followers' || mode === 'both';
  // Auth-aware refresh. The rail used to mount BEFORE auth resolved
  // on cold loads, so getMyFollowing() saw user=null, returned [],
  // and the cold-start fallback fired with popular creators. When
  // auth resolved a beat later, nothing re-triggered the effect, so
  // the rail stayed pinned to the popular set — including handles
  // the user doesn't actually follow (jimmy2k showing up alongside
  // Robert Burton in the reported case). Including user?.id in the
  // deps below makes the resolve flip an auth-null → auth-yes
  // transition into a fresh re-fetch.
  const { user } = useAuth();
  const [followingEntries, setFollowingEntries] = useState<RailEntry[] | null>(null);
  const [followerEntries, setFollowerEntries] = useState<FollowerInfo[] | null>(null);
  const [newFollowerHandles, setNewFollowerHandles] = useState<Set<string>>(new Set());
  const [openPopover, setOpenPopover] = useState<'following' | 'followers' | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // Unseen-look count per creator handle (lower-cased) → drives the spinning
  // glowing badge on each stories-rail avatar. Empty for signed-out shoppers.
  const [unseenByHandle, setUnseenByHandle] = useState<Map<string, number>>(new Map());
  // uuid → creator-handle for every look still counted as unseen. Lets the
  // real-time 'catalog:look-seen' listener find which creator's badge to
  // decrement without recomputing the whole map.
  const unseenUuidToHandle = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    let cancelled = false;
    if (!user?.id) { setUnseenByHandle(new Map()); unseenUuidToHandle.current = new Map(); return; }
    (async () => {
      try {
        const [looks, seen] = await Promise.all([getLooks(), fetchSeenLookIds(user.id)]);
        if (cancelled) return;
        const m = new Map<string, number>();
        const idMap = new Map<string, string>();
        for (const l of looks) {
          if (!l.creator || !l.uuid || seen.has(l.uuid)) continue;
          const key = l.creator.toLowerCase();
          m.set(key, (m.get(key) || 0) + 1);
          idMap.set(l.uuid, key);
        }
        unseenUuidToHandle.current = idMap;
        setUnseenByHandle(m);
      } catch { if (!cancelled) { setUnseenByHandle(new Map()); unseenUuidToHandle.current = new Map(); } }
    })();
    return () => { cancelled = true; };
  }, [user?.id, refreshKey]);

  // Real-time clearing: when a look becomes seen (impression fired in the
  // feed), drop it from its creator's unseen count so the badge updates
  // instantly. Each uuid is consumed once (removed from the lookup map).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onSeen = (e: Event) => {
      const uuid = (e as CustomEvent<{ uuid?: string; creator?: string }>).detail?.uuid;
      if (!uuid) return;
      const handle = unseenUuidToHandle.current.get(uuid);
      if (!handle) return;
      unseenUuidToHandle.current.delete(uuid);
      setUnseenByHandle(prev => {
        const cur = prev.get(handle) || 0;
        if (cur <= 0) return prev;
        const next = new Map(prev);
        if (cur - 1 <= 0) next.delete(handle);
        else next.set(handle, cur - 1);
        return next;
      });
    };
    window.addEventListener('catalog:look-seen', onSeen);
    return () => window.removeEventListener('catalog:look-seen', onSeen);
  }, []);
  // Lower-cased handles of users currently online (Supabase presence).
  const [onlineHandles, setOnlineHandles] = useState<Set<string>>(new Set());
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const prevFollowerHandlesRef = useRef<Set<string> | null>(null);

  // Handles (lower-cased) the viewer just unfollowed — filtered out of the
  // rail immediately AND out of any in-flight refetch, so a stale read that
  // resolves before the DB delete commits can't momentarily re-add them.
  // Cleared for a handle the moment it's followed again.
  const suppressedHandles = useRef<Set<string>>(new Set());
  useEffect(() => subscribeFollowingChanges((change) => {
    if (change) {
      const h = change.handle.toLowerCase();
      if (change.following === false) {
        suppressedHandles.current.add(h);
        // Instant removal from whatever the rail is currently showing.
        setFollowingEntries(prev => prev ? prev.filter(e => e.handle.toLowerCase() !== h) : prev);
      } else {
        suppressedHandles.current.delete(h);
      }
    }
    setRefreshKey(k => k + 1);
  }), []);

  // Live updates when a followed creator posts. The looks realtime channel
  // (looks-live-sync in services/looks) busts the cache and fires this on
  // every INSERT/UPDATE — re-running the following load (re-sorts so the
  // newest poster bumps to the front) and the unseen-count effect (so the
  // new look's badge appears) without a manual refresh.
  useEffect(() => subscribeToLooksChange(() => setRefreshKey(k => k + 1)), []);

  // Live online presence — drives the glowing green ring on avatars.
  // Hysteresis: a handle "going offline" is held for ONLINE_GRACE_MS
  // before the ring drops, so a brief tab refocus / mobile reconnect
  // (presence channel emits leave→join in rapid succession) doesn't
  // strobe the green glow. New "online" transitions are always shown
  // instantly — only the offline→on-screen-still-glowing path is delayed.
  useEffect(() => {
    const ONLINE_GRACE_MS = 8000;
    const pendingOff = new Map<string, number>(); // handle → setTimeout id
    return subscribeOnline((s) => {
      setOnlineHandles(prev => {
        const next = new Set<string>(s.handles);
        // Anything previously online that just left presence: keep it lit
        // until the grace timer fires.
        for (const h of prev) {
          if (next.has(h)) continue;
          if (!pendingOff.has(h)) {
            const id = window.setTimeout(() => {
              pendingOff.delete(h);
              setOnlineHandles(curr => {
                if (!curr.has(h)) return curr;
                const drop = new Set(curr);
                drop.delete(h);
                return drop;
              });
            }, ONLINE_GRACE_MS);
            pendingOff.set(h, id);
          }
          next.add(h);
        }
        // Anything that just came (back) online: cancel its grace timer.
        for (const h of s.handles) {
          const t = pendingOff.get(h);
          if (t !== undefined) { window.clearTimeout(t); pendingOff.delete(h); }
        }
        return next;
      });
    });
  }, []);

  // Following list: handle → display name + avatar + last-post ts.
  // When the user follows NO ONE yet, fall back to popular creators of
  // their gender so the rail isn't empty space on first sign-in. The
  // moment they follow someone, the next render swaps to their actual
  // follows (subscribeFollowingChanges bumps refreshKey + re-runs this
  // effect). Wrapped in try/catch so a transient network error never
  // leaves the rail blank — we fall back to whatever we can get.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let handles: string[] = [];
      try { handles = await getMyFollowing(); } catch { handles = []; }
      if (cancelled) return;
      // Drop any just-unfollowed handles whose DB delete may not have committed
      // yet, so a stale read can't flash the creator back into the rail.
      if (suppressedHandles.current.size > 0) {
        handles = handles.filter(h => !suppressedHandles.current.has(h.toLowerCase()));
      }
      if (handles.length === 0) {
        // Cold-start fallback: pick popular creators matching the
        // shopper's gender. Three-tier retry inside getPopularCreators
        // (gender-filtered → any-gender → candidate profiles) means
        // this returns SOMETHING as long as ANY profile exists. If
        // even that errors, we keep the existing entries instead of
        // wiping to [] so a refresh doesn't strip the rail.
        try {
          const suggested = await getPopularCreators(getShopperGender(), { limit: 12 });
          if (cancelled) return;
          if (suggested.length > 0) {
            setFollowingEntries(suggested.map(s => ({
              handle: s.handle,
              displayName: s.displayName,
              avatarUrl: s.avatarUrl,
              ts: 0,
            })));
          } else {
            // Keep prior entries if any; otherwise commit to [] only
            // once (subsequent retries won't blank a populated rail).
            setFollowingEntries(prev => prev && prev.length > 0 ? prev : []);
          }
        } catch {
          setFollowingEntries(prev => prev && prev.length > 0 ? prev : []);
        }
        return;
      }
      if (!supabase) {
        setFollowingEntries(handles.map(h => ({ handle: h, displayName: null, avatarUrl: null, ts: 0 })));
        return;
      }
      const [creatorRows, lookRows] = await Promise.all([
        supabase.from('creators').select('handle, display_name, avatar_url').in('handle', handles),
        // Left-join the look's creative so we can show the most-recent
        // look's poster as a thumbnail in the popover. Left (not inner) so
        // looks with no creative still count toward the last-post ts —
        // keeps the existing "posted Xh ago" behaviour unchanged.
        supabase.from('looks')
          .select('creator_handle, user_id, created_at, looks_creative (thumbnail_url, is_primary)')
          .in('creator_handle', handles)
          .order('created_at', { ascending: false })
          .limit(handles.length * 6),
      ]);
      type CRow = { handle: string; display_name: string | null; avatar_url: string | null };
      type LCreative = { thumbnail_url: string | null; is_primary: boolean | null };
      type LRow = { creator_handle: string; user_id: string | null; created_at: string | null; looks_creative: LCreative[] | null };
      const creatorByHandle = new Map<string, CRow>(
        ((creatorRows.data || []) as CRow[]).map(r => [r.handle, r]),
      );
      const userIdByHandle = new Map<string, string>();
      const lastPostByHandle = new Map<string, number>();
      const lastThumbByHandle = new Map<string, string>();
      // `user:<uuid>` handles carry the profile id inline — seed it so the
      // profiles fallback resolves a real name + avatar even for accounts
      // with no looks (otherwise the rail shows the raw "user:63c0…" key).
      for (const h of handles) {
        if (h.startsWith('user:')) userIdByHandle.set(h, h.slice(5));
      }
      for (const l of (lookRows.data || []) as LRow[]) {
        if (l.user_id && !userIdByHandle.has(l.creator_handle)) {
          userIdByHandle.set(l.creator_handle, l.user_id);
        }
        if (l.created_at && !lastPostByHandle.has(l.creator_handle)) {
          const ts = Date.parse(l.created_at);
          if (Number.isFinite(ts)) lastPostByHandle.set(l.creator_handle, ts);
        }
        // First creative thumbnail we see per handle wins — rows are
        // already newest-first, so that's the latest look's poster.
        if (!lastThumbByHandle.has(l.creator_handle) && l.looks_creative?.length) {
          const primary = l.looks_creative.find(c => c.is_primary) ?? l.looks_creative[0];
          if (primary?.thumbnail_url) lastThumbByHandle.set(l.creator_handle, primary.thumbnail_url);
        }
      }
      // Fetch the profile for EVERY user-backed handle (not just those whose
      // creators row lacks an avatar). A real-user creator often has a stale
      // signup-time avatar on their creators row (e.g. an old Google photo)
      // while their profile carries the fresh one they uploaded — so we need
      // the profile to prefer it below, mirroring CreatorPage's mergedAvatar.
      const profileNeeded = Array.from(new Set(
        handles
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
          // Profile avatar wins (user-controlled + fresh), then the creators
          // row — same order as the creator catalog page so the rail shows
          // the exact same picture the profile does.
          avatarUrl: prof?.avatar_url || cr?.avatar_url || null,
          ts: lastPostByHandle.get(h) ?? 0,
          lastThumb: lastThumbByHandle.get(h) ?? null,
        };
      });
      resolved.sort((a, b) => b.ts - a.ts);
      setFollowingEntries(resolved);
    })();
    return () => { cancelled = true; };
  }, [refreshKey, user?.id]);

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

  // A creator's own entry is pinned first (deduped against any self-follow),
  // so the rail has content even before the follows query resolves and even
  // if they follow no one.
  const followingDisplay: RailEntry[] = selfEntry
    ? [selfEntry, ...(followingEntries ?? []).filter(e => e.handle !== selfEntry.handle)]
    : (followingEntries ?? []);
  // Tapping the pinned self entry opens My Catalog; everyone else opens the
  // shopper-facing creator page.
  const handleOpenFollowing = (h: string) => {
    if (selfEntry && onOpenSelf && h === selfEntry.handle) { onOpenSelf(); return; }
    onOpenCreator(h);
  };

  const followingReady = followingEntries !== null || !!selfEntry;
  const followersReady = followerEntries !== null;
  if (!followingReady && !followersReady) return null;
  const hasFollowing = followingDisplay.length > 0;
  const hasFollowers = (followerEntries?.length ?? 0) > 0;
  if (mode === 'following' && !hasFollowing) return null;
  if (mode === 'followers' && !hasFollowers) return null;
  if (mode === 'both' && !hasFollowing && !hasFollowers) return null;

  const followerRailEntries: RailEntry[] = (followerEntries ?? []).map(f => ({
    handle: f.handle,
    displayName: f.displayName,
    avatarUrl: f.avatarUrl,
    ts: f.followedAt,
  }));

  // Tapping the "Following" row: on mobile (where the full list page is
  // wired up) open that page; everywhere else fall back to the quick
  // inline popover.
  const onFollowingTrigger = () => {
    if (onOpenFollowingList && typeof window !== 'undefined'
        && window.matchMedia('(max-width: 768px)').matches) {
      setOpenPopover(null);
      onOpenFollowingList();
    } else {
      setOpenPopover(v => v === 'following' ? null : 'following');
    }
  };

  if (mode === 'both') {
    return (
      <div
        ref={wrapperRef}
        className="follow-rail-wrap follow-rail-wrap--center"
        style={{
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0,
        }}
      >
        {/* Mobile-only Instagram-stories rail: a horizontal scroll of every
            followed creator as a glowing circle, latest-posted first (the
            entries are already ts-sorted). Hidden on desktop via CSS, which
            shows the overlapping avatar stacks below instead. */}
        {hasFollowing && (
          <FollowingStoriesRail
            entries={followingDisplay}
            onlineHandles={onlineHandles}
            unseenByHandle={unseenByHandle}
            onOpenCreator={(h) => { setOpenPopover(null); handleOpenFollowing(h); }}
            onSeeAll={onOpenFollowingList}
          />
        )}
        {/* Mobile 3D orbit carousel — replaces the flat stories scroll on
            phones. The flat rail above stays for the desktop header-center
            compact row (CSS toggles which one is visible). */}
        {hasFollowing && (
          <FollowingOrbitRail
            entries={followingDisplay}
            onlineHandles={onlineHandles}
            unseenByHandle={unseenByHandle}
            onOpenCreator={(h) => { setOpenPopover(null); handleOpenFollowing(h); }}
            onSeeAll={onOpenFollowingList}
          />
        )}
        {hasFollowing && (
          <AvatarRow
            railKind="following"
            ariaLabel="Following"
            titleText={`Following ${followingDisplay.length} creator${followingDisplay.length === 1 ? '' : 's'}`}
            entries={followingDisplay}
            newSet={null}
            isOpen={openPopover === 'following'}
            onToggle={onFollowingTrigger}
            onSelect={(h) => { setOpenPopover(null); handleOpenFollowing(h); }}
            popoverTitle={`Following · ${followingDisplay.length}`}
            tooltipPrefix={null}
            onlineHandles={onlineHandles}
          />
        )}
        {hasFollowing && hasFollowers && (
          <span className="follow-rail-separator" />
        )}
        {hasFollowers && (
          <AvatarRow
            railKind="followers"
            ariaLabel="Followers"
            titleText={`${followerEntries!.length} follower${followerEntries!.length === 1 ? '' : 's'}`}
            entries={followerRailEntries}
            newSet={newFollowerHandles}
            isOpen={openPopover === 'followers'}
            onToggle={() => setOpenPopover(v => v === 'followers' ? null : 'followers')}
            onSelect={(h) => { setOpenPopover(null); onOpenCreator(h); }}
            popoverTitle={`Followers · ${followerEntries!.length}`}
            tooltipPrefix="Followed"
            onlineHandles={onlineHandles}
          />
        )}
      </div>
    );
  }

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
      {showFollowers && hasFollowers && (
        <AvatarRow
          railKind="followers"
          ariaLabel="Followers"
          titleText={`${followerEntries!.length} follower${followerEntries!.length === 1 ? '' : 's'}`}
          entries={followerRailEntries}
          newSet={newFollowerHandles}
          isOpen={openPopover === 'followers'}
          onToggle={() => setOpenPopover(v => v === 'followers' ? null : 'followers')}
          onSelect={(h) => { setOpenPopover(null); onOpenCreator(h); }}
          popoverTitle={`Followers · ${followerEntries!.length}`}
          tooltipPrefix="Followed"
          onlineHandles={onlineHandles}
        />
      )}
      {showFollowing && hasFollowing && (
        <AvatarRow
          railKind="following"
          ariaLabel="Following"
          titleText={`Following ${followingDisplay.length} creator${followingDisplay.length === 1 ? '' : 's'}`}
          entries={followingDisplay}
          newSet={null}
          isOpen={openPopover === 'following'}
          onToggle={onFollowingTrigger}
          onSelect={(h) => { setOpenPopover(null); handleOpenFollowing(h); }}
          popoverTitle={`Following · ${followingDisplay.length}`}
          tooltipPrefix={null}
          onlineHandles={onlineHandles}
        />
      )}
    </div>
  );
}

// Memoized — lives in the always-mounted header, so it used to re-render
// on every keystroke even though its data only changes on follow events
// / presence ticks.
export default memo(FollowingRail);

// ─── internal FollowingStoriesRail (mobile) ─────────────────────────

interface FollowingStoriesRailProps {
  entries: RailEntry[];
  onlineHandles: Set<string>;
  /** handle (lower-cased) → count of the viewer's unseen looks by that creator. */
  unseenByHandle: Map<string, number>;
  onOpenCreator: (handle: string) => void;
  /** Optional trailing "See all" chip → opens the full Following page. */
  onSeeAll?: () => void;
}

/** Instagram-stories-style horizontal scroll of followed creators. Each is a
 *  glowing, slowly-rotating gradient ring around the creator's avatar with a
 *  name caption. Latest-posted creators come first (entries arrive ts-sorted).
 *  Mobile-only — CSS hides it ≥769px.
 *  When `entries` is empty (still loading), the rail renders SKELETON
 *  story slots so the row is already there with its bloom playing by the
 *  time the real data lands. The real avatar/name then fades into the
 *  same slot, no layout shift. */
function FollowingStoriesRail({ entries, onlineHandles, unseenByHandle, onOpenCreator, onSeeAll }: FollowingStoriesRailProps) {
  const SKELETON_COUNT = 6;
  if (entries.length === 0) {
    return (
      <div className="follow-stories-rail" role="list" aria-label="Loading creators">
        {Array.from({ length: SKELETON_COUNT }, (_, i) => (
          <div
            key={`skel-${i}`}
            role="listitem"
            className="follow-story follow-story--skeleton"
            aria-hidden="true"
          >
            <span className="follow-story-ring">
              <span className="follow-story-avatar follow-story-avatar--skeleton" />
            </span>
            <span className="follow-story-name follow-story-name--skeleton" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="follow-stories-rail" role="list" aria-label="Creators you follow">
      {entries.map((c) => {
        const isOnline = onlineHandles.has(c.handle.toLowerCase());
        const name = c.displayName || c.handle;
        const unseen = unseenByHandle.get(c.handle.toLowerCase()) || 0;
        return (
          <button
            key={c.handle}
            type="button"
            role="listitem"
            className="follow-story"
            // The rail animates as one cohesive unit now
            // (.follow-stories-rail plays follow-stories-arc-in in
            // home-hero.css) — no per-story stagger here.
            onClick={() => onOpenCreator(c.handle)}
            title={name}
            aria-label={`Open ${name}'s catalog`}
          >
            <span className={`follow-story-ring${isOnline ? ' is-online' : ''}`}>
              <span className="follow-story-avatar">
                {c.avatarUrl
                  ? <img src={highResAvatarUrl(c.avatarUrl, 128) || c.avatarUrl} alt="" loading="lazy" decoding="async" />
                  : <span className="follow-story-initial">{name.charAt(0).toUpperCase()}</span>}
              </span>
              {unseen > 0 && (
                <span className="follow-story-unseen" aria-label={`${unseen} new look${unseen === 1 ? '' : 's'}`}>
                  {unseen > 9 ? '9+' : unseen}
                </span>
              )}
            </span>
            <span className="follow-story-name">{name}</span>
          </button>
        );
      })}
      {onSeeAll && (
        <button
          type="button"
          className="follow-story follow-story--all"
          onClick={onSeeAll}
          title="See all"
          aria-label="See all creators you follow"
        >
          <span className="follow-story-ring follow-story-ring--all">
            <span className="follow-story-avatar follow-story-avatar--all">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
                <circle cx="3.5" cy="6" r="1" /><circle cx="3.5" cy="12" r="1" /><circle cx="3.5" cy="18" r="1" />
              </svg>
            </span>
          </span>
          <span className="follow-story-name">See all</span>
        </button>
      )}
    </div>
  );
}

// ─── internal FollowingOrbitRail (mobile 3D carousel) ───────────────

/** A modern 3D ring of creator avatars. Each creator is a circle placed on a
 *  horizontal cylinder; the whole ring slowly auto-rotates in 3D space so the
 *  front avatars read large and bright while the ones turning toward the back
 *  lean away, dim, and recede — you "kinda see the back of the circle". Drag
 *  horizontally to spin it yourself; release and it resumes its slow drift.
 *  The front-most creator's name shows in a caption below.
 *
 *  Mobile-only (CSS hides it ≥769px, where the compact stories rail shows
 *  instead). Renders a static skeleton ring while entries load.
 *
 *  All per-frame work (rotation, depth opacity, z-order, caption) is written
 *  straight to the DOM via refs so the loop never triggers React re-renders.
 *  The loop idles whenever the rail is display:none (desktop), off-screen,
 *  or the tab is hidden. */
function FollowingOrbitRail({ entries, onlineHandles, unseenByHandle, onOpenCreator, onSeeAll }: FollowingStoriesRailProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const captionRef = useRef<HTMLSpanElement | null>(null);
  const angleRef = useRef(0);
  const draggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartAngleRef = useRef(0);
  const movedRef = useRef(0);
  const frontIdxRef = useRef(-1);

  const count = entries.length;
  const step = count > 0 ? 360 / count : 0;
  // Radius spreads the avatars evenly around the cylinder so neighbours never
  // collide at the front, growing with the number of creators.
  const ITEM = 36;
  const GAP = 18;
  const radius = count > 1
    ? Math.max(104, (ITEM + GAP) / (2 * Math.sin(Math.PI / count)))
    : 0;

  // Seat each avatar at its fixed slot on the ring (set once per layout).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const kids = Array.from(stage.children) as HTMLElement[];
    kids.forEach((el, i) => {
      el.style.transform = `rotateY(${i * step}deg) translateZ(${radius}px)`;
    });
  }, [step, radius, count]);

  // Auto-rotation + per-frame depth shading. Pauses while dragging, off-screen,
  // tab-hidden, or fully display:none (desktop).
  useEffect(() => {
    if (count === 0) return;
    const reduced = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const SPEED = reduced ? 0 : 7; // deg / second — a slow, premium drift
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const stage = stageRef.current;
      const root = rootRef.current;
      // offsetParent is null when an ancestor is display:none → idle fully.
      if (!stage || !root || root.offsetParent === null) { last = now; return; }
      const dt = Math.min(64, now - last) / 1000;
      last = now;
      if (!draggingRef.current && !document.hidden) angleRef.current += SPEED * dt;
      const a = angleRef.current;
      stage.style.transform = `rotateY(${a}deg)`;
      const kids = stage.children as HTMLCollectionOf<HTMLElement>;
      let bestC = -2, bestI = -1;
      for (let i = 0; i < kids.length; i++) {
        const c = Math.cos(((i * step + a) * Math.PI) / 180); // 1 front … -1 back
        const el = kids[i];
        el.style.opacity = String(0.2 + 0.8 * (c * 0.5 + 0.5));
        el.style.zIndex = String(Math.round((c + 1) * 100));
        el.style.pointerEvents = c > 0.4 ? 'auto' : 'none';
        if (c > bestC) { bestC = c; bestI = i; }
      }
      if (bestI !== frontIdxRef.current) {
        frontIdxRef.current = bestI;
        const e = entries[bestI];
        if (captionRef.current && e) captionRef.current.textContent = e.displayName || e.handle;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [count, step, entries]);

  const onPointerDown = (e: React.PointerEvent) => {
    draggingRef.current = true;
    dragStartXRef.current = e.clientX;
    dragStartAngleRef.current = angleRef.current;
    movedRef.current = 0;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const dx = e.clientX - dragStartXRef.current;
    movedRef.current = Math.max(movedRef.current, Math.abs(dx));
    angleRef.current = dragStartAngleRef.current + dx * 0.55;
  };
  const endDrag = (e: React.PointerEvent) => {
    draggingRef.current = false;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  if (count === 0) {
    return (
      <div className="follow-orbit follow-orbit--skeleton" aria-hidden="true">
        <div className="follow-orbit-viewport">
          <div className="follow-orbit-stage">
            {Array.from({ length: 6 }, (_, i) => (
              <span key={`orbit-skel-${i}`} className="follow-orbit-item" style={{ transform: `rotateY(${i * 60}deg) translateZ(74px)` }}>
                <span className="follow-orbit-ring"><span className="follow-orbit-avatar follow-orbit-avatar--skeleton" /></span>
              </span>
            ))}
          </div>
        </div>
        <span className="follow-orbit-caption" />
      </div>
    );
  }

  return (
    <div
      className="follow-orbit"
      ref={rootRef}
      role="group"
      aria-label="Creators you follow"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="follow-orbit-viewport">
        <div className="follow-orbit-stage" ref={stageRef}>
          {entries.map((c) => {
            const isOnline = onlineHandles.has(c.handle.toLowerCase());
            const name = c.displayName || c.handle;
            const unseen = unseenByHandle.get(c.handle.toLowerCase()) || 0;
            return (
              <button
                key={c.handle}
                type="button"
                className="follow-orbit-item"
                // A drag shouldn't register as a tap — only open the creator
                // if the pointer barely moved.
                onClick={() => { if (movedRef.current < 6) onOpenCreator(c.handle); }}
                title={name}
                aria-label={`Open ${name}'s catalog`}
              >
                <span className={`follow-orbit-ring${isOnline ? ' is-online' : ''}`}>
                  <span className="follow-orbit-avatar">
                    {c.avatarUrl
                      ? <img src={highResAvatarUrl(c.avatarUrl, 128) || c.avatarUrl} alt="" loading="lazy" decoding="async" draggable={false} />
                      : <span className="follow-orbit-initial">{name.charAt(0).toUpperCase()}</span>}
                  </span>
                  {unseen > 0 && (
                    <span className="follow-orbit-unseen" aria-label={`${unseen} new look${unseen === 1 ? '' : 's'}`}>
                      {unseen > 9 ? '9+' : unseen}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <span className="follow-orbit-caption" ref={captionRef}>{entries[0]?.displayName || entries[0]?.handle || ''}</span>
      {onSeeAll && (
        <button type="button" className="follow-orbit-seeall" onClick={onSeeAll}>See all</button>
      )}
    </div>
  );
}

// ─── internal AvatarRow ─────────────────────────────────────────────

interface AvatarRowProps {
  /** Which rail — drives a `.follow-rail--{kind}` class so CSS can show
   *  only the "following" rail on mobile. */
  railKind: 'following' | 'followers';
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
  /** Lower-cased handles currently online — get a glowing green ring. */
  onlineHandles: Set<string>;
}

function AvatarRow({
  railKind, ariaLabel, titleText, entries, newSet, isOpen, onToggle, onSelect, popoverTitle, tooltipPrefix, onlineHandles,
}: AvatarRowProps) {
  const visible = entries.slice(0, MAX_VISIBLE);
  const overflow = Math.max(0, entries.length - MAX_VISIBLE);
  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }} className={`follow-rail follow-rail--${railKind}`}>
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
            const isOnline = onlineHandles.has(c.handle.toLowerCase());
            const tip = tooltipPrefix && c.ts
              ? `${c.displayName || c.handle} · ${tooltipPrefix} ${timeAgo(c.ts)}${isOnline ? ' · online' : ''}`
              : `${c.displayName || c.handle}${isOnline ? ' · online' : ''}`;
            return (
              <span
                key={c.handle}
                className={`follow-rail-avatar${isNew ? ' follow-rail-avatar--new' : ''}${isOnline ? ' follow-rail-avatar--online' : ''}`}
                title={tip}
                style={{
                  width: 28, height: 28, borderRadius: '50%',
                  border: '2px solid #fff',
                  background: '#e2e8f0',
                  overflow: 'hidden',
                  marginLeft: i === 0 ? 0 : -10,
                  // Online avatars ride above neighbours so their glow
                  // isn't clipped by the next overlapping circle.
                  zIndex: isOnline ? 55 : 50 - i,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#475569',
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {c.avatarUrl
                  ? <img src={highResAvatarUrl(c.avatarUrl, 96) || c.avatarUrl} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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
            {entries.map(c => {
              const rowOnline = onlineHandles.has(c.handle.toLowerCase());
              return (
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
                <span style={{ position: 'relative', flexShrink: 0, display: 'inline-flex' }}>
                  <span
                    className={rowOnline ? 'follow-rail-avatar--online' : undefined}
                    style={{
                      width: 30, height: 30, borderRadius: '50%',
                      background: '#e2e8f0', overflow: 'hidden',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      color: '#475569', fontSize: 12, fontWeight: 700,
                    }}
                  >
                    {c.avatarUrl
                      ? <img src={highResAvatarUrl(c.avatarUrl, 96) || c.avatarUrl} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : (c.displayName || c.handle).charAt(0).toUpperCase()}
                  </span>
                  {rowOnline && (
                    <span
                      aria-hidden="true"
                      title="Online now"
                      style={{
                        position: 'absolute', right: -1, bottom: -1,
                        width: 10, height: 10, borderRadius: '50%',
                        background: '#22c55e', border: '2px solid #fff',
                      }}
                    />
                  )}
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
                {/* Last-look poster, right-aligned. Following rows only —
                    Followers rows carry no thumbnail. */}
                {c.lastThumb && (
                  <img
                    src={highResAvatarUrl(c.lastThumb, 128) || c.lastThumb}
                    alt=""
                    aria-hidden="true"
                    loading="lazy"
                    decoding="async"
                    style={{
                      flexShrink: 0,
                      width: 28,
                      height: 37,
                      borderRadius: 5,
                      objectFit: 'cover',
                      background: '#e2e8f0',
                      border: '1px solid #e5e7eb',
                    }}
                  />
                )}
              </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

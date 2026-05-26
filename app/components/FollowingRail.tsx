import { useEffect, useRef, useState } from 'react';
import { getMyFollowing } from '~/services/follows';
import { subscribeFollowingChanges } from '~/hooks/useFollowState';
import { supabase } from '~/utils/supabase';

interface FollowingRailProps {
  onOpenCreator: (handle: string) => void;
}

interface FollowedCreator {
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
}

/**
 * Small circle in the header that, when clicked, opens a popover
 * showing every creator the signed-in shopper follows. Hidden when
 * the shopper follows nobody yet (so the header doesn't carry a
 * permanently-empty UI element). Resolves each handle against both
 * profiles + creators tables for the avatar/name — same merge
 * logic the CreatorPage hero uses.
 */
export default function FollowingRail({ onOpenCreator }: FollowingRailProps) {
  const [creators, setCreators] = useState<FollowedCreator[] | null>(null);
  const [open, setOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Refetch the rail whenever any follow toggles elsewhere (in-feed
  // icon, CreatorPage CTA, etc.). Without this the rail froze on its
  // first-mount snapshot and you'd have to reload the tab to see a
  // newly-followed creator appear at the top of the screen.
  useEffect(() => subscribeFollowingChanges(() => setRefreshKey(k => k + 1)), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const handles = await getMyFollowing();
      if (cancelled) return;
      if (handles.length === 0) {
        setCreators([]);
        return;
      }
      if (!supabase) {
        setCreators(handles.map(h => ({ handle: h, displayName: null, avatarUrl: null })));
        return;
      }
      // Pull creators table (handle keyed) + look up user_ids via
      // looks for fallback profile-based avatar. Single fetch per
      // table — cheap.
      const [creatorRows, lookRows] = await Promise.all([
        supabase.from('creators').select('handle, display_name, avatar_url').in('handle', handles),
        supabase.from('looks').select('creator_handle, user_id').in('creator_handle', handles).not('user_id', 'is', null).limit(handles.length * 3),
      ]);
      type CRow = { handle: string; display_name: string | null; avatar_url: string | null };
      type LRow = { creator_handle: string; user_id: string };
      const creatorByHandle = new Map<string, CRow>(
        ((creatorRows.data || []) as CRow[]).map(r => [r.handle, r]),
      );
      const userIdByHandle = new Map<string, string>();
      for (const l of (lookRows.data || []) as LRow[]) {
        if (!userIdByHandle.has(l.creator_handle)) userIdByHandle.set(l.creator_handle, l.user_id);
      }
      // Profile lookups for handles that lacked a creators-table avatar.
      const profileNeeded = Array.from(new Set(
        handles
          .filter(h => !creatorByHandle.get(h)?.avatar_url)
          .map(h => userIdByHandle.get(h))
          .filter((u): u is string => !!u),
      ));
      const profileByUserId = new Map<string, { full_name: string | null; avatar_url: string | null }>();
      if (profileNeeded.length > 0) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, full_name, avatar_url')
          .in('id', profileNeeded);
        for (const p of (profs || []) as { id: string; full_name: string | null; avatar_url: string | null }[]) {
          profileByUserId.set(p.id, { full_name: p.full_name, avatar_url: p.avatar_url });
        }
      }
      if (cancelled) return;
      setCreators(handles.map(h => {
        const cr = creatorByHandle.get(h);
        const uid = userIdByHandle.get(h);
        const prof = uid ? profileByUserId.get(uid) : undefined;
        return {
          handle: h,
          displayName: cr?.display_name || prof?.full_name || null,
          avatarUrl: cr?.avatar_url || prof?.avatar_url || null,
        };
      }));
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (creators === null || creators.length === 0) return null;

  // The button shows a tiny stack of up to 3 avatars (or +N if more)
  // so the rail reads as "your following" at a glance.
  const visible = creators.slice(0, 3);
  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-label="Following"
        title={`Following ${creators.length} creator${creators.length === 1 ? '' : 's'}`}
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        <span style={{ position: 'relative', display: 'inline-flex', height: 28 }}>
          {visible.map((c, i) => (
            <span
              key={c.handle}
              style={{
                width: 28, height: 28, borderRadius: '50%',
                border: '2px solid #fff',
                background: '#e2e8f0',
                overflow: 'hidden',
                marginLeft: i === 0 ? 0 : -10,
                zIndex: 10 - i,
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
          ))}
        </span>
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          right: 0,
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
            Following · {creators.length}
          </div>
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {creators.map(c => (
              <button
                key={c.handle}
                type="button"
                onClick={() => { setOpen(false); onOpenCreator(c.handle); }}
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
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.displayName || c.handle}
                  </span>
                  <span style={{ fontSize: 11, color: '#64748b' }}>@{c.handle}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

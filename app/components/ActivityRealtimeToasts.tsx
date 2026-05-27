import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '~/utils/supabase';
import { useAuth } from '~/hooks/useAuth';

/**
 * Activity — realtime engagement toasts for the signed-in creator.
 *
 * Subscribes to two Supabase realtime streams scoped to "stuff that
 * happens to me":
 *   1. user_events INSERT on rows whose target_uuid is one of my
 *      looks (click / clickout — impressions are silenced because
 *      they're too noisy to surface live).
 *   2. creator_follows INSERT where followee_handle = my creators.handle
 *      (someone followed me).
 *
 * Each new event pops a small toast in the top-right that auto-dismisses
 * after a few seconds. The toast pile caps at 4 visible so a burst
 * doesn't overflow the viewport — older toasts are evicted FIFO.
 *
 * Quiet for signed-out callers, AI users (no creators row → no handle
 * → follower-subscription skipped, look-subscription stays active),
 * and anyone with no looks at all.
 *
 * Powered by RLS + publication membership added in migration
 * 20260527000005_activity_realtime_publication_and_policy.sql —
 * without those the realtime channel delivers nothing.
 */

type ActivityKind = 'click' | 'clickout' | 'follow';

interface ActivityToast {
  id: string;
  kind: ActivityKind;
  message: string;
  ts: number;
}

const MAX_VISIBLE = 4;
const TOAST_LIFESPAN_MS = 5500;

const KIND_LABEL: Record<ActivityKind, string> = {
  click:    'New tap on your look',
  clickout: 'Someone clicked through to checkout',
  follow:   'New follower',
};

const KIND_ICON: Record<ActivityKind, string> = {
  click:    '👆',
  clickout: '🛒',
  follow:   '＋',
};

export default function ActivityRealtimeToasts() {
  const { user, loading } = useAuth();
  const [toasts, setToasts] = useState<ActivityToast[]>([]);

  const pushToast = useCallback((kind: ActivityKind) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const next: ActivityToast = {
      id, kind, message: KIND_LABEL[kind], ts: Date.now(),
    };
    setToasts(prev => {
      const merged = [...prev, next];
      // FIFO eviction so a burst can't grow without bound.
      return merged.length > MAX_VISIBLE ? merged.slice(-MAX_VISIBLE) : merged;
    });
    window.setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, TOAST_LIFESPAN_MS);
  }, []);

  // Stash callbacks in a ref so the realtime channel listeners don't
  // need to be re-subscribed every time the toasts state updates.
  const pushRef = useRef(pushToast);
  pushRef.current = pushToast;

  useEffect(() => {
    if (loading || !user || !supabase) return;
    let cancelled = false;

    type Channel = ReturnType<NonNullable<typeof supabase>['channel']>;
    let eventChannel: Channel | null = null;
    let followChannel: Channel | null = null;

    (async () => {
      // Load look IDs + creator handle in parallel.
      const [looksRes, creatorRes] = await Promise.all([
        supabase.from('looks').select('id').eq('user_id', user.id),
        supabase.from('creators').select('handle').eq('id', user.id).maybeSingle(),
      ]);
      if (cancelled) return;
      const lookIds = new Set(
        ((looksRes.data ?? []) as { id: string }[]).map(r => r.id),
      );
      const myHandle = creatorRes.data?.handle ?? null;

      // user_events stream — realtime postgres_changes can't filter by
      // an IN-list across many UUIDs in one expression, so we subscribe
      // to all INSERTs and filter the look-id membership client-side.
      // With user_events RLS only delivering events targeting my looks
      // (per the new policy), the wire-level firehose is already
      // scoped before it hits us.
      if (lookIds.size > 0) {
        eventChannel = supabase
          .channel(`activity-events-${user.id}`)
          .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'user_events' },
            (payload) => {
              const row = payload.new as {
                user_id?: string | null;
                event_type?: string | null;
                target_type?: string | null;
                target_uuid?: string | null;
              };
              if (!row) return;
              if (row.user_id === user.id) return; // don't toast my own actions
              if (row.target_type !== 'look') return;
              if (!row.target_uuid || !lookIds.has(row.target_uuid)) return;
              const k = row.event_type;
              if (k === 'click' || k === 'clickout') {
                pushRef.current(k);
              }
            },
          )
          .subscribe();
      }

      // creator_follows stream — filter to my handle server-side.
      if (myHandle) {
        followChannel = supabase
          .channel(`activity-follows-${user.id}`)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'creator_follows',
              filter: `followee_handle=eq.${myHandle}`,
            },
            (payload) => {
              const row = payload.new as { follower_id?: string | null };
              if (!row) return;
              if (row.follower_id === user.id) return;
              pushRef.current('follow');
            },
          )
          .subscribe();
      }
    })();

    return () => {
      cancelled = true;
      if (eventChannel && supabase) supabase.removeChannel(eventChannel);
      if (followChannel && supabase) supabase.removeChannel(followChannel);
    };
  }, [user, loading]);

  if (toasts.length === 0) return null;
  return (
    <div className="activity-toasts" role="status" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className={`activity-toast activity-toast--${t.kind}`}>
          <span className="activity-toast-icon" aria-hidden>{KIND_ICON[t.kind]}</span>
          <span className="activity-toast-message">{t.message}</span>
        </div>
      ))}
    </div>
  );
}

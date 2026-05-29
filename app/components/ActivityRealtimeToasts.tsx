import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '~/utils/supabase';
import { useAuth } from '~/hooks/useAuth';

/**
 * Activity — single notification pipeline for engagement events.
 *
 * Drives two flavours of toast in the same right-aligned pill stack:
 *
 *   1. **Realtime** — Supabase postgres_changes subscriptions on
 *      user_events INSERT (target = my looks) and creator_follows
 *      INSERT (followee = my handle). One toast per event, with
 *      the actor's display name + the look's title resolved before
 *      render so the message reads "<name> tapped <look title>".
 *
 *   2. **Catch-up** — on mount and whenever the tab becomes visible
 *      after being hidden, queries events that landed while I was
 *      away and pushes a SUMMARY toast per kind ("+12 new taps").
 *      Keeps a multi-week absence from spamming 1,000 individual
 *      toasts but still informs me of the volume.
 *
 * Last-seen bookkeeping lives in localStorage so it survives tab
 * refreshes. On the very first visit we fall back to
 * profiles.previous_sign_in_at; if that's null too we skip the
 * catch-up (no baseline to compare against).
 */

type ActivityKind = 'impression' | 'click' | 'clickout' | 'follow';

interface ActivityToast {
  id: string;
  kind: ActivityKind;
  message: string;
  /** Avatar of the actor whose event triggered this toast. Null for
   *  catch-up summary toasts (no single actor). */
  avatarUrl?: string | null;
  /** Thumbnail of the look the actor engaged with. Same null rule
   *  as avatarUrl. */
  thumbnailUrl?: string | null;
  /** Short label rendered under the message (e.g. "viewed your
   *  beach look") so the avatar+thumb pair carries context without
   *  needing a wall of text. */
  fallbackInitial?: string;
}

const MAX_VISIBLE = 5;
const TOAST_LIFESPAN_MS = 6000;
const SUMMARY_TOAST_LIFESPAN_MS = 9000;
const LAST_SEEN_KEY = 'activity:last-seen-at';

const KIND_ICON: Record<ActivityKind, string> = {
  impression: '👁',
  click:      '👆',
  clickout:   '🛒',
  follow:     '＋',
};

function actionVerb(kind: Exclude<ActivityKind, 'follow'>): string {
  if (kind === 'impression') return 'viewed';
  if (kind === 'click')      return 'tapped';
  return 'checked out from';
}

function summaryNoun(kind: ActivityKind, n: number): string {
  if (kind === 'impression') return n === 1 ? 'new view'    : 'new views';
  if (kind === 'click')      return n === 1 ? 'new tap'     : 'new taps';
  if (kind === 'clickout')   return n === 1 ? 'new checkout': 'new checkouts';
  return n === 1 ? 'new follower' : 'new followers';
}

export default function ActivityRealtimeToasts() {
  const { user, loading } = useAuth();
  const [toasts, setToasts] = useState<ActivityToast[]>([]);

  const pushToast = useCallback((kind: ActivityKind, message: string, lifespanMs = TOAST_LIFESPAN_MS) => {
    if (!message) return;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts(prev => {
      const merged = [...prev, { id, kind, message }];
      return merged.length > MAX_VISIBLE ? merged.slice(-MAX_VISIBLE) : merged;
    });
    window.setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, lifespanMs);
  }, []);

  const pushRef = useRef(pushToast);
  pushRef.current = pushToast;

  useEffect(() => {
    if (loading || !user || !supabase) return;
    // Capture into a non-nullable local so the inner closures don't
    // need to re-narrow user — TS can't track the outer narrowing
    // across the async IIFE + per-payload callbacks below.
    const userId: string = user.id;
    let cancelled = false;

    type Channel = ReturnType<NonNullable<typeof supabase>['channel']>;
    let eventChannel: Channel | null = null;
    let followChannel: Channel | null = null;
    let visibilityCleanup: (() => void) | null = null;

    // Per-event lookups: actor display name + look title. Cache so
    // the same actor doesn't trigger a profile fetch on every toast.
    interface LookInfo { title: string; thumbnailUrl: string | null }
    interface ActorInfo { name: string; avatarUrl: string | null }
    const lookInfoById = new Map<string, LookInfo>();
    const actorInfoCache = new Map<string, ActorInfo>();

    async function resolveActorInfo(actorId: string): Promise<ActorInfo> {
      const cached = actorInfoCache.get(actorId);
      if (cached) return cached;
      let name = 'Someone';
      let avatarUrl: string | null = null;
      if (supabase) {
        // Prefer the creators row (display_name + custom avatar) for
        // anyone who has one; fall back to the profile for everyone
        // else. The avatar_url from either source is fine — both write
        // to the same supabase storage in practice.
        const [profRes, creatorRes] = await Promise.all([
          supabase.from('profiles').select('full_name, avatar_url').eq('id', actorId).maybeSingle(),
          supabase.from('creators').select('display_name, handle, avatar_url').eq('id', actorId).maybeSingle(),
        ]);
        const fromCreator = creatorRes.data?.display_name || creatorRes.data?.handle;
        const fromProfile = profRes.data?.full_name;
        name = (fromCreator || fromProfile || 'Someone').toString().trim() || 'Someone';
        avatarUrl = (creatorRes.data?.avatar_url || profRes.data?.avatar_url || null);
      }
      const info: ActorInfo = { name, avatarUrl };
      actorInfoCache.set(actorId, info);
      return info;
    }

    // Resolve a look's title + thumbnail, cache-first. Lets a realtime
    // event for a look created AFTER mount still render an accurate
    // message instead of a generic "your look".
    async function resolveLookInfo(lookId: string): Promise<LookInfo> {
      const cached = lookInfoById.get(lookId);
      if (cached) return cached;
      let info: LookInfo = { title: 'your look', thumbnailUrl: null };
      if (supabase) {
        const { data } = await supabase
          .from('looks').select('title, thumbnail_url').eq('id', lookId).maybeSingle();
        if (data) info = { title: data.title || 'your look', thumbnailUrl: data.thumbnail_url || null };
      }
      lookInfoById.set(lookId, info);
      return info;
    }

    (async () => {
      // 1. Find my looks + their titles + my handle.
      const [looksRes, creatorRes] = await Promise.all([
        supabase.from('looks').select('id, title, thumbnail_url').eq('user_id', userId),
        supabase.from('creators').select('handle').eq('id', userId).maybeSingle(),
      ]);
      if (cancelled) return;
      for (const r of ((looksRes.data ?? []) as { id: string; title: string | null; thumbnail_url: string | null }[])) {
        lookInfoById.set(r.id, { title: r.title || 'your look', thumbnailUrl: r.thumbnail_url || null });
      }
      const myHandle = creatorRes.data?.handle ?? null;

      // 2. Catch-up helper. Pushes one SUMMARY toast per kind.
      //    Scoped by target_owner_id (the denormalized look owner) so it
      //    covers every look I own — including ones created after mount —
      //    and doesn't depend on the lookIds snapshot.
      async function pushCatchupSince(sinceIso: string) {
        if (!supabase) return;
        const [{ data: events }, { data: follows }] = await Promise.all([
          supabase
            .from('user_events')
            .select('event_type')
            .gt('created_at', sinceIso)
            .neq('user_id', userId)
            .eq('target_owner_id', userId),
          myHandle
            ? supabase
                .from('creator_follows')
                .select('follower_id')
                .gt('created_at', sinceIso)
                .eq('followee_handle', myHandle)
                .neq('follower_id', userId)
            : Promise.resolve({ data: [] as Array<{ follower_id: string }> }),
        ]);
        let imps = 0, clicks = 0, clickouts = 0;
        for (const e of (events ?? []) as Array<{ event_type: string }>) {
          if (e.event_type === 'impression') imps      += 1;
          if (e.event_type === 'click')      clicks    += 1;
          if (e.event_type === 'clickout')   clickouts += 1;
        }
        const followers = (follows ?? []).length;
        if (clickouts > 0) pushRef.current('clickout',   `+${clickouts.toLocaleString()} ${summaryNoun('clickout', clickouts)}`, SUMMARY_TOAST_LIFESPAN_MS);
        if (clicks    > 0) pushRef.current('click',      `+${clicks.toLocaleString()} ${summaryNoun('click',    clicks)}`,      SUMMARY_TOAST_LIFESPAN_MS);
        if (followers > 0) pushRef.current('follow',     `+${followers.toLocaleString()} ${summaryNoun('follow', followers)}`,  SUMMARY_TOAST_LIFESPAN_MS);
        if (imps      > 0) pushRef.current('impression', `+${imps.toLocaleString()} ${summaryNoun('impression', imps)}`,        SUMMARY_TOAST_LIFESPAN_MS);
      }

      // 3. Mount-time catch-up.
      const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(LAST_SEEN_KEY) : null;
      let sinceIso: string | null = stored;
      if (!sinceIso) {
        const { data: prof } = await supabase
          .from('profiles').select('previous_sign_in_at').eq('id', userId).maybeSingle();
        sinceIso = (prof?.previous_sign_in_at as string | null) ?? null;
      }
      if (sinceIso) await pushCatchupSince(sinceIso);
      try { localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString()); } catch { /* */ }

      // 4. Visibility tracking. On hidden → record now; on visible →
      //    catch-up since the hidden moment, then stamp now again.
      let lastHiddenAt: string | null = null;
      const onVis = () => {
        if (document.visibilityState === 'hidden') {
          lastHiddenAt = new Date().toISOString();
        } else if (document.visibilityState === 'visible' && lastHiddenAt) {
          const since = lastHiddenAt;
          lastHiddenAt = null;
          void pushCatchupSince(since);
          try { localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString()); } catch { /* */ }
        }
      };
      document.addEventListener('visibilitychange', onVis);
      visibilityCleanup = () => document.removeEventListener('visibilitychange', onVis);

      // 5. Realtime channels. Per-event toasts now include the
      //    actor's name + the look title. We resolve names lazily
      //    so the first paint of a toast might switch from
      //    "Someone tapped your X" to "John tapped your X" after
      //    the profile fetch lands — but the toast renders
      //    immediately rather than waiting on the lookup.
      // Server-side filter on the denormalized owner column means
      // Realtime only sends events that target MY looks — no platform-
      // wide firehose, and it authorizes cleanly via the simple
      // `auth.uid() = target_owner_id` policy (a cross-table-subquery
      // policy isn't reliably evaluated by Realtime, which is what
      // silently broke this toast before).
      {
        eventChannel = supabase
          .channel(`activity-events-${userId}`)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'user_events',
              filter: `target_owner_id=eq.${userId}`,
            },
            (payload) => {
              const row = payload.new as {
                user_id?: string | null;
                event_type?: string | null;
                target_type?: string | null;
                target_uuid?: string | null;
              };
              if (!row) return;
              if (row.user_id === userId) return;       // skip my own views
              if (row.target_type !== 'look' || !row.target_uuid) return;
              const k = row.event_type;
              if (k !== 'impression' && k !== 'click' && k !== 'clickout') return;
              const kind: ActivityKind = k;
              const lookId = row.target_uuid;
              const verb  = actionVerb(kind);
              const cachedLook = lookInfoById.get(lookId);
              const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              setToasts(prev => {
                const merged: ActivityToast[] = [...prev, {
                  id, kind,
                  message: `Someone ${verb} ${cachedLook?.title ?? 'your look'}`,
                  avatarUrl: null,
                  thumbnailUrl: cachedLook?.thumbnailUrl ?? null,
                  fallbackInitial: '?',
                }];
                return merged.length > MAX_VISIBLE ? merged.slice(-MAX_VISIBLE) : merged;
              });
              window.setTimeout(() => {
                setToasts(prev => prev.filter(t => t.id !== id));
              }, TOAST_LIFESPAN_MS);
              // Resolve actor (name + avatar) and look (title + thumb) and
              // upgrade the toast in place once both land.
              void Promise.all([
                row.user_id ? resolveActorInfo(row.user_id) : Promise.resolve<ActorInfo>({ name: 'Someone', avatarUrl: null }),
                resolveLookInfo(lookId),
              ]).then(([actor, look]) => {
                setToasts(prev => prev.map(t =>
                  t.id === id
                    ? {
                        ...t,
                        message: `${actor.name} ${verb} ${look.title}`,
                        avatarUrl: actor.avatarUrl,
                        thumbnailUrl: look.thumbnailUrl,
                        fallbackInitial: actor.name.charAt(0).toUpperCase() || '?',
                      }
                    : t,
                ));
              });
              try { localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString()); } catch { /* */ }
            },
          )
          .subscribe();
      }
      if (myHandle) {
        followChannel = supabase
          .channel(`activity-follows-${userId}`)
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
              if (row.follower_id === userId) return;
              const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              setToasts(prev => {
                const merged: ActivityToast[] = [...prev, {
                  id,
                  kind: 'follow',
                  message: 'Someone followed you',
                  avatarUrl: null,
                  thumbnailUrl: null,
                  fallbackInitial: '?',
                }];
                return merged.length > MAX_VISIBLE ? merged.slice(-MAX_VISIBLE) : merged;
              });
              window.setTimeout(() => {
                setToasts(prev => prev.filter(t => t.id !== id));
              }, TOAST_LIFESPAN_MS);
              if (row.follower_id) {
                void resolveActorInfo(row.follower_id).then(info => {
                  setToasts(prev => prev.map(t =>
                    t.id === id
                      ? {
                          ...t,
                          message: `${info.name} followed you`,
                          avatarUrl: info.avatarUrl,
                          fallbackInitial: info.name.charAt(0).toUpperCase() || '?',
                        }
                      : t,
                  ));
                });
              }
              try { localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString()); } catch { /* */ }
            },
          )
          .subscribe();
      }
    })();

    return () => {
      cancelled = true;
      if (eventChannel  && supabase) supabase.removeChannel(eventChannel);
      if (followChannel && supabase) supabase.removeChannel(followChannel);
      if (visibilityCleanup) visibilityCleanup();
    };
  }, [user, loading]);

  if (toasts.length === 0) return null;
  return (
    <div className="activity-toasts" role="status" aria-live="polite">
      {toasts.map(t => {
        // Per-event toasts render avatar (left) + thumb (right); the
        // catch-up summaries (no per-actor context) fall back to the
        // emoji puck so the visual language still differs.
        const hasPerEvent = t.avatarUrl !== undefined || t.thumbnailUrl !== undefined;
        return (
          <div key={t.id} className={`activity-toast activity-toast--${t.kind}${hasPerEvent ? ' activity-toast--rich' : ''}`}>
            {hasPerEvent ? (
              t.avatarUrl
                ? <img className="activity-toast-avatar" src={t.avatarUrl} alt="" />
                : <span className="activity-toast-avatar activity-toast-avatar--initial" aria-hidden>{t.fallbackInitial || '?'}</span>
            ) : (
              <span className="activity-toast-icon" aria-hidden>{KIND_ICON[t.kind]}</span>
            )}
            <span className="activity-toast-message">{t.message}</span>
            {hasPerEvent && t.thumbnailUrl && (
              <img className="activity-toast-thumb" src={t.thumbnailUrl} alt="" />
            )}
          </div>
        );
      })}
    </div>
  );
}

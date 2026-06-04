import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '~/utils/supabase';
import type { CommentTargetType } from '~/services/comments';

/**
 * iMessage-style "someone is typing…" for a comment thread, over Supabase
 * Realtime broadcast (no DB writes). Each client broadcasts a lightweight
 * `typing` ping (throttled) on a per-target channel; peers collect the
 * pings, prune anyone who's gone quiet for >3.5s, and expose the live set
 * of names (self excluded).
 */

const PING_THROTTLE_MS = 1500;
const STALE_MS = 3500;

interface TypingPeer { name: string; at: number; }

export function useCommentTyping(
  targetType: CommentTargetType,
  targetId: string,
  self: { id?: string; name?: string } | null,
) {
  const [typingNames, setTypingNames] = useState<string[]>([]);
  const peersRef = useRef<Map<string, TypingPeer>>(new Map());
  const channelRef = useRef<ReturnType<NonNullable<typeof supabase>['channel']> | null>(null);
  const lastPingRef = useRef(0);

  useEffect(() => {
    if (!supabase || !targetId) return;
    const selfId = self?.id ?? '';
    const channel = supabase.channel(`ct:${targetType}:${targetId}`, {
      config: { broadcast: { self: false } },
    });
    channelRef.current = channel;

    const recompute = () => {
      const now = Date.now();
      const names: string[] = [];
      for (const [id, peer] of peersRef.current) {
        if (now - peer.at > STALE_MS) { peersRef.current.delete(id); continue; }
        if (id !== selfId) names.push(peer.name);
      }
      setTypingNames(prev => (prev.length === names.length && prev.every((n, i) => n === names[i]) ? prev : names));
    };

    channel
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const p = payload as { userId?: string; name?: string };
        if (!p?.userId || p.userId === selfId) return;
        peersRef.current.set(p.userId, { name: p.name || 'Someone', at: Date.now() });
        recompute();
      })
      .subscribe();

    // Prune stale typers a few times a second so the indicator fades out
    // on its own when someone stops.
    const prune = window.setInterval(recompute, 1200);
    return () => {
      window.clearInterval(prune);
      void supabase!.removeChannel(channel);
      channelRef.current = null;
      peersRef.current.clear();
    };
  }, [targetType, targetId, self?.id]);

  const notifyTyping = useCallback(() => {
    const ch = channelRef.current;
    if (!ch || !self?.id) return;
    const now = Date.now();
    if (now - lastPingRef.current < PING_THROTTLE_MS) return;
    lastPingRef.current = now;
    ch.send({ type: 'broadcast', event: 'typing', payload: { userId: self.id, name: self.name || 'Someone' } });
  }, [self?.id, self?.name]);

  return { typingNames, notifyTyping };
}

import { useEffect, useRef, useState } from 'react';
import { supabase } from '~/utils/supabase';

// Real-time cursor collaboration for admin pages. Uses Supabase Realtime's
// Broadcast API — lightweight and fits inside our anon-key budget, no table
// required. Each admin shares x/y (viewport-relative) plus a stable display
// name and color; we rate-limit outbound updates to ~30ms.

export interface RemoteCursor {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  lastSeen: number;
}

interface UseLiveCursorsOptions {
  channel?: string;
  selfId?: string;
  selfName?: string;
  enabled?: boolean;
}

const PALETTE = [
  '#ef4444', '#f97316', '#f59e0b', '#10b981',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
];

function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

function getOrCreateAnonId(): string {
  try {
    const existing = localStorage.getItem('admin:cursorId');
    if (existing) return existing;
    const fresh = `anon-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem('admin:cursorId', fresh);
    return fresh;
  } catch {
    return `anon-${Math.random().toString(36).slice(2, 8)}`;
  }
}

export function useLiveCursors({
  channel: channelName = 'admin-cursors',
  selfId,
  selfName,
  enabled = true,
}: UseLiveCursorsOptions = {}): RemoteCursor[] {
  const [cursors, setCursors] = useState<Record<string, RemoteCursor>>({});
  const lastSentAt = useRef(0);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const idRef = useRef<string>('');
  const nameRef = useRef<string>('');

  useEffect(() => {
    if (!enabled) return;
    if (!supabase) return;

    const id = selfId || getOrCreateAnonId();
    const name = selfName || 'Anonymous';
    idRef.current = id;
    nameRef.current = name;

    const color = colorFor(id);
    const channel = supabase.channel(channelName, {
      config: { broadcast: { self: false } },
    });
    channelRef.current = channel;

    channel.on('broadcast', { event: 'cursor' }, ({ payload }) => {
      const p = payload as { id: string; name: string; color: string; x: number; y: number };
      if (p.id === id) return;
      setCursors(prev => ({
        ...prev,
        [p.id]: { ...p, lastSeen: Date.now() },
      }));
    });

    channel.on('broadcast', { event: 'leave' }, ({ payload }) => {
      const p = payload as { id: string };
      setCursors(prev => {
        if (!prev[p.id]) return prev;
        const { [p.id]: _, ...rest } = prev;
        return rest;
      });
    });

    channel.subscribe();

    const handleMove = (e: MouseEvent) => {
      const now = Date.now();
      if (now - lastSentAt.current < 30) return;
      lastSentAt.current = now;
      channel.send({
        type: 'broadcast',
        event: 'cursor',
        payload: { id, name, color, x: e.clientX, y: e.clientY },
      });
    };

    const handleLeave = () => {
      channel.send({ type: 'broadcast', event: 'leave', payload: { id } });
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('beforeunload', handleLeave);

    // Prune stale cursors (user left without firing leave).
    const prune = window.setInterval(() => {
      setCursors(prev => {
        const now = Date.now();
        let changed = false;
        const next: Record<string, RemoteCursor> = {};
        for (const [k, v] of Object.entries(prev)) {
          if (now - v.lastSeen < 6000) next[k] = v;
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 2000);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('beforeunload', handleLeave);
      window.clearInterval(prune);
      handleLeave();
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [channelName, selfId, selfName, enabled]);

  return Object.values(cursors);
}

// Online presence — a single Supabase Realtime presence channel that
// every signed-in client joins. Each client tracks its own user_id and
// (if it has one) its creator handle, so other clients can tell who is
// online right now. The FollowingRail uses this to draw a glowing green
// ring around followed creators / followers who are currently online.
//
// Presence is a built-in Realtime feature — it needs no table or
// publication config. State is a map keyed by the channel presence key
// (we use user_id) → array of tracked metas.

import { supabase } from '~/utils/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface OnlineState {
  /** Lower-cased creator handles currently online. */
  handles: Set<string>;
  /** Auth user ids currently online. */
  userIds: Set<string>;
}

interface PresenceMeta {
  user_id?: string;
  handle?: string | null;
  online_at?: string;
}

type Listener = (state: OnlineState) => void;

const EMPTY: OnlineState = { handles: new Set(), userIds: new Set() };

let channel: RealtimeChannel | null = null;
let started = false;
let current: OnlineState = EMPTY;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) {
    try { l(current); } catch { /* ignore one bad listener */ }
  }
}

function recompute() {
  if (!channel) return;
  const handles = new Set<string>();
  const userIds = new Set<string>();
  // presenceState() → { [presenceKey]: PresenceMeta[] }
  const state = channel.presenceState<PresenceMeta>();
  for (const key of Object.keys(state)) {
    for (const meta of state[key]) {
      if (meta.handle) handles.add(meta.handle.toLowerCase());
      if (meta.user_id) userIds.add(meta.user_id);
    }
  }
  current = { handles, userIds };
  emit();
}

/**
 * Join the presence channel for the signed-in user. Idempotent — calling
 * again while already started is a no-op. Resolves the user's creator
 * handle (best-effort) so followers can see them light up by handle.
 */
export async function startPresence(userId: string): Promise<void> {
  if (started || !supabase) return;
  started = true;

  let handle: string | null = null;
  try {
    const { data } = await supabase
      .from('creators').select('handle').eq('id', userId).maybeSingle();
    handle = (data?.handle as string | null) ?? null;
  } catch { /* shopper without a creator row — track user_id only */ }

  if (!supabase) return;
  channel = supabase.channel('presence:online', {
    config: { presence: { key: userId } },
  });

  channel
    .on('presence', { event: 'sync' }, recompute)
    .on('presence', { event: 'join' }, recompute)
    .on('presence', { event: 'leave' }, recompute)
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        void channel?.track({ user_id: userId, handle, online_at: new Date().toISOString() });
      }
    });
}

/** Leave the presence channel (sign-out / unmount). */
export function stopPresence(): void {
  if (channel && supabase) {
    void supabase.removeChannel(channel);
  }
  channel = null;
  started = false;
  current = EMPTY;
  emit();
}

/**
 * Subscribe to online-state changes. Fires immediately with the current
 * snapshot, then on every join/leave/sync. Returns an unsubscribe fn.
 */
export function subscribeOnline(cb: Listener): () => void {
  listeners.add(cb);
  cb(current);
  return () => { listeners.delete(cb); };
}

export function getOnlineState(): OnlineState {
  return current;
}

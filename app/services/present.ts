// Shared types + helpers for the /present/ live-mirror feature.
//
// All presenter -> viewer traffic flows through a single public
// Supabase Realtime broadcast channel per presenter slug. The viewer
// (/present/:slug) subscribes without auth; the presenter (Robert's
// logged-in session) publishes state changes. Channel names are
// namespaced under "present:" so they're easy to filter in the
// Supabase dashboard.
//
// One broadcast event name ("tick") carries every payload. The
// envelope's `type` field discriminates: heartbeat / route / cursor
// / overlay / etc. Keeping a single event name means we only have
// one broadcast pipe to listen on, and adding a new payload type
// later is purely additive.

import type { RealtimeChannel } from '@supabase/supabase-js';

export type PresentEventType =
  | 'heartbeat' // 1 Hz keep-alive + latency check (Phase 1)
  | 'snapshot'  // full state, periodic + on viewer connect (Phase 9)
  | 'route'     // current pathname/hash (Phase 3)
  | 'scroll'    // viewport-relative scroll % (Phase 4)
  | 'cursor'    // viewport-relative pointer coords (Phase 5)
  | 'click'     // click ripple (Phase 6)
  | 'hover'     // hover indicator (Phase 6)
  | 'overlay'   // look/bookmarks/creator overlay state (Phase 7)
  | 'search';   // search/filter state (Phase 8)

export interface PresentEnvelope<T = unknown> {
  /** Monotonic counter so the viewer can detect dropped/reordered events. */
  seq: number;
  /** ms since epoch on the presenter clock — used for latency + freshness. */
  sentAt: number;
  /** Payload type discriminator. */
  type: PresentEventType;
  /** Event payload; shape depends on `type`. */
  payload: T;
}

export interface HeartbeatPayload {
  /** Wall-clock ms on the presenter when the heartbeat was generated. */
  ts: number;
}

export const PRESENT_CHANNEL_PREFIX = 'present:';

/** The single broadcast event name. Differentiate via `envelope.type`. */
export const PRESENT_EVENT_NAME = 'tick';

/** Build the Realtime channel name for a given presenter slug. */
export function channelNameFor(slug: string): string {
  return `${PRESENT_CHANNEL_PREFIX}${slug}`;
}

export type PresentChannel = RealtimeChannel;

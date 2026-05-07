import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '~/utils/supabase';
import {
  PRESENT_EVENT_NAME,
  channelNameFor,
  type HeartbeatPayload,
  type PresentChannel,
  type PresentEnvelope,
  type PresentEventType,
} from '~/services/present';

interface UsePresentBroadcasterOptions {
  /** Presenter identity slug, e.g. 'robert-burton'. */
  slug: string;
  /** Toggle the broadcast on/off. Stops cleanly when flipped to false. */
  enabled?: boolean;
  /** Heartbeat cadence in ms. 0 disables. Default 1000. */
  heartbeatIntervalMs?: number;
}

export interface PresentBroadcaster {
  /** True once the channel has subscribed successfully. */
  isConnected: boolean;
  /**
   * Send any presenter event. Returns the seq number assigned, or
   * null if the channel isn't connected yet.
   */
  broadcast: <T>(type: PresentEventType, payload: T) => number | null;
}

/**
 * Presenter-side hook. Opens a public Supabase Realtime broadcast
 * channel under `present:<slug>` and lets callers push events into
 * it. Includes a 1 Hz heartbeat by default so viewers can detect
 * liveness and measure latency without the presenter having to do
 * anything.
 *
 * Subsequent phases call `broadcast(type, payload)` from their own
 * effects (route changes, pointer moves, overlay opens, etc.).
 */
export function usePresentBroadcaster({
  slug,
  enabled = true,
  heartbeatIntervalMs = 1000,
}: UsePresentBroadcasterOptions): PresentBroadcaster {
  const [isConnected, setIsConnected] = useState(false);
  const channelRef = useRef<PresentChannel | null>(null);
  const seqRef = useRef(0);

  // Keep `broadcast` stable across renders so callers can pass it
  // into useEffect deps without retriggering setup.
  const broadcast = useCallback(<T,>(
    type: PresentEventType,
    payload: T,
  ): number | null => {
    const channel = channelRef.current;
    if (!channel) return null;
    const seq = ++seqRef.current;
    const envelope: PresentEnvelope<T> = {
      seq,
      sentAt: Date.now(),
      type,
      payload,
    };
    channel.send({ type: 'broadcast', event: PRESENT_EVENT_NAME, payload: envelope });
    return seq;
  }, []);

  useEffect(() => {
    if (!enabled || !slug) {
      setIsConnected(false);
      return;
    }
    if (typeof window === 'undefined') return;

    const channelName = channelNameFor(slug);
    // self: false — the presenter doesn't need to receive its own
    // broadcasts, and self-echoes would inflate seq counters on the
    // wrong side.
    const channel = supabase.channel(channelName, {
      config: { broadcast: { self: false } },
    });
    channelRef.current = channel;

    channel.subscribe(status => {
      setIsConnected(status === 'SUBSCRIBED');
    });

    let heartbeatId: number | null = null;
    if (heartbeatIntervalMs > 0) {
      heartbeatId = window.setInterval(() => {
        const ts = Date.now();
        const env: PresentEnvelope<HeartbeatPayload> = {
          seq: ++seqRef.current,
          sentAt: ts,
          type: 'heartbeat',
          payload: { ts },
        };
        channel.send({ type: 'broadcast', event: PRESENT_EVENT_NAME, payload: env });
      }, heartbeatIntervalMs);
    }

    return () => {
      if (heartbeatId !== null) window.clearInterval(heartbeatId);
      supabase.removeChannel(channel);
      channelRef.current = null;
      setIsConnected(false);
    };
  }, [slug, enabled, heartbeatIntervalMs]);

  return { isConnected, broadcast };
}

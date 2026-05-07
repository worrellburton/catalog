import { useEffect, useRef, useState } from 'react';
import { supabase } from '~/utils/supabase';
import {
  PRESENT_EVENT_NAME,
  channelNameFor,
  type HeartbeatPayload,
  type PresentChannel,
  type PresentEnvelope,
} from '~/services/present';

interface UsePresentSubscriptionOptions {
  /** Presenter identity slug to follow. */
  slug: string;
  /** Toggle the subscription on/off. */
  enabled?: boolean;
  /**
   * Optional callback invoked for every received envelope. Use this
   * to wire payloads into route / scroll / overlay reducers in later
   * phases. Stable identity is not required — the hook reads the
   * latest ref each event.
   */
  onEnvelope?: (envelope: PresentEnvelope) => void;
}

export type PresentConnectionState =
  | 'idle'         // hook disabled or not yet mounted
  | 'connecting'   // channel.subscribe() in flight
  | 'connected'    // SUBSCRIBED received
  | 'disconnected' // channel closed / errored
  ;

export interface PresentSubscription {
  connection: PresentConnectionState;
  /** Most recent envelope received, if any. */
  latest: PresentEnvelope | null;
  /**
   * Approximate one-way latency presenter -> viewer in ms, refreshed
   * on each heartbeat. Assumes clocks are roughly aligned (NTP-grade
   * is fine for a demo HUD).
   */
  latencyMs: number | null;
  /** Total events received since mount. Useful for the debug HUD. */
  eventsReceived: number;
}

/**
 * Viewer-side subscription. Connects without auth (Supabase Realtime
 * channels accept anonymous subscribers under the anon key).
 *
 * The hook is intentionally minimal — it doesn't reconstruct full
 * state. Callers (the /present/ route in Phase 2+) wire `onEnvelope`
 * up to their own reducers per payload type.
 */
export function usePresentSubscription({
  slug,
  enabled = true,
  onEnvelope,
}: UsePresentSubscriptionOptions): PresentSubscription {
  const [connection, setConnection] = useState<PresentConnectionState>('idle');
  const [latest, setLatest] = useState<PresentEnvelope | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [eventsReceived, setEventsReceived] = useState(0);

  // Latest onEnvelope ref — lets callers swap callbacks without
  // re-subscribing the channel.
  const onEnvelopeRef = useRef(onEnvelope);
  useEffect(() => {
    onEnvelopeRef.current = onEnvelope;
  }, [onEnvelope]);

  useEffect(() => {
    if (!enabled || !slug) {
      setConnection('idle');
      return;
    }
    if (typeof window === 'undefined') return;

    setConnection('connecting');
    const channelName = channelNameFor(slug);
    const channel: PresentChannel = supabase.channel(channelName, {
      config: { broadcast: { self: false } },
    });

    channel.on('broadcast', { event: PRESENT_EVENT_NAME }, ({ payload }) => {
      const env = payload as PresentEnvelope;
      setLatest(env);
      setEventsReceived(n => n + 1);
      onEnvelopeRef.current?.(env);
      if (env.type === 'heartbeat') {
        const hb = env.payload as HeartbeatPayload;
        setLatencyMs(Math.max(0, Date.now() - hb.ts));
      }
    });

    channel.subscribe(status => {
      if (status === 'SUBSCRIBED') {
        setConnection('connected');
      } else if (
        status === 'CHANNEL_ERROR' ||
        status === 'CLOSED' ||
        status === 'TIMED_OUT'
      ) {
        setConnection('disconnected');
      }
    });

    return () => {
      supabase.removeChannel(channel);
      setConnection('idle');
    };
  }, [slug, enabled]);

  return { connection, latest, latencyMs, eventsReceived };
}

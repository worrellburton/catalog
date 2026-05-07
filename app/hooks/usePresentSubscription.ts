import { useEffect, useRef, useState } from 'react';
import { SUPABASE_ANON_KEY, supabase } from '~/utils/supabase';
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

    let cancelled = false;
    let currentChannel: PresentChannel | null = null;
    let retryTimer: number | null = null;
    let attempt = 0;

    // Force the Realtime client onto the anon key before opening any
    // channel. /present/ pages have no Supabase session, so without
    // this the JWT can stay null and the channel sits in CHANNEL_JOIN
    // forever (no SUBSCRIBED, no error — just stuck at "connecting").
    try {
      supabase.realtime.setAuth(SUPABASE_ANON_KEY);
    } catch (err) {
      console.warn('[present] realtime.setAuth failed:', err);
    }

    const subscribe = () => {
      if (cancelled) return;
      setConnection('connecting');
      const channelName = channelNameFor(slug);
      console.info('[present] subscribing to', channelName);
      const channel: PresentChannel = supabase.channel(channelName, {
        config: { broadcast: { self: false } },
      });
      currentChannel = channel;

      channel.on('broadcast', { event: PRESENT_EVENT_NAME }, ({ payload }) => {
        const env = payload as PresentEnvelope;
        setLatest(env);
        setEventsReceived(n => n + 1);
        // Receiving any event is proof the channel is live. supabase-js
        // sometimes never fires the SUBSCRIBED callback when two
        // channels share a name on one client (this page opens both a
        // broadcaster and a subscriber to send + receive cursor data),
        // leaving the pill stuck at "connecting" even while messages
        // flow. Promote on the first event so the UI tells the truth.
        setConnection(c => (c === 'connected' ? c : 'connected'));
        onEnvelopeRef.current?.(env);
        if (env.type === 'heartbeat') {
          const hb = env.payload as HeartbeatPayload;
          setLatencyMs(Math.max(0, Date.now() - hb.ts));
        }
      });

      channel.subscribe((status, err) => {
        if (cancelled) return;
        // Loud log so we can read it from the browser console while
        // diagnosing stuck-connecting. Strip once stable.
        console.info('[present] channel status:', status, err ?? '');
        if (status === 'SUBSCRIBED') {
          setConnection('connected');
          attempt = 0; // reset backoff on a successful connect
        } else if (
          status === 'CHANNEL_ERROR' ||
          status === 'CLOSED' ||
          status === 'TIMED_OUT'
        ) {
          setConnection('disconnected');
          // Exponential backoff capped at 8 s. Realtime's underlying
          // socket auto-reconnects, but the channel binding can stay
          // dead — recreating it forces a clean re-subscribe.
          const wait = Math.min(8000, 500 * Math.pow(2, attempt));
          attempt += 1;
          if (currentChannel) {
            supabase.removeChannel(currentChannel);
            currentChannel = null;
          }
          retryTimer = window.setTimeout(subscribe, wait);
        }
      });
    };

    subscribe();

    return () => {
      cancelled = true;
      if (retryTimer != null) window.clearTimeout(retryTimer);
      if (currentChannel) {
        supabase.removeChannel(currentChannel);
        currentChannel = null;
      }
      setConnection('idle');
    };
  }, [slug, enabled]);

  return { connection, latest, latencyMs, eventsReceived };
}

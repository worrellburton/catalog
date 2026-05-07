import { useCallback, useEffect, useRef, useState } from 'react';
import { SUPABASE_ANON_KEY, supabase } from '~/utils/supabase';
import {
  PRESENT_EVENT_NAME,
  channelNameFor,
  type HeartbeatPayload,
  type PresentChannel,
  type PresentEnvelope,
  type PresentEventType,
} from '~/services/present';

interface UsePresentChannelOptions {
  /** Presenter slug, e.g. 'robert-burton'. */
  slug: string;
  /** Toggle the connection on/off. */
  enabled?: boolean;
  /**
   * Heartbeat cadence in ms. Set 0 to disable (e.g. on the viewer
   * side, where the presenter already drives the heartbeat). The
   * presenter side defaults to 1000.
   */
  heartbeatIntervalMs?: number;
  /** Called for every received envelope (cursor, click, route, etc.). */
  onEnvelope?: (env: PresentEnvelope) => void;
}

export type PresentConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected';

export interface PresentChannelHandle {
  connection: PresentConnectionState;
  /** Convenience: connection === 'connected'. */
  isConnected: boolean;
  /** Most recent envelope received from any peer. */
  latest: PresentEnvelope | null;
  /** Estimated one-way latency in ms, refreshed on each heartbeat. */
  latencyMs: number | null;
  /** Total envelopes received since mount. */
  eventsReceived: number;
  /**
   * Send an envelope on the same channel. Returns the seq number
   * assigned, or null if the channel isn't open yet.
   */
  broadcast: <T>(type: PresentEventType, payload: T) => number | null;
}

/**
 * Single-channel hook that handles both broadcasting and receiving
 * over one Supabase Realtime channel. Replaces the previous split
 * usePresentBroadcaster + usePresentSubscription pair, which opened
 * two channels with the same name on the same client — supabase-js
 * silently dedupes them, so the second `.subscribe()` callback would
 * never fire SUBSCRIBED and the UI got stuck at "Connecting" even
 * though messages flowed normally.
 *
 * Both presenter and guest viewer call this same hook. They differ
 * only in whether they emit a heartbeat (presenter does, viewer
 * does not). Outbound goes via the returned broadcast(); inbound is
 * delivered via onEnvelope.
 */
export function usePresentChannel({
  slug,
  enabled = true,
  heartbeatIntervalMs = 1000,
  onEnvelope,
}: UsePresentChannelOptions): PresentChannelHandle {
  const [connection, setConnection] = useState<PresentConnectionState>('idle');
  const [latest, setLatest] = useState<PresentEnvelope | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [eventsReceived, setEventsReceived] = useState(0);
  const channelRef = useRef<PresentChannel | null>(null);
  const seqRef = useRef(0);

  // Stable onEnvelope ref — caller can swap closures without
  // forcing a channel re-subscribe.
  const onEnvelopeRef = useRef(onEnvelope);
  useEffect(() => {
    onEnvelopeRef.current = onEnvelope;
  }, [onEnvelope]);

  // Stable broadcast fn. channelRef.current may be null until the
  // first SUBSCRIBED status — the call returns null in that case.
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
      setConnection('idle');
      return;
    }
    if (typeof window === 'undefined') return;

    // Pin the Realtime client to the anon key. /present/ pages have
    // no session, so without this the underlying JWT can stay null
    // and the channel sits in CHANNEL_JOIN forever.
    try {
      supabase.realtime.setAuth(SUPABASE_ANON_KEY);
    } catch (err) {
      console.warn('[present] realtime.setAuth failed:', err);
    }

    let cancelled = false;
    let currentChannel: PresentChannel | null = null;
    let retryTimer: number | null = null;
    let heartbeatTimer: number | null = null;
    let attempt = 0;

    const subscribe = () => {
      if (cancelled) return;
      setConnection('connecting');
      const channelName = channelNameFor(slug);
      console.info('[present] opening', channelName);
      const channel: PresentChannel = supabase.channel(channelName, {
        config: { broadcast: { self: false } },
      });
      currentChannel = channel;
      channelRef.current = channel;

      channel.on('broadcast', { event: PRESENT_EVENT_NAME }, ({ payload }) => {
        const env = payload as PresentEnvelope;
        setLatest(env);
        setEventsReceived(n => n + 1);
        // Receiving any event is proof the channel is live, so
        // promote eagerly even if SUBSCRIBED hasn't fired yet.
        setConnection(c => (c === 'connected' ? c : 'connected'));
        onEnvelopeRef.current?.(env);
        if (env.type === 'heartbeat') {
          const hb = env.payload as HeartbeatPayload;
          setLatencyMs(Math.max(0, Date.now() - hb.ts));
        }
      });

      channel.subscribe((status, err) => {
        if (cancelled) return;
        console.info('[present] channel status:', status, err ?? '');
        if (status === 'SUBSCRIBED') {
          setConnection('connected');
          attempt = 0;
        } else if (
          status === 'CHANNEL_ERROR' ||
          status === 'CLOSED' ||
          status === 'TIMED_OUT'
        ) {
          setConnection('disconnected');
          // Exponential backoff capped at 8 s. The Realtime socket
          // auto-reconnects, but the channel binding can stay dead —
          // recreating it forces a clean re-subscribe.
          const wait = Math.min(8000, 500 * Math.pow(2, attempt));
          attempt += 1;
          if (currentChannel) {
            supabase.removeChannel(currentChannel);
            currentChannel = null;
            channelRef.current = null;
          }
          retryTimer = window.setTimeout(subscribe, wait);
        }
      });
    };

    subscribe();

    if (heartbeatIntervalMs > 0) {
      heartbeatTimer = window.setInterval(() => {
        const channel = channelRef.current;
        if (!channel) return;
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
      cancelled = true;
      if (retryTimer != null) window.clearTimeout(retryTimer);
      if (heartbeatTimer != null) window.clearInterval(heartbeatTimer);
      if (currentChannel) {
        supabase.removeChannel(currentChannel);
        currentChannel = null;
      }
      channelRef.current = null;
      setConnection('idle');
    };
  }, [slug, enabled, heartbeatIntervalMs]);

  return {
    connection,
    isConnected: connection === 'connected',
    latest,
    latencyMs,
    eventsReceived,
    broadcast,
  };
}

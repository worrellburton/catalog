import { useLocation } from '@remix-run/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePresentBroadcaster } from '~/hooks/usePresentBroadcaster';
import { usePresentSubscription } from '~/hooks/usePresentSubscription';
import { usePresentCursorBroadcast } from '~/hooks/usePresentCursorBroadcast';
import { usePresentCursors } from '~/hooks/usePresentCursors';
import { usePresentInteractionBroadcast } from '~/hooks/usePresentInteractionBroadcast';
import PresentClickRipples, { useClickRipples } from '~/components/PresentClickRipples';
import PresentRemoteCursors from '~/components/PresentRemoteCursors';
import {
  PRESENT_EMIT_EVENT,
  colorForId,
  defaultGuestName,
  getOrCreatePresentId,
  isBroadcastableRoute,
  readPresentName,
  readPresentSlug,
  type BrowserStatePayload,
  type ClickPayload,
  type OverlayPayload,
  type PresentEventType,
  type RoutePayload,
  type ScrollPayload,
  type SearchPayload,
  type SnapshotPayload,
} from '~/services/present';

/*
 * Root-level mount that turns the running consumer session into a
 * presenter. When localStorage('present:slug') is set, this component
 * opens the broadcast channel and pushes presenter events. Cleared =
 * idle, zero overhead, no WebSocket open.
 *
 * Wired into app/root.tsx so it sees every navigation and sits above
 * all routes. The consumer feed never has to know about it.
 *
 * Phase 3: route events on every nav.
 * Phase 4: throttled scroll events.
 * Phase 5: bidirectional cursors — Robert broadcasts his pointer and
 *          subscribes back to see guest viewers on /present/<slug>.
 *          Both renderings share the same channel.
 */
export default function PresentProvider() {
  const slug = useActivePresentSlug();
  const location = useLocation();
  const enabled = !!slug;

  // ── Identity ───────────────────────────────────────────────────
  // ID is stable per tab (sessionStorage). Name is pulled from a
  // user-controlled localStorage key, falling back to "Robert" for
  // the presenter (since this provider only runs in the broadcasting
  // session) so guests see a recognizable label out of the box.
  const id = useMemo(() => getOrCreatePresentId(), []);
  const presenterName = useMemo(() => readPresentName() ?? 'Robert', []);
  const color = useMemo(() => colorForId(id), [id]);

  const { broadcast, isConnected } = usePresentBroadcaster({
    slug: slug ?? '',
    enabled,
  });

  // Inbound subscription: also listen for guest cursors so we can
  // render them on Robert's screen alongside his own cursor, plus
  // their clicks so guest taps bloom over Robert's view.
  const { ingest: ingestCursor, cursors } = usePresentCursors({
    selfId: id,
    enabled,
  });
  const { ripples, pushClick } = useClickRipples();
  usePresentSubscription({
    slug: slug ?? '',
    enabled,
    onEnvelope: (env) => {
      ingestCursor(env);
      if (env.type === 'click') {
        pushClick(env.payload as ClickPayload);
      }
    },
  });

  // Outbound cursor broadcasting at ~30 Hz.
  usePresentCursorBroadcast({
    broadcast,
    isConnected,
    id,
    name: presenterName,
    color,
    role: 'presenter',
    enabled,
  });

  // Click + hover broadcasting (Phase 6).
  usePresentInteractionBroadcast({
    broadcast,
    isConnected,
    id,
    color,
    enabled,
  });

  // Broadcast route changes whenever the channel is connected.
  // isBroadcastableRoute() blocks /admin/* and /present/* so private
  // tooling and the viewer page itself never echo into the mirror.
  useEffect(() => {
    if (!enabled || !isConnected) return;
    if (!isBroadcastableRoute(location.pathname)) return;
    const payload: RoutePayload = {
      pathname: location.pathname,
      hash: location.hash || '',
      search: location.search || '',
    };
    broadcast('route', payload);
  }, [enabled, isConnected, location.pathname, location.hash, location.search, broadcast]);

  // Scroll capture: scroll events do not bubble, so we listen with
  // the capture phase on window to catch scroll on every container
  // the consumer feed uses (#grid-viewport, look overlays, deck
  // slides, etc.). Throttled to ~50 ms / 20 Hz so the wire stays
  // light even during fast flick-scrolls. Skipped entirely when on
  // private routes.
  const lastScrollSentRef = useRef(0);
  const lastScrollKeyRef = useRef('');
  useEffect(() => {
    if (!enabled || !isConnected) return;
    if (!isBroadcastableRoute(location.pathname)) return;

    const handleScroll = (e: Event) => {
      const target = e.target as Element | Document | null;
      if (!target) return;

      let element: Element;
      let selector: string;
      if (target instanceof Document) {
        element = target.documentElement;
        selector = 'window';
      } else if (target instanceof Element) {
        element = target;
        selector = target.id ? `#${target.id}` : target.tagName.toLowerCase();
      } else {
        return;
      }

      const now = performance.now();
      const key = selector;
      const sameTarget = key === lastScrollKeyRef.current;
      if (sameTarget && now - lastScrollSentRef.current < 50) return;
      lastScrollSentRef.current = now;
      lastScrollKeyRef.current = key;

      const scrollTop = element.scrollTop;
      const scrollHeight = element.scrollHeight;
      const clientHeight = element.clientHeight;
      const denom = Math.max(1, scrollHeight - clientHeight);
      const ratio = Math.max(0, Math.min(1, scrollTop / denom));

      const payload: ScrollPayload = {
        selector,
        scrollTop,
        scrollHeight,
        clientHeight,
        ratio,
      };
      broadcast('scroll', payload);
    };

    window.addEventListener('scroll', handleScroll, { capture: true, passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll, { capture: true });
    };
  }, [enabled, isConnected, location.pathname, broadcast]);

  // Snapshot accumulator — latest of each stateful payload type,
  // refreshed by every emit. Periodic broadcasts of this aggregate
  // let viewers catch up without an explicit request/response
  // protocol.
  const snapshotRef = useRef<SnapshotPayload>({});

  // Bridge: consumer routes dispatch 'present:emit' CustomEvents;
  // we forward them to broadcast() when connected. This lets _index
  // and other consumer surfaces push overlay/search/etc. payloads
  // without holding a reference to the broadcast channel.
  useEffect(() => {
    if (!enabled || !isConnected) return;
    if (typeof window === 'undefined') return;

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { type: PresentEventType; payload: unknown }
        | undefined;
      if (!detail) return;
      if (!isBroadcastableRoute(location.pathname)) return;
      // Update the snapshot accumulator before forwarding so
      // late-fired snapshot timers always carry the latest values.
      snapshotRef.current = mergeIntoSnapshot(
        snapshotRef.current,
        detail.type,
        detail.payload,
      );
      broadcast(detail.type, detail.payload);
    };

    window.addEventListener(PRESENT_EMIT_EVENT, handler);
    return () => window.removeEventListener(PRESENT_EMIT_EVENT, handler);
  }, [enabled, isConnected, location.pathname, broadcast]);

  // Mirror route changes into the snapshot too (route is broadcast
  // directly by this provider, not via emitPresentEvent).
  useEffect(() => {
    if (!isBroadcastableRoute(location.pathname)) return;
    snapshotRef.current = {
      ...snapshotRef.current,
      route: {
        pathname: location.pathname,
        hash: location.hash || '',
        search: location.search || '',
      },
    };
  }, [location.pathname, location.hash, location.search]);

  // Periodic snapshot broadcast — every 3 s while connected. Sends
  // the latest of every stateful sub-payload so a viewer that
  // joins mid-session catches up within ~1 frame of arrival
  // without an explicit request.
  useEffect(() => {
    if (!enabled || !isConnected) return;
    const id = window.setInterval(() => {
      const snap: SnapshotPayload = snapshotRef.current;
      // Skip empty snapshots (haven't emitted anything yet) so
      // viewers don't see a confusing "snapshot received but no
      // route yet" state.
      if (!snap.route && !snap.overlay && !snap.search && !snap.browser) {
        return;
      }
      broadcast('snapshot', snap);
    }, 3000);
    return () => window.clearInterval(id);
  }, [enabled, isConnected, broadcast]);

  // Render guest cursors + click ripples on Robert's screen.
  // Hidden when broadcast is off so the consumer app stays
  // untouched for normal use.
  if (!enabled) return null;
  return (
    <>
      <PresentRemoteCursors cursors={cursors} />
      <PresentClickRipples ripples={ripples} />
    </>
  );
}

/**
 * Subscribe to the active presenter slug stored in localStorage.
 * Updates whenever a 'present:slug-changed' event fires (same tab)
 * or a 'storage' event fires (cross-tab).
 */
function useActivePresentSlug(): string | null {
  const [slug, setSlug] = useState<string | null>(() => readPresentSlug());

  useEffect(() => {
    const refresh = () => setSlug(readPresentSlug());
    const onCustom = () => refresh();
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'present:slug') refresh();
    };
    window.addEventListener('present:slug-changed', onCustom);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('present:slug-changed', onCustom);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return slug;
}

function mergeIntoSnapshot(
  prev: SnapshotPayload,
  type: PresentEventType,
  payload: unknown,
): SnapshotPayload {
  switch (type) {
    case 'overlay':
      return { ...prev, overlay: payload as OverlayPayload };
    case 'search':
      return { ...prev, search: payload as SearchPayload };
    case 'browser':
      return { ...prev, browser: payload as BrowserStatePayload };
    case 'scroll': {
      const sp = payload as ScrollPayload;
      const prevScroll = prev.scroll ?? [];
      const filtered = prevScroll.filter(s => s.selector !== sp.selector);
      return { ...prev, scroll: [...filtered, sp] };
    }
    default:
      // route is captured directly from useLocation in the provider
      // (separately). Cursor / click / hover / heartbeat are
      // ephemeral and don't belong in a snapshot.
      return prev;
  }
}

// Re-export so callers (Phase 10 user-menu UI) can import it from
// here without having to know about the internal slug-change wiring.
export { defaultGuestName };

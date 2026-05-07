import { useLocation } from '@remix-run/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePresentBroadcaster } from '~/hooks/usePresentBroadcaster';
import { usePresentSubscription } from '~/hooks/usePresentSubscription';
import { usePresentCursorBroadcast } from '~/hooks/usePresentCursorBroadcast';
import { usePresentCursors } from '~/hooks/usePresentCursors';
import PresentRemoteCursors from '~/components/PresentRemoteCursors';
import {
  colorForId,
  defaultGuestName,
  getOrCreatePresentId,
  isBroadcastableRoute,
  readPresentName,
  readPresentSlug,
  type RoutePayload,
  type ScrollPayload,
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
  // render them on Robert's screen alongside his own cursor.
  const { ingest: ingestCursor, cursors } = usePresentCursors({
    selfId: id,
    enabled,
  });
  usePresentSubscription({
    slug: slug ?? '',
    enabled,
    onEnvelope: ingestCursor,
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

  // Render guest cursors on Robert's screen. Hidden when broadcast
  // is off so the consumer app stays untouched for normal use.
  return enabled ? <PresentRemoteCursors cursors={cursors} /> : null;
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

// Re-export so callers (Phase 10 user-menu UI) can import it from
// here without having to know about the internal slug-change wiring.
export { defaultGuestName };

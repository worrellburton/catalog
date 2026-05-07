import { useLocation } from '@remix-run/react';
import { useEffect, useRef, useState } from 'react';
import { usePresentBroadcaster } from '~/hooks/usePresentBroadcaster';
import {
  isBroadcastableRoute,
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
 * Phase 3: emits 'route' events on every navigation (Remix
 * useLocation). Future phases (cursor / overlay / scroll / search)
 * will register additional effects against the same broadcast()
 * function exposed by usePresentBroadcaster.
 */
export default function PresentProvider() {
  const slug = useActivePresentSlug();
  const location = useLocation();
  const enabled = !!slug;

  const { broadcast, isConnected } = usePresentBroadcaster({
    slug: slug ?? '',
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

      // Pull dimensions from documentElement when scrolling the page,
      // or from the element itself otherwise.
      let element: Element;
      let selector: string;
      if (target instanceof Document) {
        element = target.documentElement;
        selector = 'window';
      } else if (target instanceof Element) {
        element = target;
        // Prefer #id (cheap + stable). Fall back to tagName so we at
        // least produce *something* on anonymous scrollers — viewer
        // can decide whether to act on it.
        selector = target.id ? `#${target.id}` : target.tagName.toLowerCase();
      } else {
        return;
      }

      const now = performance.now();
      const key = selector;
      const sameTarget = key === lastScrollKeyRef.current;
      // 50ms throttle per-target. Switching targets resets the
      // window so the first event on a new container fires
      // immediately.
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

  return null;
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

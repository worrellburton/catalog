import { useLocation } from '@remix-run/react';
import { useEffect, useState } from 'react';
import { usePresentBroadcaster } from '~/hooks/usePresentBroadcaster';
import {
  isBroadcastableRoute,
  readPresentSlug,
  type RoutePayload,
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

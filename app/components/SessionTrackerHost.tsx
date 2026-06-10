import { useEffect } from 'react';
import { useAuth } from '~/hooks/useAuth';
import { startSessionTracker } from '~/services/session-tracker';
import { startGuestTracker, stopGuestTracker } from '~/services/guest-tracker';

/**
 * Mounts the activity tracker at the app root so every page (feed,
 * generate, style, admin, etc.) contributes to the active-user numbers.
 *
 * - Signed in → the full session tracker (active/idle time, events).
 * - Signed out (guest) → a lightweight guest heartbeat so admin DAU can
 *   split registered vs unregistered actives.
 *
 * Renders nothing — purely a side-effect host.
 */
export default function SessionTrackerHost() {
  const { user, loading } = useAuth();
  useEffect(() => {
    if (loading) return;
    if (user?.id) {
      stopGuestTracker();
      const tracker = startSessionTracker(user.id);
      return () => tracker.stop();
    }
    // Guest visitor — ping the unregistered-actives heartbeat instead.
    startGuestTracker();
  }, [user?.id, loading]);
  return null;
}

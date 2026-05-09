import { useEffect } from 'react';
import { useAuth } from '~/hooks/useAuth';
import { startSessionTracker } from '~/services/session-tracker';

/**
 * Mounts the session tracker for the authenticated user. Lives at
 * the root so every page (feed, generate, style, admin, etc.)
 * shares the same session row and contributes to active/idle time.
 *
 * Renders nothing — this is purely a side-effect host.
 */
export default function SessionTrackerHost() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user?.id) return;
    const tracker = startSessionTracker(user.id);
    return () => tracker.stop();
  }, [user?.id]);
  return null;
}

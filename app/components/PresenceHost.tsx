import { useEffect } from 'react';
import { useAuth } from '~/hooks/useAuth';
import { startPresence, stopPresence } from '~/services/presence';

/**
 * Joins the online-presence channel for the authenticated user. Lives at
 * the root so a user is marked online no matter which page they're on,
 * and so other clients (e.g. the FollowingRail) can see them. Renders
 * nothing — pure side-effect host.
 */
export default function PresenceHost() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user?.id) return;
    void startPresence(user.id);
    return () => stopPresence();
  }, [user?.id]);
  return null;
}

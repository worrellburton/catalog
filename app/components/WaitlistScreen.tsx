import { useEffect, useState } from 'react';
import CatalogLogo from './CatalogLogo';
import { getWaitlistStatus, joinWaitlist, type WaitlistStatus } from '~/services/waitlist';
import { signOut, type AuthUser } from '~/services/auth';

interface WaitlistScreenProps {
  user: AuthUser;
  onApproved: () => void;
}

export default function WaitlistScreen({ user, onApproved }: WaitlistScreenProps) {
  const [status, setStatus] = useState<WaitlistStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      let s = await getWaitlistStatus(user.id);
      if (!s) s = await joinWaitlist(user);
      if (cancelled) return;
      setStatus(s);
      setLoading(false);
      if (s?.approved) onApproved();
    }

    async function recheck() {
      const s = await getWaitlistStatus(user.id);
      if (cancelled) return;
      if (s) {
        setStatus(s);
        if (s.approved) onApproved();
      }
    }

    load();
    const interval = setInterval(recheck, 30000);
    // Re-check the moment the page comes back to the foreground or
    // gains focus — so a freshly-approved user who refreshes or
    // switches back to the tab is let in immediately, without waiting
    // up to 30s for the next poll.
    const onVisibility = () => { if (!document.hidden) recheck(); };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user.id, onApproved]);

  const handleSignOut = async () => {
    await signOut();
    window.location.reload();
  };

  return (
    <div className="waitlist-screen">
      <div className="waitlist-content">
        <CatalogLogo className="waitlist-logo" />

        {loading ? (
          <p className="waitlist-subtitle">Loading your spot…</p>
        ) : !status ? (
          <>
            <p className="waitlist-subtitle">Something went wrong</p>
            <p className="waitlist-hint">We couldn't check your waitlist status. Try refreshing.</p>
          </>
        ) : (
          <>
            <h1 className="waitlist-title">You're on the list</h1>
            <p className="waitlist-hint">
              We're rolling out Catalog in waves. We'll email or text you
              the moment you're in.
            </p>

            <div className="waitlist-numbers">
              <div className="waitlist-stat">
                <span className="waitlist-stat-label">Your spot</span>
                <span className="waitlist-stat-value">#{status.position}</span>
              </div>
              <div className="waitlist-stat-divider" />
              <div className="waitlist-stat">
                <span className="waitlist-stat-label">Total waiting</span>
                <span className="waitlist-stat-value">{status.total.toLocaleString()}</span>
              </div>
            </div>

            <p className="waitlist-user">
              Signed in as {user.email || user.displayName}
            </p>
          </>
        )}

        <button className="waitlist-signout" onClick={handleSignOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}

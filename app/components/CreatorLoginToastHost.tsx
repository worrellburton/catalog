import { useEffect, useState } from 'react';
import { useAuth } from '~/hooks/useAuth';
import { getEngagementSinceLastCheck } from '~/services/creator-engagement';
import CreatorLoginToast from './CreatorLoginToast';

const SESSION_FLAG_KEY = 'catalog:creator-toast-shown';

interface ToastData {
  impressions: number;
  clicks: number;
  clickouts: number;
  since: string | null;
}

/**
 * Mounts at the root and fires the engagement toast at most once per
 * browser-tab session. Side-effect-only — renders the toast when
 * data is ready and the user is freshly authenticated.
 *
 * "Open Analytics" click dispatches a `catalog:open-wallet-analytics`
 * CustomEvent which _index.tsx listens for; the home page handles
 * the actual navigation + scroll.
 */
export default function CreatorLoginToastHost() {
  const { user, loading } = useAuth();
  const [data, setData] = useState<ToastData | null>(null);

  useEffect(() => {
    if (loading || !user?.id) return;
    if (typeof window === 'undefined') return;
    // Per-tab gate: don't show twice in the same session even if
    // useAuth re-fires after a token refresh.
    try {
      if (sessionStorage.getItem(SESSION_FLAG_KEY) === user.id) return;
    } catch { /* sessionStorage unavailable */ }

    let cancelled = false;
    (async () => {
      const result = await getEngagementSinceLastCheck();
      if (cancelled) return;
      // Only show the toast when there's something to celebrate.
      // Zero impressions = silent (the user doesn't need a "you
      // got 0 impressions" greeting).
      if (result.impressions === 0 && result.clicks === 0 && result.clickouts === 0) {
        try { sessionStorage.setItem(SESSION_FLAG_KEY, user.id); } catch { /* */ }
        return;
      }
      setData({
        impressions: result.impressions,
        clicks:      result.clicks,
        clickouts:   result.clickouts,
        since:       result.since,
      });
      try { sessionStorage.setItem(SESSION_FLAG_KEY, user.id); } catch { /* */ }
    })();
    return () => { cancelled = true; };
  }, [user?.id, loading]);

  if (!data) return null;

  const handleClick = () => {
    try {
      window.dispatchEvent(new CustomEvent('catalog:open-wallet-analytics'));
    } catch { /* */ }
  };

  return (
    <CreatorLoginToast
      impressions={data.impressions}
      clicks={data.clicks}
      clickouts={data.clickouts}
      since={data.since}
      onClick={handleClick}
      onDismiss={() => setData(null)}
    />
  );
}

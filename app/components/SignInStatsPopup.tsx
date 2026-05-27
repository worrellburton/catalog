import { useEffect, useState } from 'react';
import { supabase } from '~/utils/supabase';
import { useAuth } from '~/hooks/useAuth';

interface RecentStats {
  since: string;
  total_impressions: number;
  total_clicks: number;
  total_clickouts: number;
  new_followers: number;
}

const SESSION_FLAG = 'sign-in-stats:shown-this-session';

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7)  return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5)  return `${w}w ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Top-center toast that surfaces analytics deltas since the creator's
 * previous sign-in. Hidden when nothing happened, when there is no
 * previous sign-in on file (first session), or once per browser
 * session (so a tab refresh doesn't replay the toast). Reads via the
 * my_recent_creator_stats RPC, which itself returns nothing for
 * signed-out callers — so this is safe to mount unconditionally.
 */
export default function SignInStatsPopup() {
  const { user, loading } = useAuth();
  const [stats, setStats] = useState<RecentStats | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (loading || !user || !supabase) return;
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(SESSION_FLAG)) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.rpc('my_recent_creator_stats');
      const row = (data as RecentStats[] | null)?.[0];
      if (cancelled || !row) return;
      const total = row.total_impressions + row.total_clicks + row.total_clickouts + row.new_followers;
      if (total === 0) return; // nothing to brag about — skip toast
      setStats(row);
      setOpen(true);
      try { sessionStorage.setItem(SESSION_FLAG, '1'); } catch { /* private mode */ }
    })();
    return () => { cancelled = true; };
  }, [user, loading]);

  // Auto-dismiss after 12s so it doesn't linger.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => setOpen(false), 12_000);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!open || !stats) return null;

  return (
    <div className="signin-stats-popup" role="status" aria-live="polite">
      <div className="signin-stats-head">
        <span className="signin-stats-title">Activity</span>
        <span className="signin-stats-since">since {timeAgo(stats.since)}</span>
        <button
          type="button"
          className="signin-stats-close"
          onClick={() => setOpen(false)}
          aria-label="Dismiss"
        >×</button>
      </div>
      <div className="signin-stats-row">
        {stats.total_impressions > 0 && (
          <Stat label="Views"     value={stats.total_impressions} />
        )}
        {stats.total_clicks > 0 && (
          <Stat label="Taps"      value={stats.total_clicks} />
        )}
        {stats.total_clickouts > 0 && (
          <Stat label="Clickouts" value={stats.total_clickouts} />
        )}
        {stats.new_followers > 0 && (
          <Stat label="Followers" value={stats.new_followers} />
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="signin-stats-stat">
      <span className="signin-stats-value">+{value.toLocaleString()}</span>
      <span className="signin-stats-label">{label}</span>
    </div>
  );
}

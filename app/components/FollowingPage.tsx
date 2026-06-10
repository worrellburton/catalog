import { useEffect, useState } from 'react';
import { getMyFollowingDetailed, type FollowingDetail } from '~/services/follows';
import { subscribeOnline } from '~/services/presence';
import '~/styles/my-looks.css';
import '~/styles/following-page.css';

interface FollowingPageProps {
  /** Open a creator's catalog (their CreatorPage). */
  onOpenCreator: (handle: string) => void;
  onClose: () => void;
}

/** Compact "Xd ago" for last-post / followed-since lines. */
function timeAgo(ms: number): string {
  if (!ms) return '—';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Abbreviate large counts: 1.2k, 12k, 1.1M. */
function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

/**
 * Full-screen "Following" list view — every creator the shopper follows,
 * with engagement stats. Tapping a row opens that creator's catalog.
 * Reuses the matte-black my-looks overlay chrome for the shell.
 */
export default function FollowingPage({ onOpenCreator, onClose }: FollowingPageProps) {
  const [entries, setEntries] = useState<FollowingDetail[] | null>(null);
  const [online, setOnline] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await getMyFollowingDetailed();
      if (!cancelled) setEntries(list);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => subscribeOnline((s) => setOnline(s.handles)), []);

  const ready = entries !== null;
  const count = entries?.length ?? 0;

  return (
    <div className="my-looks-overlay following-page-overlay">
      <div className="my-looks-container following-page-container">
        <div className="my-looks-header">
          <div className="my-looks-header-left">
            <button className="my-looks-back" onClick={onClose} aria-label="Back">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
            <h1 className="my-looks-title">Following{ready && count > 0 ? ` · ${count}` : ''}</h1>
          </div>
        </div>

        {!ready && (
          <div className="following-empty">Loading creators you follow…</div>
        )}

        {ready && count === 0 && (
          <div className="following-empty">
            You're not following anyone yet. Tap a creator's <strong>Follow</strong> button to
            build your roster — they'll show up here.
          </div>
        )}

        {ready && count > 0 && (
          <ul className="following-list">
            {entries!.map((c) => {
              const isOnline = online.has(c.handle.toLowerCase());
              // A `user:<uuid>` handle is an internal key, not a vanity
              // handle — fall back to a generic label if the name didn't
              // resolve, and never render the raw "@user:uuid" string.
              const isUserHandle = c.handle.startsWith('user:');
              const name = c.displayName || (isUserHandle ? 'Catalog user' : c.handle);
              return (
                <li key={c.handle}>
                  <button
                    type="button"
                    className="following-row"
                    onClick={() => onOpenCreator(c.handle)}
                    aria-label={`Open ${name}'s catalog`}
                  >
                    <span className={`following-avatar${isOnline ? ' is-online' : ''}`}>
                      {c.avatarUrl
                        ? <img src={c.avatarUrl} alt="" loading="lazy" />
                        : <span className="following-avatar-initial">{name.charAt(0).toUpperCase()}</span>}
                      {isOnline && <span className="following-online-dot" title="Online now" aria-hidden="true" />}
                    </span>

                    <span className="following-meta">
                      <span className="following-name">{name}</span>
                      {!isUserHandle && <span className="following-handle">@{c.handle}</span>}
                    </span>

                    <span className="following-stats">
                      <span className="following-stat">
                        <span className="following-stat-num">{compact(c.looksCount)}</span>
                        <span className="following-stat-label">looks</span>
                      </span>
                      <span className="following-stat">
                        <span className="following-stat-num">{compact(c.followerCount)}</span>
                        <span className="following-stat-label">followers</span>
                      </span>
                      <span className="following-stat following-stat--last">
                        <span className="following-stat-num">{timeAgo(c.lastPostTs)}</span>
                        <span className="following-stat-label">last post</span>
                      </span>
                    </span>

                    <svg className="following-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

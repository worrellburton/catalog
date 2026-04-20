import { useEffect, useMemo, useState } from 'react';

// Editorial changelog. Pulls the latest commits to main from the public
// GitHub API and renders them as release notes — no commit chrome.
//
// Authoring guidance: write commit subjects as headlines and bodies as
// short prose paragraphs. They land on this page verbatim.

const REPO = 'worrellburton/catalog';
const PAGE_SIZE = 100; // GitHub API per_page max

interface GitHubCommit {
  sha: string;
  html_url: string;
  commit: { message: string; author: { name: string; date: string } };
  author: { login: string; avatar_url: string } | null;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function dateBucket(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const today = startOfDay(now);
  const yesterday = today - 86_400_000;
  const weekAgo = today - 7 * 86_400_000;
  const day = startOfDay(d);
  if (day === today) return 'Today';
  if (day === yesterday) return 'Yesterday';
  if (day > weekAgo) return 'This week';
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString('en-US', { month: 'long' });
  }
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function stripPrefix(subject: string): string {
  const m = subject.match(/^(feat|fix|perf|refactor|docs|chore|ci|merge)(\(.*?\))?:\s*(.+)$/i);
  return (m ? m[3] : subject).trim();
}

function isMergeNoise(message: string): boolean {
  // Drop merge commits whose body is just the auto-generated subject — they
  // duplicate the actual feature commit they merged in.
  const subject = message.split('\n')[0];
  return /^merge:/i.test(subject);
}

export default function AdminWhatsNew() {
  const [commits, setCommits] = useState<GitHubCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const fetchPage = async (pageNum: number) => {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/commits?sha=main&per_page=${PAGE_SIZE}&page=${pageNum}`,
      { headers: { Accept: 'application/vnd.github+json' } },
    );
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const data: GitHubCommit[] = await res.json();
    return data;
  };

  useEffect(() => {
    (async () => {
      try {
        const data = await fetchPage(1);
        setCommits(data);
        setHasMore(data.length === PAGE_SIZE);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const next = page + 1;
      const data = await fetchPage(next);
      setCommits(prev => [...prev, ...data]);
      setPage(next);
      setHasMore(data.length === PAGE_SIZE);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };

  const entries = useMemo(
    () => commits.filter(c => !isMergeNoise(c.commit.message)),
    [commits],
  );

  const grouped = useMemo(() => {
    const out: { bucket: string; items: GitHubCommit[] }[] = [];
    for (const c of entries) {
      const b = dateBucket(c.commit.author.date);
      const last = out[out.length - 1];
      if (last && last.bucket === b) last.items.push(c);
      else out.push({ bucket: b, items: [c] });
    }
    return out;
  }, [entries]);

  return (
    <div
      className="admin-page"
      style={{
        maxWidth: 760,
        margin: '0 auto',
        padding: '64px 32px 96px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", system-ui, sans-serif',
        color: '#0a0a0a',
      }}
    >
      {/* Hero */}
      <header style={{ marginBottom: 48 }}>
        <h1 style={{
          fontSize: 56,
          fontWeight: 700,
          letterSpacing: '-0.025em',
          lineHeight: 1.05,
          margin: 0,
        }}>
          What's New
        </h1>
        <p style={{
          marginTop: 12,
          fontSize: 18,
          color: '#6e6e73',
          letterSpacing: '-0.01em',
        }}>
          A running log of every change shipped to Catalog.
        </p>
      </header>

      {loading && (
        <div style={{ color: '#6e6e73', fontSize: 15 }}>Loading…</div>
      )}
      {error && (
        <div style={{ color: '#c0392b', fontSize: 15 }}>
          Couldn't load changelog: {error}
        </div>
      )}

      {!loading && !error && grouped.map(group => (
        <section key={group.bucket} style={{ marginBottom: 56 }}>
          <h2 style={{
            fontSize: 12,
            fontWeight: 600,
            color: '#86868b',
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            margin: '0 0 24px',
          }}>
            {group.bucket}
          </h2>
          <div>
            {group.items.map((c, i) => {
              const [subject, ...bodyLines] = c.commit.message.split('\n');
              const headline = stripPrefix(subject);
              const body = bodyLines.join('\n').trim();
              return (
                <article
                  key={c.sha}
                  style={{
                    padding: '32px 0',
                    borderTop: i === 0 ? 'none' : '1px solid #e5e5e7',
                  }}
                >
                  <h3 style={{
                    fontSize: 28,
                    fontWeight: 600,
                    letterSpacing: '-0.02em',
                    lineHeight: 1.18,
                    margin: 0,
                    color: '#0a0a0a',
                  }}>
                    {headline}
                  </h3>
                  {body && (
                    <p style={{
                      marginTop: 14,
                      fontSize: 17,
                      lineHeight: 1.55,
                      color: '#3a3a3c',
                      whiteSpace: 'pre-wrap',
                      letterSpacing: '-0.005em',
                    }}>
                      {body}
                    </p>
                  )}
                  <div style={{
                    marginTop: 18,
                    fontSize: 12,
                    color: '#86868b',
                    letterSpacing: '0.02em',
                    display: 'flex',
                    gap: 14,
                    alignItems: 'center',
                  }}>
                    <span title={new Date(c.commit.author.date).toLocaleString()}>
                      {relativeTime(c.commit.author.date)}
                    </span>
                    <span style={{ color: '#d2d2d7' }}>·</span>
                    <a
                      href={c.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: '#86868b',
                        textDecoration: 'none',
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      }}
                    >
                      {c.sha.slice(0, 7)}
                    </a>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}

      {!loading && !error && entries.length > 0 && (
        <footer style={{ marginTop: 32, paddingTop: 24, borderTop: '1px solid #e5e5e7', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {hasMore ? (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              style={{
                fontSize: 14, fontWeight: 500, color: '#0a0a0a',
                background: 'none', border: '1px solid #d2d2d7',
                borderRadius: 999, padding: '8px 18px', cursor: loadingMore ? 'wait' : 'pointer',
                letterSpacing: '-0.005em',
              }}
            >
              {loadingMore ? 'Loading…' : 'Load older'}
            </button>
          ) : (
            <span style={{ fontSize: 13, color: '#86868b' }}>You've reached the beginning.</span>
          )}
          <a
            href={`https://github.com/${REPO}/commits/main`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 13, color: '#86868b', textDecoration: 'none' }}
          >
            View on GitHub →
          </a>
        </footer>
      )}
    </div>
  );
}

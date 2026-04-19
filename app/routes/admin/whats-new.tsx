import { useEffect, useMemo, useState } from 'react';

// Last N pushes (commits) to main on the public GitHub repo.
// Unauthenticated rate limit is 60/hr per IP — plenty for admin use.

const REPO = 'worrellburton/catalog';
const COMMIT_LIMIT = 20;

interface GitHubCommit {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: { name: string; date: string };
  };
  author: { login: string; avatar_url: string } | null;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function commitTypeStyle(subject: string): { label: string; color: string; bg: string } {
  const m = subject.match(/^(\w+)(\(.*?\))?:/);
  const type = (m?.[1] || '').toLowerCase();
  switch (type) {
    case 'feat':     return { label: 'feat',     color: '#22c55e', bg: '#ecfdf5' };
    case 'fix':      return { label: 'fix',      color: '#ef4444', bg: '#fef2f2' };
    case 'perf':     return { label: 'perf',     color: '#8b5cf6', bg: '#f5f3ff' };
    case 'refactor': return { label: 'refactor', color: '#f59e0b', bg: '#fffbeb' };
    case 'docs':     return { label: 'docs',     color: '#0891b2', bg: '#ecfeff' };
    case 'ci':       return { label: 'ci',       color: '#6366f1', bg: '#eef2ff' };
    case 'chore':    return { label: 'chore',    color: '#64748b', bg: '#f1f5f9' };
    case 'merge':    return { label: 'merge',    color: '#0369a1', bg: '#e0f2fe' };
    default:         return { label: type || 'push', color: '#64748b', bg: '#f1f5f9' };
  }
}

export default function AdminWhatsNew() {
  const [commits, setCommits] = useState<GitHubCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(
          `https://api.github.com/repos/${REPO}/commits?sha=main&per_page=${COMMIT_LIMIT}`,
          { headers: { Accept: 'application/vnd.github+json' } },
        );
        if (!res.ok) throw new Error(`GitHub API ${res.status}`);
        const data = await res.json();
        setCommits(data);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const lastUpdated = useMemo(() => commits[0]?.commit.author.date, [commits]);

  const toggleExpand = (sha: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(sha)) next.delete(sha); else next.add(sha);
      return next;
    });
  };

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1>What's New</h1>
          <p className="admin-page-subtitle">
            Last {COMMIT_LIMIT} pushes to <code>main</code>
            {lastUpdated && ` · updated ${relativeTime(lastUpdated)}`}
          </p>
        </div>
        <a
          href={`https://github.com/${REPO}/commits/main`}
          target="_blank"
          rel="noopener noreferrer"
          className="admin-btn admin-btn-secondary"
          style={{ textDecoration: 'none' }}
        >
          View on GitHub
        </a>
      </div>

      {loading && <div className="admin-empty">Loading commits…</div>}
      {error && (
        <div className="admin-empty" style={{ color: '#ef4444' }}>
          Couldn't load commits: {error}
        </div>
      )}

      {!loading && !error && commits.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {commits.map(c => {
            const [subject, ...bodyLines] = c.commit.message.split('\n');
            const body = bodyLines.join('\n').trim();
            const style = commitTypeStyle(subject);
            const isOpen = expanded.has(c.sha);
            const cleanSubject = subject.replace(/^(\w+)(\(.*?\))?:\s*/, '');

            return (
              <div
                key={c.sha}
                style={{
                  background: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: 8,
                  padding: 14,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      color: style.color,
                      background: style.bg,
                      padding: '3px 8px',
                      borderRadius: 4,
                      flexShrink: 0,
                      marginTop: 1,
                    }}
                  >
                    {style.label}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#111', lineHeight: 1.35 }}>
                      {cleanSubject}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 11, color: '#888', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <a
                        href={c.html_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#6366f1', textDecoration: 'none' }}
                      >
                        {c.sha.slice(0, 7)}
                      </a>
                      <span style={{ color: '#cbd5e1' }}>·</span>
                      <span>{c.author?.login || c.commit.author.name}</span>
                      <span style={{ color: '#cbd5e1' }}>·</span>
                      <span title={new Date(c.commit.author.date).toLocaleString()}>
                        {relativeTime(c.commit.author.date)}
                      </span>
                      {body && (
                        <>
                          <span style={{ color: '#cbd5e1' }}>·</span>
                          <button
                            onClick={() => toggleExpand(c.sha)}
                            style={{
                              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                              fontSize: 11, color: '#3b82f6', fontWeight: 600,
                            }}
                          >
                            {isOpen ? 'Hide details' : 'Show details'}
                          </button>
                        </>
                      )}
                    </div>
                    {isOpen && body && (
                      <pre
                        style={{
                          marginTop: 10,
                          padding: 12,
                          background: '#f8fafc',
                          border: '1px solid #e5e7eb',
                          borderRadius: 6,
                          fontSize: 12,
                          lineHeight: 1.55,
                          color: '#334155',
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        {body}
                      </pre>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

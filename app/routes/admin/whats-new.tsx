import { useEffect, useMemo, useState } from 'react';

// Editorial changelog. Pulls the latest commits to main from the public
// GitHub API and renders them as release notes. Each entry shows a plain-
// English summary; the raw commit body is tucked behind "View details".

const REPO = 'worrellburton/catalog';
const PAGE_SIZE = 100;

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

const PREFIX_LABEL: Record<string, { label: string; color: string }> = {
  feat: { label: 'New', color: '#16a34a' },
  fix: { label: 'Fixed', color: '#dc2626' },
  perf: { label: 'Faster', color: '#2563eb' },
  refactor: { label: 'Cleanup', color: '#7c3aed' },
  docs: { label: 'Docs', color: '#0891b2' },
  chore: { label: 'Chore', color: '#6b7280' },
  ci: { label: 'Build', color: '#6b7280' },
  style: { label: 'Style', color: '#db2777' },
};

function parseSubject(subject: string): { prefix: string | null; text: string } {
  const m = subject.match(/^(feat|fix|perf|refactor|docs|chore|ci|style|merge)(\(.*?\))?:\s*(.+)$/i);
  if (!m) return { prefix: null, text: subject.trim() };
  return { prefix: m[1].toLowerCase(), text: m[3].trim() };
}

function isMergeNoise(message: string): boolean {
  const subject = message.split('\n')[0];
  return /^merge:/i.test(subject);
}

// Best-effort readability pass. Turns a headline into something a
// 6th-grader could follow at a glance: swap jargon for plain words,
// remove code tokens and parenthetical asides, tighten phrasing.
function simplifySummary(text: string): string {
  let out = text;

  // Remove parenthetical technical asides: "(120ms)", "(via X)", etc.
  out = out.replace(/\s*\([^)]*\)/g, '');
  // Remove backtick code: `foo`.
  out = out.replace(/`[^`]+`/g, '');
  // Remove things that look like identifiers: foo(), foo.bar, foo_bar, camelCase with parens.
  out = out.replace(/\b[a-z][A-Za-z0-9]*\([^)]*\)/g, '');
  out = out.replace(/\b[A-Za-z0-9_]+\.[A-Za-z0-9_.]+/g, '');
  // Remove URL / path fragments like /api/foo, ?q=, etc.
  out = out.replace(/\/[A-Za-z0-9_\-\/:.]+/g, '');
  out = out.replace(/\?[A-Za-z0-9_=&]+/g, '');

  // Phrase-level swaps first (longest matches win).
  const phrases: [RegExp, string][] = [
    [/\blive[- ]filters?\b/gi, 'filters in real time'],
    [/\bdouble duty\b/gi, 'two jobs'],
    [/\breplace[sS]tate\b/gi, 'the address bar'],
    [/\bopt into\b/gi, 'use'],
    [/\bclient[- ]side\b/gi, 'in the browser'],
    [/\bserver[- ]side\b/gi, 'on the server'],
    [/\bsource of truth\b/gi, 'main record'],
    [/\bin[- ]place\b/gi, 'right there'],
    [/\bunder the hood\b/gi, 'behind the scenes'],
    [/\brace[- ]conditions?\b/gi, 'timing bugs'],
    [/\bfallback\b/gi, 'backup'],
    [/\bdebounced?\b/gi, 'waits a moment before running'],
    [/\bmemoiz(?:e|ed|es|ing)\b/gi, 'remembers results'],
    [/\bmutat(?:e|ed|es|ing)\b/gi, 'changes'],
    [/\bquery\s*string\b/gi, 'web address'],
    [/\bpayloads?\b/gi, 'data'],
    [/\bendpoints?\b/gi, 'API route'],
  ];
  for (const [re, rep] of phrases) out = out.replace(re, rep);

  // Word-level swaps.
  const words: [RegExp, string][] = [
    [/\bfilters?\b/gi, 'narrows down'],
    [/\bnavigates?\b/gi, 'goes'],
    [/\brenders?\b/gi, 'shows'],
    [/\btriggers?\b/gi, 'starts'],
    [/\bvalidates?\b/gi, 'checks'],
    [/\bfetch(?:es|ed|ing)?\b/gi, 'loads'],
    [/\bpersists?\b/gi, 'saves'],
    [/\bsyncs?\b/gi, 'keeps in step'],
    [/\bsynced\b/gi, 'kept in step'],
    [/\bdispatches?\b/gi, 'sends'],
    [/\binvoke[sd]?\b/gi, 'runs'],
    [/\bexecutes?\b/gi, 'runs'],
    [/\bparams?\b/gi, 'inputs'],
    [/\bparameters?\b/gi, 'inputs'],
    [/\bconfig(?:uration)?\b/gi, 'settings'],
    [/\bUI\b/g, 'screen'],
    [/\bUX\b/g, 'experience'],
    [/\bDB\b/g, 'database'],
    [/\bAPI\b/g, 'system'],
    [/\bCTA\b/g, 'button'],
    [/\bauth\b/gi, 'sign-in'],
  ];
  for (const [re, rep] of words) out = out.replace(re, rep);

  // Collapse whitespace and tidy punctuation.
  out = out.replace(/\s{2,}/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
  // Capitalize first letter.
  if (out.length > 0) out = out[0].toUpperCase() + out.slice(1);
  // Ensure ending punctuation.
  if (out && !/[.!?]$/.test(out)) out += '.';

  return out;
}

function firstSentence(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  const m = flat.match(/^(.*?[.!?])(\s|$)/);
  return (m ? m[1] : flat).trim();
}

type ReportRange = 'week' | 'month' | 'year';
const RANGE_LABEL: Record<ReportRange, string> = {
  week: 'Last week',
  month: 'This month',
  year: 'This year',
};
function rangeCutoff(range: ReportRange): Date {
  const d = new Date();
  if (range === 'week') d.setDate(d.getDate() - 7);
  else if (range === 'month') d.setMonth(d.getMonth() - 1);
  else d.setFullYear(d.getFullYear() - 1);
  return d;
}

// Build a matte-black, white-text PDF (via the browser's print → Save as
// PDF) summarising every shipped update in the chosen window: a headline
// summary then a full ledger. Opens in a new window and triggers print.
function buildAndPrintReport(commits: GitHubCommit[], range: ReportRange) {
  const cutoff = rangeCutoff(range);
  const inRange = commits
    .filter(c => !isMergeNoise(c.commit.message))
    .filter(c => new Date(c.commit.author.date) >= cutoff)
    .sort((a, b) => +new Date(b.commit.author.date) - +new Date(a.commit.author.date));

  // Tally by type for the summary.
  const counts: Record<string, number> = {};
  for (const c of inRange) {
    const { prefix } = parseSubject(c.commit.message.split('\n')[0]);
    const label = (prefix && PREFIX_LABEL[prefix]?.label) || 'Other';
    counts[label] = (counts[label] || 0) + 1;
  }
  const esc = (s: string) => s.replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]!));
  const now = new Date();
  const rangeStr = `${cutoff.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} – ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

  const summaryChips = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([label, n]) => `<div class="chip"><span class="chip-n">${n}</span><span class="chip-l">${esc(label)}</span></div>`)
    .join('');

  const rows = inRange.map(c => {
    const subject = c.commit.message.split('\n')[0];
    const { prefix, text } = parseSubject(subject);
    const tag = prefix ? PREFIX_LABEL[prefix] : null;
    const summary = simplifySummary(firstSentence(text));
    const date = new Date(c.commit.author.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `<tr>
      <td class="d">${date}</td>
      <td>${tag ? `<span class="tag" style="color:${tag.color}">${esc(tag.label)}</span>` : ''}</td>
      <td class="s">${esc(summary)}</td>
      <td class="sha">${esc(c.sha.slice(0, 7))}</td>
    </tr>`;
  }).join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Catalog — What's New (${esc(RANGE_LABEL[range])})</title>
  <style>
    @page { margin: 16mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin: 0; background: #0a0a0a; color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; padding: 32px 36px; }
    .brand { font-size: 13px; letter-spacing: 4px; text-transform: uppercase; color: #8a8a8f; margin-bottom: 4px; }
    h1 { font-size: 30px; margin: 0 0 4px; font-weight: 700; }
    .range { color: #b8b8bd; font-size: 14px; margin-bottom: 24px; }
    .summary { display: flex; gap: 14px; flex-wrap: wrap; margin: 0 0 28px; }
    .chip { background: #161618; border: 1px solid #262629; border-radius: 12px; padding: 14px 18px; min-width: 96px; }
    .chip-n { display: block; font-size: 26px; font-weight: 800; }
    .chip-l { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #9a9aa0; margin-top: 2px; }
    .total { font-size: 15px; color: #e6e6ea; margin-bottom: 20px; }
    .total b { font-size: 17px; }
    h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 2px; color: #8a8a8f; border-top: 1px solid #262629; padding-top: 18px; margin: 8px 0 10px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    td { padding: 8px 8px; border-bottom: 1px solid #1c1c1f; vertical-align: top; }
    td.d { color: #8a8a8f; white-space: nowrap; width: 64px; }
    td.s { color: #ededf2; }
    .tag { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
    td.sha { color: #5a5a60; font-family: ui-monospace, Menlo, monospace; font-size: 11px; text-align: right; white-space: nowrap; }
    .empty { color: #8a8a8f; padding: 30px 0; }
    .foot { margin-top: 26px; color: #5a5a60; font-size: 11px; }
  </style></head>
  <body>
    <div class="brand">Catalog</div>
    <h1>What's New</h1>
    <div class="range">${esc(RANGE_LABEL[range])} · ${esc(rangeStr)}</div>
    <div class="total"><b>${inRange.length}</b> update${inRange.length === 1 ? '' : 's'} shipped in this period.</div>
    <div class="summary">${summaryChips || '<div class="chip"><span class="chip-n">0</span><span class="chip-l">Updates</span></div>'}</div>
    <h2>Ledger</h2>
    ${inRange.length ? `<table><tbody>${rows}</tbody></table>` : '<div class="empty">No updates shipped in this window.</div>'}
    <div class="foot">Generated ${esc(now.toLocaleString())} · catalog.shop</div>
  </body></html>`;

  const w = window.open('', '_blank');
  if (!w) { alert('Pop-up blocked — allow pop-ups to download the report.'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
  // Give the new window a tick to lay out before invoking print.
  w.onload = () => { w.focus(); w.print(); };
  setTimeout(() => { try { w.focus(); w.print(); } catch { /* onload handles it */ } }, 400);
}

export default function AdminWhatsNew() {
  const [commits, setCommits] = useState<GitHubCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [reportRange, setReportRange] = useState<ReportRange>('month');
  const [generatingReport, setGeneratingReport] = useState(false);

  // Build the PDF report: fetch enough commit pages to cover the chosen
  // window (the page only lazy-loads 100 at a time), then hand off to the
  // matte-black print view.
  const generateReport = async () => {
    setGeneratingReport(true);
    try {
      const cutoff = rangeCutoff(reportRange);
      const acc: GitHubCommit[] = [];
      for (let p = 1; p <= 6; p++) {
        let batch: GitHubCommit[];
        try { batch = await fetchPage(p); } catch { break; }
        acc.push(...batch);
        if (batch.length < PAGE_SIZE) break;
        const oldest = batch.length ? new Date(batch[batch.length - 1].commit.author.date) : null;
        if (oldest && oldest < cutoff) break;
      }
      const seen = new Set<string>();
      const merged = [...acc, ...commits].filter(c => (seen.has(c.sha) ? false : (seen.add(c.sha), true)));
      buildAndPrintReport(merged, reportRange);
    } finally {
      setGeneratingReport(false);
    }
  };

  const fetchPage = async (pageNum: number) => {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/commits?sha=main&per_page=${PAGE_SIZE}&page=${pageNum}`,
      { headers: { Accept: 'application/vnd.github+json' } },
    );
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    return (await res.json()) as GitHubCommit[];
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
        padding: '32px 32px 96px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", system-ui, sans-serif',
        color: '#0a0a0a',
      }}
    >
      <div className="admin-page-header" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1>What's New</h1>
            <div className="admin-page-subtitle">
              Plain-English updates from the team. Every change shipped to Catalog.
            </div>
          </div>
          {/* Download a matte-black PDF report for a date range. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <select
              value={reportRange}
              onChange={e => setReportRange(e.target.value as ReportRange)}
              style={{ fontSize: 13, padding: '7px 10px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', color: '#111' }}
            >
              <option value="week">Last week</option>
              <option value="month">This month</option>
              <option value="year">This year</option>
            </select>
            <button
              className="admin-btn admin-btn-primary"
              onClick={generateReport}
              disabled={generatingReport}
              style={{ fontSize: 13, padding: '7px 14px', whiteSpace: 'nowrap' }}
            >
              {generatingReport ? 'Preparing…' : '↓ Download report'}
            </button>
          </div>
        </div>
      </div>

      {loading && (
        <div style={{ color: '#6e6e73', fontSize: 15 }}>Loading…</div>
      )}
      {error && (
        <div style={{ color: '#c0392b', fontSize: 15 }}>
          Couldn't load changelog: {error}
        </div>
      )}

      {!loading && !error && grouped.map(group => (
        <section key={group.bucket} style={{ marginBottom: 32 }}>
          <h2 style={{
            fontSize: 11,
            fontWeight: 600,
            color: '#86868b',
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            margin: '0 0 12px',
          }}>
            {group.bucket}
          </h2>
          <div>
            {group.items.map(c => {
              const [subject, ...bodyLines] = c.commit.message.split('\n');
              const { prefix, text } = parseSubject(subject);
              const body = bodyLines.join('\n').trim();
              const tag = prefix ? PREFIX_LABEL[prefix] : null;

              // Build the 6th-grade summary: prefer a simplified headline,
              // fall back to simplifying the first sentence of the body.
              const headlineSummary = simplifySummary(text);
              const bodySummary = body ? simplifySummary(firstSentence(body)) : '';
              const summary = bodySummary && bodySummary.length > headlineSummary.length + 10
                ? bodySummary
                : headlineSummary;

              const isExpanded = !!expanded[c.sha];

              return (
                <article
                  key={c.sha}
                  style={{
                    padding: '16px 0',
                    borderTop: '1px solid #f0f0f2',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    {tag && (
                      <span style={{
                        flexShrink: 0,
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        padding: '3px 8px',
                        borderRadius: 999,
                        background: `${tag.color}14`,
                        color: tag.color,
                        marginTop: 3,
                      }}>
                        {tag.label}
                      </span>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{
                        fontSize: 16,
                        lineHeight: 1.45,
                        color: '#0a0a0a',
                        margin: 0,
                        letterSpacing: '-0.005em',
                      }}>
                        {summary}
                      </p>
                      <div style={{
                        marginTop: 6,
                        fontSize: 12,
                        color: '#86868b',
                        display: 'flex',
                        gap: 10,
                        alignItems: 'center',
                        flexWrap: 'wrap',
                      }}>
                        <span title={new Date(c.commit.author.date).toLocaleString()}>
                          {relativeTime(c.commit.author.date)}
                        </span>
                        {body && (
                          <>
                            <span style={{ color: '#d2d2d7' }}>·</span>
                            <button
                              onClick={() => setExpanded(e => ({ ...e, [c.sha]: !e[c.sha] }))}
                              style={{
                                background: 'none', border: 'none', padding: 0, margin: 0,
                                color: '#0a66c2', cursor: 'pointer', fontSize: 12,
                                fontFamily: 'inherit',
                              }}
                            >
                              {isExpanded ? 'Hide details' : 'View details'}
                            </button>
                          </>
                        )}
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
                      {isExpanded && body && (
                        <div style={{
                          marginTop: 12,
                          padding: '14px 16px',
                          background: '#f6f6f8',
                          borderRadius: 8,
                          border: '1px solid #ececef',
                        }}>
                          <div style={{
                            fontSize: 10,
                            fontWeight: 600,
                            color: '#86868b',
                            textTransform: 'uppercase',
                            letterSpacing: '0.1em',
                            marginBottom: 8,
                          }}>
                            Technical details
                          </div>
                          <div style={{
                            fontSize: 14,
                            lineHeight: 1.55,
                            color: '#3a3a3c',
                            whiteSpace: 'pre-wrap',
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                          }}>
                            <div style={{ fontWeight: 600, marginBottom: 6, color: '#0a0a0a' }}>
                              {text}
                            </div>
                            {body}
                          </div>
                        </div>
                      )}
                    </div>
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

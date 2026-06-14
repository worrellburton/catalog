// Admin → Live Ledger. The real-time activity stream the dashboard's
// "Live ledger →" points at: every logged search event from
// search_logs, newest first, with full per-event detail (who, what,
// results, gender filter, click-through, exact + relative time). New
// events stream in live over Supabase realtime; filterable by audience
// and free-text. Replaces the old static "Engagement" placeholder.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '~/utils/supabase';

interface LedgerRow {
  id: string;
  query: string;
  user_handle: string | null;
  results_count: number | null;
  clicked: boolean | null;
  filter: string | null;
  created_at: string;
}

type Audience = 'all' | 'named' | 'guests';

const PAGE = 100;
const GUEST_RE = /^user_[a-z0-9]{5,8}$/i;

function classify(handle: string | null): { kind: 'guest' | 'email' | 'named'; label: string } {
  const h = (handle || '').trim();
  if (!h) return { kind: 'guest', label: 'Anonymous' };
  if (GUEST_RE.test(h)) return { kind: 'guest', label: h };
  if (h.includes('@')) return { kind: 'email', label: h };
  return { kind: 'named', label: h };
}

function initials(name: string): string {
  const parts = name.replace(/^user_/, '').split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function LiveLedger() {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [live, setLive] = useState(true);
  const [audience, setAudience] = useState<Audience>('all');
  const [q, setQ] = useState('');
  const [tick, setTick] = useState(0); // re-render so relative times refresh
  const seen = useRef<Set<string>>(new Set());

  const ingest = useCallback((batch: LedgerRow[], mode: 'append' | 'prepend') => {
    setRows(prev => {
      const fresh = batch.filter(r => !seen.current.has(r.id));
      fresh.forEach(r => seen.current.add(r.id));
      if (fresh.length === 0) return prev;
      return mode === 'prepend' ? [...fresh, ...prev] : [...prev, ...fresh];
    });
  }, []);

  const loadPage = useCallback(async (before?: string) => {
    if (!supabase) { setLoading(false); return; }
    let query = supabase
      .from('search_logs')
      .select('id, query, user_handle, results_count, clicked, filter, created_at')
      .order('created_at', { ascending: false })
      .limit(PAGE);
    if (before) query = query.lt('created_at', before);
    const { data } = await query;
    const batch = (data ?? []) as LedgerRow[];
    ingest(batch, 'append');
    setHasMore(batch.length === PAGE);
    setLoading(false);
  }, [ingest]);

  useEffect(() => { void loadPage(); }, [loadPage]);

  // Live: realtime INSERTs prepend instantly; a slow poll backstops it.
  useEffect(() => {
    if (!live || !supabase) return;
    const channel = supabase
      .channel('live-ledger')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'search_logs' },
        payload => ingest([payload.new as LedgerRow], 'prepend'))
      .subscribe();
    const poll = window.setInterval(async () => {
      const newest = rows[0]?.created_at;
      if (!newest || !supabase) return;
      const { data } = await supabase
        .from('search_logs')
        .select('id, query, user_handle, results_count, clicked, filter, created_at')
        .gt('created_at', newest)
        .order('created_at', { ascending: false })
        .limit(PAGE);
      if (data?.length) ingest(data as LedgerRow[], 'prepend');
    }, 15000);
    return () => { supabase?.removeChannel(channel); window.clearInterval(poll); };
  }, [live, ingest, rows]);

  // Refresh relative timestamps every 20s.
  useEffect(() => {
    const t = window.setInterval(() => setTick(n => n + 1), 20000);
    return () => window.clearInterval(t);
  }, []);
  void tick;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(r => {
      const cls = classify(r.user_handle);
      if (audience === 'guests' && cls.kind !== 'guest') return false;
      if (audience === 'named' && cls.kind === 'guest') return false;
      if (needle) {
        return (r.query || '').toLowerCase().includes(needle)
          || (r.user_handle || '').toLowerCase().includes(needle);
      }
      return true;
    });
  }, [rows, audience, q]);

  const distinct = useMemo(() => new Set(rows.map(r => r.user_handle || 'anon')).size, [rows]);

  return (
    <div className="admin-page ledger-page">
      <div className="admin-page-header">
        <h1>
          Live Ledger
          <span className={`ledger-live${live ? ' is-on' : ''}`}>
            <span className="ledger-live-dot" />{live ? 'Live' : 'Paused'}
          </span>
        </h1>
        <p className="admin-page-subtitle">
          Every search event as it happens — {rows.length.toLocaleString()} loaded · {distinct.toLocaleString()} distinct visitors.
        </p>
      </div>

      <div className="ledger-controls">
        <input
          className="ledger-search"
          placeholder="Filter by query or visitor…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        <div className="ledger-seg" role="group" aria-label="Audience">
          {(['all', 'named', 'guests'] as const).map(a => (
            <button key={a} type="button" className={audience === a ? 'is-active' : ''} onClick={() => setAudience(a)}>
              {a === 'all' ? 'Everyone' : a === 'named' ? 'Signed in' : 'Guests'}
            </button>
          ))}
        </div>
        <button type="button" className={`ledger-livebtn${live ? ' is-on' : ''}`} onClick={() => setLive(v => !v)}>
          {live ? '◉ Live' : '▷ Resume'}
        </button>
      </div>

      {loading ? (
        <div className="ledger-empty">Loading the ledger…</div>
      ) : filtered.length === 0 ? (
        <div className="ledger-empty">No events match.</div>
      ) : (
        <ol className="ledger-list">
          {filtered.map(r => {
            const cls = classify(r.user_handle);
            return (
              <li key={r.id} className="ledger-row">
                <span className={`ledger-avatar kind-${cls.kind}`}>{initials(cls.label)}</span>
                <div className="ledger-body">
                  <div className="ledger-line">
                    <strong>{cls.label}</strong>
                    <span className={`ledger-badge kind-${cls.kind}`}>{cls.kind === 'email' ? 'user' : cls.kind}</span>
                    <span className="ledger-verb">searched</span>
                    <span className="ledger-query">&ldquo;{r.query}&rdquo;</span>
                  </div>
                  <div className="ledger-meta">
                    <span className={`ledger-pill${(r.results_count ?? 0) === 0 ? ' is-zero' : ''}`}>
                      {(r.results_count ?? 0).toLocaleString()} result{(r.results_count ?? 0) === 1 ? '' : 's'}
                    </span>
                    {r.filter && r.filter !== 'all' && <span className="ledger-pill">{r.filter}</span>}
                    {r.clicked && <span className="ledger-pill is-click">clicked through</span>}
                    <time dateTime={r.created_at} title={new Date(r.created_at).toLocaleString()}>{timeAgo(r.created_at)}</time>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {hasMore && !loading && (
        <button
          type="button"
          className="ledger-more"
          onClick={() => { const oldest = rows[rows.length - 1]?.created_at; if (oldest) void loadPage(oldest); }}
        >
          Load older
        </button>
      )}
    </div>
  );
}

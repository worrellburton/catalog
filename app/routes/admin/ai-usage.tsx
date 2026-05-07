import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSortableTable, SortableTh } from '~/components/SortableTable';
import { supabase } from '~/utils/supabase';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

// FAL /v1/models/usage — pre-aggregated by endpoint_id in the edge function
interface FalModelUsage {
  endpoint_id: string;
  unit: string;
  quantity: number;
  unit_price: number;
  cost: number;
}

interface FalUsageData {
  [key: string]: unknown;
}

interface ExternalUsage {
  fal: { data: FalModelUsage[] | null; error: string | null };
}

interface AiUsageLog {
  id: string;
  platform: string;
  operation: string;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  units: number | null;
  estimated_cost_usd: number | null;
  status: string;
  error_message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface PlatformStat {
  platform: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  units: number;
  estimatedCost: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Platform Map — static configuration for each platform
// ─────────────────────────────────────────────────────────────────────────────

interface PlatformDef {
  id: string;
  name: string;
  description: string;
  usedFor: string;
  tracked: 'live' | 'dashboard';
  dashboardUrl: string;
  emoji: string;
  costNote: string;
}

const PLATFORMS: PlatformDef[] = [
  {
    id: 'anthropic',
    name: 'Anthropic / Claude',
    description: 'Large language model API',
    usedFor: 'Catalog brainstorm, look naming, taxonomy generation',
    tracked: 'live',
    dashboardUrl: 'https://console.anthropic.com/settings/usage',
    emoji: '🤖',
    costNote: '$3–15 / 1M tokens',
  },
  {
    id: 'serpapi',
    name: 'SerpAPI',
    description: 'Google Shopping search proxy',
    usedFor: 'Product discovery via Google Shopping',
    tracked: 'live',
    dashboardUrl: 'https://serpapi.com/dashboard',
    emoji: '🔍',
    costNote: '$0.005 / search',
  },
  {
    id: 'rainforest',
    name: 'Rainforest API',
    description: 'Amazon product data API',
    usedFor: 'Amazon product lookup by ASIN / keyword',
    tracked: 'live',
    dashboardUrl: 'https://app.rainforestapi.com/usage',
    emoji: '🛒',
    costNote: '$0.01 / request',
  },
  {
    id: 'twelvelabs',
    name: 'TwelveLabs',
    description: 'Video understanding & embedding',
    usedFor: 'Vector embeddings for product creative videos',
    tracked: 'live',
    dashboardUrl: 'https://playground.twelvelabs.io/usage',
    emoji: '🎬',
    costNote: '$0.005 / task',
  },
  {
    id: 'fal',
    name: 'FAL / Seedance',
    description: 'Serverless GPU inference',
    usedFor: 'ByteDance Seedance video generation',
    tracked: 'live',
    dashboardUrl: 'https://fal.ai/dashboard/billing',
    emoji: '⚡',
    costNote: '~$0.05–0.20 / video',
  },
  {
    id: 'google-veo',
    name: 'Google Veo 3.1',
    description: 'Google video generation model',
    usedFor: 'Image-to-video for product ads',
    tracked: 'dashboard',
    dashboardUrl: 'https://console.cloud.google.com/billing',
    emoji: '🎥',
    costNote: '~$0.08–0.15 / clip',
  },
  {
    id: 'gemini',
    name: 'Google Gemini Flash',
    description: 'Google multimodal LLM',
    usedFor: 'Veo prompt enhancement',
    tracked: 'dashboard',
    dashboardUrl: 'https://console.cloud.google.com/billing',
    emoji: '✨',
    costNote: '~$0.0005 / call',
  },
  {
    id: 'modal',
    name: 'Modal',
    description: 'Serverless container platform',
    usedFor: 'Agent runtime for crawling, scraping, video gen',
    tracked: 'dashboard',
    dashboardUrl: 'https://modal.com/settings/billing',
    emoji: '☁️',
    costNote: 'Per container-second',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function fmtCost(usd: number | null): string {
  if (usd == null) return '—';
  if (usd < 0.0001) return '<$0.0001';
  return `$${usd.toFixed(4)}`;
}

function fmtNum(n: number | null): string {
  if (n == null) return '—';
  return n.toLocaleString();
}

const PLATFORM_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  serpapi: 'SerpAPI',
  rainforest: 'Rainforest',
  twelvelabs: 'TwelveLabs',
  fal: 'FAL',
  'google-veo': 'Veo',
  gemini: 'Gemini',
  modal: 'Modal',
};

const PLATFORM_COLORS: Record<string, string> = {
  anthropic:   '#e8b4a0',
  serpapi:     '#a0c4e8',
  rainforest:  '#a0e8b4',
  twelvelabs:  '#c4a0e8',
  fal:         '#e8d4a0',
  'google-veo':'#a0e8d4',
  gemini:      '#e8a0c4',
  modal:       '#b4b4b4',
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Period helpers
// ─────────────────────────────────────────────────────────────────────────────

type Period = 'this_month' | 'last_month' | 'last_3_months';

const PERIOD_LABELS: Record<Period, string> = {
  this_month:    'This Month',
  last_month:    'Last Month',
  last_3_months: 'Last 3 Months',
};

function getPeriodRange(p: Period): { start: Date; end: Date; label: string; startStr: string; endStr: string } {
  const now = new Date();
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  if (p === 'this_month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start, end: now, startStr: fmt(start), endStr: fmt(now),
      label: start.toLocaleString('default', { month: 'long', year: 'numeric' }) };
  }
  if (p === 'last_month') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end   = new Date(now.getFullYear(), now.getMonth(), 0);
    return { start, end, startStr: fmt(start), endStr: fmt(end),
      label: start.toLocaleString('default', { month: 'long', year: 'numeric' }) };
  }
  // last_3_months
  const start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  return { start, end: now, startStr: fmt(start), endStr: fmt(now),
    label: `${start.toLocaleString('default', { month: 'short' })}–${now.toLocaleString('default', { month: 'short', year: 'numeric' })}` };
}

// ─────────────────────────────────────────────────────────────────────────────
// FAL usage helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Rows are already aggregated by the edge function — just return as-is. */
function parseFalRows(data: FalModelUsage[] | null): FalModelUsage[] {
  if (!data || !Array.isArray(data)) return [];
  return data;
}

function falTotalCost(rows: FalModelUsage[]): number {
  return rows.reduce((s, r) => s + Number(r.cost ?? 0), 0);
}

function falTotalRequests(rows: FalModelUsage[]): number {
  // FAL bills by quantity (tokens / compute-seconds / images) not a request count
  return rows.length;
}

export default function AdminAiUsage() {
  const [logs, setLogs] = useState<AiUsageLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [platformFilter, setPlatformFilter] = useState<string | null>(null);
  const [external, setExternal] = useState<ExternalUsage | null>(null);
  const [externalLoading, setExternalLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('this_month');

  const periodRange = useMemo(() => getPeriodRange(period), [period]);

  const loadLogs = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const { data } = await supabase
      .from('ai_usage_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    setLogs((data as AiUsageLog[]) ?? []);
    setLoading(false);
  }, []);

  const loadExternal = useCallback(async (startStr: string, endStr: string) => {
    if (!supabase) return;
    setExternalLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('get-external-usage', {
        body: { startDate: startStr, endDate: endStr },
      });
      if (!error && data) setExternal(data as ExternalUsage);
    } catch {
      // non-critical — UI shows error state
    } finally {
      setExternalLoading(false);
    }
  }, []);

  useEffect(() => { loadLogs(); }, [loadLogs]);
  useEffect(() => {
    loadExternal(periodRange.startStr, periodRange.endStr);
  }, [periodRange.startStr, periodRange.endStr, loadExternal]);

  // Aggregate DB-tracked logs filtered to the selected period
  const periodLogs = useMemo(
    () => logs.filter(l => new Date(l.created_at) >= periodRange.start && new Date(l.created_at) <= periodRange.end),
    [logs, periodRange],
  );

  const platformStats = useMemo<PlatformStat[]>(() => {
    const map: Record<string, PlatformStat> = {};
    for (const l of periodLogs) {
      if (!map[l.platform]) {
        map[l.platform] = { platform: l.platform, calls: 0, inputTokens: 0, outputTokens: 0, units: 0, estimatedCost: 0 };
      }
      map[l.platform].calls++;
      map[l.platform].inputTokens  += l.input_tokens ?? 0;
      map[l.platform].outputTokens += l.output_tokens ?? 0;
      map[l.platform].units        += l.units ?? 0;
      map[l.platform].estimatedCost += l.estimated_cost_usd ?? 0;
    }
    return Object.values(map).sort((a, b) => b.estimatedCost - a.estimatedCost);
  }, [periodLogs]);

  const totalCostPeriod = useMemo(
    () => platformStats.reduce((s, p) => s + p.estimatedCost, 0),
    [platformStats],
  );

  const totalCallsPeriod = useMemo(
    () => platformStats.reduce((s, p) => s + p.calls, 0),
    [platformStats],
  );

  const totalTokensPeriod = useMemo(
    () => platformStats.reduce((s, p) => s + p.inputTokens + p.outputTokens, 0),
    [platformStats],
  );

  // Table data — apply platform filter
  const filteredLogs = useMemo(
    () => (platformFilter ? logs.filter(l => l.platform === platformFilter) : logs),
    [logs, platformFilter],
  );

  const { sortedData, sort, handleSort } = useSortableTable<AiUsageLog>(
    filteredLogs,
    { key: 'created_at', direction: 'desc' },
  );

  // Unique platforms that have appeared in logs (for filter chips)
  const activePlatforms = useMemo(
    () => [...new Set(logs.map(l => l.platform))].sort(),
    [logs],
  );

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1>AI Usage</h1>
          <p className="admin-page-subtitle">API usage and estimated costs across all AI platforms</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          <div className="admin-tabs" style={{ marginBottom: 0 }}>
            {(Object.keys(PERIOD_LABELS) as Period[]).map(k => (
              <button
                key={k}
                className={`admin-tab${period === k ? ' active' : ''}`}
                style={{ fontSize: '12px', padding: '5px 12px' }}
                onClick={() => setPeriod(k)}
              >
                {PERIOD_LABELS[k]}
              </button>
            ))}
          </div>
          <button className="admin-btn admin-btn-secondary" onClick={() => { loadLogs(); loadExternal(periodRange.startStr, periodRange.endStr); }}>
            Refresh
          </button>
        </div>
      </div>

      {/* ── Platform Map ──────────────────────────────────────────────────── */}
      <section>
        <h2 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px' }}>
          Platform Map
        </h2>
        <div className="admin-stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          {PLATFORMS.map(p => (
            <div key={p.id} className="admin-stat-card" style={{ padding: '14px 16px', gap: '6px', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '20px' }}>{p.emoji}</span>
                <span
                  className={`admin-status ${p.tracked === 'live' ? 'admin-status-online' : 'admin-status-away'}`}
                  style={{ fontSize: '10px', padding: '2px 7px' }}
                >
                  {p.tracked === 'live' ? 'tracked' : 'dashboard-only'}
                </span>
              </div>
              <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--fg)' }}>{p.name}</div>
              <div style={{ fontSize: '11px', color: 'var(--muted)', lineHeight: 1.4 }}>{p.usedFor}</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
                <span style={{ fontSize: '11px', color: 'var(--muted)' }}>{p.costNote}</span>
                <a
                  href={p.dashboardUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: '11px', color: 'var(--accent)', textDecoration: 'none' }}
                >
                  Dashboard →
                </a>
              </div>
            </div>
          ))}
        </div>
      </section>
      {/* ── FAL Live Usage ─────────────────────────────────────────────────── */}
      <section style={{ marginTop: '28px' }}>
        <h2 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px' }}>
          FAL / Seedance — {periodRange.label}
        </h2>
        {externalLoading ? (
          <div className="admin-empty">Fetching FAL usage…</div>
        ) : external?.fal.error === 'BILLING_KEY_REQUIRED' ? (
          <div style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            padding: '14px 16px',
            fontSize: '12px',
            color: 'var(--muted)',
            lineHeight: 1.6,
          }}>
            <strong style={{ color: 'var(--fg)' }}>Billing key required.</strong>{' '}
            The <code>FAL_KEY</code> secret is an inference key and does not have permission to
            query usage data. To enable live usage here, add a FAL billing/admin key as a
            separate Supabase secret (<code>FAL_BILLING_KEY</code>) and update this function.
            In the meantime, view usage directly on the FAL dashboard.
            <div style={{ marginTop: '10px' }}>
              <a
                href="https://fal.ai/dashboard/billing"
                target="_blank"
                rel="noopener noreferrer"
                className="admin-btn admin-btn-secondary"
                style={{ fontSize: '11px', textDecoration: 'none' }}
              >
                Open FAL Dashboard →
              </a>
            </div>
          </div>
        ) : external?.fal.error ? (
          <div className="admin-empty" style={{ color: 'var(--danger, #e87a7a)' }}>
            Could not load FAL data: {external.fal.error}
          </div>
        ) : (() => {
          const rows = parseFalRows(external?.fal.data ?? null);
          const totalCost = falTotalCost(rows);
          const totalReqs = falTotalRequests(rows);
          return (
            <>
              <div className="admin-stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
                <div className="admin-stat-card">
                  <span className="admin-stat-value">{rows.length}</span>
                  <span className="admin-stat-label">Endpoints Used</span>
                </div>
                <div className="admin-stat-card">
                  <span className="admin-stat-value">${totalCost.toFixed(2)}</span>
                  <span className="admin-stat-label">Billed Cost (USD)</span>
                </div>
              </div>
              {rows.length > 0 && (
                <div className="admin-table-wrap" style={{ marginTop: '12px' }}>
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Endpoint</th>
                        <th style={{ textAlign: 'right' }}>Quantity</th>
                        <th style={{ textAlign: 'right' }}>Unit</th>
                        <th style={{ textAlign: 'right' }}>Unit Price</th>
                        <th style={{ textAlign: 'right' }}>Cost (USD)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i}>
                          <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>{r.endpoint_id}</td>
                          <td style={{ textAlign: 'right' }}>{Number(r.quantity).toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                          <td style={{ textAlign: 'right', color: 'var(--muted)', fontSize: '11px' }}>{r.unit}</td>
                          <td style={{ textAlign: 'right', color: 'var(--muted)', fontSize: '11px' }}>${Number(r.unit_price).toFixed(5)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 500 }}>${Number(r.cost).toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {rows.length === 0 && (
                <div className="admin-empty">No FAL usage data returned for this billing period.</div>
              )}
            </>
          );
        })()}
      </section>
      {/* ── Month Stats ───────────────────────────────────────────────────── */}
      <section style={{ marginTop: '28px' }}>
        <h2 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px' }}>
          {periodRange.label} — Tracked Platforms
        </h2>
        <div className="admin-stats-grid">
          <div className="admin-stat-card">
            <span className="admin-stat-value">{loading ? '—' : totalCallsPeriod.toLocaleString()}</span>
            <span className="admin-stat-label">Total API Calls</span>
          </div>
          <div className="admin-stat-card">
            <span className="admin-stat-value">{loading ? '—' : totalTokensPeriod.toLocaleString()}</span>
            <span className="admin-stat-label">Total Tokens (LLM)</span>
          </div>
          <div className="admin-stat-card">
            <span className="admin-stat-value">{loading ? '—' : `$${totalCostPeriod.toFixed(4)}`}</span>
            <span className="admin-stat-label">Estimated Cost (USD)</span>
          </div>
          <div className="admin-stat-card">
            <span className="admin-stat-value">{loading ? '—' : platformStats.length}</span>
            <span className="admin-stat-label">Active Platforms</span>
          </div>
        </div>

        {/* Per-platform breakdown */}
        {!loading && platformStats.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '14px' }}>
            {platformStats.map(s => (
              <div
                key={s.platform}
                style={{
                  background: 'var(--card)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  minWidth: '160px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: PLATFORM_COLORS[s.platform] ?? '#888',
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontWeight: 600, fontSize: '12px', color: 'var(--fg)' }}>
                    {PLATFORM_LABELS[s.platform] ?? s.platform}
                  </span>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--muted)', lineHeight: 1.8 }}>
                  <div>{s.calls.toLocaleString()} calls</div>
                  {(s.inputTokens + s.outputTokens) > 0 && (
                    <div>{(s.inputTokens + s.outputTokens).toLocaleString()} tokens</div>
                  )}
                  <div style={{ color: 'var(--fg)', fontWeight: 500 }}>{fmtCost(s.estimatedCost)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Recent Activity ───────────────────────────────────────────────── */}
      <section style={{ marginTop: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <h2 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
            Recent Activity
          </h2>
          <span style={{ fontSize: '11px', color: 'var(--muted)' }}>Last 200 calls</span>
        </div>

        {/* Platform filter chips */}
        {activePlatforms.length > 0 && (
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
            <button
              className={`admin-chip${!platformFilter ? ' admin-chip-active' : ''}`}
              onClick={() => setPlatformFilter(null)}
            >
              All
            </button>
            {activePlatforms.map(pid => (
              <button
                key={pid}
                className={`admin-chip${platformFilter === pid ? ' admin-chip-active' : ''}`}
                onClick={() => setPlatformFilter(prev => (prev === pid ? null : pid))}
              >
                {PLATFORM_LABELS[pid] ?? pid}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="admin-empty">Loading usage logs…</div>
        ) : sortedData.length === 0 ? (
          <div className="admin-empty">
            {platformFilter
              ? `No logs for ${PLATFORM_LABELS[platformFilter] ?? platformFilter} yet.`
              : 'No usage logs yet. Logs appear here after the first AI API call goes through an edge function.'}
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <SortableTh label="Time"           sortKey="created_at"          currentSort={sort} onSort={handleSort} />
                  <th>Platform</th>
                  <SortableTh label="Operation"      sortKey="operation"           currentSort={sort} onSort={handleSort} />
                  <th>Model</th>
                  <SortableTh label="In Tokens"      sortKey="input_tokens"        currentSort={sort} onSort={handleSort} />
                  <SortableTh label="Out Tokens"     sortKey="output_tokens"       currentSort={sort} onSort={handleSort} />
                  <SortableTh label="Units"          sortKey="units"               currentSort={sort} onSort={handleSort} />
                  <SortableTh label="Est. Cost"      sortKey="estimated_cost_usd"  currentSort={sort} onSort={handleSort} />
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sortedData.map(row => (
                  <tr key={row.id}>
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)', fontSize: '12px' }}>
                      {timeAgo(row.created_at)}
                    </td>
                    <td>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: '10px',
                          fontSize: '11px',
                          fontWeight: 600,
                          background: `${PLATFORM_COLORS[row.platform] ?? '#888'}22`,
                          color: PLATFORM_COLORS[row.platform] ?? 'var(--fg)',
                        }}
                      >
                        {PLATFORM_LABELS[row.platform] ?? row.platform}
                      </span>
                    </td>
                    <td style={{ fontSize: '12px' }}>{row.operation}</td>
                    <td style={{ fontSize: '11px', color: 'var(--muted)' }}>{row.model ?? '—'}</td>
                    <td style={{ textAlign: 'right', fontSize: '12px' }}>{fmtNum(row.input_tokens)}</td>
                    <td style={{ textAlign: 'right', fontSize: '12px' }}>{fmtNum(row.output_tokens)}</td>
                    <td style={{ textAlign: 'right', fontSize: '12px' }}>{fmtNum(row.units)}</td>
                    <td style={{ textAlign: 'right', fontSize: '12px', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtCost(row.estimated_cost_usd)}
                    </td>
                    <td>
                      <span className={`admin-status ${row.status === 'success' ? 'admin-status-online' : 'admin-status-offline'}`}>
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

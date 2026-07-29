// Admin · Pipeline health — one page answering: is the machine running,
// is its output good, and what does it cost. Read-only (no controls —
// those live on /admin/pipeline, Task 11). Panels: stage funnel, cron
// automation, link health, spend, and a demand summary that links out
// to /admin/seeding rather than recomputing it.

import { useEffect, useState } from 'react';
import { Link } from '@remix-run/react';
import { supabase } from '~/utils/supabase';

interface FunnelRow { stage: string; n: number; oldest_age: string | null }
interface CronRow { jobname: string; schedule: string; active: boolean; last_status: string | null; last_run: string | null }
interface LinkRow { bucket: string; n: number }
interface SpendRow { platform: string; operation: string; calls: number; month_usd: number; total_usd: number }

const LINK_BUCKET_ORDER = ['live', 'bot_blocked', 'blocked_by_policy', 'unreachable', 'dead', 'unchecked'];
const LINK_BUCKET_LABEL: Record<string, string> = {
  live: 'Live',
  bot_blocked: 'Bot-blocked',
  blocked_by_policy: 'Blocked (SSRF policy)',
  unreachable: 'Unreachable',
  dead: 'Dead',
  unchecked: 'Unchecked',
};
const DEMAND_STATUS_ORDER = ['approved', 'pending', 'paused', 'rejected', 'done'];

function fmtAge(age: string | null): string {
  if (!age) return '—';
  const m = age.match(/^(-?\d+)\s+days?/);
  return m ? `${m[1]}d` : '<1d';
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

export default function PipelineHealth() {
  const [funnel, setFunnel] = useState<FunnelRow[]>([]);
  const [funnelError, setFunnelError] = useState<string | null>(null);
  const [crons, setCrons] = useState<CronRow[]>([]);
  const [cronsError, setCronsError] = useState<string | null>(null);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [linksError, setLinksError] = useState<string | null>(null);
  const [spend, setSpend] = useState<SpendRow[]>([]);
  const [spendError, setSpendError] = useState<string | null>(null);
  const [monthlyCap, setMonthlyCap] = useState(0);
  const [capError, setCapError] = useState<string | null>(null);
  const [costPerPublished, setCostPerPublished] = useState(0);
  const [costError, setCostError] = useState<string | null>(null);
  const [demand, setDemand] = useState<Record<string, number>>({});
  const [demandError, setDemandError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [clientError, setClientError] = useState<string | null>(null);

  useEffect(() => {
    // F8: a missing supabase client must not leave the page spinning forever.
    if (!supabase) { setClientError('Supabase client not configured.'); setLoading(false); return; }
    void (async () => {
      const [f, c, l, s, cap, cost, targets] = await Promise.all([
        supabase.rpc('pipeline_funnel'),
        supabase.rpc('pipeline_cron_status'),
        supabase.rpc('link_health_summary'),
        supabase.rpc('pipeline_spend_summary'),
        supabase.from('app_settings').select('value').eq('key', 'pipeline_creative_monthly_usd_cap').maybeSingle(),
        supabase.rpc('pipeline_cost_per_published'),
        supabase.from('seed_targets').select('status'),
      ]);
      // F5: every RPC's error is surfaced in its own panel now, not just the
      // cron one — a permission failure / RLS block / dropped function must
      // look different from a panel that is legitimately empty.
      setFunnel((f.data ?? []) as FunnelRow[]);
      setFunnelError(f.error ? f.error.message : null);
      setCrons((c.data ?? []) as CronRow[]);
      setCronsError(c.error ? c.error.message : null);
      setLinks((l.data ?? []) as LinkRow[]);
      setLinksError(l.error ? l.error.message : null);
      setSpend(((s.data ?? []) as Array<{ platform: string; operation: string; calls: number; month_usd: string; total_usd: string }>)
        .map(r => ({ ...r, month_usd: Number(r.month_usd), total_usd: Number(r.total_usd) })));
      setSpendError(s.error ? s.error.message : null);
      setMonthlyCap(Number(cap.data?.value ?? 0));
      setCapError(cap.error ? cap.error.message : null);
      setCostPerPublished(Number(cost.data ?? 0));
      setCostError(cost.error ? cost.error.message : null);
      const tally: Record<string, number> = {};
      for (const t of (targets.data ?? []) as Array<{ status: string }>) tally[t.status] = (tally[t.status] ?? 0) + 1;
      setDemand(tally);
      setDemandError(targets.error ? targets.error.message : null);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="admin-page"><div className="admin-spinner" /></div>;
  if (clientError) return <div className="admin-page"><p className="admin-error">{clientError}</p></div>;

  // F4: pipeline_spend_summary() groups by (platform, operation), so a single
  // `.find(platform === 'fal')` only ever returns ONE group — the enforced
  // cap is the SUM across all creative rows regardless of platform/model.
  // creative_month_spend() (the RPC the driver itself calls) is service_role
  // only — the admin client authenticates as `authenticated`, which the
  // migration explicitly revokes EXECUTE from — so we can't call it directly.
  // Sum the same rows the driver would instead, scoped the same way
  // (operation = 'product-creative'), so the page and the enforcement agree.
  const creativeMonthUsd = spend
    .filter(s => s.operation === 'product-creative')
    .reduce((sum, s) => sum + s.month_usd, 0);
  const hasCreativeUsage = spend.some(s => s.operation === 'product-creative');

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Pipeline health</h1>
        <p className="admin-page-subtitle">
          Scrape → image-verify → creative → publish. Is it running, is the output good, what does it cost.
        </p>
      </div>

      <section className="admin-detail-card">
        <h2>Stage funnel</h2>
        {funnelError ? (
          <p className="admin-error">Stage funnel unavailable: {funnelError}</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Stage</th><th className="admin-th-center">Products</th><th>Oldest</th></tr></thead>
              <tbody>
                {funnel.map(r => (
                  <tr key={r.stage} className={r.stage === 'published_no_creative' ? 'admin-row-warn' : undefined}>
                    <td>{r.stage}</td>
                    <td className="admin-cell-center">{r.n}</td>
                    <td className="admin-cell-muted">{fmtAge(r.oldest_age)}</td>
                  </tr>
                ))}
                {funnel.length === 0 && <tr><td colSpan={3} className="admin-cell-muted">No products yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <p className="admin-hint">
          <strong>published_no_creative</strong> = live but invisible: video is a hard feed filter, so these
          products are is_active yet cannot appear in the feed.
        </p>
      </section>

      <section className="admin-detail-card">
        <h2>Automation</h2>
        {cronsError ? (
          <p className="admin-error">Cron status unavailable: {cronsError}</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Job</th><th>Schedule</th><th className="admin-th-center">On</th><th>Last run</th><th>Status</th></tr></thead>
              <tbody>
                {crons.map(c => (
                  <tr key={c.jobname}>
                    <td>{c.jobname}</td>
                    <td className="admin-cell-muted">{c.schedule}</td>
                    <td className="admin-cell-center">
                      <span className={`admin-status-dot admin-status-dot--${c.active ? 'live' : 'inactive'}`} /> {c.active ? 'on' : 'paused'}
                    </td>
                    <td className="admin-cell-muted">{c.last_run ? new Date(c.last_run).toLocaleString() : 'never'}</td>
                    <td>{c.last_status ?? '—'}</td>
                  </tr>
                ))}
                {crons.length === 0 && <tr><td colSpan={5} className="admin-cell-muted">No pipeline crons registered.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="admin-detail-card">
        <h2>Link health</h2>
        {linksError ? (
          <p className="admin-error">Link health unavailable: {linksError}</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Bucket</th><th className="admin-th-center">Products</th></tr></thead>
              <tbody>
                {[...links].sort((a, b) => LINK_BUCKET_ORDER.indexOf(a.bucket) - LINK_BUCKET_ORDER.indexOf(b.bucket)).map(l => (
                  <tr key={l.bucket}>
                    <td>{LINK_BUCKET_LABEL[l.bucket] ?? l.bucket}</td>
                    <td className="admin-cell-center">{l.n}</td>
                  </tr>
                ))}
                {links.length === 0 && <tr><td colSpan={2} className="admin-cell-muted">No link checks yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <p className="admin-hint">
          <strong>Bot-blocked</strong> means reachable in a browser but blocked to server requests — not broken.
        </p>
      </section>

      <section className="admin-detail-card">
        <h2>Spend</h2>
        {capError && <p className="admin-error">Monthly cap unavailable: {capError}</p>}
        {costError && <p className="admin-error">Cost-per-published unavailable: {costError}</p>}
        {spendError ? (
          <p className="admin-error">Spend unavailable: {spendError}</p>
        ) : (
          <>
            <p className="admin-hint">
              Creative spend this month: <strong>{fmtUsd(creativeMonthUsd)}</strong> / {fmtUsd(monthlyCap)} cap
              &nbsp;·&nbsp; cost per published product this month: <strong>{fmtUsd(costPerPublished)}</strong>
            </p>
            {!hasCreativeUsage && (
              <p className="admin-warn">
                No creative usage logged yet — the monthly cap is not enforceable until
                Task 3 ships and a creative has been generated.
              </p>
            )}
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Platform</th><th>Operation</th><th className="admin-th-center">Calls</th><th className="admin-th-center">Month</th><th className="admin-th-center">All-time</th></tr></thead>
                <tbody>
                  {spend.map(s => (
                    <tr key={`${s.platform}:${s.operation}`}>
                      <td>{s.platform}</td>
                      <td className="admin-cell-muted">{s.operation}</td>
                      <td className="admin-cell-center">{s.calls}</td>
                      <td className="admin-cell-center">{fmtUsd(s.month_usd)}</td>
                      <td className="admin-cell-center">{fmtUsd(s.total_usd)}</td>
                    </tr>
                  ))}
                  {spend.length === 0 && <tr><td colSpan={5} className="admin-cell-muted">No AI usage logged yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="admin-detail-card">
        <h2>Demand</h2>
        {demandError ? (
          <p className="admin-error">Demand unavailable: {demandError}</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Status</th><th className="admin-th-center">Targets</th></tr></thead>
              <tbody>
                {DEMAND_STATUS_ORDER.filter(s => demand[s] != null).map(s => (
                  <tr key={s}>
                    <td>{s}</td>
                    <td className="admin-cell-center">{demand[s]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="admin-hint">
          Read-only — manage seed targets on <Link to="/admin/seeding">Seeding</Link>.
        </p>
      </section>
    </div>
  );
}

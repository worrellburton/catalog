// Admin · Pipeline — the control surface for the scrape → image-verify →
// creative → publish pipeline (health/monitoring lives at
// /admin/pipeline/health, Task 10). Every dial here writes to app_settings
// via admin_set_pipeline_setting (admin-only RPC) except the master switch,
// which also flips every pipeline-* cron via set_pipeline_master. All flags
// default OFF — see supabase/migrations/20260729000002_pipeline_settings.sql.

import { useCallback, useEffect, useState } from 'react';
import { Link } from '@remix-run/react';
import { supabase } from '~/utils/supabase';

interface CronRow { jobname: string; schedule: string; active: boolean; last_status: string | null; last_run: string | null }

const CRON_LABELS: Record<string, string> = {
  'pipeline-creative-drain': 'Generate creatives (spends $)',
  'pipeline-publish': 'Autopublish (quality gate)',
  'pipeline-link-health': 'Check link health',
  'pipeline-reap-jobs': 'Reap stuck generation jobs',
};

function humanCron(s: string): string {
  const m: Record<string, string> = {
    '*/15 * * * *': 'every 15 min', '*/30 * * * *': 'every 30 min', '0 5 * * *': 'daily (5am)',
  };
  return m[s] || s;
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3.6e6);
  if (h < 1) return `${Math.max(1, Math.floor(diff / 6e4))}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function Pipeline() {
  const [settings, setSettings] = useState<Map<string, string>>(new Map());
  const [crons, setCrons] = useState<CronRow[]>([]);
  const [cronsError, setCronsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const [{ data: rows, error: rowsErr }, { data: cronRows, error: cronErr }] = await Promise.all([
      supabase.from('app_settings').select('key,value').like('key', 'pipeline\\_%'),
      supabase.rpc('pipeline_cron_status'),
    ]);
    if (rowsErr) setMsg(`Error loading settings: ${rowsErr.message}`);
    setSettings(new Map((rows ?? []).map((r: { key: string; value: string }) => [r.key, r.value])));
    setCrons((cronRows ?? []) as CronRow[]);
    setCronsError(cronErr ? cronErr.message : null);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const setSetting = useCallback(async (key: string, value: string) => {
    if (!supabase) return;
    const { error } = await supabase.rpc('admin_set_pipeline_setting', { p_key: key, p_value: value });
    if (error) setMsg(`Error: ${error.message}`);
    await load();
  }, [load]);

  // Master switch — flips pipeline_enabled AND every pipeline-* cron together.
  const setMaster = useCallback(async (on: boolean) => {
    if (!supabase) return;
    if (!on && !window.confirm('Pause everything? This stops the pipeline and pauses every pipeline-* cron.')) return;
    setBusy('master');
    const { error } = await supabase.rpc('set_pipeline_master', { p_on: on });
    if (error) setMsg(`Error: ${error.message}`);
    setBusy(null);
    await load();
  }, [load]);

  if (loading) return (
    <div className="admin-page">
      <span className="admin-spinner" />
    </div>
  );

  const enabled = settings.get('pipeline_enabled') === 'true';
  const creativeEnabled = settings.get('pipeline_creative_enabled') === 'true';
  const autopublishEnabled = settings.get('pipeline_autopublish_enabled') === 'true';
  const requirePersonFree = settings.get('pipeline_require_person_free') === 'true';
  const creativesPerDay = Number(settings.get('pipeline_creatives_per_day') ?? '0');
  const monthlyCap = Number(settings.get('pipeline_creative_monthly_usd_cap') ?? '0');
  const minImageScore = Number(settings.get('pipeline_min_image_score') ?? '0');
  const minImages = Number(settings.get('pipeline_min_images') ?? '0');

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1>Pipeline</h1>
          <p className="admin-page-subtitle">
            Scrape → image-verify → creative → publish. Set policy here; see it run on{' '}
            <Link to="/admin/pipeline/health">Pipeline health</Link>.
          </p>
        </div>
        <Link to="/admin/pipeline/health" className="admin-btn admin-btn-secondary">
          View pipeline health →
        </Link>
      </div>

      {msg && <p className="admin-warn">{msg}</p>}

      <section className="admin-detail-card">
        <h2>Master switch</h2>
        <div className="admin-detail-rows">
          <div className="admin-detail-row">
            <span>{enabled ? 'Pipeline is ON' : 'Pipeline is OFF'}</span>
            <button
              type="button"
              className="admin-btn admin-btn-primary"
              disabled={busy === 'master'}
              onClick={() => void setMaster(!enabled)}
            >
              {busy === 'master' ? '…' : enabled ? 'Pause everything' : 'Enable everything'}
            </button>
          </div>
        </div>
        <p className="admin-hint">
          Flips the <code>pipeline_enabled</code> flag AND every <code>pipeline-*</code> cron together —
          this is the kill switch. Turning it off stops scraping, creative generation, and publishing in
          one action.
        </p>
      </section>

      <section className="admin-detail-card">
        <h2>Stage toggles</h2>
        <div className="admin-detail-rows">
          <div className="admin-detail-row">
            <span>Creative generation</span>
            <label className="admin-toggle">
              <input type="checkbox" checked={creativeEnabled}
                onChange={e => void setSetting('pipeline_creative_enabled', e.target.checked ? 'true' : 'false')} />
              <span className="admin-toggle-track" />
            </label>
          </div>
          <div className="admin-detail-row">
            <span>Autopublish</span>
            <label className="admin-toggle">
              <input type="checkbox" checked={autopublishEnabled}
                onChange={e => void setSetting('pipeline_autopublish_enabled', e.target.checked ? 'true' : 'false')} />
              <span className="admin-toggle-track" />
            </label>
          </div>
          <div className="admin-detail-row">
            <span>Require person-free images</span>
            <label className="admin-toggle">
              <input type="checkbox" checked={requirePersonFree}
                onChange={e => void setSetting('pipeline_require_person_free', e.target.checked ? 'true' : 'false')} />
              <span className="admin-toggle-track" />
            </label>
          </div>
        </div>
      </section>

      <section className="admin-detail-card">
        <h2>Budget &amp; throughput</h2>
        <div className="admin-detail-rows">
          <div className="admin-detail-row">
            <span>Creatives per day</span>
            <input type="number" className="admin-date-input" min={0} step={1} defaultValue={creativesPerDay}
              onBlur={e => { const v = Math.max(0, Math.round(Number(e.target.value) || 0)); if (v !== creativesPerDay) void setSetting('pipeline_creatives_per_day', String(v)); }} />
          </div>
          <p className="admin-hint">
            There is a hard per-run ceiling of 25 — the cron drains at most 25 per 15-minute tick
            regardless of this value.
          </p>
          <div className="admin-detail-row">
            <span>Monthly creative budget cap (USD)</span>
            <input type="number" className="admin-date-input" min={0} step={1} defaultValue={monthlyCap}
              onBlur={e => { const v = Math.max(0, Number(e.target.value) || 0); if (v !== monthlyCap) void setSetting('pipeline_creative_monthly_usd_cap', String(v)); }} />
          </div>
          <p className="admin-hint">
            Costs are estimates — fal returns no price — so this cap is only as accurate as our pricing
            table. Reconcile against a real fal invoice after the first canary run.
          </p>
        </div>
      </section>

      <section className="admin-detail-card">
        <h2>Image quality gate</h2>
        <div className="admin-detail-rows">
          <div className="admin-detail-row">
            <span>Minimum image score</span>
            <input type="number" className="admin-date-input" min={0} max={1} step={0.05} defaultValue={minImageScore}
              onBlur={e => { const v = Math.min(1, Math.max(0, Number(e.target.value) || 0)); if (v !== minImageScore) void setSetting('pipeline_min_image_score', String(v)); }} />
          </div>
          <div className="admin-detail-row">
            <span>Minimum images</span>
            <input type="number" className="admin-date-input" min={0} step={1} defaultValue={minImages}
              onBlur={e => { const v = Math.max(0, Math.round(Number(e.target.value) || 0)); if (v !== minImages) void setSetting('pipeline_min_images', String(v)); }} />
          </div>
          <p className="admin-hint">
            2 is permissive — a 2-image gallery is often the <em>result</em> of aggressive junk pruning,
            so the count alone can't distinguish "healthy small gallery" from "barely survived."
            Measured today: min_images 2 → 260 products eligible, 3 → 206.
          </p>
        </div>
      </section>

      <section className="admin-detail-card">
        <h2>Automation</h2>
        {cronsError ? (
          <p className="admin-hint">Cron status unavailable: {cronsError}</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Job</th><th>Schedule</th><th className="admin-th-center">On</th><th>Last run</th><th>Status</th></tr></thead>
              <tbody>
                {crons.map(c => (
                  <tr key={c.jobname}>
                    <td>{CRON_LABELS[c.jobname] || c.jobname}</td>
                    <td className="admin-cell-muted">{humanCron(c.schedule)}</td>
                    <td className="admin-cell-center">
                      <span className={`admin-status-dot admin-status-dot--${c.active ? 'live' : 'inactive'}`} /> {c.active ? 'on' : 'paused'}
                    </td>
                    <td className="admin-cell-muted">{timeAgo(c.last_run)}</td>
                    <td>{c.last_status ?? '—'}</td>
                  </tr>
                ))}
                {crons.length === 0 && <tr><td colSpan={5} className="admin-cell-muted">No pipeline crons registered.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <p className="admin-hint">
          Individual jobs pause with the master switch above — there's no per-job control here, only status.
        </p>
      </section>
    </div>
  );
}

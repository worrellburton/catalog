// Admin · one product's pipeline journey, scrape → publish.
//
// The spine encodes TIME: the vertical gap between two stages is proportional
// to how long the product sat between them (log-scaled, because the real range
// is 11 seconds to 85 days). A product that ran straight through renders as a
// tight cluster; one that stalled shows a long empty run of spine with the
// wait labelled inside it. The stall is visible before you read a number.
//
// Everything else is deliberately quiet — the spine is the only place this
// page spends attention.

import { useEffect, useState } from 'react';
import { useParams, Link } from '@remix-run/react';
import { supabase } from '~/utils/supabase';

interface Step {
  key: string; label: string; at: string | null; detail: string; failed?: boolean;
  kept?: string[];          // re-hosted images the product uses now
  raw?: string[];           // what the merchant originally gave us (set-once)
  pruned_count?: number;
  video?: string | null;
  poster?: string | null;
}
interface Creative {
  status: string; enabled: boolean; model: string | null;
  cost_usd: number | null; completed_at: string | null; has_video: boolean;
}
interface Journey {
  id: string; brand: string | null; name: string | null; type: string | null;
  price: string | null; url: string | null; image: string | null; source: string | null;
  is_active: boolean; stage: string;
  blocked_by: string | null; unblock_with: string | null;
  steps: Step[]; creatives: Creative[]; total_seconds: number;
  error?: string;
}

// Real gaps span 11s to 85d — six orders of magnitude. Linear spacing would
// make everything before the stall a single invisible line, so map log10 of
// the wait onto 12–140px. The clamp keeps a 1-second gap from vanishing and an
// 85-day gap from pushing the next stage off the screen.
function gapPx(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 12;
  return Math.min(140, Math.max(12, Math.round(14 * Math.log10(1 + seconds))));
}

function fmtWait(seconds: number): string {
  if (seconds < 1) return 'instant';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

function fmtClock(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}

export default function ProductJourney() {
  const { id } = useParams();
  const [j, setJ] = useState<Journey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) { setError('Supabase client not configured.'); setLoading(false); return; }
    if (!id) { setError('No product id in the URL.'); setLoading(false); return; }
    void (async () => {
      const { data, error: e } = await supabase.rpc('product_journey', { p_id: id });
      if (e) setError(e.message);
      else if ((data as Journey)?.error) setError('Product not found.');
      else setJ(data as Journey);
      setLoading(false);
    })();
  }, [id]);

  if (loading) return <div className="admin-page"><div className="admin-spinner" /></div>;
  if (error) return <div className="admin-page"><p className="admin-error">{error}</p></div>;
  if (!j) return null;

  // Reached = the last step with a timestamp. Everything after it is unreached,
  // so it renders ghosted rather than pretending to be a future certainty.
  const lastDoneIdx = j.steps.reduce((acc, s, i) => (s.at ? i : acc), -1);

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Product journey</h1>
        <p className="admin-page-subtitle">
          <Link to="/admin/pipeline/health">← Pipeline health</Link>
        </p>
      </div>

      <section className="admin-detail-card pj-head">
        {j.image && <img className="pj-thumb" src={j.image} alt="" />}
        <div className="pj-head-text">
          <span className="pj-brand">{j.brand ?? 'Unknown brand'}</span>
          <h2 className="pj-name">{j.name ?? 'Untitled'}</h2>
          <p className="pj-meta">
            {[j.type, j.price, j.source].filter(Boolean).join(' · ')}
            {j.url && <> · <a href={j.url} target="_blank" rel="noreferrer">merchant page</a></>}
          </p>
          <span className={`pj-stage pj-stage--${j.stage.replace(':', '-')}`}>{j.stage}</span>
        </div>
      </section>

      {j.blocked_by && (
        <section className="admin-detail-card pj-block">
          <h3>What&rsquo;s holding it up</h3>
          <p className="pj-block-why">{j.blocked_by}</p>
          {j.unblock_with && <p className="pj-block-fix">{j.unblock_with}</p>}
        </section>
      )}

      <section className="admin-detail-card">
        <h2>Timeline</h2>
        <p className="admin-hint">
          Spacing is proportional to time waited, log-scaled. Timestamps are when each
          stage <em>last</em> completed — verify and enrich re-run, so a step marked
          re-run carries a newer date than the one below it.
        </p>
        <ol className="pj-spine">
          {j.steps.map((s, i) => {
            const prev = i > 0 ? j.steps[i - 1] : null;
            // These timestamps are LAST-completed, not first-reached: verify and
            // enrich re-run on existing products, so a later stage can legitimately
            // carry an earlier date. Order by pipeline position (the meaningful
            // axis) and only draw a wait when time actually moved forward —
            // otherwise say the step was re-run rather than imply time reversed.
            const delta = s.at && prev?.at
              ? (new Date(s.at).getTime() - new Date(prev.at).getTime()) / 1000
              : 0;
            const wait = delta > 0 ? delta : 0;
            const rerun = delta < 0;
            const reached = !!s.at;
            const current = i === lastDoneIdx;
            const state = s.failed ? 'failed' : current ? 'current' : reached ? 'done' : 'pending';
            return (
              <li
                key={s.key}
                className={`pj-step pj-step--${state}`}
                // a re-run badge needs clearance from the row above it, which
                // a zero-wait gap (12px) does not give.
                style={i > 0 ? { marginTop: `${Math.max(gapPx(wait), rerun ? 30 : 0)}px` } : undefined}
              >
                {i > 0 && reached && wait > 0 && (
                  <span className="pj-wait">{fmtWait(wait)}</span>
                )}
                {rerun && <span className="pj-wait pj-wait--rerun">re-run</span>}
                <span className="pj-node" aria-hidden="true" />
                <div className="pj-body">
                  <div className="pj-row">
                    <span className="pj-label">{s.label}</span>
                    <time className="pj-time">{fmtClock(s.at)}</time>
                  </div>
                  <p className="pj-detail">{s.detail}</p>

                  {/* Verify step: show what survived, and what it removed. The
                      kept images are re-hosted to our storage; the raw ones are
                      the merchant's originals, so they can 403 on hotlink —
                      those hide themselves rather than showing a broken icon. */}
                  {s.key === 'verified' && !!s.kept?.length && (
                    <>
                      <div className="pj-gallery">
                        {s.kept.map((u, k) => (
                          <a key={u} href={u} target="_blank" rel="noreferrer"
                             className="pj-shot" title={k === 0 ? 'primary' : `image ${k}`}>
                            <img src={u} alt="" loading="lazy" />
                            {k === 0 && <span className="pj-shot-tag">primary</span>}
                          </a>
                        ))}
                      </div>
                      {!!s.pruned_count && s.pruned_count > 0 && (
                        <button type="button" className="pj-raw-toggle"
                                onClick={() => setShowRaw(v => !v)}>
                          {showRaw ? 'Hide' : 'Show'} {s.raw?.length ?? 0} original
                          {(s.raw?.length ?? 0) === 1 ? '' : 's'} — {s.pruned_count} pruned
                        </button>
                      )}
                      {showRaw && !!s.raw?.length && (
                        <div className="pj-gallery pj-gallery--raw">
                          {s.raw.map(u => (
                            <a key={u} href={u} target="_blank" rel="noreferrer" className="pj-shot">
                              <img src={u} alt="" loading="lazy"
                                   onError={e => { (e.currentTarget.closest('.pj-shot') as HTMLElement).style.display = 'none'; }} />
                            </a>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  {s.key === 'creative' && s.video && (
                    <div className="pj-gallery">
                      <video className="pj-video" src={s.video} poster={s.poster ?? undefined}
                             controls muted playsInline preload="metadata" />
                    </div>
                  )}

                  {current && <span className="pj-here">you are here</span>}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {j.creatives.length > 0 && (
        <section className="admin-detail-card">
          <h2>Creatives</h2>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr><th>Status</th><th>Enabled</th><th>Model</th><th>Cost</th><th>Completed</th></tr>
              </thead>
              <tbody>
                {j.creatives.map((c, i) => (
                  <tr key={i}>
                    <td>{c.status}{c.has_video ? '' : ' (no video)'}</td>
                    <td>{c.enabled ? 'yes' : 'no — will not promote'}</td>
                    <td>{c.model ?? '—'}</td>
                    <td>{c.cost_usd != null ? `$${Number(c.cost_usd).toFixed(2)}` : '—'}</td>
                    <td>{fmtClock(c.completed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

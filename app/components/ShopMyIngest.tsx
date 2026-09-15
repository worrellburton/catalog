// In-page ShopMy ingest: preview, confirm, live progress, results.
//
// Replaces a confirm dialog and a completion alert that showed nothing in
// between — a 600-product run takes minutes. Progress is read from a
// crawl_jobs row rather than held in this component, so closing the tab does
// not lose it and a died-mid-run job stays visible.

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '~/utils/supabase';
import { createProfileCrawlJob, getCrawlJob, type CrawlJob } from '~/services/site-crawls';
import {
  phaseFor, percentFor, summariseSkips, INGEST_ESTIMATED_SECONDS, type IngestPhase,
} from './shopmy-ingest-progress';

const POLL_MS = 5_000;   // matches ProductCrawlsPanel

interface PreviewRow {
  url: string; name: string; brand: string | null;
  price: string | null; image_url: string | null;
}
interface Preview {
  curator: string; collections: number; pins: number; mapped: number;
  skipped: Record<string, number>; has_more?: boolean;
  failures?: string[]; rows: PreviewRow[];
}
interface LandedRow {
  id: string; name: string | null; brand: string | null; price: string | null;
  image_url: string | null; image_verified: boolean | null; image_verify_note: string | null;
}

/** Recover an edge function's JSON body from a non-2xx invoke() error. */
async function edgeBody(err: unknown): Promise<Record<string, unknown> | null> {
  const ctx = (err as { context?: Response })?.context;
  if (!ctx || typeof ctx.json !== 'function') return null;
  try { return await ctx.json(); } catch { return null; }
}

/** Best-effort display name before the preview resolves. Never throws. */
function labelFor(raw: string): string {
  try {
    return new URL(raw).pathname.replace(/^\/(shop\/)?/, '') || raw;
  } catch {
    return raw;
  }
}

export default function ShopMyIngest({ url, onClose, onDone }:
  { url: string; onClose: () => void; onDone: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [job, setJob] = useState<CrawlJob | null>(null);
  const [landed, setLanded] = useState<LandedRow[]>([]);
  // Non-fatal: the products list going stale (RLS change, schema drift)
  // shouldn't clobber a more important `error` or stop the progress bar,
  // which is driven by the separately-awaited getCrawlJob call below.
  const [productsNote, setProductsNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Guards against a double-click firing start() twice before the first
  // click's job row / re-render lands — plain state wouldn't catch it
  // (both clicks would read the same stale `busy`), a ref mutates instantly.
  const startingRef = useRef(false);

  // ── preview ────────────────────────────────────────────────────────────
  const runPreview = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const { data, error: err } = await supabase!.functions.invoke('shopmy-ingest', {
        body: { url, dry_run: true },
      });
      const p = data ?? (err ? await edgeBody(err) : null);
      if (!p?.success) throw new Error(p?.error ?? (err as Error)?.message ?? 'preview failed');
      setPreview(p as Preview);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [url]);

  useEffect(() => { void runPreview(); }, [runPreview]);

  // ── poll the job row + the products it is writing ──────────────────────
  const poll = useCallback(async (jobId: string, curator: string) => {
    const fresh = await getCrawlJob(jobId).catch(() => null);
    if (fresh) setJob(fresh);
    const { data, error: productsErr } = await supabase!
      .from('products')
      .select('id, name, brand, price, image_url, image_verified, image_verify_note')
      .eq('source', 'shopmy')
      // PostgREST JSON-path filter — verified against the live DB (599 rows
      // for a known curator, matching `raw_data->'shopmy'->>'curator'` in SQL).
      .eq('raw_data->shopmy->>curator', curator)
      .order('created_at', { ascending: false })
      .limit(60);
    if (productsErr) setProductsNote(`Product list may be stale: ${productsErr.message}`);
    else {
      setProductsNote(null);
      if (data) setLanded(data as LandedRow[]);
    }
    // Anything other than pending/crawling is terminal, cancelled included —
    // a job can be cancelled from the crawl-jobs table while this polls.
    if (fresh && fresh.status !== 'pending' && fresh.status !== 'crawling') {
      if (timer.current) { clearInterval(timer.current); timer.current = null; }
      onDone();
    }
  }, [onDone]);

  // Unmount cleanup — a leaked interval would otherwise poll forever.
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  // ── commit ─────────────────────────────────────────────────────────────
  const start = useCallback(async () => {
    if (!preview || startingRef.current) return;
    startingRef.current = true;
    setBusy(true); setError(null);
    // Declared outside try so `finally` can see it — stays undefined if
    // createProfileCrawlJob itself throws, which is exactly the case the
    // finally-block re-poll below must not fire for.
    let created: CrawlJob | undefined;
    try {
      const createdJob = await createProfileCrawlJob(url, preview.curator);
      created = createdJob;
      setJob(createdJob);
      void poll(createdJob.id, preview.curator);
      timer.current = setInterval(() => void poll(createdJob.id, preview.curator), POLL_MS);

      const { data, error: err } = await supabase!.functions.invoke('shopmy-ingest', {
        body: { url, dry_run: false, job_id: createdJob.id },
      });
      // functions.invoke() nulls `data` and throws on any non-2xx — this
      // ingest returns its partial-failure summary at HTTP 500, so recovering
      // the real body via edgeBody() is load-bearing, not defensive.
      const run = data ?? (err ? await edgeBody(err) : null);
      if (!run) throw err ?? new Error('ingest returned no response');
      if (run.error) setError(run.error);
    } catch (e) {
      setError((e as Error).message);
      if (timer.current) { clearInterval(timer.current); timer.current = null; }
    } finally {
      setBusy(false);
      startingRef.current = false;
      // The edge function patches the job row to done/failed BEFORE it
      // returns its response, so by the time invoke() above resolves the
      // terminal state is already in the DB — re-poll now instead of
      // leaving the UI to wait out the next 5s tick. Uses `created` (the
      // local), never the `job` state var — that was the exact bug the
      // brief's draft had (stale closure, always read the pre-setJob
      // value). .catch swallows so a re-poll failure can't throw out of
      // finally; the `created` guard means this never fires when
      // createProfileCrawlJob itself failed.
      if (created) poll(created.id, preview.curator).catch(() => {});
    }
  }, [preview, url, poll]);

  const phase: IngestPhase | null = job ? phaseFor(job, INGEST_ESTIMATED_SECONDS) : null;
  const pct = job ? percentFor(job) : 0;

  return (
    <div className="admin-section">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>
          ShopMy · {preview?.curator ?? labelFor(url)}
        </h3>
        <button className="admin-btn admin-btn-secondary" onClick={onClose}>Close</button>
      </div>

      {error && <div className="admin-form-error">{error}</div>}

      {/* preview, before any write */}
      {!job && (
        busy ? <p className="admin-form-hint">Reading the shop…</p>
        : preview ? (
          <>
            <p className="admin-form-hint">
              {preview.collections} collections · {preview.pins} pins ·{' '}
              <strong>{preview.mapped} will be added</strong> · skipped: {summariseSkips(preview.skipped)}
              {preview.has_more ? ' · more collections exist than were listed' : ''}
            </p>
            <button className="admin-btn admin-btn-primary" disabled={busy} onClick={start}>
              Ingest {preview.mapped} products
            </button>
            <ProductTable rows={preview.rows.slice(0, 60)} />
          </>
        ) : null
      )}

      {/* live progress + what has landed */}
      {job && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '12px 0' }}>
            <div style={{ flex: 1, height: 6, borderRadius: 4, background: '#eee', overflow: 'hidden' }}>
              <div style={{
                width: `${pct}%`, height: '100%', borderRadius: 4,
                background: phase === 'failed' ? '#ef4444' : phase === 'stuck' ? '#f59e0b' : '#111',
                transition: 'width 0.3s ease',
              }} />
            </div>
            <span className="admin-form-hint" style={{ margin: 0, whiteSpace: 'nowrap' }}>
              {job.scraped_urls} / {job.total_urls ?? preview?.mapped ?? '?'} · {phase}
            </span>
          </div>
          {phase === 'stuck' && (
            <p className="admin-form-hint">
              This run has been going far longer than expected — it may have stopped.
              Re-running is safe: already-ingested products are skipped.
            </p>
          )}
          {phase === 'done' && job.scraped_urls === 0 && (
            <p className="admin-form-hint">
              Nothing new to add — these products are already in the catalog.
            </p>
          )}
          {productsNote && <p className="admin-form-hint">{productsNote}</p>}
          <LandedTable rows={landed} />
        </>
      )}
    </div>
  );
}

function ProductTable({ rows }: { rows: PreviewRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead><tr><th /><th>Brand</th><th>Product</th><th>Price</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.url}>
              <td>{r.image_url && <img src={r.image_url} alt="" width={40} height={40} loading="lazy" />}</td>
              <td>{r.brand ?? '—'}</td>
              <td>{r.name}</td>
              <td>{r.price ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LandedTable({ rows }: { rows: LandedRow[] }) {
  if (rows.length === 0) return <p className="admin-form-hint">No products yet…</p>;
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead><tr><th /><th>Brand</th><th>Product</th><th>Price</th><th>Image</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.image_url && <img src={r.image_url} alt="" width={40} height={40} loading="lazy" />}</td>
              <td>{r.brand ?? '—'}</td>
              <td>{r.name ?? '—'}</td>
              <td>{r.price ?? '—'}</td>
              <td>{r.image_verified === true ? 'verified'
                 : r.image_verify_note ?? 'checking…'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

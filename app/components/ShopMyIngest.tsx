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
/** The write invocation's response — a separate call from the preview, so
 * it can report failures (and a lower mapped count) the preview never saw. */
interface RunResult { failures?: string[]; }

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

export default function ShopMyIngest({
  url, sectionIds, creatorHandle, creatorDisplayName, creatorBio, includeCreator, onClose, onDone,
}:
  {
    url: string;
    /** Wizard step 3's selection. Undefined ingests whatever the URL addresses. */
    sectionIds?: number[];
    /** Wizard step 2's (possibly edited) handle. */
    creatorHandle?: string;
    /** Wizard step 2's (possibly edited) display name. Blank keeps ShopMy's. */
    creatorDisplayName?: string;
    /** Wizard step 2's (possibly edited) bio. Blank keeps ShopMy's. */
    creatorBio?: string;
    /** False keeps the legacy products-only behaviour. */
    includeCreator?: boolean;
    onClose: () => void;
    onDone: () => void;
  }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [job, setJob] = useState<CrawlJob | null>(null);
  const [run, setRun] = useState<RunResult | null>(null);
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
        body: {
          url, dry_run: true, section_ids: sectionIds, creator_handle: creatorHandle,
          creator_display_name: creatorDisplayName, creator_bio: creatorBio,
        },
      });
      const p = data ?? (err ? await edgeBody(err) : null);
      if (!p?.success) throw new Error(p?.error ?? (err as Error)?.message ?? 'preview failed');
      setPreview(p as Preview);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [url, sectionIds, creatorHandle, creatorDisplayName, creatorBio]);

  useEffect(() => { void runPreview(); }, [runPreview]);

  // ── poll the job row + the products it is writing ──────────────────────
  const poll = useCallback(async (jobId: string, curator: string) => {
    let fresh: CrawlJob | null = null;
    let deleted = false;
    try {
      fresh = await getCrawlJob(jobId);
    } catch (e) {
      // PGRST116 = PostgREST `.single()` found 0 rows — the job row was
      // deleted mid-run (the Delete button sits right in this panel). That's
      // the one case worth stopping the poll for. Any other error here
      // (network blip, cold start, timeout) is transient: swallow it and
      // let the next tick retry — the run can still be alive server-side
      // even when one poll request fails, and clearing the interval here
      // would freeze the bar without ever reaching a terminal state.
      if ((e as { code?: string })?.code === 'PGRST116') deleted = true;
    }
    if (fresh) setJob(fresh);
    if (deleted) {
      if (timer.current) { clearInterval(timer.current); timer.current = null; }
      setError('This crawl job was deleted.');
      onDone();
      return;
    }
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
    setBusy(true); setError(null); setRun(null);
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
        body: {
          url, dry_run: false, job_id: createdJob.id,
          section_ids: sectionIds, creator_handle: creatorHandle,
          creator_display_name: creatorDisplayName, creator_bio: creatorBio,
          include_creator: includeCreator === true,
        },
      });
      // functions.invoke() nulls `data` and throws on any non-2xx — this
      // ingest returns its partial-failure summary at HTTP 500, so recovering
      // the real body via edgeBody() is load-bearing, not defensive.
      const run = data ?? (err ? await edgeBody(err) : null);
      if (!run) throw err ?? new Error('ingest returned no response');
      if (run.error) setError(run.error);
      // Surfaced in the terminal view below — a collection that 5xx'd past
      // its retries lands here, and its pins never reached `mapped`.
      setRun(run as RunResult);
    } catch (e) {
      setError((e as Error).message);
      // Do NOT clear the interval here — progress lives in the crawl_jobs
      // row precisely so a dropped invoke() response (or the function
      // hitting its wall-clock limit mid-batch) doesn't lose a run that's
      // still alive server-side. Let poll() keep going; it reaches a
      // terminal status (done/failed/stuck) on its own.
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
  }, [preview, url, poll, sectionIds, creatorHandle, creatorDisplayName, creatorBio, includeCreator]);

  const phase: IngestPhase | null = job ? phaseFor(job, INGEST_ESTIMATED_SECONDS) : null;
  const pct = job ? percentFor(job) : 0;
  // `||`, not `??` — a freshly-created job row's total_urls defaults to 0,
  // and 0 must fall through to the previewed count instead of showing "0/0".
  const total = job ? (job.total_urls || preview?.mapped) : undefined;
  // The write run is a SEPARATE invocation from the preview and refetches
  // every collection — a collection that 5xx's past its retries this time
  // pushes its pins to `failures`, and total_urls ends up lower than what
  // the operator confirmed in the preview. Surface that gap rather than
  // silently displaying only the (already-adjusted) smaller number.
  const shortfall = !!job?.total_urls && preview != null && job.total_urls !== preview.mapped;

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
              {job.scraped_urls} / {total ?? '?'}{shortfall ? ` (${preview?.mapped} expected)` : ''} · {phase}
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
          {phase === 'done' && job.scraped_urls > 0 && total != null && job.scraped_urls < total && (
            <p className="admin-form-hint">
              The bar reads 100% because the run finished — only {job.scraped_urls} of {total} needed
              a write; the rest were already present and unchanged.
            </p>
          )}
          {run?.failures && run.failures.length > 0 && (
            <div className="admin-form-error">
              <strong>
                {run.failures.length} collection{run.failures.length === 1 ? '' : 's'} failed to load
              </strong>{' '}
              — {run.failures.length === 1 ? 'its' : 'their'} pins were not ingested and are not
              counted above:
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {run.failures.map((f) => <li key={f}>{f}</li>)}
              </ul>
            </div>
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

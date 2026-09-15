# ShopMy Ingest Visible Progress — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a ShopMy ingest run visible in the panel it was launched from — a real progress bar, products appearing as they land, and a results table — replacing two modal dialogs that showed nothing in between.

**Architecture:** The ingest writes a `crawl_jobs` row and bumps `scraped_urls` per committed batch; the admin polls it every 5s. Progress lives in the database, so it survives the tab and a died-mid-run job stays visible. Derived logic sits in pure, unit-tested helpers; the React component stays thin around them.

**Tech Stack:** Remix/React, TypeScript, Deno edge function, Supabase (`crawl_jobs`), vitest for `app/**` units.

**Spec:** `docs/superpowers/specs/2026-09-15-shopmy-ingest-progress-design.md`

## Global Constraints

- **Branch is `dev`. Commit directly to `dev`.** Never create a branch of any kind. Never force-push. (`CLAUDE.md`)
- **Progress reporting must never break the ingest.** Every `crawl_jobs` write in the edge function is wrapped in try/catch and its failure ignored. A missing or invalid `job_id` still ingests.
- **`job_id` is optional.** Existing callers that omit it (the controller's `curl`, any script) must behave exactly as today.
- **Do not change** the dry-run default, the 25-row batch cap, the `isFinite` throttle guard, the in-batch `DISTINCT ON` dedup, the admin auth gate, the CORS block, or the mapper.
- Vitest only collects `app/**/*.test.{ts,tsx}` (`vite.config.ts:31`). There is **no React Testing Library** — component behaviour is not unit-testable here, so derived logic goes in pure helpers.
- `npm run lint` fails project-wide from a pre-existing ESLint flat-config issue. Not yours; ignore it.
- Do not deploy. The controller deploys and applies.

---

## File Structure

| File | Responsibility |
|---|---|
| `app/components/shopmy-ingest-progress.ts` | Pure helpers: phase, percent, skip summary. No React, no I/O. |
| `app/components/shopmy-ingest-progress.test.ts` | Vitest cases for the above |
| `supabase/functions/shopmy-ingest/index.ts` | Accept `job_id`; best-effort `crawl_jobs` updates (modify) |
| `app/components/ShopMyIngest.tsx` | Preview → confirm → progress → results |
| `app/components/ProfileCrawlsPanel.tsx` | Hand off to `ShopMyIngest`; fix the Retry hazard (modify) |

Task 1 has no dependencies. Task 2 is independent of Task 1. Task 3 consumes both. Task 4 wires Task 3 in.

---

### Task 1: Pure progress helpers

**Files:**
- Create: `app/components/shopmy-ingest-progress.ts`
- Test: `app/components/shopmy-ingest-progress.test.ts`

**Interfaces:**
- Consumes: `CrawlJob` from `~/services/site-crawls`, `isStuck` from `~/utils/aiBudget`.
- Produces:
  - `type IngestPhase = 'queued' | 'active' | 'stuck' | 'done' | 'failed'`
  - `phaseFor(job: CrawlJob, estimatedSeconds?: number): IngestPhase`
  - `percentFor(job: CrawlJob): number` — integer 0–100
  - `summariseSkips(skipped: Record<string, number> | null | undefined): string`
  - `INGEST_ESTIMATED_SECONDS: number`

- [ ] **Step 1: Write the failing test**

Create `app/components/shopmy-ingest-progress.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  phaseFor, percentFor, summariseSkips, INGEST_ESTIMATED_SECONDS,
} from './shopmy-ingest-progress';
import type { CrawlJob } from '~/services/site-crawls';

const job = (over: Partial<CrawlJob>): CrawlJob => ({
  id: 'j1', site_url: 'https://shopmy.us/shop/x', site_name: 'x',
  job_type: 'profile', status: 'pending', total_urls: 0, scraped_urls: 0,
  error: null, started_at: null, completed_at: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  ...over,
});

describe('phaseFor', () => {
  it('maps each status', () => {
    expect(phaseFor(job({ status: 'pending' }))).toBe('queued');
    expect(phaseFor(job({ status: 'crawling' }))).toBe('active');
    expect(phaseFor(job({ status: 'done' }))).toBe('done');
    expect(phaseFor(job({ status: 'failed' }))).toBe('failed');
    expect(phaseFor(job({ status: 'cancelled' }))).toBe('failed');
  });

  it('flags a long-running crawl as stuck, using started_at when present', () => {
    const old = new Date(Date.now() - 3600_000).toISOString();
    expect(phaseFor(job({ status: 'crawling', started_at: old }))).toBe('stuck');
    expect(phaseFor(job({ status: 'crawling', created_at: old, started_at: null }))).toBe('stuck');
  });

  it('does not flag a finished job as stuck however old it is', () => {
    const old = new Date(Date.now() - 86_400_000).toISOString();
    expect(phaseFor(job({ status: 'done', started_at: old }))).toBe('done');
    expect(phaseFor(job({ status: 'failed', started_at: old }))).toBe('failed');
  });
});

describe('percentFor', () => {
  it('is 0 when nothing is known yet', () => {
    expect(percentFor(job({ total_urls: 0, scraped_urls: 0 }))).toBe(0);
  });

  it('never returns NaN or Infinity for a zero denominator', () => {
    const p = percentFor(job({ total_urls: 0, scraped_urls: 5 }));
    expect(Number.isFinite(p)).toBe(true);
    expect(p).toBe(0);
  });

  it('computes a normal fraction', () => {
    expect(percentFor(job({ total_urls: 200, scraped_urls: 50 }))).toBe(25);
  });

  it('clamps above 100 and below 0', () => {
    expect(percentFor(job({ total_urls: 10, scraped_urls: 99 }))).toBe(100);
    expect(percentFor(job({ total_urls: 10, scraped_urls: -5 }))).toBe(0);
  });

  it('reports 100 for a completed job even if the counters disagree', () => {
    expect(percentFor(job({ status: 'done', total_urls: 200, scraped_urls: 0 }))).toBe(100);
  });
});

describe('summariseSkips', () => {
  it('renders none for empty input', () => {
    expect(summariseSkips(null)).toBe('none');
    expect(summariseSkips(undefined)).toBe('none');
    expect(summariseSkips({})).toBe('none');
  });

  it('renders counts, largest first', () => {
    expect(summariseSkips({ non_product_url: 2, no_brand_or_price: 16 }))
      .toBe('16 no_brand_or_price, 2 non_product_url');
  });

  it('exports a positive time estimate', () => {
    expect(INGEST_ESTIMATED_SECONDS).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run app/components/shopmy-ingest-progress.test.ts`
Expected: FAIL — cannot resolve `./shopmy-ingest-progress`.

- [ ] **Step 3: Write the helpers**

Create `app/components/shopmy-ingest-progress.ts`:

```ts
// Derived view-state for a ShopMy ingest run. Pure — no React, no I/O — so the
// logic the progress UI depends on is unit-testable even though the component
// itself is not (the repo has vitest but no React Testing Library).

import type { CrawlJob } from '~/services/site-crawls';
import { isStuck } from '~/utils/aiBudget';

/**
 * Typical wall-clock for a creator-shop ingest. A 600-product shop takes
 * minutes: ~65 collection fetches, then 24 batches of 25 with a 1.5s pause
 * between them. Used only to decide when a run looks stuck.
 */
export const INGEST_ESTIMATED_SECONDS = 240;

export type IngestPhase = 'queued' | 'active' | 'stuck' | 'done' | 'failed';

export function phaseFor(
  job: CrawlJob,
  estimatedSeconds: number = INGEST_ESTIMATED_SECONDS,
): IngestPhase {
  if (job.status === 'done') return 'done';
  // A cancelled run is terminal and not a success — surface it like a failure.
  if (job.status === 'failed' || job.status === 'cancelled') return 'failed';
  if (job.status === 'crawling') {
    // Measure from when work began; fall back to insert time if it never did.
    return isStuck(job.started_at ?? job.created_at, estimatedSeconds) ? 'stuck' : 'active';
  }
  return 'queued';
}

/** Integer 0-100. Never NaN, never out of range, whatever the counters say. */
export function percentFor(job: CrawlJob): number {
  if (job.status === 'done') return 100;
  const total = Number(job.total_urls) || 0;
  const done = Number(job.scraped_urls) || 0;
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

/** "16 no_brand_or_price, 2 non_product_url" — largest reason first. */
export function summariseSkips(skipped: Record<string, number> | null | undefined): string {
  const entries = Object.entries(skipped ?? {}).filter(([, n]) => Number(n) > 0);
  if (entries.length === 0) return 'none';
  return entries
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => `${n} ${reason}`)
    .join(', ');
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run app/components/shopmy-ingest-progress.test.ts` → PASS.
Then the full suite: `npx vitest run` and `npm run typecheck` → both clean.

- [ ] **Step 5: Commit**

```bash
git add app/components/shopmy-ingest-progress.ts app/components/shopmy-ingest-progress.test.ts
git commit -m "feat(shopmy): pure progress helpers for the ingest UI

Phase, percent and skip-summary derived from a crawl_jobs row. Pure so they
can be unit-tested — the repo has vitest but no React Testing Library, so any
logic left inside the component would be untested.

percentFor clamps and guards a zero denominator: total_urls is 0 until mapping
finishes, and a naive division would render NaN% for the first seconds of
every run."
```

---

### Task 2: `job_id` support in the edge function

**Files:**
- Modify: `supabase/functions/shopmy-ingest/index.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: the request body accepts an optional `job_id: string`. When present, the function updates that `crawl_jobs` row: `status`/`started_at` on entry, `total_urls` once mapping completes, `scraped_urls` after each committed batch, and `status`/`completed_at`/`error` at the end. All best-effort.

- [ ] **Step 1: Add the helper**

Near the other module-level helpers in `supabase/functions/shopmy-ingest/index.ts`:

```ts
/**
 * Best-effort progress reporting. A failure here must NEVER fail the ingest —
 * the job row is for the operator's benefit, the products are the point. A
 * missing or invalid job_id simply means the run is unreported.
 */
async function patchJob(
  admin: ReturnType<typeof createClient>,
  jobId: string | null,
  patch: Record<string, unknown>,
): Promise<void> {
  if (!jobId) return;
  try {
    await admin.from('crawl_jobs').update(patch).eq('id', jobId);
  } catch { /* progress is not worth failing an ingest over */ }
}
```

- [ ] **Step 2: Read `job_id` and hoist the admin client**

The admin client is currently created inside the write branch. The auth gate already builds one earlier — reuse that instance rather than creating a second. Read the id alongside the other body fields:

```ts
    const jobId: string | null = typeof body.job_id === 'string' ? body.job_id : null;
```

**A dry run must not touch the job row.** Only the write path reports progress.

- [ ] **Step 3: Report at four points**

In the write path only, after the `dryRun` early-return:

```ts
    await patchJob(admin, jobId, {
      status: 'crawling',
      started_at: new Date().toISOString(),
      total_urls: unique.length,
    });
```

Inside the batch loop, after a batch commits successfully:

```ts
      await patchJob(admin, jobId, { scraped_urls: inserted + merged });
```

Wrap the batch loop so the closing patch **always** runs. A bare statement after
the loop is skipped when the loop body throws a genuine JS exception (as opposed
to the RPC returning an `{error}` object) — control jumps to the outer catch, and
the job row is stranded at `'crawling'` with no `completed_at` forever. That is
exactly the failure mode this feature exists to surface:

```ts
    try {
      for (let i = 0; i < unique.length; i += batchSize) {
        // …existing loop body, unchanged…
      }
    } catch (e) {
      // A throw here (library fault, runtime error) would otherwise skip the
      // closing patch entirely. Turn it into a writeError so the row is closed
      // out AND the caller still gets the partial summary.
      writeError = `unexpected error during write: ${String(e).slice(0, 200)}`;
    }

    await patchJob(jobId, {
      status: writeError ? 'failed' : 'done',
      completed_at: new Date().toISOString(),
      scraped_urls: inserted + merged,
      error: writeError,
    });
```

This also improves the non-job case: today a throw inside the loop loses the
whole run summary to the generic 500 handler, discarding the `inserted`/`merged`
counts for batches that already committed. Converting it to a `writeError` means
the existing partial-summary response covers it.

`scraped_urls` is `inserted + merged` — rows the run actually accounted for. Note a no-op merge increments neither (the guard in migration `20260915000002` skips it), so a fully idempotent re-run legitimately finishes at 0 of N; that is correct, not a bug, and the results table makes it obvious.

- [ ] **Step 4: Type-check**

Run: `deno check --no-lock supabase/functions/shopmy-ingest/index.ts` → clean.

- [ ] **Step 5: Verify the guarantees by reading the code**

State in your report, with line references:
1. A request **without** `job_id` behaves exactly as before — no `crawl_jobs` read or write.
2. A **dry run** never touches `crawl_jobs`, even when `job_id` is supplied.
3. Every `patchJob` call is awaited but cannot throw.
4. Only one admin client is constructed per request.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/shopmy-ingest/index.ts
git commit -m "feat(shopmy-ingest): report progress into a crawl_jobs row

Optional job_id. When present the write path sets status/total_urls on entry,
bumps scraped_urls after each committed batch, and closes the row out with
done/failed plus the error.

Every job write is best-effort and swallowed: progress is for the operator,
the products are the point, and a bad job_id must not cost an ingest. A dry
run never touches the row, and a request without job_id behaves as before."
```

---

### Task 3: The `ShopMyIngest` component

**Files:**
- Create: `app/components/ShopMyIngest.tsx`

**Interfaces:**
- Consumes: `phaseFor`, `percentFor`, `summariseSkips`, `INGEST_ESTIMATED_SECONDS` (Task 1); `job_id` support (Task 2); `createProfileCrawlJob`, `getCrawlJob`, type `CrawlJob` from `~/services/site-crawls`; `supabase` from `~/utils/supabase`.
- Produces: `export default function ShopMyIngest({ url, onClose, onDone }: { url: string; onClose: () => void; onDone: () => void })`.

**States:** `previewing` → `preview` → (`running` → `finished`) | `error`.

- [ ] **Step 1: Build the component**

Create `app/components/ShopMyIngest.tsx`:

```tsx
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
  phaseFor, percentFor, summariseSkips, INGEST_ESTIMATED_SECONDS,
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
async function edgeBody(err: unknown): Promise<Record<string, any> | null> {
  const ctx = (err as { context?: Response })?.context;
  if (!ctx || typeof ctx.json !== 'function') return null;
  try { return await ctx.json(); } catch { return null; }
}

export default function ShopMyIngest({ url, onClose, onDone }:
  { url: string; onClose: () => void; onDone: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [job, setJob] = useState<CrawlJob | null>(null);
  const [landed, setLanded] = useState<LandedRow[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

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
    const { data } = await supabase!
      .from('products')
      .select('id, name, brand, price, image_url, image_verified, image_verify_note')
      .eq('source', 'shopmy')
      .eq('raw_data->shopmy>>curator', curator)
      .order('created_at', { ascending: false })
      .limit(60);
    if (data) setLanded(data as LandedRow[]);
    if (fresh && (fresh.status === 'done' || fresh.status === 'failed')) {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      onDone();
    }
  }, [onDone]);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  // ── commit ─────────────────────────────────────────────────────────────
  const start = async () => {
    if (!preview || busy) return;
    setBusy(true); setError(null);
    try {
      const created = await createProfileCrawlJob(url, preview.curator);
      setJob(created);
      timer.current = setInterval(() => void poll(created.id, preview.curator), POLL_MS);
      void poll(created.id, preview.curator);

      const { data, error: err } = await supabase!.functions.invoke('shopmy-ingest', {
        body: { url, dry_run: false, job_id: created.id },
      });
      const run = data ?? (err ? await edgeBody(err) : null);
      if (!run) throw err ?? new Error('ingest returned no response');
      if (run.error) setError(run.error);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (preview) void poll((job ?? { id: '' }).id || '', preview.curator).catch(() => {});
    }
  };

  const phase = job ? phaseFor(job, INGEST_ESTIMATED_SECONDS) : null;
  const pct = job ? percentFor(job) : 0;

  return (
    <div className="admin-panel-section">
      <div className="admin-panel-header">
        <h3>ShopMy · {preview?.curator ?? new URL(url).pathname.replace(/^\/(shop\/)?/, '')}</h3>
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
          <div className="admin-progress-row">
            <div className="admin-progress-track">
              <div className="admin-progress-bar" style={{ width: `${pct}%` }} />
            </div>
            <span className="admin-progress-label">
              {job.scraped_urls} / {job.total_urls || preview?.mapped || '?'} · {phase}
            </span>
          </div>
          {phase === 'stuck' && (
            <p className="admin-form-hint">
              This run has been going far longer than expected — it may have stopped.
              Re-running is safe: already-ingested products are skipped.
            </p>
          )}
          <LandedTable rows={landed} />
        </>
      )}
    </div>
  );
}

function ProductTable({ rows }: { rows: PreviewRow[] }) {
  if (rows.length === 0) return null;
  return (
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
  );
}

function LandedTable({ rows }: { rows: LandedRow[] }) {
  if (rows.length === 0) return <p className="admin-form-hint">No products yet…</p>;
  return (
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
  );
}
```

- [ ] **Step 2: Verify the PostgREST JSON filter**

`.eq('raw_data->shopmy>>curator', curator)` is PostgREST's JSON-path filter syntax and is the line most likely to be wrong. Confirm it returns rows before trusting the UI — run a read-only check via the Supabase MCP or a scratch script:

```sql
select count(*) from products
 where source = 'shopmy' and raw_data->'shopmy'->>'curator' = 'alexandraleclerc';
```

Expected: `599`. If the PostgREST spelling does not match that count, fix the filter (an `.filter('raw_data->shopmy>>curator', 'eq', curator)` form, or fetching by `site_name`) and say which you used and why.

- [ ] **Step 3: Check the styling hooks exist**

`admin-panel-section`, `admin-progress-row`, `admin-progress-track`, `admin-progress-bar`, `admin-progress-label`, `admin-table` — grep the admin CSS. **Use the classes that actually exist**; if a progress class is missing, either reuse whatever `JobProgress` renders or add the minimal rule alongside the existing admin styles. Report which you used.

- [ ] **Step 4: Typecheck and test**

Run: `npm run typecheck && npx vitest run` → both clean.

- [ ] **Step 5: Commit**

```bash
git add app/components/ShopMyIngest.tsx
git commit -m "feat(admin): in-page ShopMy ingest with live progress

Preview, confirm, progress and results in the panel instead of a confirm
dialog and a completion alert that showed nothing in between — a 600-product
run takes minutes.

Progress is read from the crawl_jobs row rather than held in component state,
so closing the tab does not lose it and a stalled run shows as stuck rather
than spinning forever."
```

---

### Task 4: Wire it into the panel, and fix the Retry hazard

**Files:**
- Modify: `app/components/ProfileCrawlsPanel.tsx`

**Interfaces:**
- Consumes: `ShopMyIngest` (Task 3), the existing `isShopMyUrl`.
- Produces: no new exports.

- [ ] **Step 1: Replace the dialog branch with the component**

Add state for the pending ShopMy URL, and replace the existing `if (isShopMyUrl(url)) { … }` block inside `handleAdd` with:

```tsx
    if (isShopMyUrl(url)) {
      setShopMyUrl(url);   // hand off to <ShopMyIngest>; it owns preview + confirm
      return;
    }
```

Render it above the jobs table:

```tsx
      {shopMyUrl && (
        <ShopMyIngest
          url={shopMyUrl}
          onClose={() => { setShopMyUrl(null); loadData(); }}
          onDone={loadData}
        />
      )}
```

Delete the now-unused `adding` state, the `edgeBody` helper and the `catalogConfirm`/`catalogAlert` ShopMy branch — they move into `ShopMyIngest`. **Leave `catalogAlert`/`catalogConfirm` imported**: the AI-crawl path and `handleDelete` still use them.

- [ ] **Step 2: Fix the Retry hazard**

`handleRetry` currently calls `triggerProfileCrawl` for every row, so retrying a ShopMy run would fire the **AI crawler** at a ShopMy URL — the expensive path this feature exists to avoid. Branch on the same host check:

```tsx
  const handleRetry = async (job: CrawlJob) => {
    // A ShopMy row must never be retried through the AI crawler.
    if (isShopMyUrl(job.site_url)) {
      setShopMyUrl(job.site_url);
      return;
    }
    // …existing AI-crawl retry, unchanged…
  };
```

- [ ] **Step 3: Poll the jobs list while a run is active**

The panel loads once on mount. Add an interval so a running job's row updates, matching `ProductCrawlsPanel`:

```tsx
  useEffect(() => {
    const active = jobs.some((j) => j.status === 'pending' || j.status === 'crawling');
    if (!active) return;
    const t = setInterval(() => { void loadData(); }, 5_000);
    return () => clearInterval(t);
  }, [jobs, loadData]);
```

Only poll while something is actually running — an idle admin tab must not hammer the database forever.

- [ ] **Step 4: Verify both paths by reading the code**

State in your report:
1. A non-ShopMy URL still reaches `createProfileCrawlJob` + `triggerProfileCrawl` with identical arguments.
2. A ShopMy URL creates **no** `crawl_jobs` row until the operator confirms inside `ShopMyIngest`.
3. Retry on a ShopMy row does not call `triggerProfileCrawl`.
4. The poll stops when no job is `pending`/`crawling`.

- [ ] **Step 5: Typecheck and test**

Run: `npm run typecheck && npx vitest run` → both clean. 152 tests currently pass, plus Task 1's.

- [ ] **Step 6: Commit**

```bash
git add app/components/ProfileCrawlsPanel.tsx
git commit -m "feat(admin): hand ShopMy URLs to the in-page ingest, fix Retry

The panel now hands a ShopMy URL to ShopMyIngest, which owns preview, confirm,
progress and results; the AI-crawl path is untouched.

Also fixes a hazard the job-row reuse exposed: handleRetry called
triggerProfileCrawl unconditionally, so retrying a ShopMy run would have fired
the AI crawler at a ShopMy URL — the expensive path this feature avoids.

Polls the jobs list only while a run is active, so an idle admin tab does not
poll forever."
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| §3 architecture, job row + polling | 2, 4 |
| §3.1 `crawl_jobs` field mapping | 2 |
| §3.2 job-table reuse + the Retry hazard | 4 |
| §3.3 polling cadence | 3 (5s), 4 (5s, gated on activity) |
| §4 components + products table | 1, 3 |
| §5 error handling, best-effort job writes | 2 (helper), 3 (preview/partial/stuck) |
| §6 testing via pure helpers | 1 |
| §8 rollout | controller deploys after Task 2 |

**Placeholder scan:** none. Every code step carries real code; Steps 2 and 3 of Task 3 are deliberate verification steps with an expected value (`599`) rather than TODOs.

**Type consistency:** `phaseFor`/`percentFor`/`summariseSkips` signatures match between Task 1's implementation, its tests, and Task 3's usage. `CrawlJob` is imported from `~/services/site-crawls` in all three. `createProfileCrawlJob(url, name)` matches `site-crawls.ts:150`.

**Known risk, flagged rather than hidden:** the PostgREST JSON-path filter in Task 3 (`raw_data->shopmy>>curator`) is the single most likely thing to be wrong, which is why Step 2 makes verifying it a task step with a concrete expected count instead of an assumption.

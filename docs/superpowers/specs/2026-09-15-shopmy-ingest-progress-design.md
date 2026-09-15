# ShopMy Ingest — Visible Progress

Status: **approved, ready for planning** · Date: 2026-09-15 · Branch: `dev`

Make a ShopMy ingest run visible while it happens: a progress bar in the panel it
was launched from, products appearing as they land, and a results table
afterwards. Replaces two modal dialogs that showed nothing in between.

Builds on `2026-09-15-shopmy-ingest-design.md`, which is shipped and live.

---

## 1. Problem

The first real run against a full creator shop exposed the gap. Measured
2026-09-15 against `alexandraleclerc`:

| Finding | Evidence |
|---|---|
| A 599-product run reports nothing between start and finish | one `catalogConfirm`, then minutes of a disabled button, then one `catalogAlert` |
| The run leaves no trace in the panel that launched it | ShopMy ingest writes `products` directly and creates **no `crawl_jobs` row**; the Profiles tab lists `crawl_jobs` |
| Progress cannot survive the tab | the whole run is one blocking `functions.invoke` in the browser |
| A run that dies mid-way vanishes silently | nothing records that it started |
| The panel never refreshes | `ProfileCrawlsPanel` loads once on mount; siblings poll (`ProductCrawlsPanel` 5s, `SiteCrawlsPanel` 15s) |

The operator's report was that after confirming, the button said "Ingesting…"
and then nothing appeared to happen — and that afterwards they could not find
the products. Both are true from where they were standing: the 621 products were
written correctly and sit at the top of `/admin/data?tab=products` (ranks 1–621
by `scraped_at`), but the Profiles tab had nothing to show either during or
after, because no job row exists.

**This is a visibility problem, not a correctness one.** The ingest itself works:
621 rows, 528 images verified and re-hosted, 0 leaked to the feed.

## 2. Decisions

| Question | Decision |
|---|---|
| Where progress lives | **A `crawl_jobs` row, polled.** The ingest writes and updates one; the panel polls every 5s and renders it with the existing `JobProgress` bar in the table that is already there. |
| What the products view shows | **Live as they land, then a final table.** Rows appear per batch with image, brand, name, price and verification status; skipped pins are shown with their reason. |
| The confirm gate | **Kept, but in-page.** Still an explicit confirm before writing — 600 rows is not a click-through — just a preview panel with a button instead of a modal. |

Rejected: a client-driven loop (progress dies with the tab, orchestration moves
into the UI) and a streaming response (new pattern for this repo, still leaves
nothing behind on failure).

## 3. Architecture

`shopmy-ingest` gains an optional **`job_id`**. When present, it updates that
`crawl_jobs` row as it works. No schema change — `job_type: 'profile'` already
exists and is what the AI profile crawl uses.

```
submit ShopMy URL
  → dry run                  → in-page preview: counts, products, skip reasons
  → operator clicks "Ingest N products"
  → create crawl_jobs row    → status 'pending', site_url, site_name = curator
  → invoke with job_id       → function sets 'crawling', total_urls, then
                               bumps scraped_urls after each committed batch
  → panel polls every 5s     → JobProgress bar + products table fill in
  → function finishes        → status 'done' (or 'failed' + error)
```

Because progress is a database row rather than a promise in a tab, closing the
page does not lose it, and a run that dies mid-way stays visible as a stale
`crawling` row instead of disappearing.

### 3.1 `crawl_jobs` field mapping

| Column | Value |
|---|---|
| `job_type` | `'profile'` |
| `site_url` | the submitted ShopMy URL |
| `site_name` | the curator username |
| `status` | `pending` → `crawling` → `done` \| `failed` |
| `total_urls` | mapped row count (what will be written), set once mapping completes |
| `scraped_urls` | rows committed so far, bumped per batch |
| `error` | the write error, on partial or total failure |
| `started_at` / `completed_at` | set on transition |

`total_urls` is deliberately the **mapped** count, not the pin count — it is the
denominator the progress bar needs, and it is what the operator confirmed.

### 3.2 The existing job table picks these up for free — including Retry

`ProfileCrawlsPanel` already calls `listCrawlJobs({ jobType: 'profile' })`
(`app/services/site-crawls.ts:106`), so a ShopMy run written as a
`job_type: 'profile'` row appears in the table that is already rendered — during
the run, and afterwards as history. Nothing about the list needs to change.

**But the row's action buttons do.** `handleRetry` calls `retryCrawlJob(job.id)`
then `triggerProfileCrawl(...)` — so pressing Retry on a ShopMy row would fire
the **AI profile crawler** at a ShopMy URL, which is exactly the expensive path
this feature exists to avoid. Retry must branch on the same host check and
re-run the ShopMy ingest instead.

`handleDelete` is safe as-is: it deletes the job row and its discovered URLs, of
which a ShopMy run has none. It does not touch `products` — deleting a run's
record must not delete the products it created.

### 3.3 Why polling rather than realtime

`ProductCrawlsPanel` (5s) and `SiteCrawlsPanel` (15s) both poll, and this panel
already imports `isStuck` from `~/utils/aiBudget`. Matching that costs nothing
and keeps one pattern in the admin. Realtime is used elsewhere in the app but
would be a second mechanism here for no gain at this cadence.

## 4. Components

`ProfileCrawlsPanel.tsx` is ~350 lines. Adding a preview, a progress view and a
products table would push it past 500, so the new surface lives in its own
component:

| File | Responsibility |
|---|---|
| `app/components/ShopMyIngest.tsx` | Preview → confirm → progress → results. Owns the ShopMy path end to end. |
| `app/components/shopmy-ingest-progress.ts` | Pure helpers: phase from a job row, percent complete, skip-reason summary. Unit-tested. |
| `app/components/ProfileCrawlsPanel.tsx` | Detects a ShopMy host and hands off; keeps owning the AI-crawl path unchanged. |
| `supabase/functions/shopmy-ingest/index.ts` | Accepts `job_id`, updates the row. |

The products table reads:

```sql
select … from products
 where source = 'shopmy'
   and raw_data->'shopmy'->>'curator' = <username>
 order by created_at desc
```

showing image thumbnail, brand, name, price, and verification status
(`clean` / `needs_review:*` / not yet checked) — so the operator can watch images
verify in the minutes after the rows land.

## 5. Error handling

| Condition | Behaviour |
|---|---|
| Dry run fails | Error shown in-page with a retry; nothing written |
| Operator cancels | Nothing written, no job row created |
| Write fails mid-run | Job row gets `status='failed'` and the error; the **partial** `inserted`/`merged` are still shown — that logic already exists and must not regress |
| Run dies (timeout, tab closed) | Row stays `crawling`; `isStuck` renders a stuck badge rather than a spinner forever |
| `job_id` points at a missing row | The ingest still runs and still writes; job updates are best-effort and must never fail the ingest |

That last rule matters: **progress reporting must never be able to break the
ingest.** Every job-row write is wrapped and its failure ignored.

## 6. Testing

The React component cannot be unit-tested here — vitest only collects
`app/**/*.test.{ts,tsx}` and the repo has no React Testing Library. So the
derived logic lives in pure exported helpers and is tested there:

1. `phaseFor(job)` returns `queued` / `active` / `stuck` / `done` / `failed` for
   each status, including a `crawling` row older than the stuck threshold.
2. `percentFor(job)` handles `total_urls = 0`, `scraped_urls > total_urls`, and
   nulls without returning `NaN` or exceeding 100.
3. `summariseSkips({no_brand_or_price: 16, non_product_url: 2})` renders a
   readable line, and an empty object renders "none".

The component stays thin around these.

## 7. Out of scope

- **Making the run faster.** 600 products still takes minutes; the throttle is
  deliberate and documented in the ingest spec's §6a.
- **Pagination of `/admin/data?tab=products`.** That list has no `.range()` and
  relies on PostgREST's 1000-row default, so ~148 of the current 1,148 products
  are already unreachable. Real, pre-existing, and tracked separately.
- **Resuming a failed run** from where it stopped. A re-run is already cheap and
  idempotent (measured: 22 merged, then 0, then 0), so retry is just re-running.
- **Backfilling job rows** for the two shops already ingested.
- The `/api/Shop/products` gallery enrichment (2–8 images per product), noted in
  the ingest runbook as the next worthwhile change.

## 8. Rollout

1. Add `job_id` support to `shopmy-ingest`; deploy. Existing callers that omit it
   are unaffected.
2. Build `ShopMyIngest.tsx` behind the existing host detection.
3. Verify against a small shop, or a single collection of a large one, before a
   full run.

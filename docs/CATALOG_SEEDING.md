# Catalog Seeding — Demand-Driven, Quality-Gated

> Single source of truth + **revert ledger** for the automated catalog-seeding
> feature. Every change made for this feature is logged in the **Change Log**
> with the exact way to undo it in the **Revert Manifest**. If we need to pull
> the whole feature, the Revert Manifest is the checklist.

Status: **in build** · Started 2026-06-29 · Branch `dev`

---

## 1. Goal

Grow the catalog automatically with **quality** products, driven by **real
shopper demand** — no manual data entry. Two demand sources feed one loop:

1. **Search terms** — what shoppers type (`search_logs`): "white shoes", "date night".
2. **Stylist scenarios** — what shoppers ask the AI stylist (`style_up_traces`):
   "beach trip, what do I wear?". A scenario expands into a full outfit, so a
   scenario is "covered" only when every garment slot has a strong, gender-
   appropriate option.

## 2. The loop (reuses existing machinery)

```
Demand                 Expand to queries        Fetch products          Gate          Publish
search term /   ─────► catalog-brainstorm ────► product-search    ────► image +  ───► is_active
scenario               (vibe→queries, EXISTS)   {ingest:true}            occasion       = true
                                                 (Google Shopping,        (gate)
                                                  EXISTS)
```

Existing pieces we orchestrate (do NOT rebuild):

| Piece | What it already does |
|---|---|
| `supabase/functions/catalog-brainstorm` | vibe/scenario → up to 8 concrete product queries (Claude) |
| `supabase/functions/product-search` | `{ingest:true}` fetches Google Shopping (SerpAPI) AND inserts into `products` + triggers embedding. 1 search + up to `detailLimit`(5) immersive lookups per query (~6 SerpAPI credits/query) |
| Enrichment spine (triggers) | on a clean `products` insert: pick-primary-image → haiku-context → embed-product → enrich-similarity → catalog auto-membership, hands-off |
| `supabase/functions/ai-stylist`, `style-up-chat` | assemble an outfit from gender-filtered catalog; already personalize by profile gender/height/weight/age. Powers the **Simulate** page |
| `style_up_traces` | records what stylists searched for = automatic scenario gap signal |
| `weekly_recrawl_enabled` / `app_settings` | kill-switch + flag pattern we mirror |

## 3. Ground truth at start (2026-06-29)

- products: 266 total / 192 active / 104 brands, ~all added in last 30 days.
- demand: `search_logs` 633 rows, 139 distinct real terms, 271 in last 7d, **53
  zero-result** (top-priority seed targets).
- `quality_score` is **dead** (median 100, read by nothing) — NOT used as a gate.
- Real gate = **image present (already enforced by trigger 071) + occasion text
  non-empty** (12 active rows fail today).
- Dedup already imperfect: 265 distinct urls but 250 distinct (brand,name) at 266 rows.

## 4. Data model

### `seed_targets` (new) — the work queue
One row per seed target (keyword or scenario). Backs the **Seeding** admin page.

| column | purpose |
|---|---|
| `term` | normalized keyword / scenario text |
| `kind` | `keyword` \| `scenario` \| `manual` |
| `status` | `pending` \| `approved` \| `paused` \| `rejected` \| `done` — curation gate |
| `priority` | higher runs sooner (demand + zero-result boost) |
| `search_hits` | popularity from `search_logs` |
| `zero_result` | shoppers searched and got nothing |
| `last_run_at`, `run_count` | scheduling + "when last run" |
| `products_found`, `products_published` | per-target yield (admin page columns) |
| `last_result` | jsonb summary of the last run |

`refresh_seed_targets_from_searches()` aggregates `search_logs` → `seed_targets`
(keyword kind), **never overwriting `status`** (so a rejected term stays rejected).

### `app_settings` keys (new rows, kill-switch + budget)
| key | default | purpose |
|---|---|---|
| `seeding_enabled` | `false` | global on/off (fail-closed) |
| `seeding_monthly_serpapi_cap` | `5000` | hard monthly SerpAPI search cap |
| `seeding_serpapi_used_month` | `0` | running counter (reset monthly) |

### `product_ready_for_feed(prod products) -> bool` (new) — the quality gate
Image present AND occasion styling non-empty. The activation cron (later stage)
flips `is_active=true` only for rows that pass. `quality_score` intentionally NOT
used.

## 5. Build stages

- [x] **S1 — Foundation** (`seed_targets` + refresh + gate predicate). Additive.
- [x] **S2 — Seeding page** (`/admin/seeding`): queue, approve/pause/reject, kill-switch, budget, run-now, Simulate link.
- [x] **S3 — Orchestrator** (`seed-run` edge fn): due target → (scenario→brainstorm) → product-search ingest → hold inactive + stamp source → record yield. Hard-gated + budget cap.
- [x] **S4 — Activation** (`run_seeding_activation`, cron): promote-only `is_active=true` where `product_ready_for_feed` and not suppressed. Gated. Dedup = non-destructive report (hard index deferred, see §7 notes).
- [x] **S5 — Simulate page** (`/admin/seeding/simulate`): scenario+gender → real `ai-stylist` over live catalog → outfit + empty slots → one-click seed gap.
- [~] **S6 — Scenario source from `style_up_traces`**: DEFERRED (YAGNI — `searches` empty today; conversational search_logs entries already flow through as scenario-kind via the orchestrator's ≥4-word→brainstorm heuristic). Future hook: `refresh_seed_targets_from_traces()`.
- [x] **S7 — Schedule** (crons): refresh / occasion-backfill / driver / activate / budget-reset. All spend/feed steps no-op while disabled. (Funnel UI = the Seeding table's found/published columns; richer monitor deferred.)

### Operating it (turn the loop ON)
Everything ships OFF. To go live: `/admin/seeding` → review queue → **Reject** junk
("books", "pizza", "kzjs") → **Approve** good targets → set the budget cap → flip
**Seeding ON**. Crons then refresh demand, fetch for approved targets (throttled),
auto-enrich occasion, and the activation cron publishes products that pass the gate.
Watch found/published per target; run **Simulate** to find scenario gaps.

## 6. Change Log

| Date | Stage | Change | Files / objects |
|---|---|---|---|
| 2026-06-29 | S1 | `seed_targets` queue table + RLS (service_role + admin via `profiles.is_admin`) + indexes + `updated_at` trigger; `app_settings` keys `seeding_enabled='false'`, `seeding_monthly_serpapi_cap='5000'`, `seeding_serpapi_used_month='0'` | `migrations/20260629000001_seeding_foundation.sql` → `public.seed_targets`, `public.seed_targets_touch_updated_at()` |
| 2026-06-29 | S1 | `refresh_seed_targets_from_searches()` — aggregates `search_logs`→`seed_targets` (keyword), upsert never overwrites status. **Verified:** 139 targets, zero-result +100 priority, idempotent, rejected not resurrected | `migrations/20260629000002_seed_targets_refresh.sql` → `public.refresh_seed_targets_from_searches()` |
| 2026-06-29 | S1 | `product_ready_for_feed(products)` gate predicate (image + occasion; not quality_score). Function only, not yet wired. **Verified:** 180/192 active pass, 12 fail, 38 inactive recoverable | `migrations/20260629000003_product_ready_for_feed.sql` → `public.product_ready_for_feed(public.products)` |

| 2026-06-29 | S3 | `enrich-occasions` edge fn (auto occasion enrichment; prompt lifted from `scripts/enrich-occasions-v2.mjs`) | `supabase/functions/enrich-occasions/index.ts` (deployed) |
| 2026-06-29 | S3 | `seed-run` orchestrator edge fn. **Verified:** kill-switch returns `{skipped:'seeding_disabled'}` | `supabase/functions/seed-run/index.ts` (deployed) |
| 2026-06-29 | S4 | `run_seeding_activation()` promote-only gated activation. **Verified:** returns 0 + feed unchanged (192) while disabled | `migrations/20260629000005_seeding_activation.sql` |
| 2026-06-29 | S4 | `seed_duplicate_report()` non-destructive dup report (hard index deferred) | `migrations/20260629000004_seeding_dedup_report.sql` |
| 2026-06-29 | S7 | cron fns + 5 schedules (refresh/occasion/driver/activate/budget-reset), all gated. **Verified:** scheduled + active, work-fns no-op while disabled | `migrations/20260629000006_seeding_crons.sql` |
| 2026-06-29 | S2 | `admin_set_seeding_setting()` is_admin RPC (flip kill-switch / budget from UI) | `migrations/20260629000007_admin_set_seeding_setting.sql` |
| 2026-06-29 | S2/S5 | `/admin/seeding` + `/admin/seeding/simulate` pages, nav + search entry, route registration. **Verified:** typecheck 0 errors, route-check pass, build OK | `app/routes/admin/seeding.tsx`, `seeding.simulate.tsx`, `admin/route.tsx`, `vite.config.ts` |

| 2026-06-29 | flag | Seeded products stamped `source='seed_serpapi'` at INSERT (product-search `source`/`is_active` params) AND belt-and-suspenders in seed-run, so the deletable flag always holds | `functions/product-search/index.ts`, `functions/seed-run/index.ts` (seed-run redeployed v3) |
| 2026-06-29 | flag | `purge_seeded_products()` is_admin RPC + "Purge seeded (N)" button — one-call delete of all seeded rows (FK-safe: all product FKs CASCADE/SET NULL) | `migrations/20260629000008_purge_seeded_products.sql`, `app/routes/admin/seeding.tsx` |
| 2026-06-29 | S2 | Seeding page redesign: two top tabs (Searches=keyword/manual, Styling=scenario) + flat Data-page look (admin-tabs/admin-btn/SortableTable, no inline styles); Add button kind follows the active tab | `app/routes/admin/seeding.tsx` |
| 2026-06-29 | S2 | "View seeded products (N)" link on /admin/seeding → `/admin/data?tab=products&filters=seeding`; new **Seeded** product filter (source=`seed_serpapi`) + chip, URL-drivable | `app/routes/admin/data.tsx`, `app/routes/admin/seeding.tsx` |
| 2026-06-29 | fix | Activation dropped the `scrape_status<>'failed'` guard — the scrape-new-products trigger marks SerpAPI rows 'failed' (they already have images), which wrongly blocked them; the image+occasion gate is the real filter | `migrations/20260629000009_seeding_activation_fix.sql` |

### ✅ Live end-to-end test (2026-06-29, bounded: cap 12, one keyword)
Ran the full loop ON for "white shoes", then turned OFF. Result:
`seed-run` → **20 products fetched** (SerpAPI, 6 credits), flagged `seed_serpapi`,
held inactive → `enrich-occasions` → **20/20 got occasion** → `run_seeding_activation`
→ **20/20 activated** (passed image+occasion gate). Sample: Asics Gel-1130
["running","gym workout",…], Nike Court Vision, Puma Caven. Activation also recovered
22 previously-stranded ready products (192→234 active). Seeding returned to OFF, budget reset.

**Known limitations (follow-ups, non-blocking):**
- `products_published` per target is computed at fetch-time (before enrichment), so it
  reads ~0 even when the products later activate. Accurate per-target publish needs a
  `seed_target_id` column on products (deferred). `products_found` is accurate.
- The `scrape-new-products` trigger still fires on seeded rows (they have images, so the
  scrape fails and marks them `scrape_status='failed'` — harmless now that activation
  ignores it, but wasteful Modal calls). Fix later: skip auto-scrape when `image_url` present.

### Notes surfaced during S1 (feed into later stages)
- The zero-result queue top is mostly junk ("pizza", "kzjs", "fff") + off-vertical
  ("perfume catalog") + **conversational** ("i need a dress for a wedding in ireland
  in october"). Confirms the curation gate is mandatory. Conversational queries are
  scenario-shaped → S3 orchestrator should route long/natural-language terms through
  `catalog-brainstorm` (not as a flat keyword search).
- 38 inactive products already pass the gate (image+occasion) but are off for other
  reasons (`is_platform=false` / `scrape_status='failed'`). **S4 activation must NOT
  blindly reactivate** — exclude `is_platform=false` and operator-hidden rows.

## 7. Revert Manifest

To remove the feature entirely, in order:

**Fastest kill (no revert):** `/admin/seeding` → flip **Seeding OFF**, or
`update app_settings set value='false' where key='seeding_enabled';`. The whole
loop goes inert immediately (no spend, no new activations).

**Full revert — Database** (run as service role / via MCP):
```sql
select cron.unschedule('seeding-refresh');
select cron.unschedule('seeding-occasion');
select cron.unschedule('seeding-driver');
select cron.unschedule('seeding-activate');
select cron.unschedule('seeding-budget-reset');

drop function if exists public.run_seeding_refresh();
drop function if exists public.run_seeding_occasion_backfill();
drop function if exists public.run_seeding_driver();
drop function if exists public.run_seeding_activation();
drop function if exists public.admin_set_seeding_setting(text, text);
drop function if exists public.purge_seeded_products();
drop function if exists public.seed_duplicate_report();
drop function if exists public.product_ready_for_feed(public.products);
drop function if exists public.refresh_seed_targets_from_searches();
drop table if exists public.seed_targets cascade;
delete from public.app_settings
  where key in ('seeding_enabled','seeding_monthly_serpapi_cap','seeding_serpapi_used_month');
```
Note: products already seeded while ON keep `source='seed_serpapi'`; to also
retire them: `update products set is_active=false where source='seed_serpapi';`
(they are otherwise normal catalog rows — leaving them is fine).

**Edge functions** — undeploy/delete `supabase/functions/seed-run` and
`supabase/functions/enrich-occasions`.

**Frontend** — delete `app/routes/admin/seeding.tsx` +
`app/routes/admin/seeding.simulate.tsx`; remove the 2 `route(...)` lines in
`vite.config.ts`; remove the Seeding nav item + the Seeding/Simulate search
items in `app/routes/admin/route.tsx`.

**Reused (do NOT delete on revert):** `catalog-brainstorm`, `product-search`,
`ai-stylist`, `embed-product`, `app_settings`, `search_logs`, `products`.

Nothing in this feature modifies existing tables/functions destructively — it is
purely additive, so revert is a clean drop.

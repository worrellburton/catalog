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
- [x] **S6 — Scenario source from `style_up_traces`** (2026-06-30): `refresh_seed_targets_from_style_chats()` + `seeding-style-demand` cron (30 min). Reads new traces, pulls styling terms (web stylists' `search_queries` + catalog stylists' last shopper message), AND-coverage-gates vs the live catalog, and queues only the **missing** ones as pending targets. Zero-touch — the live `style-up-chat` is not modified (terms come from the trace it already writes).
- [x] **S7 — Schedule** (crons): refresh / occasion-backfill / driver / activate / budget-reset. All spend/feed steps no-op while disabled. (Funnel UI = the Seeding table's found/published columns; richer monitor deferred.)
- [x] **S8 — Styling scenarios cockpit** (2026-06-30): Claude generates styling scenarios on a weekly cron; each is **simulated** through a standalone `style-engine` (per-slot occasion-aware retrieval + persona-aware assembly) and its outfit + gaps render in the Styling tab; gaps one-click **seed as demand**. The simulation engine is **separate from the live `style-up-chat`** (untouched) — this is the cockpit to prove it before connecting. See §8.

### Operating it (turn the loop ON)
Everything ships OFF. To go live: `/admin/seeding` → review queue → **Reject** junk
("books", "pizza", "kzjs") → **Approve** good targets → set the budget cap → flip
**Seeding ON**. Crons then refresh demand, fetch for approved targets (throttled),
auto-enrich occasion, and the activation cron publishes products that pass the gate.
Watch found/published per target; run **Simulate** to find scenario gaps.

## 8. Styling scenarios — simulation cockpit (S8, 2026-06-30)

The Styling tab is also the **stylist-engine simulation cockpit**. Where the
seeding loop answers "does the catalog have products for this demand", the
cockpit answers "does the **stylist** assemble a good outfit for this occasion".

**Flow:** `generate-style-scenarios` (Claude) → scenarios (`seed_targets`
`kind='scenario'`, `status='paused'`, structured `intent` jsonb) → per-scenario
**Simulate** (pick a stylist persona + a user) → `style-engine` retrieves an
occasion-aware candidate set **per garment slot** and assembles one outfit →
the row shows the outfit + **gaps** → one-click **Seed this gap** turns an
unfilled slot into an `approved` demand target the loop fetches. Loop:
*generate → simulate → see results → seed gaps → next run is better.*

| Piece | What it does | Notes |
|---|---|---|
| `generate-style-scenarios` (edge fn) | Claude brainstorms diverse scenarios (occasion × gender × season) → inserts paused scenario rows + `intent` | heuristic fallback if no API key/credits; dedups vs existing |
| `seeding-style-generate` (cron) | weekly (Mon 05:30 UTC) top-up; "Generate scenarios" button = run-now (count 25) | Claude-only, **not** budget-gated; shows in Automation panel |
| `style-engine` (edge fn) | per-slot `style_slot_search` retrieval → persona-aware Claude assembly → `{outfit, gaps, rationale, candidateCounts}` | **standalone**; heuristic top-pick fallback without credits; live `style-up-chat` untouched |
| `style_slot_search(query,k,gender)` | thin wrapper over `search_products` (zero 384-vector) for occasion-ranked, gender-filtered per-slot retrieval | embedding ignored in the category route; BM25 over occasion text |
| `seed_targets.intent` jsonb | structured scenario intent (occasion, gender, formality 0-5, season, slots, palette) | null on demand (keyword/manual) targets |
| `seed_targets.last_result` jsonb | latest simulation result (persisted, shown on re-open) | latest-only; run-comparison history deferred (YAGNI) |
| `StyleSimulateModal` (component) | stylist + user pickers, runs `style-engine`, renders outfit/gaps, seeds gaps | `app/components/StyleSimulateModal.tsx` |

**Why paused, not approved:** generated scenarios are *simulation cases*, not
demand — `paused` keeps them out of the paid `seed-run` driver (which only runs
`approved`), so 25 scenarios can't drain the SerpAPI budget. Only the **gaps**
(or an explicitly Approved scenario) become spend.

**Scale note:** the simulation reuses the same occasion-aware `search_products`
ranker as consumer search, so its candidate set is relevance-ranked (not the
120-recency window the live `style-up-chat` still uses) — i.e. it gets *better*
as the catalog grows. Connecting `style-up-chat` to this engine is the future
connect-seam (swap its candidate query); left for after the cockpit proves out.

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
| 2026-06-29 | S2 | Target row now fully clickable (term + Found count link) → products tab filtered to that target; Data page shows a "Seeding target: <term>" filter chip with clear (mirrors the brand chip), via `?target=<id>&label=<term>` | `app/routes/admin/seeding.tsx`, `app/routes/admin/data.tsx` |
| 2026-06-29 | S2 | View products per target: `products.seed_target_id` (FK → seed_targets, ON DELETE SET NULL) stamped by seed-run (v4) + backfilled; Data page filters on `?target=<id>`; the "Found" count on each Seeding row links to `/admin/data?tab=products&filters=seeding&target=<id>`. **Verified:** white shoes → 20 linked | `migrations/20260629000013_products_seed_target_id.sql`, `functions/seed-run/index.ts`, `app/routes/admin/data.tsx`, `app/routes/admin/seeding.tsx` |
| 2026-06-29 | S2 | Master switch: one "Pause / Enable everything" button (`set_seeding_master(bool)` — flips `seeding_enabled` AND `cron.alter_job` on all seeding-* crons together) so the whole system stops/starts in one click | `migrations/20260629000012_seeding_master_switch.sql`, `app/routes/admin/seeding.tsx` |
| 2026-06-29 | S7 | `seed-curate` edge fn — Claude classifies PENDING terms: real search → approved, gibberish ("fff","kzjs","tatinajc","test","detergemt") → rejected; only touches pending (manual decisions safe). **Verified:** 50 → 37 approved / 13 rejected, correct gibberish catches | `functions/seed-curate/index.ts` (deployed) |
| 2026-06-29 | S7 | `seeding-curate` cron (*/10) via `run_seeding_curate()`; runs regardless of kill-switch (Claude-only, no SerpAPI). **Verified:** auto-cleared the queue on schedule | `migrations/20260629000011_seeding_curate_cron.sql` |
| 2026-06-29 | S2 | Automation panel on /admin/seeding: lists all seeding crons (label, cadence, last run, on/paused toggle) via `seeding_cron_status()` + `set_seeding_cron_active()` (is_admin, seeding-* only, `cron.alter_job`) | `migrations/20260629000010_seeding_cron_controls.sql`, `app/routes/admin/seeding.tsx` |
| 2026-06-29 | S2 | Seeding table: pagination (25/page) + rejected pinned to the bottom (default order) + "Auto-curate pending" button | `app/routes/admin/seeding.tsx` |
| 2026-06-29 | S2 | Seeding page redesign: two top tabs (Searches=keyword/manual, Styling=scenario) + flat Data-page look (admin-tabs/admin-btn/SortableTable, no inline styles); Add button kind follows the active tab | `app/routes/admin/seeding.tsx` |
| 2026-06-29 | S2 | "View seeded products (N)" link on /admin/seeding → `/admin/data?tab=products&filters=seeding`; new **Seeded** product filter (source=`seed_serpapi`) + chip, URL-drivable | `app/routes/admin/data.tsx`, `app/routes/admin/seeding.tsx` |
| 2026-06-29 | fix | Activation dropped the `scrape_status<>'failed'` guard — the scrape-new-products trigger marks SerpAPI rows 'failed' (they already have images), which wrongly blocked them; the image+occasion gate is the real filter | `migrations/20260629000009_seeding_activation_fix.sql` |
| 2026-06-30 | S8 | `seed_targets.intent` jsonb (scenario intent) + `style_slot_search(query,k,gender)` wrapper over `search_products` (zero 384-vector → occasion-ranked per-slot retrieval). **Verified:** per-slot queries return slot-correct, gender-correct, occasion-ranked rows | `migrations/20260630000001_style_scenarios.sql` |
| 2026-06-30 | S8 | `generate-style-scenarios` edge fn — Claude brainstorms diverse styling scenarios → inserts `seed_targets(kind='scenario',status='paused',intent)`; dedups; heuristic fallback. **Verified:** HTTP 200, auth (service+admin) + insert + dedup OK; fell back to heuristic (Anthropic credits exhausted → 6 inserted) | `supabase/functions/generate-style-scenarios/index.ts` (deployed v2) |
| 2026-06-30 | S8 | `seeding-style-generate` weekly cron (Mon 05:30 UTC) via `run_style_scenario_generate()` (count 10); not budget-gated (Claude-only). **Verified:** scheduled + active; appears in Automation panel | `migrations/20260630000002_style_generate_cron.sql` |
| 2026-06-30 | S8 | `style-engine` standalone edge fn — per-slot `style_slot_search` retrieval + persona-aware Claude assembly (mirrors `ai-stylist`, persona-injected; **live `style-up-chat`/`ai-stylist` untouched**) → `{outfit,gaps,rationale,candidateCounts}`; heuristic top-pick fallback. **Verified:** HTTP 200, club×Devon filled 4/4 slots, gender-correct, candidate counts per slot | `supabase/functions/style-engine/index.ts` (deployed v1) |
| 2026-06-30 | S8 | Styling-tab simulate cockpit: per-scenario **Simulate** (stylist + user pickers) → `style-engine` → outfit/gaps render + persist `last_result`; gap → `approved` demand; "✦ Generate scenarios" button; new cron label. **Verified:** typecheck 0 errors | `app/components/StyleSimulateModal.tsx`, `app/routes/admin/seeding.tsx` |
| 2026-06-30 | S6 | `refresh_seed_targets_from_style_chats()` (pure SQL, security definer) — new `style_up_traces` since `app_settings.seeding_style_demand_watermark` → terms (web `search_queries` + catalog last shopper message, len-gated) → **AND-coverage gate** vs active catalog (name+occasion tsvector) → upsert MISSING as `seed_targets(kind='scenario',status='pending')`, never resurrecting rejected; advances watermark. + `seeding-style-demand` cron (*/30, pure SQL, not budget-gated). **Verified:** extraction + AND gate correct (sequin blazer/rave→missing, sneakers/cocktail dress→covered); fn runs clean (0 with no traces); cron registered | `migrations/20260630000003_seed_from_style_chats.sql` |
| 2026-06-30 | S6 | "Pull stylist demand" button (Styling tab) → `rpc refresh_seed_targets_from_style_chats`; `CRON_LABELS['seeding-style-demand']`. **Verified:** typecheck 0 errors | `app/routes/admin/seeding.tsx` |
| 2026-06-30 | UX | Admin polish: Automation panel **split by tab** (Searches pipeline vs Styling crons via `isStylingCron`); numeric column header-centering fixed (specificity: `.admin-table th.admin-th-center`); cron schedule `0 4 * * *`→"daily (4am)"; cron checkbox → `.admin-toggle` switch; page-load spinner (`.admin-spinner`). Styling tab = **distinct table** (Scenario/Gender/Formality/Slots/Simulated/Status) with always-on pagination; clicking a scenario opens `ScenarioProductsModal` (per-slot `style_slot_search` candidates, in-page) instead of the empty `/admin/data` redirect. **Verified:** typecheck 0 errors | `app/routes/admin/seeding.tsx`, `app/components/ScenarioProductsModal.tsx`, `app/styles/admin.css` |
| 2026-06-30 | S8e | **Self-reliant gap-sweep** (auto-seed): `sweep_style_gaps()` (pure SQL, no Claude) iterates every scenario × BOTH genders × the engine's slot plan, AND-coverage-checks the catalog (occasion qualifier + garment noun over name/type/occasion text), and queues misses to **Searches** as short reusable `kind='manual'` approved terms ("men's formal jacket"). + daily `seeding-gap-sweep` cron + "⤳ Sweep gaps" button + `CRON_LABELS`. Gap detection is retrieval not reasoning → credit-independent. **Verified live:** 37 real gaps queued (men's formal/winter/fall menswear, women's formal/winter). Spend still gated by the seeding kill-switch. | `migrations/20260630000005_sweep_style_gaps.sql`, `app/routes/admin/seeding.tsx` |
| 2026-06-30 | fix | style-engine completeness guard: a female 'dresses' scenario run on a male shopper dropped the dress leaving shoes-only; now substitutes top+bottom so every outfit has torso+bottom+shoes. **Verified:** male NYE run → shirt+pant+shoes (was shoe-only) | `supabase/functions/style-engine/index.ts` (v5) |
| 2026-06-30 | S8d | Cost controls: `style-engine` takes a `model` param (allowlist sonnet/haiku/opus, **default sonnet-4-6** — was opus), captures usage, computes per-run cost, and logs each run to `ai_usage_logs` (operation='style-engine'). New `style_engine_spend()` RPC (is_admin) aggregates the running total. Cockpit: model dropdown + "this run $X (tokens)" + "total simulation spend $Y · N runs" (modal + Styling tab). **Verified live:** Sonnet 4-slot run = $0.0136, logged + aggregated | `migrations/20260630000004_style_engine_spend.sql`, `supabase/functions/style-engine/index.ts` (v4), `supabase/functions/_shared/ai-usage.ts`, `app/components/StyleSimulateModal.tsx`, `app/routes/admin/seeding.tsx` |
| 2026-06-30 | S8c | Stylists gave identical picks (retrieval was persona-blind — every stylist shopped the same occasion+gender pool). Fix: `style-engine` now folds the stylist's `specialty` into the per-slot query (k 8→12), so each shops a vibe-skewed pool. **Verified live:** same scenario, Margot→Common Projects/Birkenstock/linen vs Devon→Nike Dunk/Y-3/Kith-neon. NOTE: differentiation is capped by catalog diversity — e.g. 7/8 nightclub dresses are tagged `quiet luxury`, so dresses still converge until seeding adds varied inventory | `supabase/functions/style-engine/index.ts` (v3) |
| 2026-06-30 | S8b | Operator feedback round: (1) `style-engine` now returns up to **3 distinct outfit sets** (`sets[]`) not one — shopper choice; StyleSimulateModal renders multiple "Look N" + a "Missing from catalog" seed section. **Verified live:** nightclub→3 distinct looks (maxi/mini/lace), `source=claude`. (2) Gap-seeds + chat-demand now `kind='manual'` → land in the **Searches** demand tab (was Styling); existing gap migrated. (3) numeric columns (Demand/Priority/Found/Published) **center-aligned** header+cell (`admin-th-center`/`admin-cell-center`). (4) **keyword search box** filters the list by term. **Verified:** typecheck 0 errors | `supabase/functions/style-engine/index.ts` (v2), `migrations/20260630000003_*` (kind=manual), `app/components/StyleSimulateModal.tsx`, `app/routes/admin/seeding.tsx`, `app/styles/admin.css`, `app/components/StyleInfoModal.tsx` |

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
select cron.unschedule('seeding-curate');
select cron.unschedule('seeding-style-generate');   -- S8
select cron.unschedule('seeding-style-demand');      -- S6

drop function if exists public.refresh_seed_targets_from_style_chats(); -- S6
drop function if exists public.run_style_scenario_generate();        -- S8
drop function if exists public.style_slot_search(text, integer, text); -- S8
drop function if exists public.run_seeding_curate();
drop function if exists public.set_seeding_master(boolean);
drop function if exists public.seeding_cron_status();
drop function if exists public.set_seeding_cron_active(text, boolean);
drop function if exists public.run_seeding_refresh();
drop function if exists public.run_seeding_occasion_backfill();
drop function if exists public.run_seeding_driver();
drop function if exists public.run_seeding_activation();
drop function if exists public.admin_set_seeding_setting(text, text);
drop function if exists public.purge_seeded_products();
drop function if exists public.seed_duplicate_report();
drop function if exists public.product_ready_for_feed(public.products);
drop function if exists public.refresh_seed_targets_from_searches();
alter table if exists public.products drop column if exists seed_target_id;
alter table if exists public.seed_targets drop column if exists intent;   -- S8 (keep last_result; it predates S8)
drop table if exists public.seed_targets cascade;
delete from public.app_settings
  where key in ('seeding_enabled','seeding_monthly_serpapi_cap','seeding_serpapi_used_month',
                'seeding_style_demand_watermark');  -- last key = S6
```
Note: products already seeded while ON keep `source='seed_serpapi'`; to also
retire them: `update products set is_active=false where source='seed_serpapi';`
(they are otherwise normal catalog rows — leaving them is fine).

**Edge functions** — undeploy/delete `supabase/functions/seed-run`,
`supabase/functions/enrich-occasions`, `supabase/functions/seed-curate`, and
(S8) `supabase/functions/generate-style-scenarios`,
`supabase/functions/style-engine`.

**Frontend** — delete `app/routes/admin/seeding.tsx` +
`app/routes/admin/seeding.simulate.tsx` + (S8) `app/components/StyleSimulateModal.tsx`;
remove the 2 `route(...)` lines in `vite.config.ts`; remove the Seeding nav item
+ the Seeding/Simulate search items in `app/routes/admin/route.tsx`. (S8 wiring
lives inside `seeding.tsx`, removed with it.)

**Reused (do NOT delete on revert):** `catalog-brainstorm`, `product-search`,
`ai-stylist`, `embed-product`, `app_settings`, `search_logs`, `products`.

Nothing in this feature modifies existing tables/functions destructively — it is
purely additive, so revert is a clean drop.

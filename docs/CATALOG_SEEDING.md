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

- [x] **S1 — Foundation** (this doc + `seed_targets` + refresh + gate predicate). Additive, no behavior change.
- [ ] **S2 — Seeding page** (`/admin/seeding`): queue list, approve/pause/reject, Simulate button.
- [ ] **S3 — Orchestrator** (`seed-run` edge fn): due target → brainstorm → product-search ingest → record yield. + budget cap.
- [ ] **S4 — Activation** (cron): `is_active=true` where `product_ready_for_feed`. + dedup key.
- [ ] **S5 — Simulate page** (`/admin/seeding/simulate`): scenario+profile → outfit + empty slots → seed target.
- [ ] **S6 — Scenario source**: ingest `style_up_traces` gaps as scenario targets.
- [ ] **S7 — Schedule + monitor**: new=priority / old=weekly crons, stuck counters.

## 6. Change Log

| Date | Stage | Change | Files / objects |
|---|---|---|---|
| 2026-06-29 | S1 | `seed_targets` queue table + RLS (service_role + admin via `profiles.is_admin`) + indexes + `updated_at` trigger; `app_settings` keys `seeding_enabled='false'`, `seeding_monthly_serpapi_cap='5000'`, `seeding_serpapi_used_month='0'` | `migrations/20260629000001_seeding_foundation.sql` → `public.seed_targets`, `public.seed_targets_touch_updated_at()` |
| 2026-06-29 | S1 | `refresh_seed_targets_from_searches()` — aggregates `search_logs`→`seed_targets` (keyword), upsert never overwrites status. **Verified:** 139 targets, zero-result +100 priority, idempotent, rejected not resurrected | `migrations/20260629000002_seed_targets_refresh.sql` → `public.refresh_seed_targets_from_searches()` |
| 2026-06-29 | S1 | `product_ready_for_feed(products)` gate predicate (image + occasion; not quality_score). Function only, not yet wired. **Verified:** 180/192 active pass, 12 fail, 38 inactive recoverable | `migrations/20260629000003_product_ready_for_feed.sql` → `public.product_ready_for_feed(public.products)` |

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

**Database** (run as service role / via MCP):
```sql
-- crons (when scheduled in later stages)
-- select cron.unschedule('seeding_refresh');
-- select cron.unschedule('seeding_run');
-- select cron.unschedule('seeding_activate');

drop function if exists public.product_ready_for_feed(public.products);
drop function if exists public.refresh_seed_targets_from_searches();
drop table if exists public.seed_targets cascade;
delete from public.app_settings
  where key in ('seeding_enabled','seeding_monthly_serpapi_cap','seeding_serpapi_used_month');
```

**Edge functions** (later stages): delete `supabase/functions/seed-run` and undeploy.

**Frontend** (later stages): delete `app/routes/admin/seeding.tsx`,
`app/routes/admin/seeding.simulate.tsx`, and remove the nav entry.

**Migrations**: the feature's migrations are self-contained
(`20260629000001..` prefixed); reverting = run the SQL above (dropping a
migration file alone does not undrop applied objects).

Nothing in this feature modifies existing tables/functions destructively — it is
purely additive, so revert is a clean drop.

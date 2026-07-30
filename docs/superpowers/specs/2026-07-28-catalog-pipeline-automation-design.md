# Catalog Pipeline Automation — Slice 1: The Spine

Status: **approved, ready for planning** · Date: 2026-07-28 · Branch: `dev`

Automate the product pipeline end to end — scrape → agent image review → creative
generation → publish — driven entirely by admin policy, with a dedicated health
and analytics page.

This document specs **Slice 1 only**. See [Out of scope](#12-out-of-scope) for
Slices 2 and 3.

---

## 1. Problem

The pipeline already works. It just doesn't run, and nobody can see that it isn't.

Measured on production 2026-07-28:

| Finding | Evidence |
|---|---|
| No product entered the catalog for 26 days | newest `products.created_at` was 2026-07-02 |
| ~177 active products can never appear in the feed | 341 active, 164 with `primary_video_url`; video is a hard feed filter (`product-creative.ts:387`, `:879`, `:1245`) |
| Nothing starts creative generation | no trigger or cron inserts `product_creative`; the only callers are admin buttons in `admin/data.tsx` |
| 217 `generation_jobs` stuck `running` since 2026-06-25 | `generation_watchdog()` only reconciles `user_generations` |
| 9 seeding crons silently `active=false` | `cron.job` |
| Video generation has **no cost telemetry at all** | `ai_usage_logs` has zero `fal` rows; `product_creative.cost_usd` is a hardcoded `0.10` on all 41 rows |

The enrichment stages themselves are sound. An end-to-end test the same day
ingested 18 products and left them untouched for 39 minutes:

| | Result |
|---|---|
| `image_verified` | 18 / 18 |
| person-free packshot | 18 / 18 |
| occasion enriched | 18 / 18 |
| passed `product_ready_for_feed` | 18 / 18 |
| leaked live before enrichment | 0 |

So this is a **wiring and visibility** project, not a rebuild.

## 2. Goals

1. A product moves from discovery to published with no human action.
2. Every automated decision is governed by admin-set policy, not code constants.
3. Spend is bounded by a cap that reflects real charges.
4. One page answers "is the machine running, is the output good, what is it
   costing, and what do we have versus what people want".

## 3. Non-goals

- No human approval queue. Review is the agent's job; the admin sets rules and
  watches exceptions. (Decided 2026-07-28.)
- No apparel-only curation gate. The catalog is deliberately multi-category —
  apparel and non-apparel alike are supported. Do not propose deactivating
  non-apparel rows.
- No replacement of the existing trigger chain. It is proven working.

## 4. Decisions

| Question | Decision |
|---|---|
| Review model | Fully automatic; admin sets policy, watches exceptions |
| Funnel sources | Brand sites on a schedule + shopper demand + affiliate feeds (Shopify explicitly excluded) — **Slices 2–3** |
| Build order | Spine first |
| Creative eligibility | Everything passing the gate, rate-limited per day under a monthly USD cap |
| Dashboard scope | All four: pipeline health, data quality, spend, catalog & demand |
| Architecture | Approach C — keep the trigger chain, add a derived-state layer |

### Why Approach C

Three options were considered:

- **A — close the two gaps only.** Smallest diff, but each dashboard panel
  re-derives "what stage is this product at" in its own query. Four panels, four
  definitions, numbers that disagree.
- **B — explicit `product_pipeline` state table.** Most observable, but
  duplicates state that already lives on `products`; the two drift and there is
  no answer to which is right. Also replaces machinery that demonstrably works.
- **C — derive stage from existing columns.** Chosen. The entire 2026-07-28
  audit was possible *because* pipeline state is already derivable from
  `products` columns — that is the evidence the derivation is sufficient. It
  cannot drift because there is no second copy of the truth.

Revisit B only if per-stage retry policy and audit history become requirements
that derived state genuinely cannot express.

## 5. Architecture

```
                        ┌───────────── admin policy (app_settings) ─────────────┐
                        │  enabled flags · creatives_per_day · monthly cap ·    │
                        │  min_image_score · min_images · require_person_free   │
                        └───────┬───────────────────────────────┬───────────────┘
                                │                               │
  product row                   ▼                               ▼
  INSERT ──► scrape ──► verify ──► de-person ──► [creative drain cron] ──► [publish cron] ──► live
            (Modal)   (Haiku)     (Gemini)         inserts product_creative     is_active=true
               │         │           │                      │                        │
               └─────────┴───────────┴──────────────────────┴────────────────────────┘
                                     │
                              pipeline_events (failures + transitions only)
                                     │
                    pipeline_stage(products) ── derived, never stored
                                     │
                          /admin/pipeline/health
```

Existing pieces reused unchanged: `scrape-product` (Modal), `verify-product-image`,
`depersonify-product-image`, `embed-product`, `enrich-occasions`,
`notify_modal_generate_creative`, `promote_creative_to_primary_video`,
`notify_generate_primary_poster`, `product_ready_for_feed`.

## 6. Components

### 6.1 `pipeline_stage(p public.products) → text`

Pure, immutable, derived. The single definition of where a product sits.

| Stage | Condition |
|---|---|
| `discovered` | `scrape_status = 'pending'` |
| `scrape_failed` | `scrape_status = 'failed'` **and** `coalesce(jsonb_array_length(images),0) = 0` — *not terminal*; a failed scrape with a usable SerpAPI gallery continues to `unverified`. 9 of 18 rows on 2026-07-28 failed scrape yet still published |
| `unverified` | `image_verified is null` |
| `needs_review` | `image_verify_note like 'needs_review%'` |
| `blocked:occasion` | verified but `styling_metadata->>'occasion'` empty |
| `awaiting_creative` | passes `product_ready_for_feed`, `primary_video_url is null`, no open `product_creative` |
| `creative_pending` | open `product_creative` row (`pending`/`queued`/`running`) |
| `ready_to_publish` | has `primary_video_url`, passes gate, `is_active = false` |
| `published` | `is_active` **and** `primary_video_url is not null` |
| `published_no_creative` | `is_active` **and** no video — live but invisible in feed (~177 rows today) |

Consumed by both crons and every dashboard panel. Never written to a column.

### 6.2 `pipeline_events`

```sql
create table public.pipeline_events (
  id          bigserial primary key,
  product_id  uuid references public.products(id) on delete cascade,
  stage       text not null,
  event       text not null,   -- queued | done | failed | published | blocked | skipped
  detail      jsonb,
  created_at  timestamptz not null default now()
);
create index on public.pipeline_events (created_at desc);
create index on public.pipeline_events (product_id, created_at desc);
```

**Transitions and failures only — never current state.** Powers throughput,
failure rate, and stuck detection. Nothing here can drift from `products`
because nothing here is authoritative.

### 6.3 Fal cost logging — blocking prerequisite

`agents/video-generator` writes the real charge on completion:

- `product_creative.cost_usd` — actual, not the `0.10` placeholder
- `ai_usage_logs` row: `platform='fal'`, `operation='product-creative'`,
  `model`, `units` (seconds), `estimated_cost_usd`, `metadata{product_id, request_id}`

**The creative drain cron must not be enabled before this ships.** A monthly cap
computed from a hardcoded constant is not a cap.

### 6.4 Creative drain cron

Rate limiting and budget enforcement are why this is a cron and not a row
trigger — a `BEFORE INSERT` trigger cannot express "40 per day".

```
run_pipeline_creative_drain(dry_run boolean default true)
  if not pipeline_enabled or not pipeline_creative_enabled -> return skipped
  -- month-to-date from ai_usage_logs where platform='fal'
  if fal_month_spend() >= pipeline_creative_monthly_usd_cap -> log 'budget', return
  n := least(pipeline_creatives_per_day - today_count, batch_size)
  if n <= 0 -> return
  select products
    where pipeline_stage(products) in ('published_no_creative','awaiting_creative')
    order by (stage = 'published_no_creative') desc, created_at asc
    limit n
  if dry_run -> return the list, write nothing
  insert product_creative(product_id, status='pending')   -- existing chain fires
  log pipeline_events(stage='creative', event='queued')
```

Selects **both** creative-less stages, not just `awaiting_creative`.
`published_no_creative` rows go first: they are already live and invisible
(~177 today), so each one generated is an immediate feed gain. Then oldest
`awaiting_creative`.

### 6.5 Publish cron

```
run_pipeline_publish(dry_run boolean default true)
  if not pipeline_enabled or not pipeline_autopublish_enabled -> return skipped
  select products at stage 'ready_to_publish'
    where image_verify_score >= min_image_score
      and jsonb_array_length(images) >= min_images
      and (not require_person_free or primary_image_person_free)
  if dry_run -> return the list
  update products set is_active = true
  log pipeline_events(stage='publish', event='published')
```

Promote-only. Never deactivates. Mirrors the existing `run_seeding_activation`
contract.

### 6.6 Watchdog extension

`generation_watchdog()` extended to cover `generation_jobs` (currently only
`user_generations`). Jobs `running` beyond a threshold are marked failed and
logged. This is what turns "217 zombies since June" into a dashboard row.

### 6.7 Link health checker

New cron, ~50 active products/day on rotation, HTTP HEAD/GET with a browser
user-agent, writing to two new `products` columns:

- `url_status smallint` — HTTP code; `403` recorded as reachable-but-bot-blocked,
  confirmed 2026-07-28 in a real browser (lululemon PDP rendered, price matched
  our stored `$128.00` exactly)
- `url_checked_at timestamptz`

Two columns, not a new table — the data is one-per-product and has no history
requirement.

### 6.8 Settings — `/admin/pipeline`

All values in `app_settings`, written via an `is_admin` RPC mirroring
`admin_set_seeding_setting`. A master switch mirroring `set_seeding_master`
flips the flag **and** the crons together — the seeding feature's switches did
not stick precisely because those two were separate.

| Key | Default | Purpose |
|---|---|---|
| `pipeline_enabled` | `false` | master, fail-closed |
| `pipeline_creative_enabled` | `false` | creative drain on/off |
| `pipeline_autopublish_enabled` | `false` | publish cron on/off |
| `pipeline_creatives_per_day` | `40` | rate limit |
| `pipeline_creative_monthly_usd_cap` | `50` | hard spend stop; set deliberately low until §6.3 reports real per-video cost, then recalibrated from the canary |
| `pipeline_min_image_score` | `0.5` | publish policy |
| `pipeline_min_images` | `2` | publish policy |
| `pipeline_require_person_free` | `true` | publish policy |

### 6.9 Health page — `/admin/pipeline/health`

1. **Pipeline health** — stage funnel from `pipeline_stage()`, stuck table with
   ages, cron enabled/last-run, throughput from `pipeline_events`.
2. **Data quality** — link health, verify-score distribution, `needs_review`
   count, missing-field coverage, duplicate clusters, retailer-brand leaks.
3. **Spend** — by platform/operation from `ai_usage_logs`, cost per published
   product, month-to-date against cap. Honest only after §6.3.
4. **Catalog & demand** — read-only summary linking to `/admin/seeding`, **not**
   a recompute. Two pages computing the same demand numbers will disagree.

## 7. Data flow

1. Product row inserted (any source) with `scrape_status='pending'`,
   `is_active=false` (the fail-closed default shipped in `55b897f4`).
2. `scrape-new-products` trigger → Modal scraper → fields, images, brand
   (normalized by `trg_products_normalize_write`).
3. `trg_products_auto_verify_image` → `verify-product-image` → prune, re-host,
   score, set `primary_image_person_free`.
4. On `person_free=false` → `trg_depersonify_on_model` → packshot → re-verify.
5. Occasion enrichment cron fills `styling_metadata->occasion`.
6. Product reaches `awaiting_creative`.
7. Creative drain inserts `product_creative` → Modal generate-ad →
   `promote_creative_to_primary_video` sets `primary_video_url` →
   poster trigger.
8. Product reaches `ready_to_publish`; publish cron sets `is_active=true`.

## 8. Error handling

- Every cron killswitch-gated and **fail-closed** (absent/unparseable setting
  means off).
- Budget cap hard-stops creative generation and logs a `budget` event.
- Both crons default to `dry_run=true`; enabling is explicit.
- Stuck detection is a dashboard row, not a discovery.
- A failed stage never blocks the row permanently: `scrape_failed` and
  `needs_review` remain eligible for downstream stages when the data supports it.

## 9. Testing

- `pipeline_stage()` assertion self-check over synthetic rows covering every
  stage including `published_no_creative` and `scrape_failed`.
- Both crons exercised in `dry_run` first; output inspected before enabling.
- Creative drain canary at `creatives_per_day = 3`; inspect real cost and output
  quality, then raise.
- Link checker verified against the known-good 2026-07-28 baseline: 341 URLs,
  268 live / 58 bot-blocked / 15 dead.

## 10. Build order

Observability before automation. Steps 1–2 add no automation and no spend.

1. Fal cost logging + `pipeline_events` + `pipeline_stage()`
2. Health dashboard — observe for a day
3. Creative drain (dry-run → canary 3 → rate up)
4. Auto-publish (dry-run → on)
5. Settings page, designed once the useful knobs are known

## 11. Rollback

Additive throughout. To stop everything: set `pipeline_enabled='false'` (fail-closed,
all crons no-op). To remove: unschedule the new crons, drop `pipeline_events`,
drop `pipeline_stage()`, drop the two `products` link-health columns, delete the
`pipeline_*` settings rows, remove the two admin routes. No existing table,
trigger, or function is modified destructively.

## 12. Out of scope

**Slice 2 — funnel: brand sites.** Brand queue + weekly re-crawl. `site-crawler`
exists but has only ever run against one domain (`wolfscollections.com`, 8 times).
Highest data quality of any source: 99% live links, avg 4.0 images, 98% with
descriptions.

**Slice 3 — funnel: demand + affiliate.** Demand loop is fully built and parked
(205 `seed_targets`, 127 approved, all crons off). Affiliate feeds are a new
build and additionally blocked on external network accounts and approval.

**Known issues, deliberately not in this slice:**

- `ProductPage.buildRetailerOffers` shows three synthetic retailer offers with
  hash-fabricated prices and a computed "discount N% off" badge, linking to
  retailer search pages. Consumer-facing invented pricing. Should be addressed
  before any growth push, but it is a storefront concern, not a pipeline one.
- 15 dead merchant links, 11 of which are querystring duplicates of ~4 products.
- 54 deactivated google-URL rows, re-sourceable now that `detailLimit` is 20.

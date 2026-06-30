# Style Scenarios — Simulation Cockpit + Weekly Generator (design)

**Date:** 2026-06-30
**Status:** awaiting approval
**Surface:** `admin/seeding` → existing **Styling** tab (`seed_targets` where `kind='scenario'`)

## Goal

A Claude-generated set of styling scenarios that (1) get **simulated** through a
standalone styling engine — picking a **stylist persona** and a **user** per run
so the evaluation is faithful — showing the assembled outfit + gaps, and (2)
**seed the gaps** as demand so the catalog fills in. Weekly cron generates fresh
scenarios; ≥25 seeded on first run. This is the cockpit to prove the engine
before it is connected to the live `style-up-chat`.

## Reuse (do NOT rebuild)

The data-model exploration proposed a full parallel `styling_scenarios` system
(new table, 4 crons, new admin page). **Rejected as over-engineering.** Reuse:

- **Styling tab + table** — `seed_targets` `kind='scenario'`, status machine,
  sortable table, per-target product view (`/admin/data?...&target=<id>`).
- **Demand pipeline** — `seed-run` already expands a scenario via
  `catalog-brainstorm` → `product-search` → products stamped `seed_target_id`.
  Gap-seeding rides this unchanged.
- **Outfit assembler** — `ai-stylist` already picks one product per slot with
  gender-gating + grounding validation; only its candidate set is occasion-blind.
- **Cron controls** — register a pg_cron job + add a `CRON_LABELS` entry and it
  auto-appears with on/off toggle, schedule, last-run status; run-now is a button.

**Only schema change:** add `intent jsonb` to `seed_targets` (scenarios only).
Simulation result is stored in the existing `seed_targets.last_result jsonb`.

## New pieces

### 1. `generate-style-scenarios` (Claude edge fn)
- Input `{ count }`. claude-sonnet-4-6 brainstorms N diverse scenarios spanning
  occasion × gender × season (club/date/work/wedding/gym/beach/festival/funeral/
  cocktail/interview/brunch …).
- Per scenario returns `{ scenario_text, gender, formality (0-5), season, slots[],
  palette }`. Inserts `seed_targets(term=scenario_text, kind='scenario',
  status='approved', intent=<the jsonb>)`. Dedup via existing
  `(lower(term), kind)` unique index. Cheap (no SerpAPI spend).

### 2. `seeding-style-generate` (weekly pg_cron)
- `run_style_scenario_generate()` wrapper → `net.http_post` to the edge fn.
  Schedule weekly (Mon 06:00 UTC). `CRON_LABELS['seeding-style-generate'] =
  'Generate styling scenarios (Claude)'`. Toggle via existing
  `set_seeding_cron_active`. Respects master pause; not budget-gated (no spend).
- "Generate scenarios now" button (run-now). **25 now** = invoke with `count=25`.

### 3. `style-engine` (standalone edge fn) — THE engine
- Input `{ scenario_text, intent, stylist_id, shopper_user_id? , gender? }`.
- Loads stylist persona (`style_up_stylists.persona_prompt`, `source_mode`) and
  user context (gender/height/weight/age/style from `profiles`, or synthetic).
- **Per-slot retrieval**: for each planned slot, call the live `search_products`
  RPC (BM25 over occasion text, gender-filtered) with an occasion+slot query →
  candidate set per slot (catalog stylists). Web stylist (Theo) → `product-search`.
- **Assembly + grounding**: reuse the proven outfit-assembly (prompt build +
  Claude call + id/role/gender validation) — extracted to
  `_shared/outfit-assembly.ts` so `ai-stylist` and `style-engine` share it, no
  duplication, `ai-stylist`'s current behavior unchanged. Persona injected.
- Returns `{ outfit: {slot: product_ref}, gaps: [slot], rationale, perSlotTopScore }`.
- **Live `style-up-chat` is untouched.** Connect-seam (later): point its
  candidate set at `style-engine` once eval proves out.

### 4. Simulate wiring (Styling tab)
- Per scenario row → "Simulate": pick **Stylist** (`style_up_stylists` dropdown)
  + **User** (`profiles` dropdown, or a synthetic gender/body preset) → Run.
- Calls `style-engine`; stores `{ stylist_id, shopper_user_id, gender, outfit,
  gaps, rationale, at }` in `seed_targets.last_result`; row expands to show the
  outfit as product cards per slot (like searches show products) + gaps in red.
- "Simulate all" batch over the set (default stylist/user, or iterate combos).

### 5. Gaps → demand (the "Both")
- Each gap slot → `seed_targets(term="<occasion> <slot> <gender>",
  kind='scenario'|'manual', status='approved', priority)` (existing "Seed this
  gap" path) → `seed-run` fills it → next simulation improves.

## Evaluation (the "98%", later phase)
Each stored `last_result` per (scenario × stylist × user) is an eval record.
Auto-score groundedness (all ids in catalog/in-set) + completeness (slots filled)
+ constraint-pass (gender); LLM-judge occasion-fit + coherence. This is the
measurement harness, run before/after any engine change.

## Build order
- **P0** migration: `intent jsonb` on `seed_targets`.
- **P1** `generate-style-scenarios` edge fn + `seeding-style-generate` cron +
  `CRON_LABELS` + "Generate now" button. Seed 25.
- **P2** extract `_shared/outfit-assembly.ts`; build `style-engine` (per-slot
  `search_products` retrieval + persona).
- **P3** Styling-tab simulate UI (stylist + user pickers, outfit/gaps render,
  store in `last_result`); gap → demand.
- **P4** eval harness scoring stored results.

## Deliberate simplifications (ponytail)
- `last_result` holds only the **latest** simulation per scenario. A
  `style_scenario_sims` history table — only if you want to compare runs side by
  side. `// ponytail: latest-only, add sims table when run-comparison needed`.
- No separate styling budget/killswitch — generation is Claude-only (cheap);
  gap-seeding rides the existing SerpAPI budget.
- No new admin page or parallel cron fleet — all in the existing Styling tab.

## What NOT to build
Parallel `styling_scenarios` table, `scenario-brainstorm`/`scenario-run`/
`scenario-generate`/`styling-activate` fns, `/admin/styling` page, second budget
+ cron-control RPC set. All redundant with `seed_targets` + the existing pipeline.

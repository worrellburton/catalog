# Catalog — Product Improvement Review
**Branch:** `main` (HEAD `fd8c857`) · **Reviewed:** 2026-07-05 · **Reviewer:** Claude Sonnet 5

Sources examined this pass: `CLAUDE.md`, `docs/daily-feed.md`, `docs/PENDING_QUEUE.md`,
`docs/SEARCH_ENRICHMENT_PLAN.md`, `docs/SEARCH_QUALITY_ANALYSIS.md`,
`docs/superpowers/plans/2026-07-01-styleup-engine-method-dial.md`,
`docs/superpowers/specs/2026-06-30-style-scenarios-cockpit-design.md`, recent
git log (`main` currently matches this session's branch exactly — no drift),
GitHub issues/PRs (none open), plus direct reads of `app/services/dials.ts`,
`app/services/search.ts`, `app/services/promote-generation.ts`,
`app/services/generation-queue.ts`, `app/services/product-creative.ts`,
`app/services/looks.ts`, `supabase/functions/embed-product/index.ts`,
`scripts/enrich-all-descriptions.mjs`, `app/routes/admin/*.tsx` file sizes,
and a repo-wide test-coverage / error-handling / migration-count sweep.

**Status check on the previous review (2026-06-24):** all four items from that
pass are **still open** — re-verified below, none re-litigated as new findings.
Ten days of active commits (mostly StyleUp) haven't touched search quality.
Items #1–#4 below are new findings from this pass, in areas the prior review
and `PENDING_QUEUE.md` don't cover.

---

## Carried forward, unchanged (re-verified, not re-argued)

| # | Prior finding | Status |
|---|---|---|
| P1 | `haiku_context` generated for every product but never enters the search embedding (`embed-product/index.ts` SELECT/`buildDoc` still omit it; trigger still doesn't fire on that column) | **Still open** |
| P2 | `fetchSeenLookIds` (`app/services/looks.ts:633`) has no session cache and is called independently by `ContinuousFeed` + `FollowingRail`, firing the same 50k-row query twice per mount; `user_seen_keys()` RPC remains unbounded | **Still open** |
| P3 | Aesthetic/vibe search ("quiet luxury", "old money") has no department-gated routing — `docs/VIBE_AESTHETIC_SEARCH_PLAN.md` Phase 1 is fully scoped but no `aesthetic_intent`/`APPAREL_DEPARTMENT` migration exists | **Still open** |
| P4 | 324/793 products have no description text and are skipped by the enrichment backfill (`scripts/enrich-all-descriptions.mjs:184-207` still just increments a `skipped` counter, no synthetic-description branch added) | **Still open** |

These four are genuinely still worth doing — see the previous review's detail if picking one up. They aren't repeated in full here to keep this pass focused on new ground.

---

## 1 · Generation-pipeline failures are swallowed with no telemetry — including inside the feature just shipped this week

**The gap.** `app/services/promote-generation.ts:265` sits inside the backfill loop
that auto-creates archived `looks` rows for completed generations — the "auto-add
every generated look to My Catalog as Inactive" feature `PENDING_QUEUE.md` marks
DONE. The catch around `promoteGenerationToLook()` there reads
`catch { /* keep going — one bad generation shouldn't block the rest */ }` — a
reasonable per-item resilience choice, but it means a *systemic* failure (a schema
mismatch from one of the 351 migrations, a null field the promoter doesn't expect)
fails identically and silently for every affected generation, forever, with nothing
logged. The same pattern repeats at scale: `app/services/generation-queue.ts`
(5 bare-comment catches, lines 78/87/109/116/120) and `app/services/product-creative.ts`
(6 sites, e.g. 605/656/668/697/1718) — all in the paid, credit-consuming generation
path, none emitting so much as a `console.warn`.

**Why it matters.** This is the newest, least battle-tested feature in the app
(shipped this session per `PENDING_QUEUE.md`'s "Progress" log), sitting on top of a
schema that's changed at a rate of ~50-120 migrations/month. If it regresses, the
symptom a user sees is "my generated look never showed up in My Catalog" — with
zero server-side signal pointing an engineer at the cause. Silent failure in a
credit-consuming flow is also a support-cost risk: users who paid for a generation
that didn't land have no trace to point to.

**Next step.** Add a small `logSwallowedError(context: string, err: unknown)`
helper (console.warn is enough to start — no new infra needed) and call it from
`promote-generation.ts:265` first, since it's the newest and highest-risk site;
extend to the `generation-queue.ts` and `product-creative.ts` sites opportunistically.

---

## 2 · `dials.ts` prefetches 7 of 23 feature flags — Daily Feed weights and video-gen config aren't warmed, and the cache never expires

**The gap.** `app/services/dials.ts` defines 23 distinct dial keys, but
`prefetchDials()` (lines 162-189) batches only 7 in its single `.in('key', …)`
query: `video_still_ratio`, `products_image_only`, `show_brand_logos`,
`comments_enabled`, `auto_editor_enabled`, `waitlist_mode`, `stylist_engine_method`.
The other 16 — critically `feed_rules`/`feed_rules_order` (the ten Daily Feed
ranking weights, per `docs/daily-feed.md`) and `look_video_model`/`quality`/
`duration`/`fallback` (which model a generation actually uses) — each cost their
own extra round-trip on first read, contradicting the file's own header comment
that `prefetchDials()` "warms them all." Separately, `dialCache` (line 9) is a
plain `Map` with no TTL: once a key is cached it only updates via an active
`subscribeX()` realtime listener, so any one-shot `getX()` call can hold a stale
value for the rest of the session even after an admin changes the dial.

**Why it matters.** Daily Feed is the product's core differentiator
(`docs/daily-feed.md`) and reads `feed_rules` on every feed compute — that's an
avoidable extra network hop on what should be the single most-optimized path in
the app. The no-TTL cache is a correctness risk more than a perf one: an admin
tuning `feed_rules` weights or `look_video_model` live (which `docs/daily-feed.md`
and the StyleUp dial docs both describe as a normal operating pattern — "flip to
compare") can have some already-warm sessions never pick up the change.

**Next step.** Add `FEED_RULES_KEY`, `FEED_RULES_ORDER_KEY`, and the four
`LOOK_VIDEO_*_KEY` constants to the `keys` array in `prefetchDials()`
(`app/services/dials.ts:166-174`). Separately, decide intentionally whether the
no-TTL cache is fine (session-lifetime staleness may be acceptable for most flags)
or whether admin-tunable dials need a max-age independent of the realtime subscription.

---

## 3 · Two admin routes have outgrown what one file — or one context window — can safely hold

**The gap.** `app/routes/admin/data.tsx` is 8,560 lines and
`app/routes/admin/catalogs.tsx` is 7,686 lines — 4-5x larger than the next-biggest
admin route (`governance.types.tsx` at 1,490 lines) and roughly 30x over this
repo's own stated guideline in CLAUDE.md Section 6 ("Keep files < 300 lines...
one responsibility per file"). `catalogs.tsx` in particular now holds the home
catalog FEED ordering, the Daily Feed settings modal, and the seeding/Styling tab
all in one file — three features this session's own commits have been actively
extending (Daily Feed dials, StyleUp scenario seeding).

**Why it matters.** This repo's primary development mode is AI-assisted editing
(per CLAUDE.md). A file this large means any single edit either needs a huge
context read or risks operating on a stale/partial view of surrounding logic —
exactly the failure mode that turns a small feature add into an accidental
regression elsewhere in the same file. It's also a growing merge-conflict surface
if more than one workstream ever touches catalogs/data in parallel.

**Next step.** Split `catalogs.tsx` along its existing tab boundaries (home
catalog/FEED ordering, Daily Feed modal, Styling/seeding tab are already visually
distinct sections) into `app/components/admin/catalogs/*.tsx`, kept behind the
same route with no behavior change. Do the same triage for `data.tsx` once
catalogs.tsx is done.

---

## 4 · Zero test coverage on Shopify sync, billing, and the two core AI edge functions

**The gap.** Only 9 test files exist in the entire repo (`app/services/*.test.ts`
×6, `app/utils/*.test.ts` ×3) against 96 files in `app/services` and 172 in
`app/components`. Every existing test targets feed/dial logic (`manage-looks`,
`feed-compose`, `dials.*`, `looks`, `search-log`) — none touches money or the two
highest-stakes AI paths: `supabase/functions/shopify-sync`, `shopify-connect`,
`shopify-callback` (live order/product sync with brand partners, Section 5 of
CLAUDE.md) or `personalize-feed` (787 lines, the Daily Feed engine) and
`style-up-chat` (427 lines, currently being A/B'd per this session's own
`docs/superpowers/plans/2026-07-01-styleup-engine-method-dial.md`).

**Why it matters.** This codebase changes fast (351 migrations, with June 2026
alone contributing 119 — a third of all-time schema churn). Untested paths in a
fast-moving schema are exactly where silent regressions land: a Shopify webhook
that stops validating HMAC correctly, or a Daily Feed fallback that stops
triggering when the Claude re-rank call fails, would ship straight to production
with no test catching it first.

**Next step.** Not full coverage — one smoke test per Shopify webhook handler
(rejects malformed HMAC, upserts idempotently) and one test asserting
`personalize-feed`'s fallback-to-deterministic-order path actually fires when the
Claude re-rank call fails, since that's the one regression a shopper would
immediately notice (a broken or empty Daily Feed).

---

## Bar check

All 4 new findings above are grounded in direct code reads (file paths + line
numbers cited), independently re-verified against `PENDING_QUEUE.md` and the
StyleUp plan docs to confirm they aren't already tracked, and scoped to a
concrete next step rather than a general recommendation. The four carried-forward
search-quality items are listed for status only, not double-counted as new
suggestions. No padding items were added past this list.

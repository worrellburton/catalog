# Catalog Webapp — Improvement Review

**Branch:** `main` · **Reviewed:** 2026-06-27 · **Reviewer:** Claude Sonnet 4.6 (scheduled pass)

Sources examined: `CLAUDE.md`, `docs/daily-feed.md`, `docs/PENDING_QUEUE.md`, `docs/VIBE_AESTHETIC_SEARCH_PLAN.md`, recent git log (50 commits). Key files: `supabase/functions/personalize-feed/index.ts`, `supabase/functions/embed-product/index.ts`, `app/services/session-tracker.ts`, `app/services/personalized-feed.ts`, `app/services/seen-feed.ts`, `app/services/looks.ts`, `app/components/CreativeCardV2.tsx`, `app/components/ContinuousFeed.tsx`, `app/components/FollowingRail.tsx`, `app/components/ShoppingForHero.tsx`, `app/routes/style-up.tsx`, `app/components/UserMenu.tsx`.

Items 1–2 are carried forward from the 2026-06-24 review (confirmed still open). Items 3–5 are new findings from this pass. Items already planned in `docs/*_PLAN.md` or `PENDING_QUEUE.md` are excluded.

---

## 1 · Product scroll impressions bypass `user_events`, starving the Daily Feed engine

**The gap.** When a shopper scrolls past a product card in the home feed, `CreativeCardV2.tsx` (~line 306) calls `trackAdImpression(creative.id)`. That function (`app/services/product-creative.ts:1692`) batches and flushes to `product_creatives.impressions` — a simple counter column — and writes **nothing** to `user_events`. The Daily Feed engine (`supabase/functions/personalize-feed/index.ts`, line 338–341) queries `user_events WHERE target_type='product'` to build its brand/type affinity maps and the per-product `seen` decay set. Product `user_events` rows only exist today when a shopper opens a look overlay (via `trackCreativeImpressions` in `session-tracker.ts:266`). A shopper who browses the product feed for 30 minutes without opening any look overlays produces zero product signal, hits the cold-start guard (`events.length < minSignal`, default 3), and falls back to the global `feed_rank` order. The personalization engine is blind to passive browsing — the most common shopper behaviour.

**Why it matters.** This is the upstream root of the "same order every visit" complaint noted in `PENDING_QUEUE.md` ("Likely the seen-tracking isn't populating"). The `applyDailyShuffle`, `applyRotationGuard`, and `derangeAgainstPrev` mechanics added recently all work correctly — they just operate on an empty signal set for most shoppers.

**Next step.** In `CreativeCardV2.tsx`'s impression effect (line ~286, the `!isLook` path), add `trackImpression({ type: 'product', id: creative.product?.id, uuid: creative.product?.id, context: creative.product?.name })` alongside `trackAdImpression(creative.id)`. The existing `user_seen_keys` RPC already handles `target_uuid` via `coalesce`, so no migration is needed.

---

## 2 · `haiku_context` is generated for every product but never enters the search embedding

**The gap.** The `haiku-context` edge function writes a two-line AI visual description to `products.haiku_context` (line 1: plain-language category; line 2: colour + materials). A pg_cron backfill runs every 10 minutes for any product with a primary image. The column is already consumed by other services (`AIStylist`, `type-governance`, `genders`) — but `embed-product/buildDoc()` does **not** include it. Confirmed: the SELECT at `supabase/functions/embed-product/index.ts:100` lists `name, brand, type, description, size_fit, materials_care, fit_intelligence, product_taxonomy, styling_metadata` — no `haiku_context`. The `buildDoc` function at lines 45–76 also has no reference to it. Semantic search is blind to the visual description. Compounding the problem: `trg_products_auto_embed` fires on `UPDATE OF name, brand, type, description, is_active` — `haiku_context` is absent from the trigger column list, so when the cron sets it on an already-embedded product, no re-embed fires. The embedding predates the visual description and is never refreshed.

**Why it matters.** The design intent for `haiku_context` was to provide clean, literal visual labels ("oversized canvas tote") correcting misleading scraped names. Shoppers searching "oversized canvas", "ankle strap heel", or "waffle knit" get rankings that ignore the clearest per-product evidence for those terms.

**Next step.** In `supabase/functions/embed-product/index.ts`: add `haiku_context` to the SELECT at line 100 and insert it into `buildDoc`'s `parts` array (after `materials_care`, before the JSON-enriched fields). In a new migration: add `haiku_context` to the `trg_products_auto_embed` trigger column list; set `force: true` in `notify_embed_product()` when `NEW.haiku_context IS DISTINCT FROM OLD.haiku_context`. Run a one-shot batch re-embed for `WHERE haiku_context IS NOT NULL AND embedded_at < haiku_context_at`.

---

## 3 · Daily Feed countdown and "personalized" copy shown to signed-out users who get the global feed

**The gap.** `ShoppingForHero.tsx` unconditionally renders the "Your daily feed / Your next feed drops in HH:MM:SS" block (lines 344–372) and fetches `refreshHour` via `getAutoEditorConfig()` regardless of auth state. Signed-out shoppers receive the global `feed_rank` order — the countdown is meaningless for them, and the info modal copy ("A fresh, personalized mix… rebuilt once a day… shaped by what you view & click") is factually wrong: nothing is personalised for a guest. `ShoppingForHero` receives no auth-related prop; `_index.tsx` has `user` state available but doesn't pass it down.

**Why it matters.** Guests are the highest-value conversion audience — the daily feed is a key sign-up incentive. Showing them a countdown to a feed they're already receiving (as if it's locked behind sign-up) breeds confusion rather than aspiration. The copy should surface what guests could unlock, not imply they already have it.

**Next step.** Add `isAuthenticated?: boolean` to `ShoppingForHero`'s props. In `_index.tsx`, pass `isAuthenticated={!!user}`. In the component, gate the `sfh-scroll-hint` block: authenticated users see the countdown as today; guests see a "Create your daily feed →" sign-in CTA instead, and the `getAutoEditorConfig()` fetch is skipped entirely for them.

---

## 4 · Style Up has no front-door in the consumer feed — it is buried two taps into the user menu

**The gap.** `app/routes/style-up.tsx` was moved from admin to consumer-facing in the most recent commit batch (`feat(style-up): make Style Up a consumer app feature`). Its only consumer entry point is `UserMenu.tsx` line 544–548: tap the profile icon, then tap "Style Up." It does not appear in the home hero, bottom bar, look overlay, product page, or any surface a shopper encounters organically. The feature requires auth; a signed-in shopper would have to know it exists to find it.

**Why it matters.** Style Up is the product's flagship AI differentiator. Four sequential phases shipped in rapid succession — AI replies, product picks, on-you renders — but the feature was never given a front-door entry. Organic trial will be near zero if the surface is buried under a profile tap.

**Next step.** The lowest-friction placement: a secondary CTA row in `ShoppingForHero.tsx` — below the inline search bar, above the recently-viewed strip — showing "Chat with a stylist →" that renders only when `isAuthenticated` is true (ties into the prop from suggestion #3). Alternatively, add a chip to the search bar's browse suggestions in `BottomBar.tsx`. Either is a one-component change.

---

## 5 · Look click signals are discarded by the Daily Feed's `rankLooks` — only seen-decay is read

**The gap.** `rankLooks` in `personalize-feed/index.ts` (lines 696–705) reads `user_events WHERE event_type='impression'` to build the `seenLooks` decay set, but reads nothing for `event_type='click'`. A shopper who opens a look generates a `click` event on `target_type='look'` (via `session-tracker.ts`) — strong positive intent. That click has zero effect on the look's score: `rankLooks` ranks entirely on brand/type affinity inherited from the look's attached products and a freshness boost. The product half of the engine has an explicit `clickedProducts` rule that boosts clicked products; looks have no equivalent. The engine is asymmetric.

**Why it matters.** Looks lead the consumer feed. A shopper who repeatedly opens editorial streetwear looks generates no affinity boost for that aesthetic in their next Daily Feed, even though the signal already exists in `user_events`. This is the cheapest possible signal improvement — no new data collection required.

**Next step.** In `rankLooks` (line ~694 in `personalize-feed/index.ts`), add a query for `user_events WHERE event_type='click' AND target_type='look'` to build a `clickedLooks` map (key = `target_uuid || target_id`, value = weighted click count). Apply `normMap`, then add `clickWeight * (clickNorm.get(l.id) ?? 0)` to the look's score (`clickWeight ≈ 0.3 * affWeight`). The change is fully contained in `rankLooks`; no schema change or new rule type needed.

---

## Summary

| # | Area | Impact | Effort |
|---|---|---|---|
| 1 | Product impressions → `user_events` (Daily Feed signal pipeline) | High | Low — 1 call in `CreativeCardV2.tsx` |
| 2 | `haiku_context` missing from embed-product (search quality) | High | Low — add field to `buildDoc` + trigger |
| 3 | Guest hero messaging (conversion UX) | Medium | Low — prop thread + conditional render |
| 4 | Style Up discoverability (feature launch) | Medium | Low — add CTA to hero or bottom bar |
| 5 | Look click signal in `rankLooks` (feed quality) | Medium | Low–Medium — new query + score term |

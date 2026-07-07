# Catalog Feature Roadmap

## Bottom line

Catalog is capability-rich and traction-poor: 5 weekly-active users, 0 clickouts in 7 days, no orders, no real supply. That combination means the roadmap's job is **not** to add surface area — it's to make the load-bearing few features *trustworthy and complete*, then delete the pile of founder tooling and fake UI that adds cost and risk without moving a metric. The strategic wedge (occasion-based stylist + your-own-selfie try-on video) is correct and, unusually, already shipped — the two hardest-to-build differentiators in the category are live. But the wedge is being undercut by data starvation (35% of inventory is invisible to the stylist), silent-wrong-outfit renders, and fake price/social-proof UI that poisons the trust the whole discover→try→buy loop depends on. **The single highest-leverage move is a one-day data job: backfill occasion text on the ~153 active products missing it (`enrich-occasions` already has the backfill param), then add occasion to the search ranker's tsvector — one `setweight` line.** That is the difference between the wedge working and the wedge silently returning thin results. Fix more than you add; at this stage, roughly 60% of the proposed feature ideas are premature.

---

## Fix first (broken / inert / off — dragging the core value)

These are already-built, load-bearing features that are broken, off, or starved. Every one of them is a smaller diff than a net-new feature and each directly unblocks the wedge.

| # | What's wrong | The fix | Effort | Metric unblocked |
|---|---|---|---|---|
| 1 | **35% of active inventory has no occasion text** (DB: 281/434 active products have `styling_metadata.occasion`). The occasion stylist — the entire wedge — is invisible to a third of the catalog, so even a perfect occasion prompt returns thin picks. | Run the existing `enrich-occasions` edge fn in backfill mode (`POST {backfill: N}`) over the ~153 products with empty occasion text. Pure data job, zero code. | **S** | Activation + conversion |
| 2 | **Occasion text isn't in the consumer search ranker.** `search_products`' BM25 tsvector weights name/brand/type/description only (migration `20260602000003` L81-93) — the `occasion` field the enrichment engine writes is *not indexed*. A shopper typing "wedding guest" only matches literal name/description text. | One `setweight` line in a new migration adding `occasion` (+ material/keywords) to the tsvector. Compounds directly with fix #1 (fills the field it indexes). | **S** | Activation + conversion |
| 3 | **Veo try-on fallback silently renders the WRONG outfit.** On Seedance submit-fail the product-blind Veo fallback marks `status='done'` while animating the selfie's *original* clothes and dropping the user's picks (~10%). A confidently-wrong try-on is worse than none — it destroys the trust the loop runs on. | The guard is already written (`generate-look/index.ts` L520-522 `allowProductBlindFallback`, L770-795 gate). Confirm `app_settings.look_video_fallback='false'`, make failure loud (retry prompt, not silent done), and add an alert if the dial is ever ON with products present. | **S** | Activation + trust |
| 4 | **Fake price-comparison chips.** `buildRetailerOffers` (ProductPage.tsx L175) invents 3 alt-retailer chips with hash-jittered prices pointing at generic *search* URLs (`amazon.com/s?k=...`) plus a fabricated "lowest/discount %" badge. Tapping the "cheapest" lands on a keyword search page, not the product — deceptive, and it burns ~75% of Shop taps. | Delete the `ALT_RETAILERS` loop + badge. Keep only the real `product.url` chip (already routes through the affiliate chokepoint). One-file removal. | **S** | Conversion + trust |
| 5 | **Seeding engine is OFF** (`seeding_enabled='false'`, never run in prod); 127 approved + 37 pending `seed_targets` sit idle. Catalog is thin (504 products, ~all <2mo old) — the supply side of the marketplace has no inflow. | Decide, don't leave half-alive: turn it on and watch it (it's the self-healing supply fix — the pipeline already exists), or freeze it and stop carrying idle surface. Given thin catalog is a wedge constraint, **turn it on** behind a rate cap. | **M** | Supply |
| 6 | **Shopify sync produces dead rows.** All 28 synced Shopify products are structurally inactive (sync routes push rows through the URL scraper → fail → `is_platform=false`). Brands table = 4 rows. | Either fix the sync path so synced products land active/curatable, or stop syncing and don't ship inactive inventory. Low priority vs. #1-4 (no real brand supply yet), but don't let dead rows accumulate. | **M** | Supply |
| 7 | **No funnel instrumentation.** Bookmarks are localStorage-only (`useBookmarks.ts` — zero Supabase), so the strongest low-friction intent signal a shopper gives is thrown away server-side. No retention cohort computable, no saved-intent signal. | Add a `saved_items` table; mirror the existing toggle writes to it (keep localStorage as offline cache). No UI change. This is the prerequisite for *any* future re-engagement and is itself the signal to instrument. | **S** | Retention + conversion (instrumentation) |

---

## Improve (sharpen what exists)

High-ROI polish on live features. All reuse existing hooks; none add a new surface.

| Feature | Improvement | Effort | Metric |
|---|---|---|---|
| **StyleUp chat (activation wall #1)** | The empty composer is a passive "Say hi…" hint — the first keystroke is the biggest first-session drop. Seed the already-existing `quickChips()` renderer (StyleUpExperience.tsx L1819) for `messages.length===0` with 4-6 one-tap occasion chips ("Date night", "Wedding guest", "Work week", "A trip"). Chip UI + send handler already exist; only the empty-state branch opts out. | S | Activation |
| **StyleUp selfie (activation wall #2)** | The selfie that unlocks "see it on me" is buried in a collapsible context-card editor (L1419-1443); a new user reaches the render before being told to add it. Front-load the photo ask on first thread entry. Reuses `pickPhoto` / `uploadUserPhoto` — just reorder *when* the ask appears. (Doppl dropped to one selfie precisely because full-body was the #1 abandonment point.) | M | Activation |
| **ProductPage social proof** | `dummySavedBy` (L237) fabricates "Saved by N shoppers" (47-527). Once `saved_items` exists (fix #7), back it with a real `COUNT(*)`; if the real count is ~0, **delete the module** rather than lie. Folds into the fake-UI cleanup with #4. | S | Trust |
| **Build-a-Catalog filters** | `composeFilterQuery` drops price/budget entirely and mashes occasion+type+vibe into one bag-of-words string. Pass the price chip through as a structured `filter_price` predicate on `search_products` (the RPC already filters gender). *Defer behind #1-2* — it's a secondary entry the wedge doesn't depend on. | S | Conversion |
| **Recent-occasion re-entry** | `recordRecentSearch` already populates a store; render it as tappable rows in the BottomBar search sheet so a returning shopper re-enters "wedding guest" in one tap. *Defer* — helps session 2+, and session 2 barely exists yet. | S | Retention (later) |

---

## Add (net-new — only what earns its place)

The honest answer: **almost nothing.** At 5 weekly-actives, a notification channel, alerts loop, and reciprocity graph have no audience to serve — they are the classic over-build the strategy warns against. The one net-new item that earns its place now is a data array (occasion chips, already covered under Improve). Everything genuinely net-new is gated on traction that doesn't exist yet.

**Activation**
- **Occasion starter chips** (covered above) — the only net-new worth shipping now, and it's a seeded array, not a new surface.

**Retention** — *build the table now, the loop later.*
- **`saved_items` server persistence** (fix #7) is the one retention-adjacent build that earns its keep *before* the audience exists, because it's the prerequisite for everything downstream and is a tiny diff. Build **only the table + mirror writes** — not the alert loop on top.
- **Deferred until DAU exists:** a push channel (Web Push + Flutter-shell native), "Daily Feed is ready" hook, back-in-stock/price-drop alerts, reciprocity notifications. Each reuses an existing pipeline (`ActivityRealtimeToasts`, `FollowingRail` unseen-counts, `personalized_feeds` day-key) — so they're cheap *when the time comes*. In-market proof they work (**Airship**: ≥1 push in first 90 days → ~3x retention; **Swym**: back-in-stock alerts 30-35% CTR / ~20% conversion; **LTK/Whatnot**: follow-loop → 80%+ MoM retention) is all from apps 4-5 orders of magnitude larger. **Do not build these at 5 WAU** — there is no cohort to move and pushing an audience that isn't there risks the exact annoyance-churn the research documents.

**Conversion / Supply** — no net-new. The redirect/affiliate model is the correct lazy architecture; do **not** build a cart or in-app checkout with no orders and no supply. The conversion work is entirely *fixes* (#4 kill fake chips) and *supply* (#5 seeding).

**Explicitly NOT building now** (all real ideas, all premature): lens/camera on the main search bar (second discovery affordance before the first converts), digital-model try-on fallback (no measured selfie-refusal drop-off), fit-prediction/sizing (no orders to reduce returns on — YAGNI), streaks/XP/leaderboards (no habit to protect at 5 WAU — the research's own #1 anti-pattern), affiliate conversion reconciliation (nothing to reconcile at 35 lifetime clickouts).

---

## Cut / deprecate

Delete or freeze. This is the over-built surface adding bundle weight, maintenance, and — in the fake-UI cases — active trust liability.

| What | Why | Action |
|---|---|---|
| **9 in-app investor decks (DeckView V1-V9)** | Zero user value; pure founder tooling shipped into the consumer bundle. | Delete from the shipped app |
| **Equity/opex modeler** | Investor-facing; no place in the consumer app. | Delete |
| **`kaizen` + `equity-advisor` edge functions** | Zero user value. | Delete |
| **`GridView.tsx`** | Confirmed zero importers (grep across `app/**/*.tsx`); superseded by `ContinuousFeed`/`FeedSection`. 279 lines of dead code. | Delete |
| **`buildRetailerOffers` ALT_RETAILERS loop + fake discount badge** | Fabricated prices → search-page dead-ends. Near-deceptive. | Delete (fix #4) |
| **`dummySavedBy` fabricated "Saved by N shoppers"** | Fake social proof. | Delete, or back with real count once `saved_items` exists |
| **Online-presence dots** (`subscribeOnline` in FollowingRail/FollowingPage) | Renders empty ~always at 5 WAU while paying realtime subscribe cost. | Gate behind a DAU threshold or remove |
| **Share watermark worker** | **Not a bug** — `s.$slug.tsx` L74 already falls back to `generation.video_url`, so shared links play. Watermark is cosmetic. | Deprioritize hard — do **not** spend effort here |

---

## Sequenced roadmap

Front-loaded on fixes and activation, because that's where the leverage is. Each step names the metric it unblocks.

### Now (this week — the wedge must work and be trustworthy)
1. **Backfill occasion text** (`enrich-occasions` backfill) → *activation/conversion*. Highest leverage, zero code. **[fix #1]**
2. **Add occasion to search tsvector** (one `setweight` migration) → *activation/conversion*. Compounds with #1. **[fix #2]**
3. **Verify `look_video_fallback='false'` + loud-fail guard** → *activation/trust*. Guard already written. **[fix #3]**
4. **Kill fake retailer chips + fake saved-by** (one ProductPage cleanup pass) → *conversion/trust*. **[fix #4 + improve]**
5. **Seed occasion starter chips** in empty StyleUp chat → *activation*. **[improve]**
6. **Delete dead surface:** DeckView V1-V9, equity modeler, kaizen/equity-advisor fns, `GridView.tsx` → *cost/risk*. **[cut]**

### Next (following 1-2 weeks — complete the funnel + instrument)
7. **Front-load the selfie ask** in StyleUp first-run → *activation (try-on completion)*. **[improve]**
8. **`saved_items` table + mirror writes** → *instrumentation, prerequisite for retention*. **[fix #7]**
9. **Turn seeding engine ON** behind a rate cap (or formally freeze it) → *supply*. **[fix #5]**
10. Instrument **D1/D7** now that saves persist — you cannot manage retention you can't measure. Treat all cited retention benchmarks as directional priors until you have your own cohort.

### Later (only once DAU/supply justify it — do NOT pull these forward)
11. Fix or freeze **Shopify sync** → *supply* (when real brand supply exists). **[fix #6]**
12. **Push channel** (Web Push + Flutter native) reusing `ActivityRealtimeToasts` → *retention* — **gate on a real daily-active base.**
13. **"Daily Feed is ready" hook** + **back-in-stock/price-drop alerts** on `saved_items` → *retention* — downstream of #8 and #12.
14. **Reciprocity notifications**, **recent-search re-entry**, **structured price filter**, **one-tap try-on share** → *retention/conversion* — cheap when the graph and traffic are non-trivial; no-ops today.

The through-line: steps 1-4 are the whole game right now. They make the differentiated wedge actually return correct, trustworthy results — which is the precondition for every retention and conversion loop below them to matter at all. Ship those before anything with the word "new" attached.

---

**Verified hooks referenced:** `GridView.tsx` (0 importers, confirmed), `ProductPage.tsx` L155/L175/L237 (fake retailer + saved-by, confirmed), `useBookmarks.ts` (localStorage-only, no Supabase, confirmed), `s.$slug.tsx` L74 (raw-video fallback exists → watermark is cosmetic, confirmed), `enrich-occasions` backfill param, `generate-look/index.ts` L520-522/L770-795 (fallback guard), `search` migration `20260602000003` L81-93 (tsvector def), `StyleUpExperience.tsx` L1819/L1419-1443 (quickChips + selfie card).
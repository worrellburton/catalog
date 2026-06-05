# Vibe & Aesthetic Search — Phases 1–3

**Status:** Proposed · **Owner:** Search · **Created:** 2026-06-05
**Depends on:** Search V7 (structured facet routing) — already live (`search_products`, migrations `20260603…`–`20260605000006`).

---

## 1. Context & where we are

Consumer search (`search` edge fn → `search_products` RPC) now **routes on intent**:

| Route | Trigger | Behaviour | Status |
|---|---|---|---|
| **Category** | a product-type noun ("white shoes", "black jacket") | hard-filter to the category (`type ∪ taxonomy.category`), tier by subcategory → color-family → BM25 → popularity | ✅ Live, eval-gated |
| **Vibe / open** | everything else ("date night", "quiet luxury") | hybrid: BM25 over occasion/style text + dense (gte-small) RRF | ✅ Live (unchanged from V6.1) |

The category route is solved. **This document covers the vibe route**, which is still weak for *aesthetic/trend* queries.

### The symptom
- `"quiet luxury"` → returns Le Labo candles, Augustinus Bader face cream, a laptop — not understated fashion.
- `"old money"` → returns **one** result: *"The Psychology of Money"* (a finance book).
- `"date night"`, `"streetwear"` → already good (honest occasion/style tags exist).

So: occasion-driven vibes work; **aesthetic/trend vibes do not**.

---

## 2. Root cause (data-verified, 2026-06-05)

The matching substrate is BM25 over `product_occasions_text()` = `styling_metadata.occasion[] + fit.best_for_occasions[] + taxonomy.style + taxonomy.subcategory`. **`taxonomy.style` is already in the searchable doc** — so "style isn't searchable" is NOT the problem.

The real problems, with numbers:

1. **The `style` facet is department-blind.** `style = "minimal luxury"` is on **44 products spanning every department** — beauty, home, tech, grooming, *and* fashion. It was enriched as a generic "premium item" descriptor, not a fashion-subculture tag.
   → Expanding `"quiet luxury" → "minimal luxury"` would **still** surface candles and a laptop. A synonym map alone fails.

2. **Keyword ambiguity.** Literal `"luxury"` appears in the doc of **55 products, 31 of them non-apparel**. `"quiet"` matches nothing, so `"quiet luxury"` degrades to matching `"luxury"` → mostly non-fashion.

3. **Missing trend vocabulary.** `"old money"`, `"clean girl"`, `"coastal grandma"`, `"mob wife"` etc. exist nowhere in the catalog text, so they fall back to incidental literal matches ("money" → a finance book).

4. **Counter-example that works:** `style = "streetwear"` (13 products) is **clean — all apparel/footwear**. Proof that a *department-coherent* aesthetic tag ranks correctly today.

**Therefore the lever is department awareness + a trustworthy aesthetic vocabulary — not raw enrichment volume.** (See [SEARCH_QUALITY_ANALYSIS.md](./SEARCH_QUALITY_ANALYSIS.md) for the broader search history.)

---

## 3. Design principles

- **Honesty over volume.** Do not stuff trend words onto every product (re-introduces the term-dilution that got `description` dropped from the doc in `20260603000002`). Tag selectively and truthfully.
- **Structured, not flat.** Aesthetic signal lives in structured facets (`taxonomy.style`, `category`/department) so it can both *rank* and *filter* — never a flat text blob.
- **Route, don't tune one knob.** Aesthetic queries get their own route; category and occasion routes stay independent (this is what ended the V1–V6 whack-a-mole).
- **Gate every change.** Each phase ships behind `npm run eval:search` assertions covering category + occasion + aesthetic intents.

---

## 4. Phase 1 — Department-aware aesthetic routing

**Goal:** fix the headline failures (`quiet luxury`, `old money`) by keeping aesthetic queries inside the apparel department. Highest ROI, lowest risk, no data migration.

**Effort:** ~half a day. Same shadow → eval → promote pattern as V7.

### 4.1 Mechanism
Add a **third route** to `search_products`, evaluated before the vibe fallback:

```
if aesthetic_intent(query) is detected:
    base ← active products WHERE taxonomy.category ∈ APPAREL_DEPARTMENT
    rank ← BM25(occasion/style doc, expanded_query) + dense RRF, within base
else if category_intent: … (existing V7 structured path)
else: … (existing vibe/hybrid path)
```

- **`APPAREL_DEPARTMENT`** = `{footwear, tops, bottoms, dresses, outerwear, knitwear, activewear, fashion}` (+ optionally `eyewear`, `jewelry` for accessories). Derived from the clean `taxonomy.category` we already trust in V7.
- **`aesthetic_intent(query)`** = a curated regex/lexicon of fashion-aesthetic terms (see Appendix A).
- **`expanded_query`** = the query OR-expanded with canonical tokens that *do* exist on apparel (Appendix A map), so e.g. `"quiet luxury"` also matches `minimal`, `tailored`, `cashmere`, `refined`.

### 4.2 Why this fixes it without Phase 2
The candles/skincare/laptop are `home`/`beauty`/`tech` → filtered out by the department gate, regardless of their polluted `"minimal luxury"` style tag. The 44 "minimal luxury" *apparel* items rise. `"old money"` → apparel + expansion to `classic/tailored/heritage` → returns the right clothing instead of a finance book.

### 4.3 Risks & mitigations
- **Mixed-intent queries** ("luxury candle", "home decor") must NOT be caught by the aesthetic gate — the lexicon is fashion-specific, and an explicit product/home noun should win. Mitigation: only fire aesthetic route when no category noun is present AND an aesthetic term matches.
- **Sparse departments** — if an aesthetic yields few apparel matches, allow graceful backfill to other apparel (already how V7 tiers).
- **Accessories** (bags, jewelry, eyewear) — decide per-aesthetic whether they belong (e.g. "old money" → yes to leather goods). Start apparel-only; widen with eval evidence.

### 4.4 Acceptance (eval)
Add to `tests/search/eval-relevance.mjs`:
- `quiet luxury`, `old money`, `clean girl`, `coastal grandma`, `streetwear`, `y2k` → **forbid** `home|home-decor|beauty|grooming|tech|books|food`; **want** ≥3 apparel results.
- Regression: `luxury candle`, `home decor`, `date night` unchanged.

---

## 5. Phase 2 — Curate the `style` facet (the real enrichment)

**Goal:** make `taxonomy.style` a *trustworthy* aesthetic signal so aesthetic queries can rank on it directly (not just survive via department filtering).

**Effort:** ~1 day incl. QA. ~128 products × haiku ≈ **$0.05–0.10** per pass.

### 5.1 Problem to fix
`style` is currently free-text and department-blind ("minimal luxury" on a laptop). We replace it with a **controlled vocabulary applied only where it's true.**

### 5.2 Controlled aesthetic vocabulary (apparel only)
A fixed enum the enricher must choose from (extensible), e.g.:
`quiet luxury · old money · streetwear · clean girl · coastal grandma · y2k · coquette · gorpcore · minimalist · classic tailoring · athleisure · bohemian · edgy · preppy · workwear`

Rules for the enricher (haiku):
- Only assign aesthetics to apparel/footwear/accessories. Non-apparel → `style` stays category-descriptive or null.
- 1–3 aesthetics per item, only when genuinely applicable (honesty gate).
- Output is a `string[]` (an item can be both "quiet luxury" and "classic tailoring").

### 5.3 Where it runs
- **New products:** extend `agents/product-scraper/modal_app.py::generate_taxonomy_and_styling` to emit the controlled `style[]` (it already runs on every scrape — see §7).
- **Backfill:** a `scripts/enrich-aesthetics.mjs` (mirror of `enrich-occasions-v2.mjs`: haiku, idempotent on an `enrichment_version`, re-embeds via `embed-product` force).

### 5.4 Search change
- Promote `style` from a single string to the controlled array in `product_occasions_text` (weight A).
- After Phase 2, Phase 1's department gate + a `style[]` exact-match tier (like V7's color tier) gives precise aesthetic ranking.

### 5.5 Acceptance
- ≥90% of apparel items carry ≥1 aesthetic; **0** non-apparel items carry a fashion aesthetic (the pollution check).
- Eval aesthetic queries now pass on `style[]` match even with the department gate relaxed.

---

## 6. Phase 3 — Occasion coverage (incremental)

**Goal:** raise recall for *occasion* vibes that are thin today (distinct from aesthetics).

**Effort:** incremental; cheap.

- Audit `styling_metadata.occasion` coverage; current top vocab: `date night (16), weekend brunch (13), casual office (9)…`. Gaps: `wedding guest, festival, job interview, travel day, gym-to-street, beach vacation`.
- Extend `enrich-occasions-v2.mjs` prompt to ensure these high-intent occasions are considered.
- 5 active products currently have **no** `occasion[]` at all — include them.
- Acceptance: eval occasion queries (`wedding guest`, `job interview`, `travel`) return ≥3 on-occasion apparel items.

---

## 7. New-product pipeline (already healthy — keep it so)

`VITE_MODAL_SCRAPER_URL` → `modal_app.py::scrape_and_update` runs `generate_taxonomy_and_styling` (Step 3) on **every** scraped product, writing `product_taxonomy` (+ color) and `styling_metadata.occasion`. So new products auto-enrich today.

**Action for Phases 2–3:** when the controlled `style[]` / occasion vocab lands, update the `generate_taxonomy_and_styling` prompt in the same place so new products are born compliant. Otherwise the backfill drifts out of date.

---

## 8. Rollout & sequencing

1. **Phase 1** behind a shadow `search_products` (or a feature gate), eval green on category + occasion + aesthetic, then promote — exactly as V7 shipped.
2. **Phase 2** enrichment backfill + Modal prompt update + search `style[]` tier; re-embed; eval.
3. **Phase 3** occasion top-up alongside or after.
4. Each promotion is a `dev → staging → main` fast-forward per `CLAUDE.md` branch rules. Rollback = re-apply the prior `search_products` migration.

## 9. Effort / cost summary

| Phase | Effort | $ | Risk | Unblocks |
|---|---|---|---|---|
| 1 — department routing | ~½ day | $0 | Low | fixes `quiet luxury`/`old money` headline |
| 2 — curate `style[]` | ~1 day + QA | ~$0.10 | Med (data) | precise aesthetic ranking |
| 3 — occasion top-up | incremental | ~$0.05 | Low | occasion recall |

## 10. Open questions

- Accessories (bags/jewelry/eyewear) in/out per aesthetic? (start out, widen on evidence)
- Do we want a tiny LLM query-understanding step for the long tail of novel aesthetics, or keep a curated lexicon? (lexicon first; revisit if tail matters)
- Should aesthetic + category compose? ("quiet luxury shoes" → apparel∩footwear∩aesthetic) — natural extension once both routes exist.

---

## Appendix A — Phase 1 aesthetic lexicon & expansion (starter)

Curated; extend as trends emerge. Expansion tokens chosen to match vocabulary that exists on **apparel** items.

| Aesthetic term (detect) | Expansion tokens (OR into BM25) |
|---|---|
| quiet luxury | minimal, tailored, refined, cashmere, understated, classic |
| old money | classic, tailored, heritage, preppy, equestrian, refined |
| clean girl | minimal, effortless, natural, sleek |
| coastal grandma | linen, relaxed, coastal, resort, neutral |
| mob wife | bold, fur, leather, glamorous, statement |
| streetwear | streetwear, street style, oversized, graphic |
| y2k | y2k, low-rise, baby tee, retro |
| coquette | feminine, bows, lace, romantic |
| gorpcore | technical, outdoor, utility, performance |

Detection fires only when no explicit product-type/home noun is present (avoids catching "luxury candle").

## Appendix B — References
- `search_products` (current): migrations `20260603000001`, `20260603000002`, `20260605000005`, `20260605000006`
- Eval/gate: `tests/search/eval-relevance.mjs` (`npm run eval:search`)
- Occasion enrichment: `scripts/enrich-occasions-v2.mjs`
- Scraper enrichment: `agents/product-scraper/modal_app.py` (`generate_taxonomy_and_styling`)
- Prior analyses: `docs/SEARCH_QUALITY_ANALYSIS.md`, `docs/SEARCH_ENRICHMENT_PLAN.md`

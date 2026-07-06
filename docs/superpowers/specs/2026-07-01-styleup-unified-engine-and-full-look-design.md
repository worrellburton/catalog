# Style Up — engine-method dial (A/B) + full-look "See it on me"

**Date:** 2026-07-01
**Status:** Design (revised to an admin dial), pending review → implementation plan

## Goal

1. **Runtime method switch (A/B).** Add an admin dial that selects how the `/style` catalog stylist sources products: **Style engine** (occasion-aware `style_slot_search`) or **Legacy** (the pre-engine recency behavior). Flip it live in the admin to compare the two.
2. **Behavior split by method:**
   - **Style engine:** the stylist suggests products directly from the engine. The up-front "Build your outfit" slot **chooser is not shown** — an outfit ask returns a complete look as engine cards. "See it on me" composites the whole look, with an optional per-piece toggle.
   - **Legacy:** exactly today's pre-engine behavior — the "Build your outfit" chooser, recency retrieval, per-card try-on. Nothing changes.
3. **Nothing is deleted.** The switch is a dial; both code paths stay live and are chosen at runtime.

Non-goals: web stylists (Theo) always source from the open web (`product-search`) regardless of the dial. No new render pipeline.

## The switch — a `stylist_engine_method` dial

Reuses the existing dials system verbatim (`app_settings` text key/value + `services/dials.ts` + `/admin/dials` + realtime).

- **Key/values:** `stylist_engine_method` ∈ `'style_engine' | 'legacy'`, default `'style_engine'`.
- **`services/dials.ts`:** add `STYLIST_ENGINE_METHOD_KEY`, `DEFAULT_STYLIST_ENGINE_METHOD`, `getStylistEngineMethod()`, `setStylistEngineMethod()`, `subscribeStylistEngineMethod()`, and add the key to `prefetchDials()`. Mirrors `waitlist_mode` (a string/enum dial rather than bool).
- **Hook:** `useStylistEngineMethod()` (mirrors `useWaitlistMode`) — hydrate + realtime subscribe, so flipping the dial updates open `/style` sessions without a refresh.
- **Admin control:** a "Stylist engine" section on `/admin/dials` — a two-option toggle (Style engine · Legacy) calling `setStylistEngineMethod`. (Scope: **global**, one dial for the whole feature; per-stylist is a future extension via a column on `style_up_stylists`.)
- **Server read:** `style-up-chat/index.ts` reads the same `app_settings` row (service role select) so the edge fn and client never disagree — the dial is the single source of truth.

## Behavior by method

| Surface | `style_engine` (default) | `legacy` |
|---|---|---|
| Typed "show me pieces" (edge fn candidates) | `retrieveOccasionCandidates` → `style_slot_search` (current v8) | 120-newest recency scan (restored pre-v7 query) |
| "Put together an outfit" | `triggerStylist('outfit')` → engine assembles a complete look; **no chooser** | `startOutfitFlow()` → "Build your outfit" chooser (as today) |
| "Try different X" swap | `fetchSwapOptions` sourced from `style_slot_search` | `fetchSwapOptions` recency scan (as today) |
| "See it on me" | full-look bar: renders all suggested pieces, optional "Choose pieces" toggle | per-card single-item try-on (as today) |

### Client (`StyleUpExperience.tsx`)
- `const method = useStylistEngineMethod()`.
- `send()` outfit branch: `method === 'style_engine' ? triggerStylist('outfit') : startOutfitFlow()`.
- `triggerStylist(mode?: 'outfit')` sends `body: { threadId, mode }`.
- Full-look bar (Part B below) renders only when `method === 'style_engine'`.

### Edge fn (`style-up-chat/index.ts`)
- Read `stylist_engine_method`. Branch the catalog candidate block:
  - `legacy` → the pre-engine query: `products.is_active.not(image_url null).order(created_at desc).limit(120)` gender-filtered (restored, kept alongside the engine path).
  - else → `retrieveOccasionCandidates` (current).
- `mode === 'outfit'` (only sent in engine mode) → append the complete-look assembly clause to the prompt: *"The shopper wants a COMPLETE look — one top (or dress), one bottom, shoes, optional layer, all coherent — return their ids in productIds."* Cap stays 4.

### Swap source (`style-up.ts`)
- `fetchSwapOptions` reads the dial (`getStylistEngineMethod()`, cached) and branches its candidate **source**: `style_slot_search` (engine) vs the existing recency query. The existing post-filters (exclude, `roleForProduct`, budget, `avoidColors`, formality, `simpler`) run over whichever source produced the rows — unchanged. Add a small `slotSearch(role, gender, occasion, k)` wrapper for the RPC.

## Part B — "See it on me": full look + optional selection (engine mode)

When `method === 'style_engine'` and the look has ≥2 pieces, show a sticky **look bar** above the composer:

```
Your look · 3 pieces        [ Choose pieces ]  [ See it on me ]
```

- **See it on me** → the existing full-look flow: `askScene()` (scene chooser) → `generateFullLook(selectedLook(), scene)`. Default `selectedLook()` = `assembleLook()` (all pieces) → complete look.
- **Choose pieces** (optional) → expands to per-piece toggles (all ON); dropping one (e.g. bottom) renders top + shoes only. State: `lookSelection: Set<string> | null` (null = all), reset when a new suggestion batch arrives.
- No render-pipeline change — `generateFullLook` already takes an arbitrary product array + scene. Per-card `tryOn` (single item) stays.

## Files touched

| File | Change |
|---|---|
| `app/services/dials.ts` | add the `stylist_engine_method` dial (get/set/subscribe + prefetch key) |
| `app/hooks/useStylistEngineMethod.ts` | **new** — hydrate + subscribe hook (mirrors `useWaitlistMode`) |
| `app/routes/admin/dials.tsx` | add the "Stylist engine" two-option control |
| `app/components/style-up/StyleUpExperience.tsx` | read the dial; outfit branch picks engine vs chooser; `triggerStylist` sends `mode`; add the sticky look bar (engine mode) + `lookSelection`/`selectedLook()` |
| `supabase/functions/style-up-chat/index.ts` | read `stylist_engine_method`; branch candidates (engine vs restored 120-newest); `mode:'outfit'` prompt clause |
| `app/services/style-up.ts` | `fetchSwapOptions` branches source on the dial; add `slotSearch` wrapper |
| `supabase/migrations/NNN_stylist_engine_method.sql` | optional seed row `app_settings('stylist_engine_method','style_engine')` (else default applies) |

No function is removed; both engines stay live.

## Reverting / operating

- **Flip to legacy:** set the dial to `legacy` in `/admin/dials` — instant, no deploy, affects new turns for every session (realtime). Flip back to `style_engine` anytime.
- Default is `style_engine`, so shipping changes nothing until an admin deliberately switches.

## Edge cases

- **Dial read on the server:** one cheap `app_settings` select per turn (or folded into an existing query); missing row → default `style_engine`.
- **Zero engine candidates** (engine mode): empty pool + `(none available)`, no recency fallback (deliberate). Legacy mode is the recency behavior by design.
- **Mid-conversation flip:** applies to the next turn; already-sent messages are unchanged. Fine for A/B.
- **Look bar threshold:** ≥2 pieces so a single pick doesn't show a "full look" CTA.

## Verification

- **Manual (local, Chrome MCP, logged-in), both dial positions:**
  - `style_engine`: "put together a smart casual dinner outfit" → engine cards, **no chooser**; `style_up_traces.candidate_count` ≈ per-slot pool + `[style-retrieval]` log. "try different pants" → occasion-relevant. Look bar → full-look render; drop bottom via "Choose pieces" → top+shoes.
  - `legacy`: same asks → "Build your outfit" chooser returns; candidates are the 120-newest; no look bar. Confirms the A/B difference on screen.
- One runnable check: unit test `selectedLook()` (all vs subset) and `fetchSwapOptions` role filter over a mocked `style_slot_search` result.

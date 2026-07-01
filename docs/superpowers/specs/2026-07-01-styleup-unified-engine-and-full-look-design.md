# Style Up — unified engine retrieval + full-look "See it on me"

**Date:** 2026-07-01
**Status:** Design approved, pending spec review → implementation plan

## Goal

Two changes to the `/style` stylist chat (catalog stylists):

1. **Unify retrieval on the engine.** Every catalog product surfaced in the chat should come from the occasion-aware engine (`style_slot_search`), not the legacy 240-newest recency scan. Today only the typed "recommend/show me pieces" path uses the engine; the "put together an outfit" ask (slot chooser) and the "try different X" swap picker still use recency.
2. **"See it on me" = the whole look, with optional piece selection.** A single tap should composite **all** the suggested pieces onto the shopper (complete look). The shopper can optionally drop pieces first (e.g. top + shoes, no bottom).

Non-goals: web stylists (Theo) intentionally keep sourcing from the open web (`product-search`) — out of scope. No new render pipeline (reuse the existing full-look render). No change to how single-piece "See it on me" works.

## Background (current behavior, verified in code)

- `send()` ([StyleUpExperience.tsx:851‑875](../../../app/components/style-up/StyleUpExperience.tsx)) routes free text through client-side detectors **before** the edge fn: `swapTargetFromText` → `handleSwapRequest`; `wantsFullOutfit` → `startOutfitFlow` (slot chooser); `wantsFullLook` → `askScene` (full render); else → `triggerStylist` (the **only** caller of the `style-up-chat` edge fn / engine).
- The edge fn's catalog candidates come solely from `retrieveOccasionCandidates` → `style_slot_search` (occasion-aware BM25); picks are validated against that pool. **Engine-backed.**
- `startOutfitFlow` → `askOutfitSlots` shows a "Build your outfit" chooser; on submit, `onChoose('slots')` calls `recommendForSlot` per slot → `fetchSwapOptions` (**240-newest recency scan + JS substring re-score**, [style-up.ts:643](../../../app/services/style-up.ts)).
- `handleSwapRequest` → `fetchSwapOptions` (same recency scan).
- Full-look render already exists: `assembleLook()` (one piece per slot from `lookPicks()`), `generateFullLook(products, scene)` → `startFullLookRender({products, scene})` → `renderLook`. Triggered today only by typing "show me the full look" → `askScene` (scene chooser) → `generateFullLook(assembleLook(), scene)`.

## Part A — Unify catalog retrieval on the engine

**Guiding rule: switch, don't delete.** No existing function is removed. Each switch is guarded by a single boolean flag that defaults to the new (engine) behavior; flipping it to `false` restores the exact legacy path. The old chooser flow and recency scan stay in the codebase, reachable, so a revert is one line.

### A1. "Put together an outfit" → engine (flag `ROUTE_OUTFIT_TO_ENGINE`)

- Add a module-level `const ROUTE_OUTFIT_TO_ENGINE = true` in `StyleUpExperience.tsx`.
- In `send()`, the `wantsFullOutfit(text)` branch becomes:
  `ROUTE_OUTFIT_TO_ENGINE ? void triggerStylist('outfit') : void startOutfitFlow();`
  Flag `false` → the current "Build your outfit" chooser returns unchanged.
- `triggerStylist(mode?: 'outfit')` passes `body: { threadId, mode }` to `supabase.functions.invoke('style-up-chat', …)`.
- **Edge fn (`style-up-chat/index.ts`):** read `body.mode`. When `mode === 'outfit'` (catalog branch only), append an assembly instruction to the system prompt: *"The shopper wants a COMPLETE look. Recommend one coherent outfit from the candidates — a top (or a dress), a bottom, shoes, plus an optional layer — one piece per slot, all matching in color/formality/season. Return their ids in productIds."* Cap stays at 4 (top+bottom+shoes+layer, or dress+shoes). No `mode` → existing "1‑4 pieces" behavior. This is purely additive on the server (an extra prompt clause), so it needs no flag.

**Kept, not deleted:** `startOutfitFlow`, `askOutfitSlots`, `onChoose('slots')`, the shoes sub-chooser, `recommendForSlot` / `webRecommendForSlot`, `chosenBySlot`, `sendChooser` — all remain. They're simply not reached while the flag is `true`.

### A2. "Try different X" swap → engine (flag `SWAP_USE_ENGINE`)

- Add `const SWAP_USE_ENGINE = true` in `style-up.ts`.
- In `fetchSwapOptions`, branch the candidate **source**:
  - `SWAP_USE_ENGINE` → `supabase.rpc('style_slot_search', { p_query, p_k, p_gender })`, where `p_query = \`${styleText} ${occasion} ${ROLE_QUERY_NOUN[role]}\``, `p_gender` = shopper gender, `p_k` ≈ 16.
  - else → the **existing** `.from('products').order('created_at').limit(240)` block, left in place verbatim.
- The existing post-filters/re-score (exclude ids, `roleForProduct` match, budget, `avoidColors`, formality, `simpler`) run over whichever source produced the candidates — unchanged. The recency tiebreak stays harmless with engine results (engine order dominates).
- Add a tiny wrapper (e.g. `slotSearch(role, gender, occasion, k)`) so the RPC call lives in one place. `style_slot_search` is granted to `authenticated`, so the client may call it directly.
- Web swap (`webFetchSwapOptions`) unchanged.

After A1+A2 (flags on), every **catalog** product path (typed, outfit, swap) is engine-backed; web stays web. Flags off → exact prior behavior.

## Part B — "See it on me": full look + optional selection

Add a **sticky look bar** above the composer, shown whenever `assembleLook().length >= 2`:

```
Your look · 3 pieces        [ Choose pieces ]  [ See it on me ]
```

- **`See it on me` (primary):** triggers the existing full-look flow — `askScene()` (scene chooser) → `generateFullLook(selectedLook(), scene)`. Default `selectedLook()` = `assembleLook()` (all pieces) → complete look. No typing required (replaces needing to type "show me the full look", which still works as a fallback).
- **`Choose pieces` (optional):** expands the bar to list `assembleLook()` pieces as toggles, all ON by default. Toggling off drops a piece from `selectedLook()`. Empty selection disables the CTA.
- State: `lookSelection: Set<string> | null` (null = all). `selectedLook()` = `assembleLook()` filtered by `lookSelection`.
- Per-card "See it on me" (single item, `tryOn`) is unchanged.

No render-pipeline change: `generateFullLook` already accepts an arbitrary product array + scene. Part B is purely **additive** — it deletes nothing (per-card `tryOn` and the "show me the full look" text trigger stay). For consistency it's gated by `const SHOW_LOOK_BAR = true`; `false` hides the bar and restores the prior UI exactly.

## Files touched

No file loses code. Every change is a flag-gated branch or an additive block.

| File | Change |
|---|---|
| `app/components/style-up/StyleUpExperience.tsx` | add `ROUTE_OUTFIT_TO_ENGINE` + `SHOW_LOOK_BAR` flags; `wantsFullOutfit` branch chooses `triggerStylist('outfit')` vs the kept `startOutfitFlow()`; `triggerStylist` takes/sends `mode`; **add** sticky look bar + `lookSelection` + `selectedLook()` wired to `askScene`/`generateFullLook`. Chooser flow kept intact. |
| `supabase/functions/style-up-chat/index.ts` | read `body.mode`; when `'outfit'`, **append** a complete-look assembly clause to the catalog prompt (additive, no flag) |
| `app/services/style-up.ts` | add `SWAP_USE_ENGINE` flag + `slotSearch` wrapper; `fetchSwapOptions` branches candidate source (engine vs the kept recency block). `recommendForSlot`/`webRecommendForSlot` kept. |

## Reverting

- Outfit ask → chooser: set `ROUTE_OUTFIT_TO_ENGINE = false`.
- Swap → recency: set `SWAP_USE_ENGINE = false`.
- Hide the look bar: set `SHOW_LOOK_BAR = false`.
- The `mode:'outfit'` prompt clause is inert unless the client sends `mode`, so with `ROUTE_OUTFIT_TO_ENGINE = false` it never fires — no server revert needed. (Redeploy the edge fn only if you also want the clause gone.)

## Edge cases / decisions

- **Zero engine candidates for a slot** (outfit or swap): behaves like today's empty pool — the stylist says it's short on options; no recency fallback (deliberate — the recency scan is what we're removing).
- **`mode:'outfit'` reliability:** an explicit prompt instruction + productIds validation (already in code) makes the complete-look assembly deterministic; if Claude still under-fills, that's a prompt tweak, not an architecture change.
- **Look bar threshold:** `>= 2` pieces so a single suggested item doesn't show a "full look" CTA (single-item try-on covers that).
- **Selection persistence:** `lookSelection` resets when a new suggestion batch arrives (so a fresh outfit starts "all selected").

## Verification

- **Manual (local, Chrome MCP, logged-in):** "put together a smart casual dinner outfit" → engine cards, no chooser; confirm via `style_up_traces.candidate_count` + the `[style-retrieval]` log that the engine ran (not recency). "try different pants" → occasion-relevant alternates. Sticky look bar → "See it on me" renders the full look; drop bottom via "Choose pieces" → renders top+shoes.
- **Assertion:** with `SWAP_USE_ENGINE = true`, a "try different pants" turn issues a `style_slot_search` RPC (visible in the Supabase RPC/postgres logs or a `console.log`), not a `products` recency select. The recency block still exists in the file but is unreached — flipping the flag reactivates it.
- One runnable check: a small unit test for `selectedLook()` (all-selected vs subset) and for the `fetchSwapOptions` role filter over a mocked `style_slot_search` result.

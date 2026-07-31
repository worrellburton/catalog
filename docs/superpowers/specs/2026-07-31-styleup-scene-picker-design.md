# StyleUp — Scene picker before generation

**Date:** 2026-07-31
**Status:** Approved design, pre-implementation
**Feedback source:** Robert Burton (founder) — "Before the look is generated can we
have the user select which scene they want… where they want the setting to be for
the look?"

## Problem

Today a full-look render auto-derives its setting and **never asks** the shopper.
`startLookRender` calls `autoScene(occasion, messages)` → `setChosenScene` →
`generateFullLook(pieces, scene)` immediately ([StyleUpExperience.tsx:1143](../../../app/components/style-up/StyleUpExperience.tsx)).
The founder wants the shopper to pick the setting *before* the look is generated.

## What already exists (reused, not rebuilt)

- **Scene vocabulary** — `INTENT_SCENE` / `OCCASION_SCENE` map activities/occasions to
  well-phrased render settings; `autoScene()` resolves the best guess (shopper's own
  words in chat > occasion > "a clean studio").
- **The scene phrase already drives the render** — `renderLook` injects
  `"Setting: <scene>. Place the subject naturally in this environment."`
  ([style-up.ts:860](../../../app/services/style-up.ts)). A chosen scene needs **no new
  render plumbing** — it only has to reach `generateFullLook(pieces, scene)`.
- **The chooser mechanism** — `sendChooser` + `ChooserBubble` render a tap-to-choose
  bubble; single-select **dispatches on tap** (`submit([o.value])`), options with an
  `image` render as cards (`su-choose-opt--card`). `kind:'scene'` already has a render
  class (`su-choose-options--stack`).
- **Gen backend** — Fal (`FAL_KEY`) already powers look video; the same key reaches
  Fal's flux image models, so backdrop thumbnails are a one-off generation, not new infra.

## Design

### 1. Scene presets + assets

New `app/data/style-scenes.ts`:

```ts
export interface ScenePreset { id: string; label: string; phrase: string; imageUrl: string; }
export const SCENE_PRESETS: ScenePreset[] = [ /* 8 entries */ ];
```

Eight curated presets, phrases lifted from the existing vocab so they render well:

| id | label | phrase |
|----|-------|--------|
| studio | Clean studio | a clean studio |
| restaurant | Candlelit restaurant | a candlelit restaurant |
| rooftop | Rooftop bar | a rooftop bar at night |
| cafe | Sunny café | a sunny outdoor café |
| street | City street | a scenic old-town street |
| beach | Beach at golden hour | a sandy beach at golden hour |
| office | Modern office | a bright modern office |
| park | Sunny park | a sunny park |

**Thumbnails:** generated once by a one-off script (`agents/scene-backdrops/` or a
scratch script) calling a Fal flux endpoint (one empty-backdrop image per `phrase`),
uploaded to a Supabase Storage bucket `scene-backdrops/<id>.webp`. The public URLs are
baked into `SCENE_PRESETS.imageUrl`. No runtime generation, no admin CRUD for MVP.

`presetForPhrase(phrase: string): ScenePreset | null` — maps an `autoScene` output to a
preset: exact `phrase` match first, then a keyword fallback (contains "restaurant" →
restaurant, "beach" → beach, "office"/"work" → office, "café"/"coffee" → cafe, "rooftop"
→ rooftop, "park"/"garden" → park, "street"/"town" → street, "studio" → studio), else
`null`.

### 2. The pick flow

1. Shopper taps **Generate this look** (or any full-look entry — all route through
   `startLookRender`).
2. `startLookRender` no longer renders. It **stashes the pieces** (`pendingScenePiecesRef`)
   and calls `sendSceneChooser(threadId, autoScene(...))`.
3. `sendSceneChooser` posts a `kind:'scene'` chooser bubble titled **"Where should we
   shoot this look?"**:
   - If the guess is **not** a preset, a leading text card **"Suggested: &lt;guess&gt;"**
     (value = the raw guess phrase, no image) so the shopper's specific setting stays
     one tap away.
   - The 8 preset **thumbnail cards** (value = `preset.phrase`, `image = imageUrl`),
     the guess's matching preset listed first when the guess *is* a preset.
   - A trailing **"Somewhere else…"** card (value = `__custom__`, no image).
4. **One tap** on any card dispatches (single-select). Tapping a scene →
   `chooseWithEcho` echoes the label as the shopper's own line ("Candlelit restaurant")
   then `onChoose('scene', [phrase])`.
5. `onChoose`'s new `'scene'` branch: `setChosenScene(phrase)` →
   `generateFullLook(pendingScenePiecesRef.current ?? assembleLook(), phrase)`.
6. **Freeform:** tapping **"Somewhere else…"** does *not* dispatch — `ChooserBubble`
   reveals an inline text field + submit; the typed setting becomes the scene value and
   flows through the same `onChoose('scene', [typed])` path.

Single-piece **swaps** already reuse `chosenScene` (`selectSwapOption` →
`startFullLookRender({ …, scene: chosenScene })`, [line 1234](../../../app/components/style-up/StyleUpExperience.tsx)),
so the scene pick happens **once per full look**, not on every swap re-render.

### 3. Files touched

- **new** `app/data/style-scenes.ts` — `SCENE_PRESETS`, `presetForPhrase`.
- `app/components/style-up/StyleUpExperience.tsx`:
  - `startLookRender` — stash pieces + `sendSceneChooser` instead of rendering.
  - new `sendSceneChooser(threadId, guess)` — builds the scene chooser payload.
  - new `pendingScenePiecesRef` — holds the pieces between chooser open and choice.
  - `onChoose` — add the `'scene'` branch (set scene → render stashed pieces).
  - `ChooserBubble` — add the freeform "type your own" affordance, gated to
    `kind:'scene'` + the `__custom__` option.
- `app/styles/style-up.css` — scene thumbnail card sizing under `su-choose-options--stack`
  / `su-choose-opt--card` (only if the existing card sizing needs a scene-specific tweak).

`sendChooser` and the `StyleUpProductRef.choose` type already accept an arbitrary `kind`
and image-bearing options — no service/type change needed.

### 4. Error / edge handling

- **Empty look** — `startLookRender` keeps its existing guard: no pieces → `triggerStylist()`,
  no chooser.
- **`pendingRender` in flight** — keeps the existing "Still finishing your last look" guard
  *before* opening the chooser.
- **Guess is a preset** — no "Suggested" card; the matching preset leads.
- **Freeform empty submit** — reuse `ChooserBubble`'s existing `vals.length === 0` no-op.
- **Thumbnail fails to load** — card falls back to its label (image `alt=""`, label always
  rendered); the flow still works text-only.

### 5. Testing

- Unit-test `presetForPhrase` (pure): "a candlelit restaurant" → restaurant; "running
  errands around town" → null (→ leading Suggested card); "a bright modern office" →
  office; unknown → null. (`app/data/style-scenes.test.ts`.)
- The render path itself is integration-level (Fal); not unit-tested here — covered by the
  existing render flow.

## Out of scope (follow-ups)

- Admin-managed scene CRUD / per-occasion scene availability.
- Thumbnail regeneration pipeline (cron/edge).
- **#4 — swap-option cards using creative primary media** (separate task, next in queue).

## Related, already shipped this session

- **#1** Change-button consistency: fixed plural-footwear classification in
  `roleTagFromName` + wrapped the pill in the composer's `<Beam>`.
- **#2** Message bar lifted (`.su-composer-beam` bottom margin 10 → 22px).

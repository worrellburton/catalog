# Catalog — Pending Work Queue

> Captured live during a long QA walkthrough. Each item is specified well
> enough to implement directly. Items are roughly ordered small→large.
> Everything NOT listed here that came up in that session is already
> shipped to `main` (see "Recently shipped" at the bottom).

---

## Quick visual / small

### A. Look overlay — creator name next to avatar
On an open look, the lower-left has the creator avatar (+ follow badge) but
no name. Show the creator's name next to the avatar.
- File: `app/components/LookOverlay.tsx` (corner avatar / `CreatorAvatarFollow` area).

### B. Mobile feed — dark gradient between top UI and feed
On mobile web the header is `background: transparent` (`app/styles/header.css`
~line 725, inside the `@media (max-width:768px)` block), so the wordmark /
icons / creator-stories row float over bright feed cards with no scrim.
Add a dark top gradient on mobile **without** moving the chrome (header is
`height:48px; align-items:center`) and **without** affecting the Flutter
shell (the shell hides the webapp `header` via `html[data-shell] header`).
Prefer a `header::before` fixed scrim (top 0, ~120px, gradient → transparent,
`pointer-events:none`) — but check for existing header frost pseudo-elements
first (`header.css` ~line 89).

### C. Generate / Queueing ("Vision") — one viewport
Condense the queueing screen so it doesn't scroll (single viewport).
- File: `app/routes/generate.tsx` (queueing/progress step).

---

## Medium

### D. Look overlay — make it like the product screen
1. Comments should be its **own button** (like the product page's Comments
   button), NOT the floating green chat bubble.
2. **Remove the "About" tab** (tabs are currently Products | About).
3. Move the AI creator summary (currently in the About tab) into a
   **"View more info"** section, mirroring the product page.
- Files: `app/components/LookOverlay.tsx` (tabs ~line 879, About tab ~951,
  AI summary `aboutSummary`), `app/styles/look-overlay.css`.

### E. Product page — Comments as a bottom drawer (TikTok-style)
Comments currently navigate to `/comments/:type/:slug` (full page,
`CommentsPage`). Instead open an **in-place bottom drawer** that overlays the
product page and scrolls internally (TikTok comment-sheet feel). Reuse
`CommentsPage`'s comment logic inside a bottom sheet.
- Files: `app/components/ProductPage.tsx` (`onOpenComments` ~line 1268),
  `app/components/CommentsPage.tsx`, `app/routes/_index.tsx` (router wiring).

### F. Search overlay — keyboard-dismiss layout breaks
When the soft keyboard dismisses while the search overlay is open, the pills
and search bar overlap (broken transitional layout). FRAGILE: this is the
heavily-tuned `kbInset` / bottom-bar keyboard-pinning code.
- File: `app/components/BottomBar.tsx` (`kbInset`, the `searchOpen` inline
  `style`), `app/styles/bottom-bar.css`.

### G. Generate / Style step
- Make the style presets (Street, Editorial, …) **horizontally scrollable**.
- Allow the user to **enter their own description**; if they do, send that
  custom description to **Seedance** for generation.
- File: `app/routes/generate.tsx` (Style step), plus the Seedance prompt
  path (custom style already persists via `profiles.custom_style_prompt` +
  the Seedance prompt threading — extend for a per-generation override).

### H. Generate / Review step
- Toggling **Fast ↔ Pro** should NOT shift the layout (keep it stable).
- Add a **Weight** row (alongside Height / Age).
- Condense to **one viewport** (no scroll).
- File: `app/routes/generate.tsx` (Review step).

### I. Generate / Queueing — "analyzing" + jokes + intense particles
On the queueing screen, show an "analyzing" state with rotating **funny
jokes** (words ticker), and throw the **WebGL particle effect** in there
turned way up (intense / "going crazy").
- Files: `app/routes/generate.tsx`, `app/components/ParticleBackground.tsx`
  (or `SiteParticleHost`).

### J. In-progress generation pill → follow-toast format
The "Your commercial look is in process" pill at the top should use the same
notification **format** as the follow toast (`FollowToastHost` /
`.follow-toast`). Unify the styles.
- Files: `app/components/FollowToastHost.tsx`, the pending-look pill
  (`header.css` ~line 150 `.pending-look-pill`), wherever the pill renders.

### K. Activity — in-progress generation row
On `/activity`, if a look is generating, show a row at the top with a
**horizontal progress bar** (how far along) and the same **joke/words
ticker** as the queueing screen.
- File: `app/routes/activity.tsx`, `app/services/activity.ts`.

---

## Large

### L. My Catalog — Products tab + per-creator product reorder
Replace tabs with **Live · Inactive | Products** (the "All" tab was already
removed; a visual divider separates the status tabs from Products). The
**Products** tab lists EVERY product across all the creator's looks
(deduped), and the creator can **drag-reorder** them (vertical-only drag).
- Needs a new table, e.g. `creator_product_order (user_id, product_id,
  sort_order, pk(user_id,product_id))` + owner RLS, and a service to
  aggregate look products + persist order. Mirror the look drag-reorder
  already in `MyLooks.tsx` (grip handle + pointer events).
- Files: `app/components/MyLooks.tsx`, `app/services/manage-looks.ts`,
  new migration.

### M. Creator catalog appearance settings (customization)
In My Catalog, add a **settings gear** (appearance). Options:
1. **Particles on/off** — when on, render the particle field on the
   creator's catalog/consumer surfaces.
2. **Color wheel** — selecting a color tints the catalog **background with
   that hue**.
Per-creator, persisted. NOTE: a `creator_catalog_theme` migration already
exists (`20260601191547_creator_catalog_theme`) — check what columns it
has before adding more.
- Files: `app/components/MyLooks.tsx` (gear), consumer surfaces that read
  the theme, `app/services/*`.

### N. Catalog Analytics screen — REBUILD (intentional) + animated graphs
The creator Catalog Analytics screen (`CreatorAnalyticsModal` in
`app/components/MyLooks.tsx` ~lines 763–997; CSS `.my-cat-analytics-*` in
`app/styles/my-looks.css`) is visually broken: the header (title + close ×)
and the date-range pill row (All time / Today / Yesterday / This week / Last)
**overlap at the top** — they render on the same vertical band instead of
stacking, and the main app header/wordmark appears to bleed through. The
earlier title-truncation patch did NOT fix it; the layout needs a real
rebuild, not another patch.

Rebuild requirements:
- Clean, intentional layout: header row (title + ×) clearly above the
  range-pill row, which is clearly above the stat grid. No overlap, proper
  top safe-area clearance. Investigate the conflicting/duplicate
  `.my-cat-analytics-card--page` rules (there are two: ~3565 and ~3601).
- Add **graphs** with **very thin lines**.
- The graph bars/lines **animate from left to right** with a **pulsing
  light on the leading front** (the draw head glows/pulses).
- Easing **ease-in-out**, **very slow and subtle**.
- Keep it tasteful and on-brand (dark theme, hairline strokes).

### O. Auto-add every generated look to My Catalog as INACTIVE
Today a `looks` row is only created when the user explicitly publishes a
generation (`promoteGenerationToLook` → status `'live'`,
`app/services/promote-generation.ts`). Change it so **every generated look**
automatically lands in the creator's My Catalog with status **`'archived'`
(Inactive)** as soon as it's generated — the creator can then flip it Live.
- Likely hook point: generation-complete pipeline (`supabase/functions/
  fal-webhook/index.ts` and/or the trigger in
  `20260603_looks_creative_sync_from_generation.sql` /
  `20260601000005_backfill_primary_video_and_autopromote.sql`). Auto-create
  the `looks` row at completion with `status='archived'`; keep the existing
  publish flow (promote → `'live'`) working on top of it.
- Verify it doesn't double-create on later explicit publish (the
  find-or-promote logic keys off `source_generation_id`).

### P. Home hero — let the feed peek higher
On the home hero ("Make a catalog for anything"), start the feed a touch
higher so the top of the product feed is just visible at the bottom of the
first viewport (bigger peek). FRAGILE: the hero centering is heavily tuned
(`app/styles/home-hero.css` — `.ai-bar-wrap` bottom %, `.sfh` padding,
`--hero-scroll-progress`). Adjust the hero band height / feed offset
carefully; don't reintroduce the transform-centering bugs called out in
CLAUDE.md.

### Q. Generate / Pick products — horizontal scroll breaks after brand pick
On the "Pick your products" step, each category row scrolls horizontally —
but after you tap a brand chip (James Perse, Kith, …) the product row can no
longer be scrolled horizontally. Fix so the filtered row stays
horizontally scrollable. Likely a re-render/`touch-action`/overflow issue on
the row container after the brand filter applies.
- File: `app/routes/generate.tsx` (`CATEGORY_GROUPS.map`, the per-row brand
  chips + product scroller, ~line 1714+).

### R. Generate / Pick products — collapsible categories + an "All" row
- Make Hat / Top / Bottoms / Shoes / Accessories / Objects rows
  **collapsible**, defaulting to **collapsed**.
- Add a new row at the very top labelled **"All"** that shows ALL products
  and lets the user **search across all products and brands** in one place.
- File: `app/routes/generate.tsx` (products step).

### S. Per-creator unseen-look badge (stories row)
When a creator you can see has uploaded look(s) you **haven't seen yet**,
show a count badge on their profile circle in the top stories row: a
**number in a circle that spins and glows**, indicating how many unseen
looks you have from them. Ties into the seen/unseen tracking (see Feed
ordering below — same per-user seen data).
- Files: the stories/creators row component (top of consumer feed), the
  seen-tracking service.

### T. Create-a-look — video upload + in/out trimmer
STATUS: trimmer UX ✅ DONE (app/components/VideoTrimmer.tsx + CreateLookV2
integration): single-video pick → one-viewport trimmer (scrub + draggable
in/out handles, looped preview), Done captures the FIRST frame of the
selection as a JPEG poster; MediaItem carries trimStart/trimEnd/posterUrl,
thumb shows the poster. DECISION (made): trimmed video = stored clip + the
first frame is the poster.
REMAINING (essential — otherwise the trim is discarded on publish):
  • uploadLookMedia(lookId, file, type) currently ignores poster/trim; the
    server auto-generates a poster from frame 0. Extend it to accept the
    client poster (upload the data URL as an image) and set the look's
    thumbnail to it, so "poster = first frame of selection" holds.
  • Persist trimStart/trimEnd (looks_creative needs columns, or store as
    metadata) so look playback uses the [start,end] window. True re-encode
    cutting would need ffmpeg.wasm; range-based playback is the pragmatic clip.
  • Verify the poster renders on the published look.
ORIGINAL NOTE ↓
### T (orig). Create-a-look — video upload + in/out trimmer
On the "Create a look" upload screen, the user tried to upload a **video**
and it didn't work (the file input likely accepts images only, and the
upload/generation pipeline expects photos). Build proper video support:
1. Let the user **select a video** (extend the file `accept` AND the
   upload/generation handling — don't enable selection alone, it'll fail
   downstream).
2. On video upload, open a **one-viewport** trimmer screen:
   - Select **in** and **out** points.
   - **Click-and-drag** the in/out handles to roll the selection to a new
     range.
   - **Scrub** through the video.
   - **Done** button at the bottom → saves the trimmed selection as their
     option (persist the chosen segment / extracted frame(s)).
- Files: `app/components/CreateLookV2.tsx` (upload hero / file input),
  the upload service (`user-generations` / uploads), generation pipeline.

---

## Feed ordering algorithm (DETAILED SPEC — investigate + implement)

Per-user, qualify **each impression** on a product AND a look as seen/unseen.

1. **All unseen** → show in the **admin-prepared order** (`feed_rank`).
2. **All seen** → **randomize**.
3. **Half seen / half unseen** → unseen first (admin order); once the user
   scrolls past the unseen into the seen items, the **seen portion is
   randomized**.
4. The "random" must keep **fluidity to product type** — cluster by type
   (all shoes together, then all shirts, etc.). Grouped random, NOT pure
   random.

Current state: `reorderBySeen()` in `app/services/looks.ts:457` already does
unseen-first / shuffle-seen, but:
- It does NOT cluster the shuffled portion by product type (item 4 — TODO).
- Reported symptom: "same order every visit." Likely the **seen-tracking
  isn't populating** (`seenLookIds` empty) so it stays in deterministic
  `feed_rank` order. Investigate the viewed-look / impression recording so
  items actually get marked seen. Also confirm products (not just looks)
  are seen-qualified and ordered.

---

## Progress (live on `main`) — "do it all" pass
DONE: **L (Products tab — new table + RLS + drag-reorder)** · **O (generated
looks auto-add to My Catalog as Inactive)** · **feed reshuffle fix
(reorderBySeen now depends on shuffleKey)** · **P (mobile feed peek)** · A
(look creator name) · B (mobile top gradient) · Q (picker scroll after brand
pick) · J (pending pill → follow-toast format) · creator-page follow toast ·
Top-Looks live-only · edit-look vertical scroll · product divider · search
autocomplete matches-only+creators · generate "Your looks" removal + title
rename.
DONE (cont.): **D (look comments → labelled button, floating bubble removed)**
· **R (collapsible categories + "All" aggregate row)**.
PARTIAL: H — Weight row + no Fast↔Pro shift DONE; full one-viewport condense
STILL TODO.
STILL TODO (all are large rebuilds / fragile / need live verification):
- **S** per-creator unseen-look badge — ✅ DONE. Spinning conic-ring +
  pulsing-glow count badge on each FollowingStoriesRail avatar; computed from
  getLooks + fetchSeenLookIds keyed by handle.
- **E** comments → bottom drawer — ✅ DONE. CommentsPage renders as an
  82dvh bottom sheet (grab handle, dim backdrop tap-to-dismiss, slide-up,
  internal scroll) instead of a full page.
- **N** analytics — ✅ DONE. Header overlap hardened + "Impressions over
  time" trend graph added (very thin line, L→R draw over 3.8s ease-in-out,
  pulsing glow head; daily-bucketed from events; catalog-wide view;
  respects reduced-motion). Verify the animation visually + tune timing if
  desired. (Per-look view has no daily series — count-only path.)
- **T** video upload + in/out trimmer
- **E** comments → TikTok bottom drawer
- **M** appearance settings — ✅ DONE END-TO-END. Settings gear in My Catalog
  (particles toggle + hue slider) saved to creators.catalog_particles /
  catalog_hue, applied live in My Catalog AND on the consumer CreatorPage
  (getCreatorAppearanceById for user creators, getCreatorAppearance by handle
  for seed). Particle layer is z-index:-1 over the page bg; hue tints the page
  background.
- **M (orig note)** appearance settings (particles + hue) — EXTEND the existing theme
  system, don't rebuild: `app/services/catalog-theme.ts` already does
  light/dark via `creators.catalog_theme` (migration 20260601000011) with
  getCreatorTheme(handle)/setMyCatalogTheme. Add `catalog_particles` +
  `catalog_hue` columns to **`creators`** (NOT profiles), extend that
  service, add a settings gear in My Catalog, and apply on the consumer
  CreatorPage. (Note: the existing light/dark service isn't wired into any
  .tsx yet — check where catalog_theme should be applied/toggled.)
- **S** per-creator unseen-look badge (FollowingRail; needs unseen-by-handle
  from fetchSeenLookIds + looks, badge w/ spin+glow). Avatar render is in a
  FollowingRail sub-stack component.
- **D-rest / R-rest / C / F** — see PARTIAL + smaller-polish notes
- **Feed type-clustering** — ambiguous: reorderBySeen operates on LOOKS, not
  products; "cluster by product type" likely targets a product feed. Confirm
  target before building.

## Recently shipped (earlier this session, live on `main`)
- Search autocomplete: matches-only + creators included (mobile + desktop)
- Activity Top Looks: exclude non-live (ghost) looks
- Edit-look: vertical-only scroll
- Product page: divider moved below "View more info"
- Mobile search suggestions: fit screen, top-anchored while typing
- Creator-page Follow button now fires the global follow toast
- Become-a-creator flow (application + admin approval queue)
- About-tab Claude summary; no-cache HTML deploy fix; chunk-error recovery


# Plan: Fix Freezing Videos in Feed

## TL;DR
The feed freezes because *every* visible card autoplays full-quality video with `preload="auto"` simultaneously — at 2-viewport rootMargin (~32 cards in pool, 6-12 actively decoded), the browser blows past its concurrent-connection cap and GPU/CPU decode budget. Two parallel video systems (`TrailVideoHost` for LookCard + declarative `<video>` in CreativeCard) both fire 1 s heartbeat play() loops that compete. Fix: introduce a single **playback director** that ranks cards by viewport proximity and only *plays* the top N closest, while keeping the rest *paused on poster*. Tier `preload` by distance band. Drop dual heartbeats. Result: always-playing cards within the user's actual visible band, no freezes elsewhere, zero quality loss.

## Steps

### Phase 1 — Single playback director
1. Create `app/services/video-playback-director.ts` — global singleton that:
   - Tracks every registered `<video>` element with its card's `getBoundingClientRect()`.
   - Each scroll-tick (rAF-throttled) ranks all registered videos by distance from viewport center.
   - Top **N** (mobile: 4, desktop: 6) → `play()` if paused.
   - Rest → `pause()` if playing (poster stays visible).
   - Only re-evaluates on scroll / resize / register-unregister, not on a fixed 1 s heartbeat.
   - Exposes `register(el, opts)` / `unregister(el)`.
2. Add scroll-velocity gate: if user is scrolling > 2000 px/s, suspend play() calls for everyone (no decode thrash mid-flick); resume on scroll-stop.
3. Add visibility hook: `document.hidden` → pause everything; `visible` → re-rank + resume top-N.

### Phase 2 — Wire CreativeCard to the director
4. In `CreativeCard.tsx`:
   - Remove the local 1 s heartbeat `useEffect` (lines ~109-130).
   - Remove `autoPlay` from `<video>` element — director controls playback.
   - Register the `videoRef` with the director on mount.
5. Set `preload` dynamically:
   - Mounted but >2 viewports away → `preload="none"` (poster only)
   - Within 2 viewports → `preload="metadata"`
   - Within 1 viewport (top-N) → `preload="auto"`
6. Tighten `useInViewport` rootMargin from `200% 0%` → `100% 0%` for card mounting.

### Phase 3 — Wire TrailVideoHost (LookCard) to the same director
7. In `TrailVideoHost.tsx`:
   - Remove the 1 s heartbeat (line ~225).
   - Drop gesture `resumeInSlot()` (replaced by director).
   - When `attach()` parents a video into a slot, register with director instead of calling `play()`.
   - Keep the appendChild-based slot reuse — solves the detail-view handoff correctly.

### Phase 4 — Cut redundant network pressure
8. Remove default `crossOrigin="anonymous"` from card `<video>` and TrailVideoHost. Set it one-shot only when `captureVideoFrame()` is about to run after a tap.
9. Remove the unconditional 256 KB `prefetchVideoBytes(creative.video_url)` warm-up. Replace with director-driven prefetch for top-N only.

### Phase 5 — Mobile bitrate verification
10. Count `product_creative` rows with `mobile_video_url` populated. If <90%, file follow-up backfill via `agents/video-generator`.

## Relevant Files
- `app/components/CreativeCard.tsx` — remove local heartbeat (~line 109), remove `autoPlay` attr (~line 284), wire to director, dynamic `preload`, drop default `crossOrigin`.
- `app/components/TrailVideoHost.tsx` — remove `setInterval(resumeInSlot, 1000)` (~line 225), strip gesture `resumeInSlot`, register on `attach`, drop `crossOrigin` default.
- `app/components/LookCard.tsx` — inherits fix via `useTrailVideo`; no direct changes.
- `app/hooks/useInViewport.ts` — unchanged; consumers pass tighter margin.
- `app/services/video-loading.ts` — gate `prefetchVideoBytes` to director-promoted cards.
- `app/components/FeedSection.tsx` — no changes.
- **NEW**: `app/services/video-playback-director.ts` — single playback controller.

## Verification
1. Mobile (Safari + Chrome mobile sim) and desktop scroll: visible cards play; fast flick pauses mid-scroll, resumes <200 ms after stop; 30 s idle → no freeze.
2. Chrome DevTools → Performance: `decodeVideoFrame` <8 ms; Network shows ≤6 concurrent streams.
3. DevTools → Media panel: only top-N show "Playing"; rest "Paused" with poster.
4. Flutter shell (`data-shell="catalog-app"`) autoplays without gesture.
5. Tap-to-detail handoff: ProductPage hero shows captured tap-time frame.

## Decisions
- **Quality preserved**: same URLs, codec, poster strategy. Only decode concurrency changes.
- **"Always playing"**: cards the user can see are always playing. Off-screen pause is invisible.
- **Top-N**: mobile=4, desktop=6 (bump to 8 if tall-screen devices show >6 cards).
- **Out of scope**: HLS/DASH, video regeneration, overlay/hero refactor.

## Further Considerations
1. Director scope: feed cards only vs. overlays/hero too. Recommendation: feed only (simpler).
2. Top-N: constants vs. env-driven A/B. Recommendation: constants for now.
3. `mobile_video_url` backfill: separate task if Phase 5 reveals gaps.
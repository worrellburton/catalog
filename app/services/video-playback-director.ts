// Single-owner playback director for the feed.
//
// Only this module ever calls .play() or .pause() on video elements
// used in the feed grid. All cards register here; a rAF-throttled
// reducer ranks them by proximity to viewport center and promotes the
// top-K nearest to a shared <video> pool element. Every other card
// stays on its poster image.
//
// This eliminates the "two heartbeats racing" failure mode from the
// previous implementation (CreativeCard + TrailVideoHost both calling
// play() independently) and gives us a clean recovery path after
// modal open/close and tab visibility changes.

import { captureVideoFrame, getPrefetchCount, isSlowConnection, isMobileViewport } from './video-loading';
import {
  setVideoSource,
  getVideoSource,
  browserSupportsNativeHls,
  prefetchHlsModule,
} from '~/utils/hlsAttach';
import { videoPipelineMode } from './video-pipeline';

// ── Constants ──────────────────────────────────────────────────────────
//
// Promotion is viewport-distance based, NOT a fixed top-K. Every card whose
// rect overlaps the [-PLAY_MARGIN .. viewport+PLAY_MARGIN] band gets a
// pooled <video> + .play(). Cards beyond the RELEASE_MARGIN release their
// element back to the parking div (poster stays visible). The hysteresis
// band between the two prevents flicker when scrolling slowly past the
// boundary.
//
// Pool size is bounded so DOM weight stays flat regardless of how far the
// user scrolls — when full, the most-distant assigned card is evicted to
// make room for a closer one.

/** Multiplier on viewport height for the play zone (each side). The band
 *  is sized to "everything visible + roughly half a screen of lookahead"
 *  so the row about to scroll into view is already playing — no
 *  poster→video pop. */
const PLAY_MARGIN_VH_DESKTOP = 0.6;
// 0.5 = ~half a screen of lookahead each side. This head-start is what lets a
// card's <video> buffer + decode its first frame BEFORE it scrolls into view,
// so playback reveals instantly instead of holding on the poster. Do not
// tighten this to "save decodes" — it directly reintroduces the poster→video
// delay (the decode-count win isn't worth the visible lag).
const PLAY_MARGIN_VH_MOBILE = 0.5;
/** Multiplier on viewport height for the release zone (each side). */
const RELEASE_MARGIN_VH_DESKTOP = 1.5;
const RELEASE_MARGIN_VH_MOBILE = 1.25;
/** Hard ceiling on pooled <video> elements — i.e. the max number of clips
 *  decoding/playing at once.
 *
 *  This is a SAFETY ceiling, not a target: the steady-state decode count is
 *  whatever falls inside the (tight) play band above, which prompt release +
 *  the fast-flick velocity gate keep near "visible + lookahead". The cap only
 *  bites on pathologically tall/wide viewports.
 *
 *  History: 40/12 once melted the CPU, but that was the strobe bug (every
 *  pooled <video> reloading on every rank pass) compounding — fixed in
 *  f769da9. The follow-up cut to 14/6 over-corrected: a 6-col desktop shows
 *  ~25 cards at once and a 2-col phone ~8, so a 14/6 pool left HALF the
 *  visible grid frozen on its poster (no slot to play in). The cap must sit
 *  ABOVE the visible-card count or autoplay silently degrades to stills.
 *  These values cover a full screen + a lookahead row on realistic viewports. */
const POOL_MAX_DESKTOP = 32;
const POOL_MAX_MOBILE = 14;
/** Upper clamp for the DYNAMIC mobile cap (see poolMax). The mobile pool grows
 *  to cover the play band on tall viewports so far-band cards don't freeze on
 *  their poster, but never past this ceiling — keeps simultaneous HLS decoders
 *  clear of the iOS limit. */
const POOL_MAX_MOBILE_CEILING = 20;
/** While a detail overlay is open, the background home feed is out of the
 *  active scope and would normally have ALL its <video>s released — parked
 *  off-screen (mobile drops their decoded surface) and freed for the overlay's
 *  own nested feed to repurpose. Returning then cold re-buffers, so the feed
 *  shows posters ("looks dead") for a beat — worst on HLS, whose re-attach
 *  overruns the ~360ms close animation, so the cold attach can't beat the slide
 *  and the user lands on posters. A cold attach is fundamentally not instant;
 *  only a PAUSED-but-decoded element resumes instantly (play(), no re-buffer).
 *
 *  So instead of keeping a small fixed handful warm, we keep the WHOLE visible
 *  grid warm and reserve only enough of the pool for the overlay's own nested
 *  rails: keepWarm = poolMax() - NESTED_FEED_RESERVE. Because keep-warm cards
 *  are PAUSED (hold a decoder instance but don't decode while covered) and
 *  warm + nested <= poolMax <= the decoder-safe ceiling, this never exceeds the
 *  simultaneous-decoder budget the pool cap already guarantees — it just shifts
 *  it toward "feed resumes instantly on back" and away from "nested rail plays a
 *  few more tiles". The rails are off-screen when an overlay first opens, so the
 *  reserve sits free until you actually scroll to them. The kept cards are also
 *  PROTECTED from the nested feed's eviction (see rank()) so they survive while
 *  the overlay is open instead of being stolen the moment a rail tile needs a
 *  slot — without that, raising the count alone is silently defeated. */
const NESTED_FEED_RESERVE_DESKTOP = 8;
// Mobile pool is 14 and bumps against the iOS simultaneous-HLS-decoder ceiling,
// so the reserve is the tighter lever here: 6 leaves keepWarm = 14 - 6 = 8 =
// a full mobile viewport (2 cols x ~4 rows), so the entire visible grid resumes
// instantly on back while the nested rail still gets 6 concurrent tiles.
const NESTED_FEED_RESERVE_MOBILE = 6;
/** px/s scroll speed above which we skip play() calls (poster only). */
const SCROLL_VELOCITY_THRESHOLD = 2500;
/** ms of scroll-quiet before we re-rank after a fast flick. */
const SCROLL_REST_DELAY_MS = 150;
/** Max play() retries per card before marking it degraded. */
const MAX_RETRIES = 2;
/** rootMargin for the "near viewport" observer that gates which cards rank()
 *  measures. THE fix for the O(N) getBoundingClientRect storm: rank() used to
 *  call getRect() on EVERY registered card every pass (scroll + rAF), so after
 *  a long scroll session — thousands of never-unmounted cards — each frame did
 *  thousands of forced sync layouts and the whole machine lagged. Now rank()
 *  measures only cards inside this band. It MUST exceed the largest
 *  RELEASE_MARGIN_VH (1.5) so a card is still tracked through the release band;
 *  past this band it's released and dropped from the active set. Percentage is
 *  viewport-relative so it survives resize. */
const NEAR_BAND_ROOT_MARGIN = '200% 0%';

// ── Pre-attach (prebuffer) tuning ────────────────────────────────────────
// We buffer the first segment(s) of the NEAREST upcoming clips into spare pool
// elements while they're still AHEAD of the play band. When such a card crosses
// into the play band, rank()'s existing acquire prefers a free slot whose src
// already matches (see "Prefer a free slot that ALREADY holds this card's clip"
// below) and adopts the pre-buffered element — its first frame is already
// decoded, so it reveals instantly instead of cold-loading the HLS chain
// (manifest → media playlist → init → segment). This is what lets HLS feel as
// instant as the old progressive MP4 without giving up adaptive quality.
//
// Bounded hard so it can't reopen the historical CPU/memory cliffs:
//   • only a few elements (PREARM_MAX), only cards inside the prearm band,
//   • never grows past poolMax, never evicts a PLAYING card,
//   • skipped on fast flicks and save-data,
//   • PREARM_ENABLED=false fully disables it (instant fall back to cold attach).
const PREARM_ENABLED = true;
const PREARM_MAX_DESKTOP = 3;
// This is the ONLY warm that actually decodes an upcoming clip's first frame
// (into a spare pool element), so a promoted card reveals instantly instead of
// holding its poster while it cold-buffers. At 1, only the single nearest
// upcoming clip was ready on mobile; a 2-col grid scrolls two new cards in per
// row, so the second always popped late. 4 keeps the next TWO full rows warm
// (2 cols × 2 rows), so a normal scroll-down finds the incoming clips already
// decoded instead of cold-attaching the HLS chain (manifest → playlist → init →
// segment) and flashing its poster for a beat — the residual HLS poster-pop the
// pipeline-by-device split otherwise leaves on the mobile feed. Still bounded by
// poolMax (prearm only runs while assignedIds < cap and never evicts a playing
// card), so total decoders stay under the ceiling.
const PREARM_MAX_MOBILE = 4;
// Lookahead band for prebuffering. MUST sit between the play and release bands
// (play < prearm < release < near-band) so prearmed cards are still tracked by
// rank() and are never past the point where they'd be released. Mobile widened
// to 1.1 (still < RELEASE_MARGIN_VH_MOBILE=1.25) so the prearm ring actually
// contains the next two incoming rows that PREARM_MAX_MOBILE=4 warms.
const PREARM_MARGIN_VH_DESKTOP = 1.1;
const PREARM_MARGIN_VH_MOBILE = 1.1;

// ── Cold-attach budget (anti-burst) ──────────────────────────────────────
// Max number of COLD attaches (a fresh setVideoSource → HLS manifest→playlist
// →init→segment chain + first-frame decode) a single rank() pass may kick off.
// When an overlay closes, the near-band re-balloons and one rank() pass would
// otherwise cold-attach the whole visible grid AT ONCE — a synchronized decoder
// burst that spikes the main thread and starves every clip's bytes, i.e. the
// beat-long "feed freezes on poster then resumes" on back. Capping cold attaches
// per pass and re-ranking next frame spreads the burst over a few rAF frames
// (~16ms each), so the nearest cards light up first and the rest trail by a
// frame or two (sub-100ms, covered by their poster/freeze-frame meanwhile).
// FREE and never counted: keep-playing unpauses, same-src reclaims (a card
// adopting its own parked element on return), and prearm adopts — only genuine
// cold attaches cost budget, so the instant-resume paths are never throttled.
const ATTACH_BUDGET_DESKTOP = 6;
const ATTACH_BUDGET_MOBILE = 3;

// Device tuning keys off the SAME mobile breakpoint as the video pipeline and
// the feed grid (isMobileViewport, ≤768px, imported from video-loading.ts).
// Previously the director used a local ≤600px cutoff, so a 601–768px viewport —
// which renders the 2-col MOBILE grid (FeedSection) AND is served the HLS
// pipeline (video-pipeline) — ran with DESKTOP pool tuning (POOL_MAX 32, wider
// play band). On Safari/iOS that over-saturated the simultaneous-HLS-decoder
// ceiling, so clips stalled on their poster then played a beat later. Sharing
// one breakpoint keeps the whole HLS/mobile regime on the decoder-safe mobile
// pool (POOL_MAX 14). Desktop (>768px, MP4) is unchanged.
function playMarginPx(): number {
  if (typeof window === 'undefined') return 0;
  return window.innerHeight * (isMobileViewport() ? PLAY_MARGIN_VH_MOBILE : PLAY_MARGIN_VH_DESKTOP);
}
function releaseMarginPx(): number {
  if (typeof window === 'undefined') return 0;
  return window.innerHeight * (isMobileViewport() ? RELEASE_MARGIN_VH_MOBILE : RELEASE_MARGIN_VH_DESKTOP);
}
/** Mobile pool cap is sized to COVER the play band, not a flat constant: the
 *  band spans (1 + 2·PLAY_MARGIN)·vh and the 2-col 3:4 grid's row pitch scales
 *  with width, so a tall/narrow viewport can hold >14 cards in-band. A flat cap
 *  below that count freezes the farthest in-band cards on their poster (rank()
 *  won't evict a nearer card for a farther one) — the opposite of "always
 *  playing." So compute the band's card count and clamp it to
 *  [POOL_MAX_MOBILE, POOL_MAX_MOBILE_CEILING]: never below the tuned minimum,
 *  never past the decoder-safe ceiling. The cap is a CEILING, not a target —
 *  the steady-state decode count is whatever falls inside the (tight) play band.
 *  Desktop keeps its flat cap. */
function poolMax(): number {
  if (!isMobileViewport()) return POOL_MAX_DESKTOP;
  if (typeof window === 'undefined') return POOL_MAX_MOBILE;
  const COLS = 2, GAP = 2; // mobile feed grid: repeat(2, 1fr), 2px gap (feed.css)
  const cardW = (window.innerWidth - GAP) / COLS;
  const rowPitch = cardW * (4 / 3) + GAP; // 3:4 cards
  const bandPx = window.innerHeight * (1 + 2 * PLAY_MARGIN_VH_MOBILE);
  // +1 row of headroom covers the partial-row overlap at both band ends.
  const needed = (Math.ceil(bandPx / rowPitch) + 1) * COLS;
  return Math.min(POOL_MAX_MOBILE_CEILING, Math.max(POOL_MAX_MOBILE, needed));
}
function prearmMarginPx(): number {
  if (typeof window === 'undefined') return 0;
  return window.innerHeight * (isMobileViewport() ? PREARM_MARGIN_VH_MOBILE : PREARM_MARGIN_VH_DESKTOP);
}
function prearmMax(): number {
  return isMobileViewport() ? PREARM_MAX_MOBILE : PREARM_MAX_DESKTOP;
}
function attachBudget(): number {
  return isMobileViewport() ? ATTACH_BUDGET_MOBILE : ATTACH_BUDGET_DESKTOP;
}

// ── Types ──────────────────────────────────────────────────────────────

export type CardStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'degraded';

interface CardEntry {
  getRect: () => DOMRect;
  videoUrl: string;
  posterUrl: string;
  slotEl: HTMLDivElement;
  videoEl: HTMLVideoElement | null;
  /** Freeze-frame <img> left in the slot when the video element is taken
   *  away (eviction / steal). Shows the EXACT frame the card was on, so
   *  the card never falls back to its frame-0 poster ("weird thumbnail"
   *  flash on return from an overlay). Cleared when a video reveals. */
  freezeEl: HTMLImageElement | null;
  /** Clip aspect ratio (w/h) derived from the poster image's natural size.
   *  The poster is transformed with resize:'contain' so it preserves the clip's
   *  exact aspect — this lets applyCoverSize size the box correctly BEFORE the
   *  video's own metadata loads, eliminating the stretched 100%×100% fallback. */
  aspectHint?: number;
  retryCount: number;
  lastFailureAt: number;
  status: CardStatus;
}

interface PoolSlot {
  el: HTMLVideoElement;
  assignedTo: string | null;
}

// ── Director class ─────────────────────────────────────────────────────

class VideoPlaybackDirector {
  private cards = new Map<string, CardEntry>();
  /** trailId → cardId, registered when a card donates its element to an
   *  overlay hero, so the CLOSE direction can hand the frame back. */
  private trailReturn = new Map<string, string>();
  private pool: PoolSlot[] = [];
  private parkingDiv: HTMLDivElement | null = null;
  private rafId: number | null = null;
  private lastScrollY = 0;
  private lastScrollTime = Date.now();
  private isScrollFast = false;
  private scrollRestTimer: ReturnType<typeof setTimeout> | null = null;
  // Set on a scope transition (overlay open/close). The NEXT markScroll then
  // re-baselines instead of computing velocity — the scroll origin just changed
  // (window scrollY ↔ an overlay scroller's scrollTop), so a cross-origin delta
  // would be a bogus huge velocity that trips the fast-flick gate and wrongly
  // suppresses prearm on the surface the user just landed on.
  private scrollBaselinePending = false;
  private subscribers = new Map<string, Set<(s: CardStatus) => void>>();
  private initialized = false;
  // Overlay scope stack. While an overlay (LookOverlay, ProductPage, …) is
  // open it pushes its slot-prefix here; only cards whose id begins with the
  // topmost prefix are allowed to play. Everything else — chiefly the home
  // feed that stays mounted, blurred, behind the overlay — is released so it
  // stops decoding frames under the blur layer (which would otherwise force
  // the compositor to re-rasterize the blur every frame and tank the FPS).
  private scopeStack: string[] = [];
  // Scopes whose overlay is mid-close (sliding out). beginScopeExit() adds a
  // prefix here; activeScope() then treats it as transparent so the background
  // feed re-warms during the exit animation rather than waiting for unmount.
  // Cleared when the scope is finally popped (or re-pushed).
  private exitingScopes = new Set<string>();
  // [debug HUD] opt-in via localStorage 'pd-hud'='1'. Records assign→first-
  // frame reveal latency (the felt "poster hold") so it can be measured on a
  // real foreground device — a backgrounded preview tab throttles decode and
  // inflates these numbers. Cheap to keep; only displayed when the flag is on.
  private revealSamples: { ms: number; via: string }[] = [];
  private hudEl: HTMLDivElement | null = null;
  private hudTimer: ReturnType<typeof setInterval> | null = null;
  // Active-set gating (perf). An IntersectionObserver flags which cards are
  // near the viewport; rank() measures ONLY these. Per-frame cost is therefore
  // bounded by what's on/near screen, not by how many cards have mounted over a
  // long scroll session — fixes the unbounded O(N) rank meltdown.
  private nearIds = new Set<string>();
  // Cards currently holding a pooled <video> (bounded by poolMax). Lets the
  // overlay-open / tab-hide pause loops iterate just these instead of every
  // registered card — O(poolMax), not O(mounted-over-a-long-scroll).
  private assignedIds = new Set<string>();
  private nearObserver: IntersectionObserver | null = null;
  private elToId = new WeakMap<Element, string>();

  // Lazy init — safe to import on the server; DOM access only when the
  // first card registers (always in the browser).
  private init() {
    if (this.initialized || typeof document === 'undefined') return;
    this.initialized = true;

    // Off-screen parking area for unassigned pool elements. opacity:0 (NOT
    // visibility:hidden) because prebufferSlot() loads upcoming clips into
    // parked elements: iOS/Safari suppresses media loading for a
    // visibility:hidden <video>, but an opacity:0, zero-size one still buffers.
    // Matches TrailVideoHost's off-screen pool, which parks the same way.
    this.parkingDiv = document.createElement('div');
    this.parkingDiv.style.cssText =
      'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;' +
      'opacity:0;pointer-events:none;overflow:hidden';
    this.parkingDiv.setAttribute('aria-hidden', 'true');
    document.body.appendChild(this.parkingDiv);

    // Near-viewport gate: maintains the set of cards rank() is allowed to
    // measure. A card entering the band joins the active set; leaving it drops
    // out AND releases its <video> (it's past the release margin by then).
    if (typeof IntersectionObserver !== 'undefined') {
      this.nearObserver = new IntersectionObserver(
        entries => {
          for (const e of entries) {
            const id = this.elToId.get(e.target);
            if (!id) continue;
            if (e.isIntersecting) {
              this.nearIds.add(id);
            } else {
              this.nearIds.delete(id);
              const entry = this.cards.get(id);
              if (entry?.videoEl) {
                this.releaseVideoEl(id, entry.videoEl);
                entry.videoEl = null;
                entry.status = 'idle';
                this.emit(id, 'idle');
              }
            }
          }
          this.scheduleRank();
        },
        { rootMargin: NEAR_BAND_ROOT_MARGIN },
      );
    }

    // Pre-create a small warm pool. The pool grows on demand up to
    // poolMax(); growth past that point is blocked and eviction takes over.
    const initialPool = Math.min(8, poolMax());
    for (let i = 0; i < initialPool; i++) {
      this.pool.push({ el: this.createVideoEl(), assignedTo: null });
    }

    // Phase 1: warm the hls.js chunk during idle so the first HLS attach in
    // this session isn't gated on the dynamic import. No-op on native-HLS
    // browsers (Safari/iOS never load hls.js) and on save-data.
    {
      const w = window as Window & { requestIdleCallback?: (cb: () => void) => void };
      if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(() => prefetchHlsModule());
      else window.setTimeout(() => prefetchHlsModule(), 1200);
    }

    // Track scroll motion so we (a) skip prearm on fast flicks and (b) withhold
    // fresh-clip reveals during ANY scroll. The window listener covers the main
    // feed (document scroll); inner-container surfaces feed the same signal via
    // notifyScroll(). markScroll() is the single source of truth for both.
    window.addEventListener('scroll', () => this.markScroll(window.scrollY), { passive: true });

    // Pause everything when the tab is hidden; re-rank on return.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.pauseAll();
      } else {
        this.scheduleRank();
      }
    });
    // iOS BFCache restoration (swipe-close + reopen) doesn't always
    // fire visibilitychange. pageshow + the page-lifecycle "resume"
    // event cover the remaining paths so videos pick back up where
    // they left off instead of freezing on the first frame.
    const onResume = () => {
      this.scheduleRank();
      setTimeout(() => this.scheduleRank(), 200);
    };
    window.addEventListener('pageshow', onResume);
    document.addEventListener('resume', onResume as EventListener);

    // Heartbeat: re-rank so any card whose play() failed (paused after retries)
    // gets another attempt once data has buffered. Critical for search results
    // where videos are cold-cache and play() can be called before bytes arrive.
    // BUT only pay for the (forced-layout) re-rank when something near the
    // viewport isn't playing yet — once the feed is settled (all near cards
    // playing) a periodic rank() is pure idle drain that keeps the CPU awake on
    // a static screen. Skipped while hidden; the nearIds scan is bounded + cheap.
    setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      for (const id of this.nearIds) {
        // Only an IN-SCOPE near card that isn't playing warrants a retry rank.
        // Out-of-scope cards behind an open overlay are intentionally not
        // playing — released to 'idle' or held 'paused' by keep-warm — so they
        // must NOT keep the heartbeat awake (that would defeat its idle-quiet).
        // No overlay open ⇒ activeScope() is null ⇒ inActiveScope() is always
        // true ⇒ behaviour is unchanged.
        const e = this.cards.get(id);
        // A card whose STATUS says playing but whose element is actually
        // paused is a silent stall (browser paused it under memory/decoder
        // pressure, or a pause raced a play) — treat it as not playing so
        // the rank pass below kicks it. This is the "visible videos always
        // play" guarantee's detection half.
        const silentlyStalled = !!e?.videoEl && e.status === 'playing' && e.videoEl.paused;
        if ((e?.status !== 'playing' || silentlyStalled) && this.inActiveScope(id)) {
          this.scheduleRank();
          break;
        }
      }
    }, 1500);

    this.initHud();
  }

  private now(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  private recordReveal(ms: number, via: string): void {
    this.revealSamples.push({ ms: Math.round(ms), via });
    if (this.revealSamples.length > 30) this.revealSamples.shift();
  }

  // Opt-in debug HUD. Enable on any device: localStorage.setItem('pd-hud','1')
  // then reload. Shows the active video pipeline (HLS vs MP4) for THIS device,
  // pool occupancy, playing count, prewarm count, and the assign→first-frame
  // reveal latency that issue #1/#2 are about.
  private initHud(): void {
    if (typeof localStorage === 'undefined') return;
    try { if (localStorage.getItem('pd-hud') !== '1') return; } catch { return; }
    const el = document.createElement('div');
    el.style.cssText =
      'position:fixed;left:8px;bottom:8px;z-index:2147483647;' +
      'font:11px/1.45 ui-monospace,Menlo,monospace;color:#3f6;' +
      'background:rgba(0,0,0,.78);padding:6px 9px;border-radius:6px;' +
      'white-space:pre;pointer-events:none;max-width:62vw';
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
    this.hudEl = el;
    this.hudTimer = setInterval(() => this.updateHud(), 300);
  }

  private updateHud(): void {
    if (!this.hudEl) return;
    const assigned = this.pool.filter(p => p.assignedTo).length;
    let playing = 0;
    this.cards.forEach(e => { if (e.status === 'playing') playing++; });
    const s = this.revealSamples;
    const last = s.length ? s[s.length - 1] : null;
    const avg = s.length ? Math.round(s.reduce((a, b) => a + b.ms, 0) / s.length) : 0;

    // ── Pipeline line ── the effective mode for THIS device + what the assigned
    // pool elements are ACTUALLY playing: getVideoSource() returns the desired
    // source URL (the .m3u8 manifest on the HLS path, the .mp4 on the legacy
    // path), so an .m3u8 here is a live confirmation the clip is HLS — even when
    // hls.js has swapped el.src to an opaque MediaSource blob.
    const w = typeof window !== 'undefined' ? window.innerWidth : 0;
    const device = w <= 768 ? 'mobile' : 'desktop';
    const mode = videoPipelineMode();
    const hlsImpl = browserSupportsNativeHls() ? 'native' : 'hls.js';
    let hlsSrc = 0, mp4Src = 0;
    for (const p of this.pool) {
      if (!p.assignedTo) continue;
      const src = getVideoSource(p.el);
      if (!src) continue;
      if (/\.m3u8(\?|#|$)/i.test(src)) hlsSrc++; else mp4Src++;
    }

    this.hudEl.textContent =
      `pipe ${mode.toUpperCase()} · ${device} ${w}w · ${hlsImpl}\n` +
      `src  hls ${hlsSrc} / mp4 ${mp4Src}\n` +
      `pool ${assigned}/${this.pool.length}   playing ${playing}\n` +
      `near ${this.nearIds.size} / mounted ${this.cards.size}\n` +
      `prewarmed ${getPrefetchCount()}\n` +
      `reveal last ${last ? `${last.ms}ms (${last.via})` : '—'}\n` +
      `reveal avg  ${avg}ms  n=${s.length}`;

    this.updateSrcBadges();
  }

  // pd-hud only: tag every mounted card with an HLS/MP4 badge (top-right) so you
  // can see at a glance WHICH clips fell back to MP4 (no hls_url ladder) vs play
  // the HLS ladder. entry.videoUrl is the device-aware source pickPlaybackSource
  // chose, so an .m3u8 here means that card is on HLS. Green = HLS, red = MP4.
  private updateSrcBadges(): void {
    type BadgeHost = HTMLDivElement & { __pdBadge?: HTMLDivElement };
    this.cards.forEach(entry => {
      const isHls = /\.m3u8(\?|#|$)/i.test(entry.videoUrl || '');
      const host = entry.slotEl as BadgeHost;
      let badge = host.__pdBadge;
      if (!badge) {
        badge = document.createElement('div');
        badge.setAttribute('aria-hidden', 'true');
        badge.style.cssText =
          'position:absolute;top:6px;right:6px;z-index:2147483646;' +
          'font:9px/1.35 ui-monospace,Menlo,monospace;padding:1px 5px;' +
          'border-radius:4px;pointer-events:none;letter-spacing:.4px;font-weight:700;color:#000';
        host.appendChild(badge);
        host.__pdBadge = badge;
      }
      badge.textContent = isHls ? 'HLS' : 'MP4';
      badge.style.background = isHls ? 'rgba(63,255,120,.9)' : 'rgba(255,120,90,.92)';
    });
  }

  private createVideoEl(): HTMLVideoElement {
    const el = document.createElement('video');
    // anonymous CORS so canvas captures (freeze-frames on evict/steal,
    // tap-to-detail handoffs) aren't tainted — matches TrailVideoHost's
    // elements. Supabase storage serves ACAO:*, so playback is unaffected.
    el.crossOrigin = 'anonymous';
    el.muted = true;
    el.defaultMuted = true;
    el.autoplay = true;
    el.loop = true;
    el.playsInline = true;
    el.setAttribute('muted', '');
    el.setAttribute('autoplay', '');
    el.setAttribute('playsinline', '');
    el.preload = 'none';
    // EXPLICIT COVER (no object-fit): when the intrinsic size resolves —
    // loadedmetadata, or a native-HLS rung switch firing 'resize' — recompute
    // the element's box to the exact cover dimensions for its tile. Persistent
    // listeners added ONCE here (not per-acquire) so they can't leak as the
    // pooled element is recycled; each calls whatever the CURRENT owner set as
    // el.__coverApply. See applyCoverSize() for why object-fit is avoided:
    // WebKit/iOS renders object-fit:cover AS contain on a freshly-attached
    // <video> (confirmed on-device: box stays =TILE, content paints pillarboxed),
    // and no hide/cover/timing trick fixes it because the mis-paint lands on the
    // first VISIBLE composite. Sizing the box itself to the cover rect removes
    // object-fit from the equation entirely.
    // loadeddata/playing are included so applyCoverSize also drives the REVEAL
    // (opacity 0→1) once a real frame exists at the cover dimensions — the
    // element is held opacity:0 until then so the first VISIBLE frame is already
    // correctly cover-framed, never the stretched 100%×100% pre-metadata fallback.
    type CoverEl = HTMLVideoElement & { __coverApply?: () => void };
    const reapply = () => { (el as CoverEl).__coverApply?.(); };
    el.addEventListener('loadedmetadata', reapply);
    el.addEventListener('resize', reapply);
    el.addEventListener('loadeddata', reapply);
    el.addEventListener('playing', reapply);
    this.parkingDiv!.appendChild(el);
    return el;
  }

  // ── Public API ───────────────────────────────────────────────────────

  /**
   * Register a card with the director. Call from a ref-callback when
   * the card's slot div mounts. Re-registering the same cardId (e.g.
   * React Strict Mode double-mount) updates the entry in place.
   */
  register(
    cardId: string,
    getRect: () => DOMRect,
    videoUrl: string,
    posterUrl: string,
    slotEl: HTMLDivElement,
  ): void {
    this.init();
    const existing = this.cards.get(cardId);
    if (existing) {
      // Update mutable fields (slot may have re-mounted into a different node)
      if (existing.slotEl !== slotEl) {
        this.unobserveNear(existing.slotEl);
        this.unfreezeCard(existing);
      }
      existing.getRect = getRect;
      existing.slotEl = slotEl;
      if (existing.videoUrl !== videoUrl) {
        // URL changed — release current element so rank() re-assigns with new
        // src. Drop any freeze frame too: it belongs to the PREVIOUS item and
        // must never paint over the new item's poster.
        if (existing.videoEl) {
          this.releaseVideoEl(cardId, existing.videoEl);
          existing.videoEl = null;
        }
        this.unfreezeCard(existing);
        existing.videoUrl = videoUrl;
        existing.status = 'idle';
      }
      if (existing.aspectHint === undefined) this.loadAspectHint(cardId, posterUrl);
      this.observeNear(cardId, slotEl);
      this.scheduleRank();
      return;
    }
    this.cards.set(cardId, {
      getRect,
      videoUrl,
      posterUrl,
      slotEl,
      videoEl: null,
      freezeEl: null,
      retryCount: 0,
      lastFailureAt: 0,
      status: 'idle',
    });
    this.loadAspectHint(cardId, posterUrl);
    this.observeNear(cardId, slotEl);
    this.scheduleRank();
  }

  /** Derive the clip's aspect ratio from the poster image (cached — the card's
   *  own <img> already fetched it, so this resolves ~immediately) and stash it
   *  on the entry so applyCoverSize can size the box correctly BEFORE the video's
   *  metadata loads. The poster uses resize:'contain', so its natural aspect ==
   *  the clip's aspect. Best-effort: on any failure the box just falls back to
   *  100%×100% (hidden by opacity:0) until the video's own metadata arrives. */
  private loadAspectHint(cardId: string, posterUrl: string): void {
    if (!posterUrl || typeof Image === 'undefined') return;
    const img = new Image();
    img.onload = () => {
      const entry = this.cards.get(cardId);
      if (!entry || entry.posterUrl !== posterUrl) return;
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        entry.aspectHint = img.naturalWidth / img.naturalHeight;
        // If the video is already attached but still waiting on its own
        // metadata, re-size it now from the hint.
        if (entry.videoEl) this.applyCoverSize(entry, entry.videoEl);
      }
    };
    img.src = posterUrl;
  }

  /** Start tracking a card's slot for near-viewport gating. Optimistically
   *  marks it active so the very next rank() considers it (no first-paint
   *  delay); the observer prunes it within a tick if it's actually far off. */
  private observeNear(cardId: string, slotEl: HTMLDivElement): void {
    this.elToId.set(slotEl, cardId);
    this.nearIds.add(cardId);
    this.nearObserver?.observe(slotEl);
  }

  private unobserveNear(slotEl: Element | null | undefined): void {
    if (!slotEl) return;
    this.nearObserver?.unobserve(slotEl);
    this.elToId.delete(slotEl);
  }

  /**
   * Unregister a card. Call when the card's slot div unmounts.
   * Safe to call multiple times.
   */
  unregister(cardId: string): void {
    const entry = this.cards.get(cardId);
    if (!entry) return;
    if (entry.videoEl) {
      this.releaseVideoEl(cardId, entry.videoEl);
      entry.videoEl = null;
    }
    this.unfreezeCard(entry);
    this.unobserveNear(entry.slotEl);
    this.nearIds.delete(cardId);
    this.cards.delete(cardId);
    this.scheduleRank();
  }

  /**
   * Feed scroll events here (passive listener on the feed container). Drives the
   * scroll-motion state so surfaces whose feed scrolls an INNER container
   * (overlay rails, nested feeds) — where the director's own window listener
   * never fires — still withhold fresh reveals during motion. Pass the
   * container's scrollTop (or window.scrollY).
   */
  notifyScroll(scrollY: number): void {
    this.markScroll(scrollY);
  }

  /**
   * Single source of truth for scroll-motion state. Computes velocity → sets
   * isScrollFast (used only to skip prearm on fast flicks), arms the rest timer
   * that clears it SCROLL_REST_DELAY_MS after the last event, and re-ranks.
   * Idempotent; safe to call from multiple listeners. (The thumbnail fix no
   * longer depends on scroll — see applyCoverSize.)
   */
  private markScroll(scrollY: number): void {
    const now = Date.now();
    // First event after a scope transition: record position as the new baseline
    // (no velocity sample) and clear any stale fast-flick state, so prearm is
    // available immediately on the surface the user just moved to. See
    // scrollBaselinePending / resetScrollBaseline.
    if (this.scrollBaselinePending) {
      this.scrollBaselinePending = false;
      this.lastScrollY = scrollY;
      this.lastScrollTime = now;
      this.isScrollFast = false;
      if (this.scrollRestTimer) { clearTimeout(this.scrollRestTimer); this.scrollRestTimer = null; }
      this.scheduleRank();
      return;
    }
    const dy = Math.abs(scrollY - this.lastScrollY);
    const dt = Math.max(1, now - this.lastScrollTime);
    const velocity = (dy / dt) * 1000; // px/s
    this.lastScrollY = scrollY;
    this.lastScrollTime = now;
    this.isScrollFast = velocity > SCROLL_VELOCITY_THRESHOLD;
    if (this.scrollRestTimer) clearTimeout(this.scrollRestTimer);
    this.scrollRestTimer = setTimeout(() => {
      this.isScrollFast = false;
      this.scheduleRank();
    }, SCROLL_REST_DELAY_MS);
    this.scheduleRank();
  }

  /**
   * Push an overlay scope. Pass the slot-prefix the overlay's nested feed
   * uses (e.g. `look:42`, `product:Nike:Air Force 1`). While it's on top of
   * the stack, only cards whose director id starts with that prefix play;
   * the background home feed is released. Call popScope with the SAME prefix
   * when the overlay closes. Idempotent per (re-)mount — safe to push the
   * same prefix twice (React Strict Mode) since popScope removes one match.
   */
  pushScope(prefix: string): void {
    if (!prefix) return;
    // A fresh push is active, not exiting — clear any stale exit flag so a
    // rapid close→reopen of the same scope re-gates the background feed.
    this.exitingScopes.delete(prefix);
    this.scopeStack.push(prefix);
    // The active scroll surface is about to change to the overlay's own
    // scroller; re-baseline so its first notifyScroll isn't read as a flick.
    this.resetScrollBaseline();
    this.scheduleRank();
  }

  /** Pop a previously-pushed overlay scope (removes the last matching entry). */
  popScope(prefix: string): void {
    if (!prefix) return;
    const idx = this.scopeStack.lastIndexOf(prefix);
    if (idx !== -1) this.scopeStack.splice(idx, 1);
    // Once the prefix is fully gone from the stack, drop its exit flag too.
    if (!this.scopeStack.includes(prefix)) this.exitingScopes.delete(prefix);
    // Returning to the surface beneath (feed or a parent overlay); re-baseline
    // so its first scroll event after the handoff isn't a cross-origin flick.
    this.resetScrollBaseline();
    this.scheduleRank();
  }

  /** Re-baseline scroll-motion tracking on the NEXT markScroll. Called on scope
   *  transitions because the active scroll surface (and thus the meaning of the
   *  scrollY value fed in) changes — a delta across that boundary would be a
   *  spurious velocity. Also clears stale fast-flick state so the new surface's
   *  prearm isn't gated off the instant it opens. */
  private resetScrollBaseline(): void {
    this.scrollBaselinePending = true;
    this.isScrollFast = false;
    if (this.scrollRestTimer) { clearTimeout(this.scrollRestTimer); this.scrollRestTimer = null; }
  }

  /**
   * Signal that an overlay scope has begun its close animation. Unlike
   * popScope this does NOT touch the stack — the overlay's effect cleanup
   * still pops exactly once on unmount, so the push/pop balance (and nested-
   * overlay correctness) is preserved. It only marks the scope transparent to
   * activeScope() so the background feed starts re-acquiring + decoding its
   * <video>s DURING the ~360 ms slide-out instead of after unmount. By the
   * time the overlay clears, the feed underneath is already live — no frozen
   * "dead" feed for a beat on back. Idempotent; safe to call repeatedly.
   */
  beginScopeExit(prefix: string): void {
    if (!prefix) return;
    if (!this.scopeStack.includes(prefix)) return; // not an open scope
    if (this.exitingScopes.has(prefix)) return;    // already exiting
    this.exitingScopes.add(prefix);
    this.scheduleRank();
  }

  /** Active scope = the topmost overlay prefix that isn't mid-close, or null
   *  when none is open (or every open scope is animating out). A scope flagged
   *  by beginScopeExit is skipped so the background feed re-warms during the
   *  close animation. */
  private activeScope(): string | null {
    for (let i = this.scopeStack.length - 1; i >= 0; i--) {
      const prefix = this.scopeStack[i];
      if (!this.exitingScopes.has(prefix)) return prefix;
    }
    return null;
  }

  /** A card is eligible to play only if it belongs to the active scope. */
  private inActiveScope(id: string): boolean {
    const scope = this.activeScope();
    return scope === null ? true : id.startsWith(scope);
  }

  /**
   * Notify the director that a detail overlay has opened or closed.
   * Open: pause all non-active cards so the detail view isn't fighting
   * for decode budget. Close: re-rank to restore feed playback.
   */
  notifyDetail(action: 'open' | 'close', cardId?: string): void {
    if (action === 'open') {
      // Only cards holding a pooled <video> can be playing — iterate that
      // bounded set, not every registered card (O(poolMax), not O(mounted)).
      for (const id of this.assignedIds) {
        if (id === cardId) continue;
        const entry = this.cards.get(id);
        if (entry?.videoEl && !entry.videoEl.paused) {
          try { entry.videoEl.pause(); } catch { /* ignore */ }
          entry.status = 'paused';
          this.emit(id, 'paused');
        }
      }
    } else {
      this.scheduleRank();
    }
  }

  /**
   * Subscribe to status changes for a single card.
   * Returns an unsubscribe function.
   */
  subscribe(cardId: string, cb: (s: CardStatus) => void): () => void {
    if (!this.subscribers.has(cardId)) this.subscribers.set(cardId, new Set());
    this.subscribers.get(cardId)!.add(cb);
    return () => { this.subscribers.get(cardId)?.delete(cb); };
  }

  /**
   * Returns the currently-assigned <video> element for a card, or null.
   * Use this to capture a frame on tap (captureVideoFrame).
   */
  getVideoElement(cardId: string): HTMLVideoElement | null {
    return this.cards.get(cardId)?.videoEl ?? null;
  }

  /**
   * Releases the assigned <video> element from a card without returning
   * it to the director's off-screen parking div. The caller takes full
   * ownership of the element (e.g. to donate it to TrailVideoHost so an
   * overlay hero can reuse the already-playing element seamlessly).
   * The director re-assigns a fresh pool element to the card on the next
   * rank cycle.
   */
  /** Remember which card donated under a TrailVideoHost trail id, so the
   *  overlay can sync the frame back on close (the open direction donates
   *  the element; without this the card resumed at an arbitrary time). */
  registerTrailReturn(trailId: string, cardId: string): void {
    this.trailReturn.set(trailId, cardId);
  }

  /**
   * Reverse handoff on overlay close: pin the overlay hero's EXACT current
   * frame over the source card, seek the card's own element to the hero's
   * time, and unfreeze once the seek lands — the card continues from the
   * same frame the overlay was showing, no restart-from-zero jump.
   */
  syncFromTrailReturn(trailId: string, heroEl: HTMLVideoElement | null): void {
    if (!heroEl) return;
    const cardId = this.trailReturn.get(trailId);
    const entry = cardId ? this.cards.get(cardId) : undefined;
    if (!entry) return;
    this.freezeCard(entry, heroEl);
    const el = entry.videoEl;
    if (!el) return; // not re-acquired yet — reveal path unfreezes later
    const t = heroEl.currentTime;
    if (!isFinite(t)) { this.unfreezeCard(entry); return; }
    try {
      el.currentTime = el.duration && isFinite(el.duration) ? t % el.duration : t;
    } catch { this.unfreezeCard(entry); return; }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.removeEventListener('seeked', finish);
      this.fadeOutFreeze(entry); // reveal: crossfade the pinned frame out
    };
    el.addEventListener('seeked', finish, { once: true });
    // Backstop: never leave the freeze up if 'seeked' doesn't fire.
    window.setTimeout(finish, 600);
  }

  /**
   * Reverse of stealVideoElement. On overlay close, take the WARM, still-playing
   * hero element back and re-adopt it as the mapped card's pooled <video>, so the
   * grid resumes INSTANTLY at the same frame instead of cold-re-acquiring + re-
   * buffering a fresh element (the "that video stops for a beat on back" seam).
   * The element keeps its src / hls.js instance / currentTime — no reload, no
   * decode gap. Any cold element rank() grabbed under the slide-out is released
   * back to the pool. Returns true if it adopted (so the caller can tell
   * TrailVideoHost to forget the element); false to fall back to normal acquire.
   *
   * The caller MUST call this only once the hero is gone (overlay unmounting), or
   * it would steal the element out from under the still-visible hero.
   */
  adoptReturnedElement(trailId: string, el: HTMLVideoElement | null): boolean {
    // Consume the mapping unconditionally — this is the terminal consumer on
    // close, so deleting here (even on the fallback paths below) prevents a
    // stale trailId->cardId entry from accumulating when the card has unmounted.
    const cardId = this.trailReturn.get(trailId);
    this.trailReturn.delete(trailId);
    if (!el || !cardId) return false;
    const entry = this.cards.get(cardId);
    if (!entry) return false; // card unmounted — let TrailVideoHost park it
    // Release any cold element rank() acquired for this card during the close
    // animation (it goes back to the pool; the warm element replaces it).
    if (entry.videoEl && entry.videoEl !== el) {
      this.releaseVideoEl(cardId, entry.videoEl);
      entry.videoEl = null;
    }
    // Re-register el as a pool slot for this card (steal removed its old slot).
    const existingSlot = this.pool.find(p => p.el === el);
    if (existingSlot) existingSlot.assignedTo = cardId;
    else this.pool.push({ el, assignedTo: cardId });
    // Director styling; the element is warm (playing, has frames) so it reveals
    // immediately (applyCoverSize flips opacity:1 at readyState>=2).
    Object.assign(el.style, {
      position: 'absolute', top: '50%', left: '50%', inset: 'auto',
      transform: 'translate(-50%, -50%) translateZ(0)', objectFit: 'fill',
      zIndex: '2', display: 'block', opacity: '1', transition: 'none',
    });
    (el as HTMLVideoElement & { __coverApply?: () => void }).__coverApply =
      () => this.applyCoverSize(entry, el);
    entry.slotEl.appendChild(el);
    // Assign videoEl BEFORE applyCoverSize: applyCoverSize early-returns unless
    // entry.videoEl === el, and a re-parented already-playing element never
    // re-fires loadedmetadata/loadeddata/playing/resize — so if we sized after,
    // the box would keep the HERO's aspect inside the (differently-shaped) grid
    // tile (mis-sized/distorted card). Setting it first lets the guard pass so
    // the warm element is re-cover-sized to THIS card's rect.
    entry.videoEl = el;
    entry.status = 'playing';
    this.assignedIds.add(cardId);
    this.applyCoverSize(entry, el);
    this.fadeOutFreeze(entry); // warm reveal: crossfade the pinned frame out
    this.emit(cardId, 'playing');
    this.playEl(cardId, entry);
    return true;
  }

  stealVideoElement(cardId: string): HTMLVideoElement | null {
    const entry = this.cards.get(cardId);
    if (!entry || !entry.videoEl) return null;
    const el = entry.videoEl;
    // The card keeps painting the stolen element's exact frame while the
    // overlay owns it — on return, the re-attached video reveals over this.
    this.freezeCard(entry, el);
    // Remove the slot from the pool entirely so rank() cannot reclaim this
    // element. If we only mark assignedTo=null the director's next RAF
    // immediately re-uses the "free" slot, stealing the element back from
    // TrailVideoHost's offscreen pool before the overlay can attach() it.
    const slotIdx = this.pool.findIndex(p => p.el === el);
    if (slotIdx !== -1) this.pool.splice(slotIdx, 1);
    this.assignedIds.delete(cardId);
    entry.videoEl = null;
    entry.status = 'idle';
    this.emit(cardId, 'idle');
    // Re-rank: director will create a fresh pool element for this card.
    this.scheduleRank();
    return el;
  }

  // ── Private ──────────────────────────────────────────────────────────

  private scheduleRank(): void {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.rank();
    });
  }

  /** Distance from a card's rect to the viewport (0 if overlapping). */
  private distanceToViewport(rect: DOMRect): number {
    const vh = typeof window !== 'undefined' ? window.innerHeight : 0;
    if (rect.bottom < 0) return -rect.bottom;          // above viewport
    if (rect.top > vh) return rect.top - vh;           // below viewport
    return 0;                                           // overlapping
  }

  private rank(): void {
    if (typeof document !== 'undefined' && document.hidden) return;

    const playMargin = playMarginPx();
    const releaseMargin = releaseMarginPx();
    const prearmMargin = prearmMarginPx();
    const max = poolMax();

    // Snapshot every card with its current distance. We classify into
    // three bands using hysteresis:
    //   distance <= playMargin     → must play
    //   distance >= releaseMargin  → must release
    //   in between                 → keep current state (don't churn)
    type Ranked = { id: string; entry: CardEntry; distance: number };
    const ranked: Ranked[] = [];
    // Iterate only the near-viewport set, NOT every registered card. This is
    // what keeps rank() cheap on a long-scrolled feed: getRect() (a forced
    // sync layout) runs for ~the cards on/near screen, never for the thousands
    // that have scrolled out of the band.
    for (const id of this.nearIds) {
      const entry = this.cards.get(id);
      if (!entry) { this.nearIds.delete(id); continue; }
      const rect = entry.getRect();
      // Skip cards that haven't laid out yet (0×0 rect) — happens briefly
      // on mount; the next rank() pass picks them up.
      if (rect.width === 0 && rect.height === 0) continue;
      ranked.push({ id, entry, distance: this.distanceToViewport(rect) });
    }

    // While an overlay scope is active, keep the background cards ALIVE instead
    // of releasing them, so returning to the feed never shows a cold re-buffer
    // ("feed dead on back"). The budget is the pool MINUS a reserve for the
    // overlay's own nested rails (keepWarm = poolMax - NESTED_FEED_RESERVE), so
    // the WHOLE visible grid stays warm while warm + nested ≤ poolMax keeps total
    // decoders within the safe ceiling. Desktop keeps them PLAYING (seamless,
    // zero hitch on back); mobile PAUSES them (decoder-safe, instant resume from
    // the retained surface) — see the device-split in the release step below.
    const keepWarm = new Set<string>();
    if (this.activeScope() !== null) {
      const reserve = isMobileViewport() ? NESTED_FEED_RESERVE_MOBILE : NESTED_FEED_RESERVE_DESKTOP;
      const warmBudget = Math.max(0, max - reserve);
      const warmCandidates = ranked
        .filter(r => r.entry.videoEl && !this.inActiveScope(r.id) && r.distance <= playMargin)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, warmBudget);
      for (const { id } of warmCandidates) keepWarm.add(id);
    }

    // 1. Release: anything past releaseMargin — OR outside the active overlay
    //    scope (e.g. the home feed behind an open overlay) — gives its slot
    //    back so it stops decoding. EXCEPT the keep-warm set.
    //
    //    Keep-warm handling is DEVICE-SPLIT:
    //    • Desktop — leave the card PLAYING under the overlay (do NOT pause it).
    //      The overlay surface is opaque (#0a0a0a fully covers the feed — there's
    //      no backdrop blur over it to re-rasterize), and desktop has decode
    //      headroom with no iOS decoder ceiling, so the only cost is decoding a
    //      covered clip. The payoff: returning to the feed is TRULY seamless —
    //      the card never paused, so there's nothing to resume and no visible
    //      "adjacent videos pause then resume on back" hitch.
    //    • Mobile — PAUSE in place (element + decoded surface retained) to stay
    //      under the iOS simultaneous-decoder ceiling; the retained surface still
    //      makes the paused→play resume instant on return.
    const pauseWarm = isMobileViewport();
    for (const { id, entry, distance } of ranked) {
      if (!entry.videoEl) continue;
      if (keepWarm.has(id)) {
        if (pauseWarm && !entry.videoEl.paused) {
          try { entry.videoEl.pause(); } catch { /* ignore */ }
          entry.status = 'paused';
          this.emit(id, 'paused');
        }
        continue;
      }
      if (distance >= releaseMargin || !this.inActiveScope(id)) {
        this.releaseVideoEl(id, entry.videoEl);
        entry.videoEl = null;
        entry.status = 'idle';
        this.emit(id, 'idle');
      }
    }

    // 2. Determine the desired-playing set. Inside playMargin AND in the
    //    active scope → wants playback. Sorted nearest-first so eviction
    //    (when pool is full) favors the closest cards.
    const wantsPlay = ranked
      .filter(r => r.distance <= playMargin && this.inActiveScope(r.id))
      .sort((a, b) => a.distance - b.distance);

    // Anti-burst: bound the COLD attaches this pass; defer the rest to the next
    // rAF so a return-from-overlay wave lights up progressively instead of
    // freezing on a synchronized decoder burst. Resumes/same-src reclaims are
    // free (handled before this is decremented). See ATTACH_BUDGET_* docs.
    let coldBudget = attachBudget();
    let deferredColdAttach = false;

    for (const { id, entry, distance } of wantsPlay) {
      if (entry.videoEl) {
        // Already assigned — keep it playing. If it's paused for any reason
        // (assignment happened mid-flick, autoplay rejected, source swap),
        // kick it again. The status guard only skips when a play() promise
        // is genuinely in-flight (status='loading' is set right before the
        // playEl() call below).
        if (entry.videoEl.paused && entry.status !== 'loading') {
          if (entry.status === 'paused') entry.retryCount = 0;
          this.playEl(id, entry);
        }
        continue;
      }

      // Need a slot. Prefer a free slot that ALREADY holds this card's clip
      // — after a detail overlay released the feed, this lets a card reclaim
      // its own element (no src swap, no reload, no black flash, instant
      // resume from where it paused). This reclaim is FREE (no cold-attach
      // cost), so it's never throttled by the budget below.
      const warmSlot = this.pool.find(
        p => p.assignedTo === null && getVideoSource(p.el) === entry.videoUrl,
      );
      // No own-clip slot to reclaim → this would be a COLD attach. If the per-
      // pass budget is spent, defer this card to the next rank() (it's still in
      // the play band; its poster/freeze-frame covers until then). wantsPlay is
      // nearest-first, so the closest cards spend the budget first.
      if (!warmSlot && coldBudget <= 0) {
        deferredColdAttach = true;
        continue;
      }
      // Then an EMPTY free slot — so an overlay's nested feed clobbers blank
      // slots before the parked home-feed clips, leaving those reclaimable on
      // return. Then any free slot; if none, grow up to poolMax(); if at cap,
      // evict the most-distant assigned card.
      let slot =
        warmSlot ||
        this.pool.find(p => p.assignedTo === null && !getVideoSource(p.el)) ||
        this.pool.find(p => p.assignedTo === null);
      if (!slot && this.pool.length < max) {
        slot = { el: this.createVideoEl(), assignedTo: null };
        this.pool.push(slot);
      }
      if (!slot) {
        // Pool at cap — evict the assigned card with the largest distance,
        // provided it's farther than the candidate (otherwise we'd thrash).
        let victimDist = distance;
        let victim: { slot: PoolSlot; entry: CardEntry; id: string } | null = null;
        for (const p of this.pool) {
          if (!p.assignedTo) continue;
          // PROTECT keep-warm: a paused background card retained for an instant
          // resume on back must NOT be stolen by the overlay's nested rail —
          // evicting it cold-rebuffers the feed on return, exactly what keep-warm
          // exists to prevent. The reserve guarantees the rail enough non-warm
          // slots, so its acquires never need to reach for these.
          if (keepWarm.has(p.assignedTo)) continue;
          const e = this.cards.get(p.assignedTo);
          if (!e || !e.videoEl) continue;
          const d = this.distanceToViewport(e.getRect());
          if (d > victimDist) {
            victimDist = d;
            victim = { slot: p, entry: e, id: p.assignedTo };
          }
        }
        if (!victim) continue; // nothing to evict — skip this card this pass
        this.releaseVideoEl(victim.id, victim.entry.videoEl!);
        victim.entry.videoEl = null;
        victim.entry.status = 'idle';
        this.emit(victim.id, 'idle');
        slot = victim.slot;
      }

      // A prebuffered slot was parked with autoplay disabled (prebufferSlot);
      // restore it so an adopted element behaves like any freshly-acquired one.
      // playEl drives playback either way — this just keeps pool elements
      // uniform and lets the muted-autoplay heuristic re-evaluate on adopt.
      slot.el.autoplay = true;

      // (Re-)configure the element. EXPLICIT COVER (no object-fit): the box is
      // centered and sized to the exact cover rect (applyCoverSize, below + on
      // loadedmetadata/resize), so the content fills the tile with the correct
      // aspect crop and there is NO object-fit for WebKit to mis-render as
      // contain (the "thumbnail" glitch). The element stays opacity:1/visible;
      // before its first frame it's transparent (no poster attr) so the card's
      // own cover poster <img> beneath shows — no black, no thumbnail.
      const isNewClip = getVideoSource(slot.el) !== entry.videoUrl;
      slot.el.preload = 'auto';
      if (isNewClip) {
        // Point the element at the src and start buffering. setVideoSource routes
        // HLS via hls.js / native (and MP4 straight to el.src), kicking off
        // buffering — no explicit load() needed (load() on an hls.js element
        // resets its MSE pipeline). This is the COLD attach the budget bounds.
        setVideoSource(slot.el, entry.videoUrl);
        coldBudget--;
      }
      Object.assign(slot.el.style, {
        position: 'absolute',
        // Centered; width/height are set by applyCoverSize to the cover rect.
        top: '50%',
        left: '50%',
        inset: 'auto',
        transform: 'translate(-50%, -50%) translateZ(0)',
        // object-fit:fill is a no-op here (the box is sized to the clip's exact
        // aspect, so fill == cover with NO aspect computation for WebKit to get
        // wrong). Never 'cover'/'contain' — those are the mis-rendered modes.
        objectFit: 'fill',
        zIndex: '2',
        display: 'block',
        // Held transparent until applyCoverSize has applied real cover dims AND a
        // frame exists, so the first VISIBLE frame is correctly cover-framed —
        // never the stretched 100%×100% pre-metadata fallback. A frameless
        // <video> (no poster attr) is transparent, so the card's poster <img>
        // beneath shows during the gap — no black, no stretch.
        opacity: '0',
        transition: 'none',
      });

      slot.assignedTo = id;
      this.assignedIds.add(id);
      entry.videoEl = slot.el;
      entry.status = 'loading';
      // Wire the persistent metadata/frame listeners (added in createVideoEl) to
      // THIS owner, then size + (if a frame already exists) reveal now — the
      // intrinsic size is often already known on a recycled/prebuffered element,
      // giving an instant correct reveal (e.g. returning from an overlay).
      (slot.el as HTMLVideoElement & { __coverApply?: () => void }).__coverApply =
        () => this.applyCoverSize(entry, slot.el!, true);
      // Fresh clip → size now but DON'T reveal on a possibly-stale readyState
      // (hls.js reuse keeps the prior clip's frame); the frame listeners reveal
      // once THIS clip paints. Same-src reclaim → the frame is this clip's, reveal now.
      this.applyCoverSize(entry, slot.el, !isNewClip);

      // Move the element into the card's slot div, then start playback. We always
      // call play() here — the browser queues against the in-flight buffering and
      // the pool cap bounds concurrent decodes.
      entry.slotEl.appendChild(slot.el);
      this.playEl(id, entry);
    }

    // Cold-attach budget was hit this pass — at least one in-band card still
    // wants a fresh element. Re-rank next frame to promote the next nearest
    // batch, so a big return wave lights up over a few frames instead of one.
    // scheduleRank() self-coalesces (no-op if a rAF is already queued).
    if (deferredColdAttach) this.scheduleRank();

    // 2.5 Watchdog resume: a card inside the play band that HOLDS an
    //     element but isn't actually playing gets kicked back into
    //     playback — covers silent browser pauses, play/pause races, and
    //     post-overlay returns. keepWarm cards are deliberately paused
    //     behind an overlay; failed elements back off briefly so a
    //     genuinely unplayable clip can't hot-loop play() calls.
    if (!this.isScrollFast) {
      for (const r of ranked) {
        if (r.distance > playMargin) continue;
        const e = r.entry;
        if (!e.videoEl || !e.videoEl.paused) continue;
        if (!this.inActiveScope(r.id)) continue;
        if (keepWarm.has(r.id)) continue;
        if (e.retryCount > 2 && Date.now() - e.lastFailureAt < 5000) continue;
        this.playEl(r.id, e);
      }
    }

    // 3. Pre-attach: prebuffer the nearest UPCOMING clips (just outside the
    //    play band) into spare pool elements so promotion is an instant adopt
    //    instead of a cold HLS chain. Best-effort + hard-bounded (see PREARM
    //    docs): never evicts a playing card, never exceeds poolMax, skipped on
    //    fast flicks / save-data / when disabled. Also skipped while a cold-
    //    attach wave is still draining (deferredColdAttach) so the budget
    //    promotes every VISIBLE card before we spend slots on lookahead.
    if (PREARM_ENABLED && !this.isScrollFast && !isSlowConnection() && !deferredColdAttach && this.assignedIds.size < max) {
      const useNativeHls = browserSupportsNativeHls();
      // The nearest N upcoming cards we want kept warm. Slicing to prearmMax
      // FIRST bounds the ACTIVE prebuffer set to ~N regardless of how many rank
      // passes run: already-warm targets are skipped, only the missing ones are
      // armed. (Arming "N new per pass" instead would let prebuffered slots
      // accumulate to fill every spare slot — fine on desktop, jank on mobile.)
      const targets = ranked
        .filter(r =>
          r.distance > playMargin &&
          r.distance <= prearmMargin &&
          this.inActiveScope(r.id) &&
          !r.entry.videoEl)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, prearmMax());
      for (const { entry } of targets) {
        const url = entry.videoUrl;
        if (!url) continue;
        // Already buffered into a free slot? Leave it.
        if (this.pool.some(p => p.assignedTo === null && getVideoSource(p.el) === url)) continue;
        // Prefer an EMPTY free slot (don't clobber another prearm); else grow up
        // to the cap; else reuse any free slot (recycles a stale prebuffer).
        // NEVER evict a playing card.
        let slot: PoolSlot | undefined =
          this.pool.find(p => p.assignedTo === null && !getVideoSource(p.el));
        if (!slot && this.pool.length < max) {
          slot = { el: this.createVideoEl(), assignedTo: null };
          this.pool.push(slot);
        }
        if (!slot) slot = this.pool.find(p => p.assignedTo === null);
        if (!slot) break; // no headroom — leave the rest to cold-attach
        this.prebufferSlot(slot, entry, useNativeHls);
      }
    }
  }

  /**
   * Size a pooled <video>'s BOX to the exact "cover" rectangle for its tile,
   * instead of relying on object-fit:cover. WebKit/iOS renders object-fit:cover
   * AS contain on a freshly-attached <video> — confirmed on-device with a live
   * overlay: the element box stays = the tile, object-fit computes to `cover`,
   * yet the content paints pillarboxed (small, centered) and stays that way well
   * past any reveal/shield window, because the mis-paint lands on the first
   * VISIBLE composite and no hide/cover/timing trick can pre-empt it.
   *
   * The cure: remove object-fit from the picture. The element is centered
   * (translate -50%,-50%) and we set its width/height so the box is the smallest
   * rect of the CLIP's aspect that still covers the tile (one axis 100%, the
   * other > 100%, overflow clipped by .look-card). object-fit:fill then fills
   * that box without distortion (box aspect == clip aspect), so there is no
   * aspect computation for WebKit to get wrong — the first painted frame is
   * already correctly cover-framed. Percentage-based, so it can never blow up to
   * the video's intrinsic pixel size (the bug the auto/min-width approach had).
   *
   * Also owns the REVEAL: the element is held opacity:0 until the intrinsic size
   * is known (so cover dims are applied) AND a real frame exists (readyState>=2),
   * so the first VISIBLE frame is already correctly framed — never the stretched
   * 100%×100% fallback that's active while the size is still unknown. Called on
   * acquire and via persistent loadedmetadata/resize/loadeddata/playing listeners.
   *
   * `canReveal` is IDENTITY-SAFE gating: the immediate acquire call for a FRESH
   * clip passes false, because on the hls.js reuse path (Chrome/Android)
   * loadSource() does NOT reset readyState — so a recycled element can still
   * report readyState>=2 with the PREVIOUS clip's decoded frame at acquire-time,
   * and revealing then would flash the wrong clip. The persistent frame listeners
   * pass true: they fire only once the NEW clip actually produces a frame, so the
   * reveal is always of THIS clip. (On Safari/iOS native HLS, el.src=url resets
   * readyState to 0 synchronously, so a fresh clip is readyState<2 at acquire and
   * this gate is a no-op there — it only matters for the hls.js path.) */
  private applyCoverSize(entry: CardEntry, el: HTMLVideoElement, canReveal = true): void {
    if (entry.videoEl !== el) return;
    const vw = el.videoWidth, vh = el.videoHeight;
    const r = entry.getRect();
    if (!r.width || !r.height) return;
    // Prefer the video's own intrinsic aspect (exact); before metadata, fall back
    // to the poster-derived aspectHint so the box is ALREADY cover-correct on the
    // first paint (no stretched 100%×100% window). Only if BOTH are unknown do we
    // use a plain fill box — and that's kept invisible by opacity:0 until a frame.
    const vidAspect = (vw && vh) ? (vw / vh) : (entry.aspectHint || 0);
    if (!vidAspect) {
      el.style.width = '100%';
      el.style.height = '100%';
      return;
    }
    const tileAspect = r.width / r.height;
    if (vidAspect > tileAspect) {
      // Clip is wider than the tile → fill height, overflow (crop) width.
      el.style.height = '100%';
      el.style.width = (vidAspect / tileAspect * 100).toFixed(3) + '%';
    } else {
      // Clip is taller/narrower → fill width, overflow (crop) height.
      el.style.width = '100%';
      el.style.height = (tileAspect / vidAspect * 100).toFixed(3) + '%';
    }
    // Cover dims are now applied. Reveal once a real frame of THIS clip exists so
    // the first visible paint is correctly framed; until then the poster <img>
    // covers. canReveal guards against revealing a stale prior-clip frame (see above).
    if (canReveal && el.readyState >= 2) {
      el.style.opacity = '1';
      this.fadeOutFreeze(entry); // reveal: crossfade the pinned frame out (if any)
    }
  }

  /**
   * Point a FREE pool slot at an upcoming clip and start buffering it WITHOUT
   * playing it or moving it on-screen. The slot stays free (assignedTo=null)
   * so rank()'s acquire can adopt it via same-src match — by then its first
   * frame is decoded, so the reveal is instant.
   *
   * hls.js (non-native) fetches segments on attachMedia regardless of play(),
   * so the element reaches a first frame on its own. Native HLS (iOS/Safari)
   * ignores preload for an off-screen element, so we kick the pipeline with a
   * muted play() and immediately pause + rewind to frame 0 once data lands —
   * the only way to prime AVFoundation's media cache (a fetch() can't, which is
   * exactly why the HTTP-cache warm never helped iOS).
   */
  private prebufferSlot(slot: PoolSlot, entry: CardEntry, useNativeHls: boolean): void {
    const el = slot.el;
    el.preload = 'auto';
    // Don't autoplay off-screen; the play path calls play() and restores
    // autoplay on adopt. Staying paused avoids currentTime drift so the adopted
    // clip still starts at frame 0 (matches the poster — no zoom pop).
    el.autoplay = false;
    if (getVideoSource(el) !== entry.videoUrl) {
      setVideoSource(el, entry.videoUrl);
    }
    if (useNativeHls) {
      const target = entry.videoUrl;
      const onData = () => {
        // Bail if the slot got claimed for real playback meanwhile, or was
        // re-pointed at another clip.
        if (slot.assignedTo !== null) return;
        if (getVideoSource(el) !== target) return;
        try { el.pause(); } catch { /* ignore */ }
        try { if (el.currentTime > 0) el.currentTime = 0; } catch { /* ignore */ }
      };
      el.addEventListener('loadeddata', onData, { once: true });
      // Muted, off-screen kick — silent; rejected pre-gesture, in which case the
      // card just cold-attaches on promotion as before (no regression).
      void el.play().catch(() => { /* gesture-gated; nothing to do */ });
    }
  }

  private playEl(cardId: string, entry: CardEntry): void {
    const el = entry.videoEl;
    if (!el) return;

    // Backup: when the video finally has data, retry play() if still paused.
    // This covers the case where play() is called before the first bytes arrive
    // (e.g. cold cache on a search result) and the Promise rejects before data
    // loads. The listener is once: true so it fires at most once per assignment.
    const onLoadedData = () => {
      const current = this.cards.get(cardId);
      if (current?.videoEl === el && el.paused) {
        void el.play().catch(() => {});
      }
    };
    el.addEventListener('loadeddata', onLoadedData, { once: true });

    el.play().then(() => {
      // Guard: card may have been demoted while play() was in-flight.
      if (this.cards.get(cardId)?.videoEl !== el) return;
      entry.status = 'playing';
      entry.retryCount = 0;
      this.emit(cardId, 'playing');
    }).catch((err: DOMException | Error) => {
      // AbortError = .pause() fired before play() settled — expected, not a bug.
      if (err.name === 'AbortError') return;
      if (this.cards.get(cardId)?.videoEl !== el) return;

      entry.status = 'paused';
      entry.retryCount++;
      entry.lastFailureAt = Date.now();
      this.emit(cardId, 'paused');

      if (entry.retryCount <= MAX_RETRIES) {
        setTimeout(() => {
          const current = this.cards.get(cardId);
          if (current?.videoEl === el) this.playEl(cardId, current);
        }, 400 * entry.retryCount);
      } else {
        // MAX_RETRIES exhausted — keep entry as 'paused' (not 'degraded')
        // so the heartbeat can recover it once data finally arrives.
        this.emit(cardId, 'paused');
      }
    });
  }

  /** Pin the element's current decoded frame into the card's slot as an
   *  <img> overlay. Best-effort: CORS-tainted canvases / frameless elements
   *  simply leave the poster fallback in place. */
  private freezeCard(entry: CardEntry, el: HTMLVideoElement): void {
    try {
      if (el.readyState < 2) return;
      const frame = captureVideoFrame(el);
      if (!frame) return;
      let img = entry.freezeEl;
      if (!img) {
        img = document.createElement('img');
        img.setAttribute('aria-hidden', 'true');
        Object.assign(img.style, {
          position: 'absolute',
          inset: '0',
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          // ABOVE the pooled <video> (z-index 2): the freeze covers the gap
          // while the re-attached clip cold-buffers, then fadeOutFreeze fades it
          // DOWN on reveal so the live video shows through it — a soft
          // poster→video crossfade instead of a hard snap (the felt "freeze then
          // resume" on back from an overlay). Fading the freeze (a static image
          // of THIS card's own last frame) is identity-safe; fading the recycled
          // <video> itself is not (hls.js reuse can hold a prior clip's frame).
          zIndex: '3',
          display: 'block',
          pointerEvents: 'none',
          opacity: '1',
          transition: 'none',
        });
        entry.freezeEl = img;
      } else {
        // Reused after a prior fade-out was armed — restore it to fully opaque
        // and cancel any pending transition so it covers the new gap cleanly.
        img.style.transition = 'none';
        img.style.opacity = '1';
      }
      img.src = frame;
      if (img.parentElement !== entry.slotEl) entry.slotEl.appendChild(img);
    } catch { /* best-effort — poster remains the fallback */ }
  }

  private unfreezeCard(entry: CardEntry): void {
    const img = entry.freezeEl;
    if (!img) return;
    entry.freezeEl = null;
    try { img.remove(); } catch { /* already detached */ }
  }

  /** Crossfade the freeze-frame OUT at reveal time: the live video is already
   *  painting at full opacity beneath it (z-index 2 vs the freeze's 3), so
   *  fading the freeze down reveals the clip through it — a soft poster→video
   *  swap instead of a hard cut. Detaches the img from the entry IMMEDIATELY so
   *  a concurrent re-acquire/freeze never reuses the fading element, then removes
   *  it once the transition ends (with a timeout backstop). Used only on the
   *  same-identity reveal paths; identity-CHANGE paths still call unfreezeCard
   *  for an instant drop so a prior item's frame can't linger over a new one. */
  private fadeOutFreeze(entry: CardEntry): void {
    const img = entry.freezeEl;
    if (!img) return;
    entry.freezeEl = null;
    const FADE_MS = 140;
    let removed = false;
    const drop = () => { if (removed) return; removed = true; try { img.remove(); } catch { /* detached */ } };
    img.style.transition = `opacity ${FADE_MS}ms linear`;
    // Flip on the next frame so the transition animates from opacity:1.
    requestAnimationFrame(() => { img.style.opacity = '0'; });
    img.addEventListener('transitionend', drop, { once: true });
    window.setTimeout(drop, FADE_MS + 80); // backstop if transitionend never fires
  }

  private releaseVideoEl(cardId: string, el: HTMLVideoElement): void {
    // Before the element leaves the slot, pin its current frame into the
    // card so the poster never flashes underneath (the frame-0 thumbnail
    // "pop" on return from a look/product overlay).
    const entry = this.cards.get(cardId);
    if (entry && entry.videoEl === el) this.freezeCard(entry, el);
    try { el.pause(); } catch { /* ignore */ }
    this.assignedIds.delete(cardId);
    const slot = this.pool.find(p => p.el === el);
    if (slot) slot.assignedTo = null;
    if (this.parkingDiv) {
      try { this.parkingDiv.appendChild(el); } catch { /* ignore */ }
    }
  }

  private pauseAll(): void {
    // Bounded by poolMax: only assigned cards can hold a playing <video>.
    for (const id of this.assignedIds) {
      const entry = this.cards.get(id);
      if (entry?.videoEl && !entry.videoEl.paused) {
        try { entry.videoEl.pause(); } catch { /* ignore */ }
        entry.status = 'paused';
        this.emit(id, 'paused');
      }
    }
  }

  private emit(cardId: string, status: CardStatus): void {
    this.subscribers.get(cardId)?.forEach(cb => cb(status));
  }
}

// ── Singleton export ───────────────────────────────────────────────────
// One director for the entire page. All feed components share it.
export const director = new VideoPlaybackDirector();

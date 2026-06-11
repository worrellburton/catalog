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

import { captureVideoFrame, getPrefetchCount, isSlowConnection } from './video-loading';
import {
  setVideoSource,
  getVideoSource,
  browserSupportsNativeHls,
  prefetchHlsModule,
} from '~/utils/hlsAttach';

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
/** While a detail overlay is open, the background home feed is out of the
 *  active scope and would normally have ALL its <video>s released — parked
 *  off-screen (mobile drops their decoded surface) and freed for the overlay's
 *  own nested feed to repurpose. Returning then cold re-buffers, so the feed
 *  shows posters ("looks dead") for a beat — worst on HLS, whose re-attach
 *  overruns the ~360ms close animation. Instead we keep this many of the
 *  NEAREST background cards alive-but-PAUSED (element + decoded surface kept,
 *  zero decode while covered) so returning is an instant paused→play resume.
 *  Bounded well under poolMax so the overlay's nested feed still gets slots. */
const KEEP_WARM_UNDER_OVERLAY_DESKTOP = 8;
const KEEP_WARM_UNDER_OVERLAY_MOBILE = 4;
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
const PREARM_MAX_MOBILE = 1;
// Lookahead band for prebuffering. MUST sit between the play and release bands
// (play < prearm < release < near-band) so prearmed cards are still tracked by
// rank() and are never past the point where they'd be released.
const PREARM_MARGIN_VH_DESKTOP = 1.1;
const PREARM_MARGIN_VH_MOBILE = 0.95;

function isMobileViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth <= 600;
}
function playMarginPx(): number {
  if (typeof window === 'undefined') return 0;
  return window.innerHeight * (isMobileViewport() ? PLAY_MARGIN_VH_MOBILE : PLAY_MARGIN_VH_DESKTOP);
}
function releaseMarginPx(): number {
  if (typeof window === 'undefined') return 0;
  return window.innerHeight * (isMobileViewport() ? RELEASE_MARGIN_VH_MOBILE : RELEASE_MARGIN_VH_DESKTOP);
}
function poolMax(): number {
  return isMobileViewport() ? POOL_MAX_MOBILE : POOL_MAX_DESKTOP;
}
function prearmMarginPx(): number {
  if (typeof window === 'undefined') return 0;
  return window.innerHeight * (isMobileViewport() ? PREARM_MARGIN_VH_MOBILE : PREARM_MARGIN_VH_DESKTOP);
}
function prearmMax(): number {
  return isMobileViewport() ? PREARM_MAX_MOBILE : PREARM_MAX_DESKTOP;
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
  private pool: PoolSlot[] = [];
  private parkingDiv: HTMLDivElement | null = null;
  private rafId: number | null = null;
  private lastScrollY = 0;
  private lastScrollTime = Date.now();
  private isScrollFast = false;
  private scrollRestTimer: ReturnType<typeof setTimeout> | null = null;
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

    // Track scroll velocity so we can skip play() during fast flicks.
    window.addEventListener('scroll', () => {
      const now = Date.now();
      const dy = Math.abs(window.scrollY - this.lastScrollY);
      const dt = Math.max(1, now - this.lastScrollTime);
      const velocity = (dy / dt) * 1000; // px/s
      this.lastScrollY = window.scrollY;
      this.lastScrollTime = now;
      this.isScrollFast = velocity > SCROLL_VELOCITY_THRESHOLD;
      if (this.scrollRestTimer) clearTimeout(this.scrollRestTimer);
      this.scrollRestTimer = setTimeout(() => {
        this.isScrollFast = false;
        this.scheduleRank();
      }, SCROLL_REST_DELAY_MS);
    }, { passive: true });

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
        if (this.cards.get(id)?.status !== 'playing' && this.inActiveScope(id)) {
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
  // then reload. Shows pool occupancy, playing count, prewarm count, and the
  // assign→first-frame reveal latency that issue #1/#2 are about.
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
    this.hudEl.textContent =
      `pool ${assigned}/${this.pool.length}   playing ${playing}\n` +
      `near ${this.nearIds.size} / mounted ${this.cards.size}\n` +
      `prewarmed ${getPrefetchCount()}\n` +
      `reveal last ${last ? `${last.ms}ms (${last.via})` : '—'}\n` +
      `reveal avg  ${avg}ms  n=${s.length}`;
  }

  private createVideoEl(): HTMLVideoElement {
    const el = document.createElement('video');
    el.muted = true;
    el.defaultMuted = true;
    el.autoplay = true;
    el.loop = true;
    el.playsInline = true;
    el.setAttribute('muted', '');
    el.setAttribute('autoplay', '');
    el.setAttribute('playsinline', '');
    el.preload = 'none';
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
    this.observeNear(cardId, slotEl);
    this.scheduleRank();
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
   * Feed scroll events here (passive listener on the feed container).
   * Computes velocity; suspends all play() calls during fast flicks
   * and resumes after SCROLL_REST_DELAY_MS of quiet.
   */
  notifyScroll(_scrollY: number): void {
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
    this.scheduleRank();
  }

  /** Pop a previously-pushed overlay scope (removes the last matching entry). */
  popScope(prefix: string): void {
    if (!prefix) return;
    const idx = this.scopeStack.lastIndexOf(prefix);
    if (idx !== -1) this.scopeStack.splice(idx, 1);
    // Once the prefix is fully gone from the stack, drop its exit flag too.
    if (!this.scopeStack.includes(prefix)) this.exitingScopes.delete(prefix);
    this.scheduleRank();
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

    // While an overlay scope is active, keep the NEAREST few background cards
    // alive-but-paused instead of releasing them, so returning to the feed is
    // an instant paused→play resume (decoded surface retained) rather than a
    // cold re-buffer that shows posters for a beat. Bounded by KEEP_WARM_* so
    // the overlay's own nested feed still gets pool slots. The kept cards sit
    // out of the active scope, so step 2 below never re-plays them while the
    // overlay is up; the moment beginScopeExit/close clears the scope they
    // fall into wantsPlay and resume from their retained frame.
    const keepWarm = new Set<string>();
    if (this.activeScope() !== null) {
      const warmBudget = isMobileViewport() ? KEEP_WARM_UNDER_OVERLAY_MOBILE : KEEP_WARM_UNDER_OVERLAY_DESKTOP;
      const warmCandidates = ranked
        .filter(r => r.entry.videoEl && !this.inActiveScope(r.id) && r.distance <= playMargin)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, warmBudget);
      for (const { id } of warmCandidates) keepWarm.add(id);
    }

    // 1. Release: anything past releaseMargin — OR outside the active overlay
    //    scope (e.g. the home feed behind an open overlay) — gives its slot
    //    back so it stops decoding. EXCEPT the keep-warm set, which we pause in
    //    place (element + surface retained) for an instant resume on return.
    for (const { id, entry, distance } of ranked) {
      if (!entry.videoEl) continue;
      if (keepWarm.has(id)) {
        if (!entry.videoEl.paused) {
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
      // resume from where it paused). Then an EMPTY free slot — so an overlay's
      // nested feed clobbers blank slots before the parked home-feed clips,
      // leaving those reclaimable on return. Then any free slot; if none, grow
      // up to poolMax(); if at cap, evict the most-distant assigned card.
      let slot =
        this.pool.find(p => p.assignedTo === null && getVideoSource(p.el) === entry.videoUrl) ||
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

      // (Re-)configure the element. A recycled pooled <video> sits at z-index
      // 2, above the card's poster <img> (z-index 1). It MUST stay transparent
      // until it actually has a frame to paint, or it flashes black over the
      // poster — revealVideoWhenReady enforces that for both branches below.
      if (getVideoSource(slot.el) !== entry.videoUrl) {
        // New clip: point the element at the src and start buffering. The
        // poster (the clip's FRAME 0) covers the gap until the first decoded
        // frame reveals the video. setVideoSource routes HLS manifests
        // through hls.js (and progressive MP4 straight to el.src), so it
        // also kicks off buffering — no explicit load() needed (and calling
        // load() on an hls.js-managed element would reset its MSE pipeline).
        slot.el.preload = 'auto';
        setVideoSource(slot.el, entry.videoUrl);
        this.revealVideoWhenReady(slot.el, entry.videoUrl, entry);
      } else {
        // Same src (pool reuse). The element still points at the right clip,
        // but its decoded surface may NOT have survived: while a detail
        // overlay was open this element sat parked off-screen, and mobile
        // browsers routinely drop the GPU surface of a parked <video>. The
        // old code revealed it at opacity 1 unconditionally on the assumption
        // it "already has frames" — which flashed BLACK over the poster on
        // every return from a look/product. Gate the reveal on a real frame
        // instead so the poster covers the gap when the surface was dropped.
        slot.el.preload = 'auto';
        this.revealVideoWhenReady(slot.el, entry.videoUrl, entry);
      }
      const poster = entry.posterUrl;
      if (poster && slot.el.getAttribute('poster') !== poster) {
        slot.el.setAttribute('poster', poster);
      }
      Object.assign(slot.el.style, {
        position: 'absolute',
        inset: '0',
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        zIndex: '2',
        display: 'block',
        transition: 'opacity 0.12s ease',
      });

      slot.assignedTo = id;
      this.assignedIds.add(id);
      entry.videoEl = slot.el;
      entry.status = 'loading';

      // Move the element into the card's slot div, then start playback.
      // We always call play() here — the browser will queue against the
      // in-flight network buffering, and the pool cap already bounds how
      // many decodes run concurrently. Skipping play() here was leaving
      // cards stuck in 'loading' on subsequent rank passes.
      entry.slotEl.appendChild(slot.el);
      this.playEl(id, entry);
    }

    // 3. Pre-attach: prebuffer the nearest UPCOMING clips (just outside the
    //    play band) into spare pool elements so promotion is an instant adopt
    //    instead of a cold HLS chain. Best-effort + hard-bounded (see PREARM
    //    docs): never evicts a playing card, never exceeds poolMax, skipped on
    //    fast flicks / save-data / when disabled.
    if (PREARM_ENABLED && !this.isScrollFast && !isSlowConnection() && this.assignedIds.size < max) {
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
   * Reveal a (re)assigned pool element only once it actually has a frame to
   * paint. The card's poster <img> sits beneath the pooled <video> (z-index
   * 1 vs 2); revealing the video before its first frame is decoded flashes
   * black over that poster — the "grid card goes black on return from a
   * look/product" bug. If the element already holds a decoded current frame
   * (readyState >= HAVE_CURRENT_DATA) it's shown at once (the seamless
   * scroll-back / resume case); otherwise it stays transparent until
   * `loadeddata`, with `playing` as a backstop. The target-URL guard stops a
   * stale once-listener from a prior assignment revealing a recycled element.
   */
  private revealVideoWhenReady(el: HTMLVideoElement, targetUrl: string, entry?: CardEntry): void {
    // Compare the LOGICAL source (manifest URL for HLS) — under hls.js
    // el.src / el.currentSrc are MSE blobs that never equal targetUrl.
    const matches = () => getVideoSource(el) === targetUrl;
    // HAVE_CURRENT_DATA (2): the current frame is decoded and paintable.
    if (el.readyState >= 2 && matches()) {
      el.style.opacity = '1';
      if (entry) this.unfreezeCard(entry);
      return;
    }
    el.style.opacity = '0';
    const revealT0 = this.now();
    let revealed = false;
    const reveal = (via: 'loadeddata' | 'playing') => {
      if (!matches()) return;
      el.style.opacity = '1';
      if (entry) this.unfreezeCard(entry);
      if (!revealed) {
        revealed = true;
        this.recordReveal(this.now() - revealT0, via);
      }
    };
    el.addEventListener('loadeddata', () => reveal('loadeddata'), { once: true });
    el.addEventListener('playing', () => reveal('playing'), { once: true });
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
    if (entry.posterUrl && el.getAttribute('poster') !== entry.posterUrl) {
      el.setAttribute('poster', entry.posterUrl);
    }
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
          zIndex: '2',
          display: 'block',
          pointerEvents: 'none',
        });
        entry.freezeEl = img;
      }
      img.src = frame;
      // The (re)attached <video> is appended AFTER this img, so once it
      // reveals it paints above; until then the freeze frame covers.
      if (img.parentElement !== entry.slotEl) entry.slotEl.appendChild(img);
    } catch { /* best-effort — poster remains the fallback */ }
  }

  private unfreezeCard(entry: CardEntry): void {
    const img = entry.freezeEl;
    if (!img) return;
    entry.freezeEl = null;
    try { img.remove(); } catch { /* already detached */ }
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

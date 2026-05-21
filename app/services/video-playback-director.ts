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

/** Multiplier on viewport height for the play zone (each side). */
const PLAY_MARGIN_VH_DESKTOP = 1.5;
const PLAY_MARGIN_VH_MOBILE = 1.0;
/** Multiplier on viewport height for the release zone (each side). */
const RELEASE_MARGIN_VH_DESKTOP = 3.0;
const RELEASE_MARGIN_VH_MOBILE = 2.0;
/** Hard ceiling on pooled <video> elements. Tuned to fit ~2.5 viewports of
 *  cards at the densest desktop layout (~6 cols). Scroll-velocity gate
 *  prevents thrashing when this is the binding constraint. */
const POOL_MAX_DESKTOP = 40;
const POOL_MAX_MOBILE = 12;
/** px/s scroll speed above which we skip play() calls (poster only). */
const SCROLL_VELOCITY_THRESHOLD = 2500;
/** ms of scroll-quiet before we re-rank after a fast flick. */
const SCROLL_REST_DELAY_MS = 150;
/** Max play() retries per card before marking it degraded. */
const MAX_RETRIES = 2;

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

// ── Types ──────────────────────────────────────────────────────────────

export type CardStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'degraded';

interface CardEntry {
  getRect: () => DOMRect;
  videoUrl: string;
  posterUrl: string;
  slotEl: HTMLDivElement;
  videoEl: HTMLVideoElement | null;
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

  // Lazy init — safe to import on the server; DOM access only when the
  // first card registers (always in the browser).
  private init() {
    if (this.initialized || typeof document === 'undefined') return;
    this.initialized = true;

    // Off-screen parking area for unassigned pool elements.
    this.parkingDiv = document.createElement('div');
    this.parkingDiv.style.cssText =
      'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;' +
      'visibility:hidden;pointer-events:none;overflow:hidden';
    this.parkingDiv.setAttribute('aria-hidden', 'true');
    document.body.appendChild(this.parkingDiv);

    // Pre-create a small warm pool. The pool grows on demand up to
    // poolMax(); growth past that point is blocked and eviction takes over.
    const initialPool = Math.min(8, poolMax());
    for (let i = 0; i < initialPool; i++) {
      this.pool.push({ el: this.createVideoEl(), assignedTo: null });
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

    // Heartbeat: every 1.5 s, re-rank so any card whose play() failed
    // (degraded or paused after retries) gets another attempt once data
    // has buffered. Critical for search results where videos are cold-cache
    // and play() can be called before bytes arrive.
    setInterval(() => { this.scheduleRank(); }, 1500);
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
      existing.getRect = getRect;
      existing.slotEl = slotEl;
      if (existing.videoUrl !== videoUrl) {
        // URL changed — release current element so rank() re-assigns with new src
        if (existing.videoEl) {
          this.releaseVideoEl(cardId, existing.videoEl);
          existing.videoEl = null;
        }
        existing.videoUrl = videoUrl;
        existing.status = 'idle';
      }
      this.scheduleRank();
      return;
    }
    this.cards.set(cardId, {
      getRect,
      videoUrl,
      posterUrl,
      slotEl,
      videoEl: null,
      retryCount: 0,
      lastFailureAt: 0,
      status: 'idle',
    });
    this.scheduleRank();
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
   * Notify the director that a detail overlay has opened or closed.
   * Open: pause all non-active cards so the detail view isn't fighting
   * for decode budget. Close: re-rank to restore feed playback.
   */
  notifyDetail(action: 'open' | 'close', cardId?: string): void {
    if (action === 'open') {
      for (const [id, entry] of this.cards) {
        if (id !== cardId && entry.videoEl && !entry.videoEl.paused) {
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
    const max = poolMax();

    // Snapshot every card with its current distance. We classify into
    // three bands using hysteresis:
    //   distance <= playMargin     → must play
    //   distance >= releaseMargin  → must release
    //   in between                 → keep current state (don't churn)
    type Ranked = { id: string; entry: CardEntry; distance: number };
    const ranked: Ranked[] = [];
    for (const [id, entry] of this.cards) {
      const rect = entry.getRect();
      // Skip cards that haven't laid out yet (0×0 rect) — happens briefly
      // on mount; the next rank() pass picks them up.
      if (rect.width === 0 && rect.height === 0) continue;
      ranked.push({ id, entry, distance: this.distanceToViewport(rect) });
    }

    // 1. Release: anything past releaseMargin gives its slot back.
    for (const { id, entry, distance } of ranked) {
      if (distance >= releaseMargin && entry.videoEl) {
        this.releaseVideoEl(id, entry.videoEl);
        entry.videoEl = null;
        entry.status = 'idle';
        this.emit(id, 'idle');
      }
    }

    // 2. Determine the desired-playing set. Inside playMargin → wants
    //    playback. Sorted nearest-first so eviction (when pool is full)
    //    favors the closest cards.
    const wantsPlay = ranked
      .filter(r => r.distance <= playMargin)
      .sort((a, b) => a.distance - b.distance);

    for (const { id, entry, distance } of wantsPlay) {
      if (entry.videoEl) {
        // Already assigned — keep it playing. Skip play() during fast flicks
        // (the heartbeat / scroll-rest will pick it back up when quiet).
        if (entry.videoEl.paused && entry.status !== 'loading' && !this.isScrollFast) {
          if (entry.status === 'paused') entry.retryCount = 0;
          this.playEl(id, entry);
        }
        continue;
      }

      // Need a slot. Try free first; if none, grow up to poolMax(); if at
      // cap, evict the most-distant currently-assigned card that is farther
      // than this one.
      let slot = this.pool.find(p => p.assignedTo === null);
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

      // (Re-)configure the element.
      if (slot.el.src !== entry.videoUrl) {
        slot.el.src = entry.videoUrl;
        slot.el.preload = 'auto';
        // Explicitly call load() so the browser starts buffering immediately.
        // Without this, setting src alone may not kick the network request
        // until play() is called, causing play() to pend until data arrives.
        try { slot.el.load(); } catch { /* ignore */ }
      } else {
        // Same src (pool reuse) — make sure preload is still set to auto.
        slot.el.preload = 'auto';
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
      });

      slot.assignedTo = id;
      entry.videoEl = slot.el;
      entry.status = 'loading';

      // Move the element into the card's slot div.
      entry.slotEl.appendChild(slot.el);
      // During a fast flick we still attach + load() so the bytes are warm,
      // but defer the play() call until scroll quiets.
      if (!this.isScrollFast) {
        this.playEl(id, entry);
      }
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

  private releaseVideoEl(cardId: string, el: HTMLVideoElement): void {
    try { el.pause(); } catch { /* ignore */ }
    const slot = this.pool.find(p => p.el === el);
    if (slot) slot.assignedTo = null;
    if (this.parkingDiv) {
      try { this.parkingDiv.appendChild(el); } catch { /* ignore */ }
    }
  }

  private pauseAll(): void {
    for (const [id, entry] of this.cards) {
      if (entry.videoEl && !entry.videoEl.paused) {
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

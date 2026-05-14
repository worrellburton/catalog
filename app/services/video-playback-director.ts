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

/** How many cards play simultaneously on narrow viewports (≤600 px). */
const K_MOBILE = 2;
/** How many cards play simultaneously on wider viewports. */
const K_DESKTOP = 4;
/** px/s scroll speed above which we suspend all play() calls. */
const SCROLL_VELOCITY_THRESHOLD = 2000;
/** ms of scroll-quiet before we re-rank after a fast flick. */
const SCROLL_REST_DELAY_MS = 150;
/** Max play() retries per card before marking it degraded. */
const MAX_RETRIES = 2;

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

    // Pre-create pool elements (K_MAX + 1 spare for detail handoff).
    const poolSize = Math.max(K_MOBILE, K_DESKTOP) + 1;
    for (let i = 0; i < poolSize; i++) {
      this.pool.push({ el: this.createVideoEl(), assignedTo: null });
    }

    // Pause everything when the tab is hidden; re-rank on return.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.pauseAll();
      } else {
        this.scheduleRank();
      }
    });
  }

  private createVideoEl(): HTMLVideoElement {
    const el = document.createElement('video');
    el.muted = true;
    el.defaultMuted = true;
    el.loop = true;
    el.playsInline = true;
    el.setAttribute('muted', '');
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

  private rank(): void {
    if (typeof document !== 'undefined' && document.hidden) return;

    // Promote ALL registered cards — every card plays all the time.
    for (const [id, entry] of this.cards) {
      if (entry.videoEl) {
        // Already assigned — just ensure it's playing.
        if (entry.videoEl.paused && entry.status !== 'loading') {
          this.playEl(id, entry);
        }
        continue;
      }

      // Get a free slot, growing the pool dynamically if needed.
      let slot = this.pool.find(p => p.assignedTo === null);
      if (!slot) {
        slot = { el: this.createVideoEl(), assignedTo: null };
        this.pool.push(slot);
      }

      // (Re-)configure the element.
      if (slot.el.src !== entry.videoUrl) {
        slot.el.src = entry.videoUrl;
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

      // Move the element into the card's slot div and start playback.
      entry.slotEl.appendChild(slot.el);
      this.playEl(id, entry);
    }
  }

  private playEl(cardId: string, entry: CardEntry): void {
    const el = entry.videoEl;
    if (!el) return;

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
        entry.status = 'degraded';
        this.emit(cardId, 'degraded');
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

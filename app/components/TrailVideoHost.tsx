// TrailVideoHost - a single HTMLVideoElement per creative id, owned by the
// app root and shuttled between slots (grid card → overlay hero → trail rail).
//
// Why this exists
// ───────────────
// React's render model normally remounts a <video> when its parent changes
// (e.g. card → ProductPage hero). That tears down the media pipeline: source
// re-fetch, decode reset, first-frame black gap. The only way to keep the
// pixels alive across a layout change is to keep the *DOM element* alive and
// move it with appendChild - browsers preserve currentTime and decoder state
// across appendChild within the same document.
//
// Pattern
// ───────
// 1. Components that want video render a placeholder <div ref={setSlot} />.
// 2. setSlot is a callback ref returned by useTrailVideo(id, src).
// 3. When called, the host creates-or-reuses an element keyed by id and
//    appendChild's it into the slot. The previous slot loses the element
//    automatically (DOM move, not clone).
// 4. When the consumer unmounts, we move the element back to a hidden pool
//    so it's ready if the same id is opened again seconds later.
//
// LRU eviction caps the pool at POOL_MAX live elements so trails of 50+
// don't leak.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';

// Pool cap. We size for "2 viewports of cards stay alive at once" - at
// ~6 cards per mobile viewport that's 12 cards. 32 gives enough headroom
// for search results (up to 48 items per page) so videos beyond row 3
// don't lose their buffered frames. Videos that exit the 2-viewport band
// get returned to the off-screen pool (paused) and only get evicted
// entirely once the cap is exceeded.
const POOL_MAX = 32;

interface TrailVideoManager {
  /** Attach the element for `id` (creating if needed) into `container`.
   *  Returns a cleanup that returns the element to the off-screen pool. */
  attach: (id: string, src: string, container: HTMLElement) => () => void;
}

const TrailVideoContext = createContext<TrailVideoManager | null>(null);

interface PoolEntry {
  el: HTMLVideoElement;
  src: string;
  /** Monotonically incrementing access counter - used for LRU eviction. */
  lastUsed: number;
}

export function TrailVideoHost({ children }: { children: ReactNode }) {
  const poolRef = useRef<HTMLDivElement>(null);
  const elementsRef = useRef<Map<string, PoolEntry>>(new Map());
  const tickRef = useRef(0);

  const evictIfNeeded = useCallback(() => {
    const pool = elementsRef.current;
    if (pool.size <= POOL_MAX) return;
    // Sort by lastUsed ascending; drop until we're back under cap. We only
    // evict elements currently parked in the off-screen pool (still attached
    // to their slot? skip - they're in use).
    const offscreen = poolRef.current;
    if (!offscreen) return;
    const candidates = [...pool.entries()]
      .filter(([, p]) => p.el.parentElement === offscreen)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [id, entry] of candidates) {
      if (pool.size <= POOL_MAX) break;
      try { entry.el.pause(); entry.el.removeAttribute('src'); entry.el.load(); } catch {}
      entry.el.remove();
      pool.delete(id);
    }
  }, []);

  const attach = useCallback((id: string, src: string, container: HTMLElement): (() => void) => {
    const pool = elementsRef.current;
    let entry = pool.get(id);

    if (entry && entry.src !== src) {
      // Same id, new source - replace. Rare (worker re-render of a creative).
      try { entry.el.pause(); } catch {}
      entry.el.src = src;
      entry.src = src;
    }

    if (!entry) {
      const el = document.createElement('video');
      // Set muted BEFORE any other attribute. Chrome's autoplay policy
      // evaluates the muted state at the moment the element is created;
      // setting it later (or after src) can leave the element flagged
      // as unmuted-pending-decode and reject autoplay.
      el.muted = true;
      el.defaultMuted = true;
      el.autoplay = true;
      el.loop = true;
      el.playsInline = true;
      el.setAttribute('muted', '');
      el.setAttribute('autoplay', '');
      el.setAttribute('playsinline', '');
      // 'auto' so the video buffers fully while the card sits in the
      // 2-viewport prep band - by the time the user actually scrolls to
      // it, frames are already decoded and playback starts instantly.
      // Bandwidth-heavy on mobile, but bounded by POOL_MAX (32) so worst
      // case is ~32 buffered videos at any moment.
      el.preload = 'auto';
      el.crossOrigin = 'anonymous';
      el.src = src;
      el.setAttribute('data-trail-id', id);
      el.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      // Fallback retry: when the first frame arrives, attempt play() again.
      // This is the moment Chrome's autoplay heuristic actually evaluates,
      // so a play() called pre-loadeddata that "succeeded" but produced no
      // visible frames will properly start playing here.
      el.addEventListener('loadeddata', () => {
        if (el.paused) void el.play().catch(() => {});
      }, { once: true });
      entry = { el, src, lastUsed: ++tickRef.current };
      pool.set(id, entry);
    }

    const e = entry; // narrow for closure
    e.lastUsed = ++tickRef.current;

    // Move into the slot. appendChild on an already-parented node detaches
    // first - the previous slot loses it automatically without remount.
    container.appendChild(e.el);
    // Resume playback. Errors here are routine on iOS before user gesture.
    // If play() rejects (autoplay policy), nudge currentTime to ~0.5 s so
    // the paused frame isn't frame 0 - for AI-gen videos that's the
    // reference still image, which is indistinguishable from the static
    // product photo and makes the card look frozen. A small seek forward
    // is allowed without a gesture and gives us at least one visibly
    // different frame to display until the user's first gesture lands.
    void e.el.play().catch(() => {
      try {
        if (e.el.paused && e.el.currentTime < 0.05 && e.el.readyState >= 1) {
          e.el.currentTime = 0.5;
        }
      } catch { /* readyState too low or seek not allowed - try again later */ }
    });

    return () => {
      // Park back in the off-screen pool so currentTime survives if the
      // consumer remounts within the trail (e.g. the same card reappears in
      // the next "more like this" rail).
      const offscreen = poolRef.current;
      if (offscreen && e.el.parentElement === container) {
        offscreen.appendChild(e.el);
        try { e.el.pause(); } catch {}
      }
      e.lastUsed = ++tickRef.current;
      evictIfNeeded();
    };
  }, [evictIfNeeded]);

  const manager = useMemo<TrailVideoManager>(() => ({ attach }), [attach]);

  // Visibility + gesture playback recovery. Three sources of frozen-frame
  // bugs we have to handle:
  //   1. Tab hidden → browsers pause every video. We want them paused
  //      while hidden but resumed when the tab returns.
  //   2. iOS / Chrome autoplay policy can reject the initial play() - the
  //      first frame is decoded so the card LOOKS rendered, but it never
  //      animates. The first user gesture (tap, scroll, key) unblocks
  //      autoplay, so we use that as a chance to retry.
  //   3. Network stalls / decoder hiccups can leave a video paused mid-
  //      playback. A 3 s heartbeat re-issues play() on any in-slot video
  //      that's currently paused - cheap insurance.
  //
  // "In-slot" means the video is parented to a real card slot, not the
  // off-screen pool. We only resume those - pool-parked videos should
  // stay paused until they're attached to a slot again.
  useEffect(() => {
    const offscreen = poolRef.current;
    const isInSlot = (el: HTMLVideoElement) =>
      el.parentElement && el.parentElement !== offscreen;

    const resumeInSlot = () => {
      for (const { el } of elementsRef.current.values()) {
        if (!isInSlot(el)) continue;
        if (!el.paused) continue;
        void el.play().catch(() => { /* ignore - next tick will retry */ });
      }
    };
    const pauseAll = () => {
      for (const { el } of elementsRef.current.values()) {
        try { el.pause(); } catch { /* ignore */ }
      }
    };

    const onVisibility = () => {
      if (document.hidden) pauseAll();
      else resumeInSlot();
    };

    // First-gesture unblock for browsers that gate autoplay until the
    // user interacts with the page. Listeners are once: true so we don't
    // burn CPU after the unblock. We include scroll / wheel because the
    // home grid is scroll-driven - a user can land on /catalog.shop,
    // scroll the feed, never click anything, and without these the
    // AI-gen video stays paused at frame 0 (which is the reference
    // still image, indistinguishable from the static product photo).
    const onFirstGesture = () => resumeInSlot();

    // Heartbeat: every 1 s, kick any in-slot video that has stalled. A
    // tighter interval matters most in the first few seconds after the
    // grid mounts - that's when the muted-autoplay flag is being
    // evaluated and a play() retry can flip a paused element into
    // playing without the user touching anything.
    const heartbeat = window.setInterval(resumeInSlot, 1000);

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pointerdown', onFirstGesture, { once: true, passive: true });
    window.addEventListener('touchstart', onFirstGesture, { once: true, passive: true });
    window.addEventListener('keydown',     onFirstGesture, { once: true });
    window.addEventListener('scroll',      onFirstGesture, { once: true, passive: true, capture: true });
    window.addEventListener('wheel',       onFirstGesture, { once: true, passive: true });

    return () => {
      window.clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pointerdown', onFirstGesture);
      window.removeEventListener('touchstart', onFirstGesture);
      window.removeEventListener('keydown', onFirstGesture);
      window.removeEventListener('scroll', onFirstGesture, { capture: true } as EventListenerOptions);
      window.removeEventListener('wheel', onFirstGesture);
    };
  }, []);

  return (
    <TrailVideoContext.Provider value={manager}>
      {children}
      {/* Off-screen pool: zero-size, aria-hidden, but kept in the document so
          attached <video> elements stay alive between consumers. */}
      <div
        ref={poolRef}
        aria-hidden="true"
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          overflow: 'hidden',
          pointerEvents: 'none',
          opacity: 0,
        }}
      />
    </TrailVideoContext.Provider>
  );
}

/** Returns a ref callback; assign to the slot div. */
export function useTrailVideo(id: string | undefined, src: string | undefined) {
  const mgr = useContext(TrailVideoContext);
  const cleanupRef = useRef<(() => void) | null>(null);
  return useCallback((node: HTMLElement | null) => {
    // Tear down any prior attachment when the ref changes or node detaches.
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    if (!mgr || !node || !id || !src) return;
    cleanupRef.current = mgr.attach(id, src, node);
  }, [mgr, id, src]);
}

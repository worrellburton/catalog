// TrailVideoHost — a single HTMLVideoElement per creative id, owned by the
// app root and shuttled between slots (grid card → overlay hero → trail rail).
//
// Why this exists
// ───────────────
// React's render model normally remounts a <video> when its parent changes
// (e.g. card → ProductPage hero). That tears down the media pipeline: source
// re-fetch, decode reset, first-frame black gap. The only way to keep the
// pixels alive across a layout change is to keep the *DOM element* alive and
// move it with appendChild — browsers preserve currentTime and decoder state
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

const POOL_MAX = 16;

interface TrailVideoManager {
  /** Attach the element for `id` (creating if needed) into `container`.
   *  Returns a cleanup that returns the element to the off-screen pool. */
  attach: (id: string, src: string, container: HTMLElement) => () => void;
}

const TrailVideoContext = createContext<TrailVideoManager | null>(null);

interface PoolEntry {
  el: HTMLVideoElement;
  src: string;
  /** Monotonically incrementing access counter — used for LRU eviction. */
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
    // to their slot? skip — they're in use).
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
      // Same id, new source — replace. Rare (worker re-render of a creative).
      try { entry.el.pause(); } catch {}
      entry.el.src = src;
      entry.src = src;
    }

    if (!entry) {
      const el = document.createElement('video');
      el.muted = true;
      el.loop = true;
      el.playsInline = true;
      // 'metadata' over 'auto' so we don't yank bandwidth for cards the user
      // never actually scrolls to. The host's prime step (preload links via
      // primeTrailAssets) covers the above-the-fold cards anyway.
      el.preload = 'metadata';
      el.crossOrigin = 'anonymous';
      el.src = src;
      el.setAttribute('data-trail-id', id);
      el.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      entry = { el, src, lastUsed: ++tickRef.current };
      pool.set(id, entry);
    }

    const e = entry; // narrow for closure
    e.lastUsed = ++tickRef.current;

    // Move into the slot. appendChild on an already-parented node detaches
    // first — the previous slot loses it automatically without remount.
    container.appendChild(e.el);
    // Resume playback. Errors here are routine on iOS before user gesture.
    void e.el.play().catch(() => {});

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

  // Visibility hook: pause everything when the tab hides.
  useEffect(() => {
    const onHide = () => {
      if (document.hidden) {
        for (const { el } of elementsRef.current.values()) {
          try { el.pause(); } catch {}
        }
      }
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
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

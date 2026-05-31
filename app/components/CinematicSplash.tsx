// CinematicSplash — the premium cold-open animation.
//
// Concept: tiny (~5KB) downscaled product/look images from the live
// cached home feed tumble in from 3D space, swirl around the CATALOG
// wordmark, then snap into a grid that matches the feed layout and
// cross-fade away to reveal the live feed underneath ("the splash WAS
// the feed"). ~2.5s, plays on cold open.
//
// Everything is GPU-cheap: CSS transforms on a small (≤24) set of tiny
// images inside a `preserve-3d` stage. No canvas, no WebGL, no per-frame
// JS. Respects prefers-reduced-motion (falls back to a logo fade).

import { useEffect, useMemo, useRef, useState } from 'react';
import CatalogLogo from './CatalogLogo';
import { getCachedHomeFeed } from '~/services/product-creative';
import { withTransform } from '~/utils/supabase-image';

interface CinematicSplashProps {
  /** Total play time before onDone fires (ms). */
  durationMs?: number;
  /** Fired once the animation + exit fade completes. */
  onDone?: () => void;
  /** Preview mode keeps the splash mounted (no onDone auto-exit) and
   *  lets the admin replay it. */
  preview?: boolean;
  /** Replay nonce — bump in preview mode to restart the animation. */
  replayKey?: number;
}

const TILE_COUNT = 24;        // images on the stage
const GRID_COLS = 6;          // landing grid columns
const EXIT_FADE_MS = 420;     // cross-fade to feed at the end

// Pull up to TILE_COUNT distinct image URLs from the cached home feed,
// downscaled hard (≈80px → a few KB each). Falls back to an empty set
// when the cache is cold (first-ever visit) — the logo still plays.
function useSplashImages(): string[] {
  return useMemo(() => {
    const feed = getCachedHomeFeed() ?? [];
    const urls: string[] = [];
    const seen = new Set<string>();
    for (const ad of feed) {
      const raw =
        ad.product?.primary_image_url ||
        ad.thumbnail_url ||
        ad.product?.image_url ||
        (ad.product?.images && ad.product.images[0]) ||
        null;
      if (!raw || seen.has(raw)) continue;
      seen.add(raw);
      // 80px @ q40 cover → ~3–6 KB. No-op for non-Supabase URLs but
      // those are rare in the feed (most go through storage).
      const small = withTransform(raw, { width: 80, quality: 40, resize: 'cover' }) || raw;
      urls.push(small);
      if (urls.length >= TILE_COUNT) break;
    }
    return urls;
  }, []);
}

// Deterministic pseudo-random so each tile's start position is stable
// across re-renders within a single play.
function seeded(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x); // 0..1
}

interface TilePlacement {
  url: string;
  // start (scattered in 3D)
  sx: number; sy: number; sz: number; srot: number;
  // landing grid cell (percent of stage)
  gx: number; gy: number;
  delay: number;
}

function placeTiles(urls: string[]): TilePlacement[] {
  const rows = Math.ceil(urls.length / GRID_COLS);
  return urls.map((url, i) => {
    const col = i % GRID_COLS;
    const row = Math.floor(i / GRID_COLS);
    // Landing position centered as a grid, expressed in vw/vh-ish percent.
    const gx = ((col + 0.5) / GRID_COLS) * 100;
    const gy = ((row + 0.5) / rows) * 100;
    // Scatter: random ring around center, pushed back in Z.
    const ang = seeded(i, 1) * Math.PI * 2;
    const dist = 60 + seeded(i, 2) * 60;            // % from center
    const sx = 50 + Math.cos(ang) * dist;
    const sy = 50 + Math.sin(ang) * dist;
    const sz = -400 - seeded(i, 3) * 700;           // px, behind the screen
    const srot = (seeded(i, 4) - 0.5) * 160;        // deg
    const delay = seeded(i, 5) * 280;               // ms stagger
    return { url, sx, sy, sz, srot, gx, gy, delay };
  });
}

export default function CinematicSplash({ durationMs = 2500, onDone, preview = false, replayKey = 0 }: CinematicSplashProps) {
  const images = useSplashImages();
  const tiles = useMemo(() => placeTiles(images), [images]);
  const [phase, setPhase] = useState<'assemble' | 'reveal' | 'exit'>('assemble');
  const doneRef = useRef(false);

  const reduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    doneRef.current = false;
    setPhase('assemble');
    // Phase timing: assemble (cascade in) → reveal (logo crisp, tiles
    // settled) → exit (cross-fade). Reveal starts ~55% through, exit
    // near the end.
    const revealAt = Math.max(700, durationMs * 0.55);
    const exitAt = Math.max(revealAt + 300, durationMs - EXIT_FADE_MS);
    const t1 = window.setTimeout(() => setPhase('reveal'), revealAt);
    const t2 = window.setTimeout(() => setPhase('exit'), exitAt);
    const t3 = window.setTimeout(() => {
      if (preview || doneRef.current) return;
      doneRef.current = true;
      onDone?.();
    }, durationMs + EXIT_FADE_MS);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); window.clearTimeout(t3); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationMs, replayKey]);

  // Reduced-motion / cold-cache fallback: simple logo fade.
  if (reduced || tiles.length === 0) {
    return (
      <div className={`cinematic-splash cs-simple ${phase === 'exit' ? 'cs-exit' : ''}`} aria-hidden="true">
        <CatalogLogo className="cs-logo" />
      </div>
    );
  }

  return (
    <div
      className={`cinematic-splash ${phase === 'exit' ? 'cs-exit' : ''}`}
      data-phase={phase}
      aria-hidden="true"
    >
      <div className="cs-stage">
        {tiles.map((t, i) => (
          <div
            key={`${t.url}-${i}-${replayKey}`}
            className="cs-tile"
            style={{
              // CSS custom props drive the keyframes (start → grid).
              ['--sx' as string]: `${t.sx}%`,
              ['--sy' as string]: `${t.sy}%`,
              ['--sz' as string]: `${t.sz}px`,
              ['--srot' as string]: `${t.srot}deg`,
              ['--gx' as string]: `${t.gx}%`,
              ['--gy' as string]: `${t.gy}%`,
              animationDelay: `${t.delay}ms`,
            } as React.CSSProperties}
          >
            <img src={t.url} alt="" loading="eager" decoding="async" draggable={false} />
          </div>
        ))}
      </div>

      <div className={`cs-logo-wrap ${phase !== 'assemble' ? 'cs-logo-in' : ''}`}>
        <CatalogLogo className="cs-logo" />
      </div>

      <div className="cs-vignette" />
    </div>
  );
}

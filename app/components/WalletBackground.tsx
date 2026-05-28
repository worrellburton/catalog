import { useEffect, useRef, memo } from 'react';

/**
 * Wallet background — a layered wave field that tells a calm
 * "flow of value" story. Smooth sine curves stream across the
 * viewport at varying frequencies, amplitudes, and depths; bright
 * highlights travel along the crests like droplets being carried
 * on the surface. Scroll lifts the amplitudes + highlight rate,
 * so the field is calm on land and lively as the reader descends.
 *
 * Story arc (mapped to scroll progress 0..1, compressed so the
 * short Wallet page reaches saturation by ~25% scroll):
 *   0.00 — calm tide. Low amplitude, a few highlights drifting.
 *   0.55 — choppy. Wavelengths shorten, peaks rise.
 *   1.00 — alive. Full amplitude; highlight rate peaks; gold
 *           accents thread through the green crests.
 *
 * Events (window-scoped):
 *   wallet:burst  — fires a circular shockwave from the cursor,
 *                   temporarily lifting nearby wave amplitudes.
 *   wallet:payout — paints a 3.2s gold tidal sweep along the
 *                   bottom of the viewport.
 *
 * Rendering: pure 2D canvas, stroked paths with linear gradients.
 * No WebGL shader complexity, no extra deps. Mobile downscale +
 * prefers-reduced-motion honored.
 */

interface WalletBackgroundProps {
  /** Scroll container whose scrollTop drives the story arc. When
   *  omitted, the field plays at its calm-tide default state. */
  scrollEl?: HTMLElement | null;
}

interface Wave {
  /** Base vertical position as a fraction of canvas height (0..1). */
  baseY: number;
  /** Amplitude in px at scroll=0; scaled up by the story arc. */
  amplitude: number;
  /** Distance in px between crests. */
  wavelength: number;
  /** Phase shift per second (px). Sign drives direction. */
  speed: number;
  /** Current phase offset in radians. */
  phase: number;
  hue: 'green' | 'gold' | 'slate';
  /** 0 (back, soft + thin) → 1 (front, prominent). Drives stroke
   *  thickness, opacity, and parallax. */
  depth: number;
  thickness: number;
}

interface Highlight {
  /** Which wave the droplet rides along. */
  waveIdx: number;
  /** 0..1 position across the viewport width. */
  t: number;
  /** Per-second progression. */
  speed: number;
  color: 'green' | 'gold';
}

interface Shockwave {
  x: number;
  y: number;
  startedAt: number;
}

interface PayoutSweep {
  startedAt: number;
}

const WAVE_COUNT_DESKTOP = 14;
const WAVE_COUNT_MOBILE  = 8;
const HIGHLIGHT_TARGET_PER_SEC = 4;

function makeWaves(count: number, w: number): Wave[] {
  const waves: Wave[] = [];
  for (let i = 0; i < count; i++) {
    const depth = Math.random();
    // Distribute waves down the viewport with a touch of jitter so
    // the bands don't read as rigid horizontal stripes.
    const slot = (i + 0.5) / count;
    const baseY = slot + (Math.random() - 0.5) * 0.04;
    const r = Math.random();
    let hue: Wave['hue'];
    if (r < 0.62)      hue = 'green';
    else if (r < 0.78) hue = 'gold';
    else               hue = 'slate';
    waves.push({
      baseY,
      amplitude: 18 + Math.random() * 48 * (0.55 + depth * 0.6),
      wavelength: 200 + Math.random() * 400,
      // Mostly leftward drift but a few right-going waves so the
      // field doesn't read as a single conveyor belt.
      speed: (Math.random() < 0.7 ? -1 : 1) * (24 + Math.random() * 70),
      phase: Math.random() * Math.PI * 2,
      hue,
      depth,
      thickness: 0.6 + depth * 1.9,
    });
  }
  // Reference w so the unused-arg linter stays quiet; future
  // initializers may want viewport-derived wavelength scaling.
  void w;
  return waves;
}

const HUE_RGB: Record<Wave['hue'], string> = {
  green: '22, 163, 74',
  gold:  '202, 138, 4',
  slate: '100, 116, 139',
};

const WalletBackground = memo(function WalletBackground({ scrollEl }: WalletBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvasInit = canvasRef.current;
    if (!canvasInit) return;
    const ctxInit = canvasInit.getContext('2d', { alpha: true });
    if (!ctxInit) return;
    const canvas: HTMLCanvasElement = canvasInit;
    const ctx: CanvasRenderingContext2D = ctxInit;

    const reduceMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const isMobile = typeof window !== 'undefined'
      && window.matchMedia?.('(max-width: 768px)').matches;
    const waveCount = reduceMotion ? 5 : (isMobile ? WAVE_COUNT_MOBILE : WAVE_COUNT_DESKTOP);

    const state = {
      waves: [] as Wave[],
      highlights: [] as Highlight[],
      shockwaves: [] as Shockwave[],
      payoutSweep: null as PayoutSweep | null,
      width: 0,
      height: 0,
      dpr: 1,
      lastTime: performance.now(),
      scrollTarget: 0,
      scroll: 0,
      highlightSpawnAccumulator: 0,
    };

    function resize() {
      state.dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      state.width = rect.width;
      state.height = rect.height;
      canvas.width = Math.floor(rect.width * state.dpr);
      canvas.height = Math.floor(rect.height * state.dpr);
      ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      if (state.waves.length === 0) {
        state.waves = makeWaves(waveCount, state.width);
      }
    }
    resize();
    window.addEventListener('resize', resize);

    function updateScroll() {
      const el = scrollEl;
      if (!el) { state.scrollTarget = 0; return; }
      const max = Math.max(1, el.scrollHeight - el.clientHeight);
      state.scrollTarget = Math.min(1, Math.max(0, el.scrollTop / max));
    }
    if (scrollEl) {
      scrollEl.addEventListener('scroll', updateScroll, { passive: true });
      updateScroll();
    }

    function onBurst(e: Event) {
      const detail = (e as CustomEvent).detail as { x?: number; y?: number } | undefined;
      const x = detail?.x ?? state.width / 2;
      const y = detail?.y ?? state.height / 2;
      state.shockwaves.push({ x, y, startedAt: performance.now() });
    }
    function onPayout() {
      state.payoutSweep = { startedAt: performance.now() };
    }
    window.addEventListener('wallet:burst',  onBurst);
    window.addEventListener('wallet:payout', onPayout);

    function easeInOut(t: number): number {
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }

    /** y at x on a given wave, including the additive lift from any
     *  active shockwaves passing through that point. */
    function sampleWaveY(wave: Wave, x: number, now: number, ampMul: number, H: number): number {
      const base = wave.baseY * H;
      let amp = wave.amplitude * ampMul;
      // Shockwave: a propagating gaussian ring boosts amplitude where
      // its radius matches the distance from origin.
      for (const sw of state.shockwaves) {
        const dt = (now - sw.startedAt) / 1000;
        const r = dt * 360; // ring radius in px/sec
        const distance = Math.hypot(x - sw.x, base - sw.y);
        const sigma = 60;
        const ring = Math.exp(-Math.pow(distance - r, 2) / (2 * sigma * sigma));
        amp += 38 * ring * Math.max(0, 1 - dt / 1.4);
      }
      return base + amp * Math.sin((x / wave.wavelength) * Math.PI * 2 + wave.phase);
    }

    function draw(now: number) {
      const dt = Math.min(48, now - state.lastTime);
      state.lastTime = now;
      const dtSec    = dt / 1000;
      const dtFrames = dt / 16.67;

      // Compress the scroll mapping: the wallet rarely scrolls far,
      // so reach the saturated end of the story by ~25% scroll.
      state.scroll += (state.scrollTarget - state.scroll) * Math.min(0.18, 0.08 * dtFrames);
      const compressed = Math.min(1, state.scroll / 0.25);
      const eased      = easeInOut(compressed);

      const { width: W, height: H, waves, highlights } = state;

      // White base + subtle warm-ivory wash at the bottom so the
      // page never feels sterile.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
      const wash = ctx.createLinearGradient(0, 0, 0, H);
      wash.addColorStop(0, 'rgba(248, 250, 252, 0)');
      wash.addColorStop(1, 'rgba(240, 253, 244, 0.55)');
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, W, H);

      // Step wave phases.
      for (const wave of waves) {
        wave.phase += (wave.speed / wave.wavelength) * Math.PI * 2 * dtSec;
      }

      // Reap shockwaves once past their lifetime.
      for (let i = state.shockwaves.length - 1; i >= 0; i--) {
        if ((now - state.shockwaves[i].startedAt) / 1000 > 1.6) {
          state.shockwaves.splice(i, 1);
        }
      }

      // Amplitude multiplier ramps with the story. Calm baseline so
      // the field reads alive even at scroll=0 (the Wallet page
      // rarely scrolls far enough to reach 1.0 cleanly).
      const ampMul = 0.95 + 0.45 * eased;

      // Draw waves back-to-front by depth so the prominent ones
      // overlap the soft back layer correctly.
      const ordered = waves.slice().sort((a, b) => a.depth - b.depth);
      for (const wave of ordered) {
        const baseAlpha = (0.18 + 0.42 * wave.depth) * (0.7 + 0.35 * eased);
        // Sample finely so the curve is smooth.
        const sampleStep = 6;
        ctx.beginPath();
        for (let px = -30; px <= W + 30; px += sampleStep) {
          const y = sampleWaveY(wave, px, now, ampMul, H);
          if (px === -30) ctx.moveTo(px, y);
          else            ctx.lineTo(px, y);
        }
        // Edge-fading gradient so waves appear to "stream in from"
        // off-canvas rather than starting abruptly.
        const grad = ctx.createLinearGradient(0, 0, W, 0);
        grad.addColorStop(0,    `rgba(${HUE_RGB[wave.hue]}, 0)`);
        grad.addColorStop(0.18, `rgba(${HUE_RGB[wave.hue]}, ${baseAlpha * 0.9})`);
        grad.addColorStop(0.82, `rgba(${HUE_RGB[wave.hue]}, ${baseAlpha * 0.9})`);
        grad.addColorStop(1,    `rgba(${HUE_RGB[wave.hue]}, 0)`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = wave.thickness;
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      // Spawn highlights — droplets that ride the wave crests.
      // Frame-rate-independent reservoir; higher rate as the story
      // advances. Cap to keep the stack predictable.
      const ratePerSec = HIGHLIGHT_TARGET_PER_SEC * (0.8 + 1.4 * eased);
      state.highlightSpawnAccumulator += ratePerSec * dtSec;
      while (state.highlightSpawnAccumulator >= 1 && highlights.length < 24) {
        state.highlightSpawnAccumulator -= 1;
        const waveIdx = Math.floor(Math.random() * waves.length);
        const wave = waves[waveIdx];
        highlights.push({
          waveIdx,
          t: 0,
          speed: 0.05 + Math.random() * 0.18,
          // Most droplets adopt the wave's value tint; a sprinkle of
          // gold keeps premium / payout vibe alive even on calm
          // green segments.
          color: wave.hue === 'gold' || Math.random() < 0.22 ? 'gold' : 'green',
        });
      }

      // Step + draw highlights.
      for (let i = highlights.length - 1; i >= 0; i--) {
        const h = highlights[i];
        h.t += h.speed * dtSec;
        const wave = waves[h.waveIdx];
        if (!wave || h.t >= 1) {
          highlights.splice(i, 1);
          continue;
        }
        const x = h.t * W;
        const y = sampleWaveY(wave, x, now, ampMul, H);
        const rgb = h.color === 'green' ? '74, 222, 128' : '253, 224, 71';
        // Glow halo + white-hot core. Halo shrinks at the t≈0 and
        // t≈1 boundaries so droplets fade in/out at viewport edges.
        const edgeFade = Math.min(1, h.t * 6, (1 - h.t) * 6);
        const glowR = 14 * edgeFade + 4;
        const halo = ctx.createRadialGradient(x, y, 0, x, y, glowR);
        halo.addColorStop(0,    `rgba(${rgb}, ${0.85 * edgeFade})`);
        halo.addColorStop(0.45, `rgba(${rgb}, ${0.3  * edgeFade})`);
        halo.addColorStop(1,    `rgba(${rgb}, 0)`);
        ctx.fillStyle = halo;
        ctx.fillRect(x - glowR, y - glowR, glowR * 2, glowR * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${0.95 * edgeFade})`;
        ctx.beginPath();
        ctx.arc(x, y, 2.4 * edgeFade + 0.4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Payout gold tidal sweep — paints over the bottom of the
      // viewport for ~3.2s after wallet:payout fires.
      if (state.payoutSweep) {
        const elapsed = now - state.payoutSweep.startedAt;
        const duration = 3200;
        if (elapsed >= duration) {
          state.payoutSweep = null;
        } else {
          const t = elapsed / duration;
          const env = t < 0.12 ? t / 0.12
                     : t > 0.78 ? Math.max(0, (1 - t) / 0.22)
                     : 1;
          const ribbonY = H - 36;
          const ribbonH = 28;
          const headX = -160 + (W + 320) * easeInOut(t);
          const baseAlpha = 0.18 * env;
          ctx.fillStyle = `rgba(253, 224, 71, ${baseAlpha})`;
          ctx.fillRect(0, ribbonY, W, ribbonH);
          const sheenGrad = ctx.createLinearGradient(headX - 240, 0, headX + 80, 0);
          sheenGrad.addColorStop(0,    'rgba(253, 224, 71, 0)');
          sheenGrad.addColorStop(0.55, `rgba(253, 224, 71, ${0.55 * env})`);
          sheenGrad.addColorStop(0.85, `rgba(255, 247, 200, ${0.95 * env})`);
          sheenGrad.addColorStop(1,    `rgba(253, 224, 71, 0)`);
          ctx.fillStyle = sheenGrad;
          ctx.fillRect(headX - 240, ribbonY - 6, 320, ribbonH + 12);
          const edgeGrad = ctx.createLinearGradient(0, ribbonY - 14, 0, ribbonY + ribbonH);
          edgeGrad.addColorStop(0, 'rgba(253, 224, 71, 0)');
          edgeGrad.addColorStop(1, `rgba(253, 224, 71, ${0.22 * env})`);
          ctx.fillStyle = edgeGrad;
          ctx.fillRect(0, ribbonY - 14, W, ribbonH + 14);
        }
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
      window.removeEventListener('wallet:burst', onBurst);
      window.removeEventListener('wallet:payout', onPayout);
      if (scrollEl) scrollEl.removeEventListener('scroll', updateScroll);
    };
  }, [scrollEl]);

  return <canvas ref={canvasRef} className="wallet-bg-canvas" aria-hidden />;
});

export default WalletBackground;

import { useEffect, useRef, memo } from 'react';

/**
 * Wallet background — a generative particle network that tells a
 * "flow of value" story. Nodes drift in space, distance-based
 * connections fade in/out, and bright pulses travel along the
 * connections to literally render transactions moving through the
 * network. Wired to the wallet overlay's scroll position so the
 * network intensifies as the reader descends the page.
 *
 * Story arc (mapped to scrollProgress 0..1):
 *   0.00 — quiet potential. A handful of dim nodes drifting; few
 *           connections. "Your storefront exists."
 *   0.35 — connections kick in. Distance threshold widens, edge
 *           opacity rises. "People are finding you."
 *   0.65 — pulses begin to fire. Transactions flow along edges.
 *           "Money is moving."
 *   1.00 — saturation. The network is alive — dense pulses, brighter
 *           hubs, slow camera drift via depth-based parallax.
 *
 * Rendering: pure 2D canvas, additive blending, capped DPR. No
 * WebGL shader complexity — keeps the bundle tiny and the perf
 * predictable. Reduces particle count on phones and respects
 * `prefers-reduced-motion`.
 */

interface WalletBackgroundProps {
  /** Scroll container whose scrollTop drives the story arc. When
   *  omitted, the animation plays at its sparse default state. */
  scrollEl?: HTMLElement | null;
}

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 0 (back, slow + small) → 1 (front, fast + big). Drives
   *  parallax depth and visual prominence. */
  depth: number;
  radius: number;
  hue: 'green' | 'slate';
  pulsePhase: number;
}

interface Pulse {
  fromIdx: number;
  toIdx: number;
  /** 0..1 progress along the edge. */
  t: number;
  speed: number;
  color: 'green' | 'gold';
}

/** Free-flying particle spawned by the Withdraw-burst event. Not
 *  tied to any node — fans outward from an origin until its life
 *  expires. */
interface BurstParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 0..1, drops to 0 over time. Drives alpha + radius. */
  life: number;
  color: 'green' | 'gold';
}

/** Gold horizontal sweep that paints along the bottom of the
 *  viewport whenever a payout posts. One active at a time —
 *  re-triggering restarts the timer. */
interface PayoutRibbon {
  startedAt: number;
}

const NODE_COUNT_DESKTOP = 110;
const NODE_COUNT_MOBILE = 55;
const CONNECTION_BASE_PX = 130;
const PULSE_TARGET_PER_SEC = 6;
const GREEN_NODE_RATIO = 0.22;
const PARALLAX_PX = 90;

function makeNodes(count: number, w: number, h: number): Node[] {
  const nodes: Node[] = [];
  for (let i = 0; i < count; i++) {
    const depth = Math.random();
    nodes.push({
      x: Math.random() * w,
      y: Math.random() * h,
      // Front nodes (high depth) drift faster — gives the network
      // visible motion without making the back layer chaotic.
      vx: (Math.random() - 0.5) * (0.08 + depth * 0.18),
      vy: (Math.random() - 0.5) * (0.08 + depth * 0.18),
      depth,
      radius: 1 + depth * 2.8,
      hue: Math.random() < GREEN_NODE_RATIO ? 'green' : 'slate',
      pulsePhase: Math.random() * Math.PI * 2,
    });
  }
  return nodes;
}

const WalletBackground = memo(function WalletBackground({ scrollEl }: WalletBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvasInit = canvasRef.current;
    if (!canvasInit) return;
    const ctxInit = canvasInit.getContext('2d', { alpha: true });
    if (!ctxInit) return;
    // Capture into non-null locals so the inner draw / resize
    // closures don't have to keep re-narrowing across the IIFE.
    const canvas: HTMLCanvasElement = canvasInit;
    const ctx: CanvasRenderingContext2D = ctxInit;

    const reduceMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const isMobile = typeof window !== 'undefined'
      && window.matchMedia?.('(max-width: 768px)').matches;
    const nodeCount = reduceMotion
      ? 30
      : (isMobile ? NODE_COUNT_MOBILE : NODE_COUNT_DESKTOP);

    const state = {
      nodes: [] as Node[],
      pulses: [] as Pulse[],
      bursts: [] as BurstParticle[],
      ribbon: null as PayoutRibbon | null,
      width: 0,
      height: 0,
      dpr: 1,
      lastTime: performance.now(),
      // The target is what the scroll handler writes; current eases
      // toward it every frame so scroll-jacks are smooth.
      scrollTarget: 0,
      scroll: 0,
      // Reservoir for fractional pulse spawns so the spawn rate is
      // independent of frame timing.
      pulseSpawnAccumulator: 0,
    };

    // ── Event bus ─────────────────────────────────────────────────────
    // Listen for window-scoped events so any surface (CreatorWallet
    // CTA, future earnings ledger ping, etc.) can trigger visual
    // celebrations without holding a ref to this canvas.
    function spawnBurst(originX: number, originY: number) {
      const count = reduceMotion ? 12 : 36;
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + Math.random() * 0.3;
        const speed = 1.8 + Math.random() * 3.6;
        state.bursts.push({
          x: originX,
          y: originY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1,
          color: Math.random() < 0.7 ? 'green' : 'gold',
        });
      }
    }
    function onBurst(e: Event) {
      const detail = (e as CustomEvent).detail as { x?: number; y?: number } | undefined;
      const x = detail?.x ?? state.width / 2;
      const y = detail?.y ?? state.height / 2;
      spawnBurst(x, y);
    }
    function onPayout() {
      state.ribbon = { startedAt: performance.now() };
    }
    window.addEventListener('wallet:burst',  onBurst);
    window.addEventListener('wallet:payout', onPayout);

    function resize() {
      state.dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      state.width = rect.width;
      state.height = rect.height;
      canvas.width = Math.floor(rect.width * state.dpr);
      canvas.height = Math.floor(rect.height * state.dpr);
      ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      if (state.nodes.length === 0) {
        state.nodes = makeNodes(nodeCount, state.width, state.height);
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

    function easeInOut(t: number): number {
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }

    function draw(now: number) {
      const dt = Math.min(48, now - state.lastTime); // ms; clamp for tab-blur catch-up
      state.lastTime = now;
      const dtFrames = dt / 16.67; // normalize to 60fps frame units

      // Ease the scroll progress toward its target — smooths out
      // momentum-scroll fits and gives the depth shift a sense of
      // weight. We then compress the scroll range: the Wallet screen
      // is short enough that most users barely scroll, so map the
      // first 25% of scroll to the full story arc — past that the
      // network is already saturated.
      state.scroll += (state.scrollTarget - state.scroll) * Math.min(0.18, 0.08 * dtFrames);
      const compressed = Math.min(1, state.scroll / 0.25);
      const eased     = easeInOut(compressed);

      const { width: W, height: H, nodes, pulses } = state;

      // Background — bright white at top, faintly warmer ivory at
      // the bottom of the viewport so the long scroll never feels
      // sterile.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, 'rgba(248, 250, 252, 0)');
      grad.addColorStop(1, 'rgba(240, 253, 244, 0.55)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      // Parallax — back-layer barely moves; front-layer shifts up
      // as you scroll. Visualises descending into the network.
      const parallax = eased * PARALLAX_PX;

      // Step nodes.
      for (const n of nodes) {
        n.x += n.vx * dtFrames;
        n.y += n.vy * dtFrames;
        n.pulsePhase += 0.035 * dtFrames;
        if (n.x < -25) n.x = W + 25;
        if (n.x > W + 25) n.x = -25;
        if (n.y < -25) n.y = H + 25;
        if (n.y > H + 25) n.y = -25;
      }

      // Connections. Baseline already feels rich at scroll=0 (the
      // short Wallet page rarely scrolls far); the scroll ramp adds
      // a top-end intensity rather than waking the network up from
      // sleep.
      const threshold = CONNECTION_BASE_PX * (1.05 + 0.25 * eased);
      const thresholdSq = threshold * threshold;
      const connBaseAlpha = 0.18 + 0.12 * eased;
      ctx.lineWidth = 1;
      ctx.lineCap = 'round';
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        const ay = a.y - parallax * a.depth;
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const by = b.y - parallax * b.depth;
          const dx = a.x - b.x;
          const dy = ay - by;
          const distSq = dx * dx + dy * dy;
          if (distSq > thresholdSq) continue;
          const dist = Math.sqrt(distSq);
          const falloff = 1 - dist / threshold;
          const alpha = falloff * falloff * connBaseAlpha;
          // Green tint when at least one endpoint is a green hub;
          // otherwise neutral slate so the network reads as mostly
          // ambient with green "value" highlights.
          if (a.hue === 'green' || b.hue === 'green') {
            ctx.strokeStyle = `rgba(22, 163, 74, ${alpha * 1.4})`;
          } else {
            ctx.strokeStyle = `rgba(100, 116, 139, ${alpha})`;
          }
          ctx.beginPath();
          ctx.moveTo(a.x, ay);
          ctx.lineTo(b.x, by);
          ctx.stroke();
        }
      }

      // Nodes — soft halos via radial gradient + crisp core.
      for (const n of nodes) {
        const y = n.y - parallax * n.depth;
        const breathing = 1 + 0.18 * Math.sin(n.pulsePhase);
        const r = n.radius * breathing;
        const isGreen = n.hue === 'green';
        const rgb = isGreen ? '22, 163, 74' : '100, 116, 139';
        const promScroll = isGreen ? (0.85 + 0.25 * eased) : 1;
        const baseAlpha = (0.22 + 0.42 * n.depth) * promScroll;

        const glowR = r * (isGreen ? 7 : 3.5);
        const halo = ctx.createRadialGradient(n.x, y, 0, n.x, y, glowR);
        halo.addColorStop(0, `rgba(${rgb}, ${baseAlpha * 0.55})`);
        halo.addColorStop(1, `rgba(${rgb}, 0)`);
        ctx.fillStyle = halo;
        ctx.fillRect(n.x - glowR, y - glowR, glowR * 2, glowR * 2);

        ctx.fillStyle = `rgba(${rgb}, ${Math.min(1, baseAlpha + 0.22)})`;
        ctx.beginPath();
        ctx.arc(n.x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Spawn pulses. Healthy baseline so the network reads as
      // "transactions are flowing" from the first frame; the scroll
      // ramp pushes it toward saturation as the user descends.
      const ratePerSec = PULSE_TARGET_PER_SEC * (0.85 + 0.65 * eased);
      state.pulseSpawnAccumulator += (ratePerSec * dt) / 1000;
      while (state.pulseSpawnAccumulator >= 1 && pulses.length < 60) {
        state.pulseSpawnAccumulator -= 1;
        const fromIdx = Math.floor(Math.random() * nodes.length);
        const a = nodes[fromIdx];
        let bestIdx = -1;
        let bestD = thresholdSq * 1.4;
        for (let j = 0; j < nodes.length; j++) {
          if (j === fromIdx) continue;
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d = dx * dx + dy * dy;
          if (d < bestD) { bestD = d; bestIdx = j; }
        }
        if (bestIdx >= 0) {
          pulses.push({
            fromIdx,
            toIdx: bestIdx,
            t: 0,
            speed: 0.0055 + Math.random() * 0.014,
            // Mostly green (value); occasional gold (premium /
            // payout) for visual variety.
            color: Math.random() < 0.74 ? 'green' : 'gold',
          });
        }
      }

      // Step + draw pulses.
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        p.t += p.speed * dtFrames;
        const a = nodes[p.fromIdx];
        const b = nodes[p.toIdx];
        if (!a || !b || p.t >= 1) {
          pulses.splice(i, 1);
          continue;
        }
        const ay = a.y - parallax * a.depth;
        const by = b.y - parallax * b.depth;
        const x = a.x + (b.x - a.x) * p.t;
        const y = ay + (by - ay) * p.t;
        const rgb = p.color === 'green' ? '74, 222, 128' : '253, 224, 71';
        const trailLen = Math.min(0.18, p.t);
        const tx = a.x + (b.x - a.x) * (p.t - trailLen);
        const ty = ay + (by - ay) * (p.t - trailLen);

        // Trail.
        const trailGrad = ctx.createLinearGradient(tx, ty, x, y);
        trailGrad.addColorStop(0, `rgba(${rgb}, 0)`);
        trailGrad.addColorStop(1, `rgba(${rgb}, 0.65)`);
        ctx.strokeStyle = trailGrad;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(x, y);
        ctx.stroke();

        // Head halo + white-hot core.
        const glowR = 16;
        const halo = ctx.createRadialGradient(x, y, 0, x, y, glowR);
        halo.addColorStop(0,    `rgba(${rgb}, 0.9)`);
        halo.addColorStop(0.45, `rgba(${rgb}, 0.32)`);
        halo.addColorStop(1,    `rgba(${rgb}, 0)`);
        ctx.fillStyle = halo;
        ctx.fillRect(x - glowR, y - glowR, glowR * 2, glowR * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.beginPath();
        ctx.arc(x, y, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── Burst particles (Withdraw CTA fanout) ────────────────────
      // Free-flying particles, not tied to any node. Decay via life
      // so the burst feels like an explosion that diffuses into the
      // ambient network rather than a hard cut.
      for (let i = state.bursts.length - 1; i >= 0; i--) {
        const p = state.bursts[i];
        p.x += p.vx * dtFrames;
        p.y += p.vy * dtFrames;
        // Slight drag so particles slow as they expand.
        p.vx *= Math.pow(0.96, dtFrames);
        p.vy *= Math.pow(0.96, dtFrames);
        p.life -= 0.018 * dtFrames;
        if (p.life <= 0) { state.bursts.splice(i, 1); continue; }
        const rgb = p.color === 'green' ? '74, 222, 128' : '253, 224, 71';
        const lifeAlpha = p.life;
        const glowR = 14 * lifeAlpha + 4;
        const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
        halo.addColorStop(0,    `rgba(${rgb}, ${0.85 * lifeAlpha})`);
        halo.addColorStop(0.45, `rgba(${rgb}, ${0.3  * lifeAlpha})`);
        halo.addColorStop(1,    `rgba(${rgb}, 0)`);
        ctx.fillStyle = halo;
        ctx.fillRect(p.x - glowR, p.y - glowR, glowR * 2, glowR * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${0.9 * lifeAlpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2 * lifeAlpha + 0.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── Payout ribbon ────────────────────────────────────────────
      // A 3-second horizontal gold sweep along the bottom edge that
      // marks a posted payout. Drawn last so it floats above the
      // network. Fades in/out via a sine envelope.
      if (state.ribbon) {
        const elapsed = now - state.ribbon.startedAt;
        const duration = 3200;
        if (elapsed >= duration) {
          state.ribbon = null;
        } else {
          const t = elapsed / duration;
          // Envelope: ease in over 12%, hold, ease out over last 22%.
          const env = t < 0.12
            ? t / 0.12
            : t > 0.78
              ? Math.max(0, (1 - t) / 0.22)
              : 1;
          const ribbonY = H - 36;
          const ribbonH = 28;
          // The "comet head" travels left → right; the trail behind
          // it lingers so the eye reads "money landed".
          const headX = -160 + (W + 320) * easeInOut(t);
          // Base bar.
          const baseAlpha = 0.18 * env;
          ctx.fillStyle = `rgba(253, 224, 71, ${baseAlpha})`;
          ctx.fillRect(0, ribbonY, W, ribbonH);
          // Sheen sweep.
          const sheenGrad = ctx.createLinearGradient(headX - 240, 0, headX + 80, 0);
          sheenGrad.addColorStop(0,    'rgba(253, 224, 71, 0)');
          sheenGrad.addColorStop(0.55, `rgba(253, 224, 71, ${0.55 * env})`);
          sheenGrad.addColorStop(0.85, `rgba(255, 247, 200, ${0.95 * env})`);
          sheenGrad.addColorStop(1,    `rgba(253, 224, 71, 0)`);
          ctx.fillStyle = sheenGrad;
          ctx.fillRect(headX - 240, ribbonY - 6, 320, ribbonH + 12);
          // Soft top edge — implies the ribbon is a stream of light,
          // not a flat block.
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

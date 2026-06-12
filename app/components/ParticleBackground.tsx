import { useEffect, useRef } from 'react';
import { particleControls } from '~/services/particles';

// Vanilla WebGL particle drift - no dependencies. Renders a soft cloud of
// glowing points with additive blending and slow noise-driven motion. Sized
// so it reads as ambient texture, not a focal effect. Auto-pauses when the
// tab is hidden and honours prefers-reduced-motion (renders one static frame).
//
// Speed is read every frame from `particleControls.speed` (singleton config
// in services/particles.ts). The site mounts one of these at the app root
// so splash → landing → search ceremony all share ONE continuous canvas —
// dial the speed up/down to retune the visible field without remounting.

interface ParticleBackgroundProps {
  /** Multiplier on each particle's drift speed at mount time. Useful for
   *  one-off, non-singleton mounts (e.g. the wallet's tinted variant).
   *  The site singleton omits this and reads from `particleControls` live. */
  speed?: number;
}

// ── Particle intensity knob ─────────────────────────────────────────
// One number you can dial to make the field more / less visible. It
// scales the particle COUNT, the maximum per-particle ALPHA, and the
// base SIZE in tandem so the relative look stays consistent (just more
// or fewer of the same sparks).
//
//   0.5 = whisper (90 desktop / 45 mobile, ~50% alpha)
//   1.0 = subtle (180 / 90, ~80% alpha)            ← old default
//   1.4 = present (252 / 126, ~100% alpha)         ← current default
//   1.8 = lively  (324 / 162, alpha clamped to 1)
//   2.5 = busy    (450 / 225, very prominent)
//
// Anything above ~2.5 starts to cost GPU on phones; stay at 1.4–1.8 for
// production. Mobile still gets the same intensity ratio, just a halved
// count baseline so additive-blend fill doesn't melt phones.
export const PARTICLE_INTENSITY = 1.4;

const PARTICLE_COUNT = Math.round(180 * PARTICLE_INTENSITY);

const VS = /* glsl */ `
  attribute vec3 aSeed;        // x = phase, y = drift speed, z = base size
  uniform   float uTime;
  uniform   vec2  uViewport;
  uniform   float uIntensity;  // mirrors PARTICLE_INTENSITY in JS
  varying   float vAlpha;

  // Cheap pseudo-noise from a hash - enough texture for drift.
  float hash(float n) { return fract(sin(n) * 43758.5453123); }

  void main() {
    float t = uTime * aSeed.y;

    // Each particle drifts on a Lissajous-ish path so motion stays smooth
    // and never repeats exactly within a session.
    float x = cos(t + aSeed.x * 6.283) * (0.55 + 0.4 * hash(aSeed.x));
    float y = sin(t * 0.83 + aSeed.x * 4.1) * (0.55 + 0.4 * hash(aSeed.x + 1.7));

    // Bias slightly upward so the cloud feels like it's rising.
    y += 0.05 * sin(t * 0.4);

    gl_Position = vec4(x, y, 0.0, 1.0);

    // Size scales with viewport height so points stay visually consistent.
    float pixelRatio = min(uViewport.y / 800.0, 1.5);
    gl_PointSize = aSeed.z * pixelRatio;

    // Pulse opacity per-particle, offset by phase. Multiplied by uIntensity
    // (clamped to 1.0 in the fragment so glow doesn't blow out) so the
    // single PARTICLE_INTENSITY knob in JS controls visible brightness too,
    // not just count.
    vAlpha = (0.25 + 0.55 * (0.5 + 0.5 * sin(t * 1.7 + aSeed.x * 12.0))) * uIntensity;
  }
`;

const FS = /* glsl */ `
  precision mediump float;
  varying float vAlpha;

  void main() {
    // 4-point AI spark / diamond. gl_PointCoord is [0,1] sprite coords;
    // we distance from center, then use a sub-unit superellipse exponent
    // so the shape becomes a concave diamond (pinched waist along the
    // cardinal axes — the classic Claude/Gemini "spark" silhouette, but
    // here it's the catalog AI mark in particle form).
    vec2  d  = abs(gl_PointCoord - 0.5) * 2.0;       // 0..1 per axis
    float r  = pow(d.x, 0.55) + pow(d.y, 0.55);       // concave diamond
    // Soft inner glow that brightens at the very center so each diamond
    // also reads as a luminous point at small sizes.
    float c  = exp(-dot(d, d) * 6.0);
    float a  = (smoothstep(1.05, 0.0, r) * 0.85 + c * 0.4) * vAlpha;

    // Cool silver-white tint so the field reads on matte black without
    // looking warm/cream.
    gl_FragColor = vec4(0.95, 0.96, 1.0, a);
  }
`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn('Particle shader compile failed:', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export default function ParticleBackground({ speed }: ParticleBackgroundProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // When a one-off mount sets `speed`, use that locally; otherwise read the
  // shared `particleControls.speed` live on every frame so the singleton
  // can be retuned by any consumer.
  const localSpeed = speed;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: false });
    if (!gl) return; // Older device - gate keeps working without the bg.

    const vs = compile(gl, gl.VERTEX_SHADER, VS);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('Particle program link failed:', gl.getProgramInfoLog(program));
      return;
    }
    gl.useProgram(program);

    // Per-particle seed: (phase, drift speed, base size).
    // Halve the field + cap DPR harder on phones — additive-blend fill is
    // the cost, and 180 points at dpr 2 is overkill for ambient texture on
    // a small screen.
    const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;
    // Same intensity ratio on mobile, halved baseline (additive-blend fill
    // is the cost on phones).
    const count = isMobile ? Math.round(90 * PARTICLE_INTENSITY) : PARTICLE_COUNT;
    const seeds = new Float32Array(count * 3);
    // Size baseline scales with intensity too so a higher intensity is
    // also a slightly bigger spark, not just more of them.
    const sizeMin = 1.5 * PARTICLE_INTENSITY;
    const sizeMax = 6.0 * PARTICLE_INTENSITY;
    for (let i = 0; i < count; i++) {
      seeds[i * 3 + 0] = Math.random();                       // phase 0..1
      seeds[i * 3 + 1] = 0.04 + Math.random() * 0.10;         // very slow drift
      seeds[i * 3 + 2] = sizeMin + Math.random() * (sizeMax - sizeMin);
    }

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);

    const aSeed = gl.getAttribLocation(program, 'aSeed');
    gl.enableVertexAttribArray(aSeed);
    gl.vertexAttribPointer(aSeed, 3, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(program, 'uTime');
    const uViewport = gl.getUniformLocation(program, 'uViewport');
    const uIntensity = gl.getUniformLocation(program, 'uIntensity');
    gl.uniform1f(uIntensity, PARTICLE_INTENSITY);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // additive for glow
    gl.clearColor(0, 0, 0, 0);

    const dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2);
    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uViewport, canvas.width, canvas.height);
    };
    resize();
    window.addEventListener('resize', resize);

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let raf = 0;
    let running = true;
    const start = performance.now();

    // Driver: scale wall-clock by the live speed (prop override or the
    // shared singleton's value) so any consumer can speed the field up
    // mid-animation (e.g. SearchCeremony → "searching the world").
    let accum = 0;
    let last = performance.now();
    const frame = () => {
      if (!running) return;
      // Site singleton (no explicit speed prop) skips the GL draw while the
      // feed covers it — keeps the loop alive to resume instantly, but
      // spends zero GPU on a hidden canvas. One-off mounts (ceremony, which
      // pass `speed`) always render.
      if (localSpeed === undefined && particleControls.paused) {
        // Singleton + feed covering it: fully STOP the loop instead of spinning
        // a no-op rAF every frame. That 60fps heartbeat kept the main thread
        // awake on the feed — the screen users actually sit on — for zero
        // pixels drawn. particleControls.onPausedChange restarts us the instant
        // the field is uncovered again (hero / landing / search ceremony).
        running = false;
        return;
      }
      const now = performance.now();
      const s = localSpeed ?? particleControls.speed;
      accum += ((now - last) / 1000) * s;
      last = now;
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(uTime, reduced ? 0 : accum);
      gl.drawArrays(gl.POINTS, 0, count);
      if (!reduced) raf = requestAnimationFrame(frame);
    };
    frame();
    void start;

    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!reduced) {
        running = true;
        frame();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // The singleton fully stops its loop while paused (see frame()), so it
    // needs a nudge to resume the instant the feed uncovers it. One-off mounts
    // (localSpeed set) ignore `paused` and never subscribe.
    const onPausedChange = () => {
      if (localSpeed !== undefined || reduced) return;
      if (!particleControls.paused && !running && !document.hidden) {
        running = true;
        last = performance.now();
        frame();
      }
    };
    const unsubPaused = localSpeed === undefined
      ? particleControls.onPausedChange(onPausedChange)
      : null;

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      unsubPaused?.();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      gl.deleteBuffer(buf);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      // CRITICAL: explicitly drop the WebGL context. Deleting GL objects
      // does NOT free the context itself — without this, every overlay
      // that mounts a ParticleBackground (comments, wallet, add-product,
      // create-look, …) leaks a live context. Browsers cap simultaneous
      // WebGL contexts (~16) and evict the OLDEST when the cap is hit —
      // which is the app-root SiteParticleHost singleton — silently
      // blanking the home/hero particle field. Releasing on unmount keeps
      // the live-context count flat so the singleton is never evicted.
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, []);

  return <canvas ref={canvasRef} className="pw-particles" aria-hidden="true" />;
}

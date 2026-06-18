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
// One number you can dial to make the field more / less visible. On DESKTOP it
// scales the particle COUNT (× the 340 baseline below), the maximum per-particle
// ALPHA, and the base SIZE in tandem so the relative look stays consistent. On
// MOBILE the count is decoupled — a fixed MOBILE_PARTICLE_COUNT (see below) —
// so intensity only moves alpha/size there, not the point count.
//
//   1.0 = subtle  (340 desktop, ~80% alpha)
//   1.4 = present (476 desktop, ~100% alpha)   ← current default
//   1.8 = lively  (612 desktop, alpha clamped to 1)
//
// Above ~1.8 starts to cost GPU; the brightness clamps in the fragment so the
// look mostly stops changing past there.
export const PARTICLE_INTENSITY = 1.4;

// Dense, fine star-dust field (Mercury-style): many small points rather than a
// few large sparks. Most are tiny far stars (size skewed small + depth fog),
// with a handful of larger, brighter near ones for the depth read.
const PARTICLE_COUNT = Math.round(340 * PARTICLE_INTENSITY);   // desktop
// Mobile is dialed way up to a dense star-dust storm (explicit count, not the
// old intensity ratio). gl.POINTS scales fine to this many points; the real
// cost is additive fill, kept in check by the small skewed sizes + the DoF
// energy conservation below (out-of-focus discs are dimmer).
const MOBILE_PARTICLE_COUNT = 8700;

// ── Depth of field (shallow, f/1.2) ─────────────────────────────────
// Photographic DoF. APERTURE_FSTOP is the literal f-number: lower = wider
// aperture = shallower focus, so more sparks bloom into soft, dim bokeh discs
// while only those near FOCAL_DEPTH stay crisp. Each particle's depth slowly
// oscillates, so sparks breathe in and out of focus over time.
export const APERTURE_FSTOP = 1.2;
const FOCAL_DEPTH = 0.62;

const VS = /* glsl */ `
  attribute vec4 aSeed;        // x = phase, y = drift speed, z = base size, w = depth seed
  uniform   float uTime;
  uniform   vec2  uViewport;
  uniform   float uIntensity;  // mirrors PARTICLE_INTENSITY in JS
  uniform   float uFade;       // 0..1 load fade-in
  uniform   float uFocus;      // focal-plane depth in [0,1] that stays crisp
  uniform   float uFStop;      // aperture f-number (1.2 = very shallow DoF)
  varying   float vAlpha;
  varying   float vBlur;       // 0 = in focus (diamond) .. 1 = full bokeh disc

  // How fast the circle of confusion opens per unit of defocus, BEFORE the
  // 1/f-stop scaling. Higher = a shallower-looking field overall.
  const float DOF_BASE = 3.0;

  // Cheap pseudo-noise from a hash - enough texture for drift.
  float hash(float n) { return fract(sin(n) * 43758.5453123); }

  void main() {
    float t = uTime * aSeed.y;

    // DEPTH: each particle lives at a depth in [0,1] (0 = far, 1 = near) that
    // slowly oscillates, so the cloud reads as living 3D layers rather than a
    // flat sheet. persp is the perspective factor — near particles are
    // larger, drift across a wider arc (parallax), and read brighter; far ones
    // shrink, move less, and dim out (depth fog).
    float depth = 0.5 + 0.5 * sin(aSeed.w * 6.2831 + t * 0.6);
    float persp = mix(0.45, 1.55, depth);

    // DEPTH OF FIELD: the circle of confusion grows with distance from the
    // focal plane and inversely with the f-number (wide aperture = shallow
    // DoF). Out-of-focus sparks bloom into bigger, softer, dimmer bokeh discs;
    // because depth oscillates, each spark drifts in and out of focus.
    float coc = abs(depth - uFocus) * (DOF_BASE / uFStop);
    vBlur = clamp(coc, 0.0, 1.0);

    // Each particle drifts on a Lissajous-ish path so motion stays smooth
    // and never repeats exactly within a session — amplitude scaled by depth
    // so near layers parallax past far ones.
    float x = cos(t + aSeed.x * 6.283) * (0.55 + 0.4 * hash(aSeed.x)) * persp;
    float y = sin(t * 0.83 + aSeed.x * 4.1) * (0.55 + 0.4 * hash(aSeed.x + 1.7)) * persp;

    // Bias slightly upward so the cloud feels like it's rising.
    y += 0.05 * sin(t * 0.4);

    gl_Position = vec4(x, y, 0.0, 1.0);

    // Size scales with viewport height AND depth so near sparks loom larger,
    // then blooms further with the circle of confusion when out of focus.
    float pixelRatio = min(uViewport.y / 800.0, 1.5);
    gl_PointSize = aSeed.z * pixelRatio * persp * (1.0 + coc * 1.6);

    // Pulse opacity per-particle, offset by phase. Multiplied by depth fog
    // (far = dimmer), uIntensity (the brightness knob), and uFade (the
    // load-in ramp), then divided by the CoC so a bigger bokeh disc is dimmer
    // — the same light spread over more area (energy conservation). Clamped to
    // 1.0 in the fragment so glow doesn't blow out.
    float pulse = 0.25 + 0.55 * (0.5 + 0.5 * sin(t * 1.7 + aSeed.x * 12.0));
    float fog   = mix(0.30, 1.0, depth);
    vAlpha = pulse * fog * uIntensity * uFade / (1.0 + coc * 1.4);
  }
`;

const FS = /* glsl */ `
  precision mediump float;
  varying float vAlpha;
  varying float vBlur;

  void main() {
    // IN FOCUS — 4-point AI spark / diamond. gl_PointCoord is [0,1] sprite
    // coords; distance from center through a sub-unit superellipse exponent
    // makes a concave diamond (pinched waist along the cardinal axes — the
    // classic Claude/Gemini "spark" silhouette, the catalog AI mark in
    // particle form).
    vec2  d  = abs(gl_PointCoord - 0.5) * 2.0;       // 0..1 per axis
    float r  = pow(d.x, 0.55) + pow(d.y, 0.55);       // concave diamond
    // Soft inner glow that brightens at the very center so each diamond
    // also reads as a luminous point at small sizes.
    float c  = exp(-dot(d, d) * 6.0);
    float diamond = smoothstep(1.05, 0.0, r) * 0.85 + c * 0.4;

    // OUT OF FOCUS — a soft round bokeh disc with a faint brighter rim (the
    // classic defocused-highlight look). vBlur (circle of confusion) crossfades
    // the crisp diamond into the disc as the spark leaves the focal plane.
    float rr   = length(gl_PointCoord - 0.5) * 2.0;   // 0 center .. 1 edge
    float disc = smoothstep(1.0, 0.45, rr);            // soft-edged circle
    float rim  = smoothstep(0.6, 0.95, rr) * smoothstep(1.0, 0.92, rr);
    float bokeh = disc * 0.6 + rim * 0.55;

    float shape = mix(diamond, bokeh, vBlur);

    // Cool silver-white tint so the field reads on matte black without
    // looking warm/cream.
    gl_FragColor = vec4(0.95, 0.96, 1.0, shape * vAlpha);
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

    // Per-particle seed: (phase, drift speed, base size, depth).
    // Cap DPR harder on phones — additive-blend fill is the real cost, not the
    // point count. Mobile runs the dense MOBILE_PARTICLE_COUNT field; the DoF
    // energy-conservation (dimmer bokeh) keeps the additive fill in check.
    const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;
    const count = isMobile ? MOBILE_PARTICLE_COUNT : PARTICLE_COUNT;
    const seeds = new Float32Array(count * 4);
    // Finer baseline than the old sparks — a star-dust look. Sizes are skewed
    // toward the minimum (pow below) so most points are tiny far stars and only
    // a few are larger; depth (persp) then scales near ones up further.
    const sizeMin = 0.7 * PARTICLE_INTENSITY;
    const sizeMax = 4.0 * PARTICLE_INTENSITY;
    for (let i = 0; i < count; i++) {
      seeds[i * 4 + 0] = Math.random();                       // phase 0..1
      seeds[i * 4 + 1] = 0.04 + Math.random() * 0.10;         // very slow drift
      // pow(2.2) bunches sizes near the minimum → mostly fine dust, few big.
      seeds[i * 4 + 2] = sizeMin + Math.pow(Math.random(), 2.2) * (sizeMax - sizeMin);
      seeds[i * 4 + 3] = Math.random();                       // depth seed 0..1
    }

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);

    const aSeed = gl.getAttribLocation(program, 'aSeed');
    gl.enableVertexAttribArray(aSeed);
    gl.vertexAttribPointer(aSeed, 4, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(program, 'uTime');
    const uViewport = gl.getUniformLocation(program, 'uViewport');
    const uIntensity = gl.getUniformLocation(program, 'uIntensity');
    const uFade = gl.getUniformLocation(program, 'uFade');
    const uFocus = gl.getUniformLocation(program, 'uFocus');
    const uFStop = gl.getUniformLocation(program, 'uFStop');
    gl.uniform1f(uIntensity, PARTICLE_INTENSITY);
    gl.uniform1f(uFocus, FOCAL_DEPTH);
    gl.uniform1f(uFStop, APERTURE_FSTOP);

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
      // Fade the whole field in over ~900ms when the screen first loads
      // (reduced-motion users get it fully on at once, no ramp).
      const fade = reduced ? 1 : Math.min(1, (now - start) / 900);
      gl.uniform1f(uFade, fade);
      gl.drawArrays(gl.POINTS, 0, count);
      // Keep animating while the field is still fading in even if motion is
      // otherwise reduced, so the fade itself always completes.
      if (!reduced || fade < 1) raf = requestAnimationFrame(frame);
    };
    frame();

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

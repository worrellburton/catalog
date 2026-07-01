import { useEffect, useRef } from 'react';

// StyleUpBackground — a WebGL "fashion illustration" field for the StyleUp
// surface.
//
// The motif is flowing fabric drape: long, sweeping hairline contours that fold
// and overlap like the hem of a gown or a scarf caught mid-motion. Each stroke
// SELF-DRAWS — an invisible pen tip sweeps it on left→right, it holds, then the
// whole line fades before redrawing with fresh folds. Monochrome near-white ink
// on the dark base (editorial croquis, in the René Gruau / David Downton spirit
// of spare, confident line), low-alpha so it reads as ambient texture behind the
// chat — never a focal effect.
//
// `intensity` sets the presence: ~1 on the /style landing (bolder), ~0.4 inside
// a conversation (a faint whisper). It's driven as a uniform and eased, so it
// glides between surfaces without re-creating the GL context.
//
// Sizes to its parent box (works full-screen or inside a pane), honors
// prefers-reduced-motion (renders one static, fully-drawn frame), pauses on a
// hidden tab, and releases its GL context on unmount so it never leaks.

const VS = /* glsl */ `
  attribute vec2 aPos;
  void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

// Flowing fabric-drape hairlines that self-draw. Line widths are derived from
// pixels so they stay a uniform hairline at any resolution.
const FS = /* glsl */ `
  precision mediump float;
  uniform vec2  uRes;       // canvas size in device px
  uniform float uTime;      // slow seconds
  uniform float uFade;      // 0..1 load-in ramp
  uniform float uIntensity; // presence: ~1 landing, ~0.4 in-thread
  uniform float uStatic;    // 1 = reduced-motion (fully drawn, no animation)
  uniform vec3  uInk;       // line color — neutral ink, tinted per-stylist in-thread

  // Cheap per-cycle hash so a stroke's folds vary each time it redraws.
  float hash(float n) { return fract(sin(n * 91.3458) * 47453.5453); }

  // One draped hairline stroke. i = line index.
  float drape(vec2 uv, float asp, float t, float i) {
    // Per-line self-draw cycle, staggered so they don't all draw at once.
    float period = 15.0;
    float off = i * 2.3;
    float tt = (t + off) / period;
    float cyc = floor(tt);
    float ph = fract(tt);              // 0..1 within this stroke's cycle

    // Curve params, re-rolled only between cycles (while the stroke is faded).
    float r1 = hash(i * 3.17 + cyc * 1.7);
    float r2 = hash(i * 7.91 + cyc * 2.3);
    float r3 = hash(i * 5.13 + cyc * 0.9);

    // Vertical band this drape lives in (spread across the height).
    float band = (i + 0.5) / 6.0 + (r1 - 0.5) * 0.10;

    // Fabric drape: a soft main swell plus a gentler secondary fold, with a
    // very slow drift so the cloth never sits perfectly still.
    float k = 1.6 + r2 * 1.8;
    float amp = 0.06 + r3 * 0.05;
    float y = band
            + amp        * sin(uv.x * k        * asp + r1 * 6.2832 + t * 0.05)
            + amp * 0.5  * sin(uv.x * k * 1.9  * asp + r2 * 6.2832 - t * 0.037)
            + 0.03 * sin(t * 0.06 + i);

    // Uniform hairline distance field (~0.7px + AA edge).
    float px = 1.0 / uRes.y;
    float w  = 0.6 * px;
    float aa = 1.2 * px;
    float line = 1.0 - smoothstep(w, w + aa, abs(uv.y - y));

    // Self-drawing reveal: a pen tip sweeps left→right during the draw phase,
    // the stroke holds, then fades out before the next cycle redraws it.
    float front   = smoothstep(0.0, 0.34, ph);            // tip position 0..1
    float reveal  = 1.0 - smoothstep(front, front + 0.02, uv.x);
    float appear  = smoothstep(0.0, 0.03, ph);            // no pop at the start
    float fadeOut = 1.0 - smoothstep(0.72, 1.0, ph);      // dissolve at the end
    float env = reveal * appear * fadeOut;

    // A subtle brighter nib right at the drawing tip (only while drawing).
    float drawing = 1.0 - smoothstep(0.30, 0.34, ph);
    float nib = drawing * line * (1.0 - smoothstep(0.0, 0.015, abs(uv.x - front))) * 0.6;

    // Reduced motion → fully drawn, static, no nib.
    env = mix(env, 1.0, uStatic);
    return line * env + nib * (1.0 - uStatic);
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / uRes;
    float asp = uRes.x / uRes.y;
    float t = uTime;

    float ink = 0.0;
    for (int i = 0; i < 6; i++) {
      ink += drape(uv, asp, t, float(i));
    }
    ink = clamp(ink, 0.0, 1.0);

    // Ink color (neutral, or eased toward the stylist's accent in-thread);
    // alpha driven by presence + the load-in ramp.
    float a = ink * 0.20 * uIntensity * uFade;
    gl_FragColor = vec4(uInk, a);
  }
`;

// Neutral near-white ink — the drape's default line color.
const NEUTRAL_INK: [number, number, number] = [0.86, 0.9, 0.98];

/** "#rrggbb" → 0..1 rgb, or null when unparseable. */
function hexToRgb(hex: string | null | undefined): [number, number, number] | null {
  const m = hex?.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn('StyleUp bg shader compile failed:', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export interface StyleUpBackgroundProps {
  /** Presence of the drape field: ~1 on the landing (bolder), ~0.4 in-thread. */
  intensity?: number;
  /** Stylist accent hex — tints the ink toward it in-thread (null = neutral). */
  accent?: string | null;
}

export default function StyleUpBackground({ intensity = 1, accent = null }: StyleUpBackgroundProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const targetRef = useRef(intensity);   // where the presence should ease to
  const inkTargetRef = useRef<[number, number, number]>(NEUTRAL_INK); // ink color to ease to
  const kickRef = useRef<() => void>(() => {}); // resume the loop if it settled

  // Track the desired presence + ink tint without re-creating the GL context,
  // and nudge the loop awake (matters under reduced-motion, where it settles
  // then stops).
  useEffect(() => {
    targetRef.current = intensity;
    const a = hexToRgb(accent);
    // Lift the accent toward white so the hairlines stay luminous on the dark
    // base (a raw mid-tone accent would read muddy at line weight).
    inkTargetRef.current = a ? [a[0] * 0.55 + 0.45, a[1] * 0.55 + 0.45, a[2] * 0.55 + 0.45] : NEUTRAL_INK;
    kickRef.current();
  }, [intensity, accent]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: false });
    if (!gl) return; // No WebGL — the chat just renders on its flat dark base.

    const vs = compile(gl, gl.VERTEX_SHADER, VS);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('StyleUp bg program link failed:', gl.getProgramInfoLog(program));
      return;
    }
    gl.useProgram(program);

    // Full-screen quad (two triangles).
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1,
    ]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, 'uRes');
    const uTime = gl.getUniformLocation(program, 'uTime');
    const uFade = gl.getUniformLocation(program, 'uFade');
    const uIntensity = gl.getUniformLocation(program, 'uIntensity');
    const uStatic = gl.getUniformLocation(program, 'uStatic');
    const uInk = gl.getUniformLocation(program, 'uInk');

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2);

    const resize = () => {
      const host = canvas.parentElement;
      const w = host?.clientWidth || window.innerWidth;
      const h = host?.clientHeight || window.innerHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
    };
    resize();

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    if (ro && canvas.parentElement) ro.observe(canvas.parentElement);
    window.addEventListener('resize', resize);

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    gl.uniform1f(uStatic, reduced ? 1 : 0);
    const start = performance.now();
    let current = targetRef.current;   // eased presence
    const ink: [number, number, number] = [inkTargetRef.current[0], inkTargetRef.current[1], inkTargetRef.current[2]]; // eased ink color
    let raf = 0;
    let running = false;

    const frame = () => {
      if (!running) return;
      const now = performance.now();
      const secs = (now - start) / 1000;
      // Ease the presence + ink tint toward their targets so surface changes glide.
      current += (targetRef.current - current) * 0.06;
      let inkDelta = 0;
      for (let i = 0; i < 3; i++) {
        ink[i] += (inkTargetRef.current[i] - ink[i]) * 0.06;
        inkDelta = Math.max(inkDelta, Math.abs(inkTargetRef.current[i] - ink[i]));
      }
      const fade = Math.min(1, (now - start) / 1200);
      gl.uniform1f(uTime, reduced ? 0 : secs);
      gl.uniform1f(uFade, fade);
      gl.uniform1f(uIntensity, current);
      gl.uniform3f(uInk, ink[0], ink[1], ink[2]);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      // Keep going while animating; under reduced-motion, stop once the load-in
      // ramp and the eases have all settled.
      const settled = fade >= 1 && Math.abs(targetRef.current - current) < 0.004 && inkDelta < 0.004;
      if (!reduced || !settled) raf = requestAnimationFrame(frame);
      else running = false;
    };
    const kick = () => { if (!running && !document.hidden) { running = true; raf = requestAnimationFrame(frame); } };
    kickRef.current = kick;
    kick();

    const onVisibility = () => {
      if (document.hidden) { running = false; cancelAnimationFrame(raf); }
      else kick();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      running = false;
      kickRef.current = () => {};
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      gl.deleteBuffer(buf);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      // Release the context so StyleUp never eats into the browser's live-WebGL
      // cap (which would evict the home/hero particle field).
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, []);

  return <canvas ref={canvasRef} className="su-bg-canvas" aria-hidden="true" />;
}

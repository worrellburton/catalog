import { useEffect, useRef } from 'react';

// StyleUpBackground — a subtle WebGL "blueprint" field for the StyleUp chat.
//
// Very thin, slow, intentional measurement lines: a drifting technical grid
// with ruler ticks plus a couple of long sweep lines crossing the frame. Cool,
// near-monochrome, low-alpha so it reads as ambient texture BEHIND the dark
// chat — never a focal effect. Inspired by the site particle field, but quieter
// and more architectural ("measurements", not stars).
//
// Sizes to its parent box (works full-screen or inside a pane), honors
// prefers-reduced-motion (renders one static frame), pauses on a hidden tab,
// and releases its GL context on unmount so it never leaks a live context.

const VS = /* glsl */ `
  attribute vec2 aPos;
  void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

// All work is done in aspect-corrected UV space (small numbers) so mediump
// stays precise at any resolution. Line widths are derived from pixels.
const FS = /* glsl */ `
  precision mediump float;
  uniform vec2  uRes;   // canvas size in device px
  uniform float uTime;  // slow seconds
  uniform float uFade;  // 0..1 load-in ramp

  const float CELLS = 26.0;   // fine grid rows across the height

  // Thin antialiased mask for the nearest line of a unit grid in g-space.
  float lineMask(vec2 g, float halfW, float aa) {
    vec2 f = abs(fract(g) - 0.5);
    float d = 0.5 - max(f.x, f.y);          // distance to nearest grid line
    return 1.0 - smoothstep(halfW, halfW + aa, d);
  }

  // Distance to a single straight line (normal n, offset off) → thin mask.
  float sweepMask(vec2 uv, vec2 n, float off, float halfW, float aa) {
    float d = abs(dot(uv - 0.5, n) - off);
    return 1.0 - smoothstep(halfW, halfW + aa, d);
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / uRes;
    vec2 asp = vec2(uRes.x / uRes.y, 1.0);
    float t = uTime;

    // Barely-there drift of the whole field — slow and deliberate.
    vec2 g = uv * asp * CELLS + vec2(t * 0.45, -t * 0.27);

    float pxToG = CELLS / uRes.y;           // one device px → g units

    // Fine blueprint grid — whisper faint, continuous thin lines.
    float fine = lineMask(g, 0.5 * pxToG, 1.3 * pxToG);

    // Major grid every 5 cells, broken into measurement ticks along its length.
    vec2 gm = g / 5.0;
    float major = lineMask(gm, 0.7 * (pxToG * 5.0), 1.2 * (pxToG * 5.0));
    float ticks = step(0.72, fract(g.x * 2.0)) + step(0.72, fract(g.y * 2.0));
    major *= clamp(ticks, 0.0, 1.0);

    // Two long sweep lines crossing very slowly (the "ruler" gesture).
    float a1 = 0.62, a2 = 2.42;
    vec2 n1 = vec2(-sin(a1), cos(a1));
    vec2 n2 = vec2(-sin(a2), cos(a2));
    float o1 = (fract(t * 0.011) - 0.5) * 1.3;
    float o2 = (fract(t * 0.008 + 0.5) - 0.5) * 1.3;
    float s1 = sweepMask(uv, n1, o1, 0.0014, 0.0026);
    float s2 = sweepMask(uv, n2, o2, 0.0014, 0.0026);

    // Compose — kept low so it's ambient, not busy.
    float ink = fine * 0.05 + major * 0.11 + (s1 + s2) * 0.16;

    // Cool blueprint tint; brighten slightly on the structural lines.
    vec3 col = mix(vec3(0.52, 0.66, 0.84), vec3(0.82, 0.91, 1.0),
                   clamp(major + s1 + s2, 0.0, 1.0));

    // Soft radial falloff keeps the center clean and the edges quiet.
    float vig = smoothstep(1.18, 0.30, length(uv - 0.5) * 1.4);

    gl_FragColor = vec4(col, ink * vig * uFade);
  }
`;

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

export default function StyleUpBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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
    const start = performance.now();
    let raf = 0;
    let running = true;

    const frame = () => {
      if (!running) return;
      const now = performance.now();
      // Slow time base — "very slow and intentional".
      gl.uniform1f(uTime, reduced ? 0 : (now - start) / 1000);
      const fade = reduced ? 1 : Math.min(1, (now - start) / 1400);
      gl.uniform1f(uFade, fade);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      if (!reduced || fade < 1) raf = requestAnimationFrame(frame);
    };
    frame();

    const onVisibility = () => {
      if (document.hidden) { running = false; cancelAnimationFrame(raf); }
      else if (!reduced) { running = true; frame(); }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      running = false;
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

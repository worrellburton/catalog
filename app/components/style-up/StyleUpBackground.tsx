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

// A minimal motif — NOT a grid. A few super-thin, dim, slowly wandering
// contour lines (a stencil-sketch feel), nothing more. Line widths are derived
// from pixels so they stay hairline at any resolution.
const FS = /* glsl */ `
  precision mediump float;
  uniform vec2  uRes;   // canvas size in device px
  uniform float uTime;  // slow seconds
  uniform float uFade;  // 0..1 load-in ramp

  // Hairline antialiased contour at y = base + amp*sin(freq*x + phase).
  float contour(vec2 uv, float base, float amp, float freq, float phase, float w, float aa) {
    float y = base + amp * sin(uv.x * freq + phase);
    float d = abs(uv.y - y);
    return 1.0 - smoothstep(w, w + aa, d);
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / uRes;
    float asp = uRes.x / uRes.y;
    float t = uTime;

    float px = 1.0 / uRes.y;     // one device pixel, in uv-y units
    float w  = 0.35 * px;        // ~0.7px → hairline
    float aa = 1.0 * px;

    // Three sparse, slow, gently wandering lines — a sketch motif, not a field.
    float ink = 0.0;
    ink += contour(uv, 0.26, 0.045, 4.2 * asp,  t * 0.05,        w, aa);
    ink += contour(uv, 0.55, 0.065, 3.1 * asp, -t * 0.043 + 1.6, w, aa);
    ink += contour(uv, 0.79, 0.040, 5.4 * asp,  t * 0.058 + 3.2, w, aa);

    // Cool, and dim — a quiet motif, never a focal element.
    gl_FragColor = vec4(vec3(0.74, 0.82, 0.95), ink * 0.075 * uFade);
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

import { useEffect, useRef } from 'react';

// Vanilla WebGL particle drift — no dependencies. Renders a soft cloud of
// glowing points with additive blending and slow noise-driven motion. Sized
// so it reads as ambient texture, not a focal effect. Auto-pauses when the
// tab is hidden and honours prefers-reduced-motion (renders one static frame).

const PARTICLE_COUNT = 180;

const VS = /* glsl */ `
  attribute vec3 aSeed;        // x = phase, y = drift speed, z = base size
  uniform   float uTime;
  uniform   vec2  uViewport;
  varying   float vAlpha;

  // Cheap pseudo-noise from a hash — enough texture for drift.
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

    // Pulse opacity per-particle, offset by phase, so the field shimmers.
    vAlpha = 0.25 + 0.55 * (0.5 + 0.5 * sin(t * 1.7 + aSeed.x * 12.0));
  }
`;

const FS = /* glsl */ `
  precision mediump float;
  varying float vAlpha;

  void main() {
    // Soft circular falloff — gl_PointCoord is the [0,1] sprite coord.
    vec2  d   = gl_PointCoord - 0.5;
    float r   = dot(d, d) * 4.0;
    float a   = exp(-r * 3.5) * vAlpha;

    // Slight warm tint so the cloud reads as light, not pure white.
    gl_FragColor = vec4(0.95, 0.92, 0.88, a);
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

export default function ParticleBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: false });
    if (!gl) return; // Older device — gate keeps working without the bg.

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
    const seeds = new Float32Array(PARTICLE_COUNT * 3);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      seeds[i * 3 + 0] = Math.random();              // phase 0..1
      seeds[i * 3 + 1] = 0.04 + Math.random() * 0.10; // very slow drift
      seeds[i * 3 + 2] = 1.5 + Math.random() * 4.5;   // size 1.5..6 px
    }

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);

    const aSeed = gl.getAttribLocation(program, 'aSeed');
    gl.enableVertexAttribArray(aSeed);
    gl.vertexAttribPointer(aSeed, 3, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(program, 'uTime');
    const uViewport = gl.getUniformLocation(program, 'uViewport');

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // additive for glow
    gl.clearColor(0, 0, 0, 0);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
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

    const frame = () => {
      if (!running) return;
      const t = (performance.now() - start) / 1000;
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(uTime, reduced ? 0 : t);
      gl.drawArrays(gl.POINTS, 0, PARTICLE_COUNT);
      if (!reduced) raf = requestAnimationFrame(frame);
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

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      gl.deleteBuffer(buf);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, []);

  return <canvas ref={canvasRef} className="pw-particles" aria-hidden="true" />;
}

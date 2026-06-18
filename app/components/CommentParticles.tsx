import { useEffect, useRef } from 'react';

/**
 * WebGL avatar drift field for the comments page. Same "particle thing"
 * treatment as ParticleBackground, but instead of abstract sparks each
 * particle is a commenter's profile picture: a soft circular sprite
 * drifting on a slow Lissajous path with a gentle pulse. Reads as a
 * living crowd of the people in the thread behind the content.
 *
 * Self-contained vanilla WebGL — no deps. Auto-pauses when the tab is
 * hidden and honours prefers-reduced-motion (renders one static frame).
 * Avatars load with crossOrigin so they're sampleable as textures;
 * any that fail to load (CORS / 404) are simply skipped.
 */

interface CommentParticlesProps {
  /** Commenter avatar URLs. Duplicates are de-duped; order is irrelevant. */
  avatars: string[];
  className?: string;
}

const VS = /* glsl */ `
  attribute vec2 aCorner;       // unit quad corner in [-1,1]
  uniform   vec2  uCenter;      // clip-space center of this avatar
  uniform   float uSize;        // half-size in clip units
  uniform   float uAspect;      // canvasHeight / canvasWidth (keeps circles round)
  varying   vec2  vUv;
  void main() {
    vUv = aCorner * 0.5 + 0.5;
    vec2 pos = uCenter + vec2(aCorner.x * uSize * uAspect, aCorner.y * uSize);
    gl_Position = vec4(pos, 0.0, 1.0);
  }
`;

const FS = /* glsl */ `
  precision mediump float;
  uniform sampler2D uTex;
  uniform float uAlpha;
  varying vec2 vUv;
  void main() {
    // Circular mask with a soft feathered edge.
    vec2 c = (vUv - 0.5) * 2.0;
    float d = length(c);
    float mask = smoothstep(1.0, 0.86, d);
    if (mask <= 0.001) discard;
    // Faint luminous ring just inside the edge so each face reads as a
    // distinct token, not a hard-cut circle.
    float ring = smoothstep(0.80, 0.92, d) * smoothstep(1.0, 0.92, d);
    vec4 tex = texture2D(uTex, vUv);
    vec3 col = mix(tex.rgb, vec3(0.96, 0.97, 1.0), ring * 0.6);
    gl_FragColor = vec4(col, tex.a * mask * uAlpha);
  }
`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn('CommentParticles shader compile failed:', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

interface Sprite {
  tex: WebGLTexture;
  phase: number;
  speed: number;
  baseX: number;
  baseY: number;
  driftX: number;
  driftY: number;
  size: number;
  alpha: number;
  depth: number;   // 0 (far) .. 1 (near)
}

export default function CommentParticles({ avatars, className }: CommentParticlesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Stable key for the avatar set so the effect only re-inits when the
  // distinct list actually changes (not on every parent render).
  const uniqueAvatars = Array.from(new Set(avatars.filter(Boolean)));
  const avatarKey = uniqueAvatars.join('|');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (uniqueAvatars.length === 0) return;

    const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: false });
    if (!gl) return;

    const vs = compile(gl, gl.VERTEX_SHADER, VS);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return;
    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('CommentParticles link failed:', gl.getProgramInfoLog(program));
      return;
    }
    gl.useProgram(program);

    // Unit quad (two triangles).
    const quad = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    const aCorner = gl.getAttribLocation(program, 'aCorner');
    gl.enableVertexAttribArray(aCorner);
    gl.vertexAttribPointer(aCorner, 2, gl.FLOAT, false, 0, 0);

    const uCenter = gl.getUniformLocation(program, 'uCenter');
    const uSize = gl.getUniformLocation(program, 'uSize');
    const uAspect = gl.getUniformLocation(program, 'uAspect');
    const uAlpha = gl.getUniformLocation(program, 'uAlpha');
    const uTex = gl.getUniformLocation(program, 'uTex');
    gl.uniform1i(uTex, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2);
    let aspect = 1;
    const resize = () => {
      const w = canvas.clientWidth || window.innerWidth;
      const h = canvas.clientHeight || window.innerHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
      aspect = canvas.height / canvas.width;
    };
    resize();
    window.addEventListener('resize', resize);

    // Build a sprite per avatar. The texture starts as a 1x1 transparent
    // pixel and is replaced once the image decodes, so a slow-loading
    // avatar never blocks the field from animating.
    const sprites: Sprite[] = [];
    const images: HTMLImageElement[] = [];
    // Bias size + alpha smaller when there are many faces so a busy thread
    // doesn't turn into a wall of overlapping circles.
    const n = uniqueAvatars.length;
    const sizeBase = n > 24 ? 0.10 : n > 12 ? 0.13 : 0.17;

    uniqueAvatars.forEach((url, i) => {
      const tex = gl.createTexture();
      if (!tex) return;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        } catch {
          /* tainted canvas / decode failure — sprite stays transparent */
        }
      };
      img.src = url;
      images.push(img);

      // Scatter across the field with a golden-angle spiral so faces don't
      // clump, then give each its own slow drift.
      const ga = i * 2.399963; // golden angle
      const rad = Math.sqrt((i + 0.5) / n) * 0.82;
      sprites.push({
        tex,
        phase: ga,
        speed: 0.10 + Math.random() * 0.12,
        baseX: Math.cos(ga) * rad,
        baseY: Math.sin(ga) * rad * 0.92,
        driftX: 0.05 + Math.random() * 0.07,
        driftY: 0.05 + Math.random() * 0.07,
        size: sizeBase * (0.85 + Math.random() * 0.4),
        alpha: 0.55 + Math.random() * 0.35,
        depth: Math.random(),
      });
    });

    // Painter's order for the depth field: draw far faces first so near ones
    // (drawn last) overlap them correctly.
    sprites.sort((a, b) => a.depth - b.depth);

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let running = true;
    let accum = 0;
    let last = performance.now();
    const start = performance.now();

    const frame = () => {
      if (!running) return;
      const now = performance.now();
      accum += (now - last) / 1000;
      last = now;
      const t = reduced ? 0 : accum;
      // Whole field fades in over ~900ms on load.
      const fade = reduced ? 1 : Math.min(1, (now - start) / 900);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(uAspect, aspect);
      for (const s of sprites) {
        // Depth: near faces loom larger, drift across a wider arc (parallax),
        // and read brighter; far ones shrink, move less, and dim (depth fog).
        const persp = 0.6 + 0.8 * s.depth;
        const fog = 0.5 + 0.5 * s.depth;
        const cx = s.baseX + Math.cos(t * s.speed + s.phase) * s.driftX * persp;
        const cy = s.baseY + Math.sin(t * s.speed * 0.8 + s.phase * 1.3) * s.driftY * persp
          + 0.02 * Math.sin(t * 0.3 + s.phase);
        const pulse = 0.92 + 0.08 * Math.sin(t * 0.9 + s.phase * 2.0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, s.tex);
        gl.uniform2f(uCenter, cx, cy);
        gl.uniform1f(uSize, s.size * pulse * persp);
        gl.uniform1f(uAlpha, s.alpha * fog * fade);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      // Keep looping while motion is on, or until the fade-in completes.
      if (!reduced || fade < 1) raf = requestAnimationFrame(frame);
    };
    frame();

    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!reduced) {
        running = true;
        last = performance.now();
        frame();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      for (const img of images) { img.onload = null; }
      for (const s of sprites) gl.deleteTexture(s.tex);
      gl.deleteBuffer(buf);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatarKey]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}

// Liquid Chrome — a real WebGL fragment shader: domain-warped fractal
// noise lit like flowing molten metal, resolving from turbulent → calm
// as the wordmark settles. No textures (so no cross-origin concerns),
// one fullscreen triangle, mediump precision. The RAF loop stops and the
// GL context is explicitly released on unmount.
//
// Falls back to a CSS gradient sheen if WebGL is unavailable.

import { useEffect, useRef, useState } from 'react';
import type { SplashVariantProps } from '../types';

const DPR_CAP = 1.5;

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

// Domain-warped fbm → metallic palette. uPhase eases turbulence down and
// brightness up as the splash resolves.
const FRAG = `
precision mediump float;
uniform vec2  uRes;
uniform float uTime;
uniform float uPhase;   // 0 assemble, 1 reveal, 2 exit
uniform float uReveal;  // 0..1 eased resolve

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p);
  float a=hash(i), b=hash(i+vec2(1.0,0.0)), c=hash(i+vec2(0.0,1.0)), d=hash(i+vec2(1.0,1.0));
  vec2 u=f*f*(3.0-2.0*f);
  return mix(a,b,u.x)+(c-a)*u.y*(1.0-u.x)+(d-b)*u.x*u.y;
}
float fbm(vec2 p){
  float v=0.0, amp=0.5;
  for(int i=0;i<5;i++){ v+=amp*noise(p); p*=2.02; amp*=0.5; }
  return v;
}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes.xy;
  vec2 p = (gl_FragCoord.xy - 0.5*uRes.xy) / min(uRes.x, uRes.y);
  float t = uTime * 0.12;
  float turb = mix(1.0, 0.45, uReveal);

  // two-stage domain warp
  vec2 q = vec2(fbm(p*2.0 + t), fbm(p*2.0 - t + 4.3));
  vec2 r = vec2(fbm(p*2.0 + 1.7*q + t*0.7), fbm(p*2.0 + 1.7*q - t*0.6));
  float f = fbm(p*2.0 + turb*1.8*r);

  // metallic ramp: dark steel → bright chrome highlight
  float m = smoothstep(0.2, 0.95, f);
  vec3 steel = vec3(0.07, 0.08, 0.10);
  vec3 mid   = vec3(0.36, 0.39, 0.45);
  vec3 hi    = vec3(0.92, 0.95, 1.0);
  vec3 col = mix(steel, mid, m);
  col = mix(col, hi, pow(m, 4.0));

  // a warm catalog-tinted sweep that grows on reveal
  float sweep = smoothstep(0.0, 1.0, sin((uv.x+uv.y)*3.14159 - uTime*0.6)*0.5+0.5);
  col += vec3(0.10,0.07,0.05) * sweep * uReveal;

  // radial vignette to focus the center wordmark
  float vig = smoothstep(1.05, 0.25, length(p));
  col *= mix(0.6, 1.0, vig);
  col += pow(m, 8.0) * 0.25 * vig;  // specular bloom near highlights

  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error('[LiquidChrome] shader compile failed:', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export default function LiquidChrome({ phase, replayKey }: SplashVariantProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = (canvas.getContext('webgl', { antialias: false, alpha: false, depth: false })
      || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) { setFailed(true); return; }

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) { setFailed(true); return; }
    const prog = gl.createProgram();
    if (!prog) { setFailed(true); return; }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { setFailed(true); return; }
    gl.useProgram(prog);

    // Fullscreen triangle.
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, 'uRes');
    const uTime = gl.getUniformLocation(prog, 'uTime');
    const uPhase = gl.getUniformLocation(prog, 'uPhase');
    const uReveal = gl.getUniformLocation(prog, 'uReveal');

    const dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1);
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let raf = 0;
    let running = true;
    const start = performance.now();
    let reveal = 0;
    const render = (now: number) => {
      if (!running) return;
      const ph = phaseRef.current;
      const target = ph === 'assemble' ? 0 : 1;
      reveal += (target - reveal) * 0.04;
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, (now - start) / 1000);
      gl.uniform1f(uPhase, ph === 'assemble' ? 0 : ph === 'reveal' ? 1 : 2);
      gl.uniform1f(uReveal, reveal);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buf);
      // Proactively drop the GL context so we don't leak one per replay.
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayKey]);

  if (failed) {
    return <div className="sv-liquid-fallback" aria-hidden="true" />;
  }
  return (
    <div className="sv-liquid-scene">
      <canvas ref={canvasRef} className="sv-liquid-canvas" />
      <div className="sv-vignette" />
    </div>
  );
}

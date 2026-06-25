// A compact rotary dial for the Daily Feed rule weights — replaces the linear
// range slider with a knob that fills low → high around a 270° arc. Draggable
// (pointer), clickable (jump-to), and keyboard-accessible (arrow keys). The
// current value sits in the centre. Admin-only; styling is self-contained SVG.

import { useCallback, useRef } from 'react';

interface WeightDialProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange: (n: number) => void;
  size?: number;
}

// Screen-clockwise degrees (y-down): 135° = bottom-left (low), sweeping 270°
// clockwise up and over to 45°/bottom-right (high), leaving a 90° gap at the
// bottom. Low on the left, high on the right — reads as a low→high dial.
const START = 135;
const SWEEP = 270;

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const s = polar(cx, cy, r, startDeg);
  const e = polar(cx, cy, r, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}

export default function WeightDial({ value, min, max, step = 1, disabled = false, onChange, size = 62 }: WeightDialProps) {
  const ref = useRef<SVGSVGElement>(null);
  const span = max - min || 1;
  const frac = Math.max(0, Math.min(1, (value - min) / span));
  const valDeg = START + SWEEP * frac;
  const cx = 50, cy = 50, r = 38;
  const knob = polar(cx, cy, r, valDeg);
  const accent = disabled ? '#cbd5e1' : '#2563eb';

  const setFromPointer = useCallback((clientX: number, clientY: number) => {
    const svg = ref.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = clientX - (rect.left + rect.width / 2);
    const py = clientY - (rect.top + rect.height / 2);
    let ang = (Math.atan2(py, px) * 180) / Math.PI;
    if (ang < 0) ang += 360;
    let t = ang - START;
    if (t < 0) t += 360;
    // In the bottom gap (t > SWEEP): snap to whichever end is nearer.
    if (t > SWEEP) t = t > SWEEP + (360 - SWEEP) / 2 ? 0 : SWEEP;
    const raw = min + (t / SWEEP) * span;
    const next = Math.max(min, Math.min(max, Math.round(raw / step) * step));
    if (next !== value) onChange(next);
  }, [min, max, span, step, value, onChange]);

  return (
    <svg
      ref={ref}
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="slider"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={e => {
        if (disabled) return;
        e.preventDefault();
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        setFromPointer(e.clientX, e.clientY);
      }}
      onPointerMove={e => {
        if (disabled || e.buttons === 0) return;
        setFromPointer(e.clientX, e.clientY);
      }}
      onKeyDown={e => {
        if (disabled) return;
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); onChange(Math.min(max, value + step)); }
        else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); onChange(Math.max(min, value - step)); }
      }}
      style={{ touchAction: 'none', cursor: disabled ? 'default' : 'pointer', display: 'block', outline: 'none' }}
    >
      <path d={arcPath(cx, cy, r, START, START + SWEEP)} fill="none" stroke="#e2e8f0" strokeWidth={7} strokeLinecap="round" />
      {frac > 0.001 && (
        <path d={arcPath(cx, cy, r, START, valDeg)} fill="none" stroke={accent} strokeWidth={7} strokeLinecap="round" />
      )}
      <circle cx={knob.x} cy={knob.y} r={6.5} fill="#fff" stroke={accent} strokeWidth={3} />
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={28} fontWeight={700} fill={disabled ? '#94a3b8' : '#0f172a'}>{value}</text>
    </svg>
  );
}

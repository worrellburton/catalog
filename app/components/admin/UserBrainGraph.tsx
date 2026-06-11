// User brain canvas — the population as a radial constellation. Root
// "users" at the centre; one node per COUNTRY on the ring, sized by how
// many of the filtered population live there, wearing a gender-split
// arc (blue male / pink female / grey unknown). User avatars orbit
// their country. Pan with drag, zoom with wheel, hover a country for
// the magnifier, click it to drill. Read-only by design — segmentation
// happens in the toggles above, editing belongs to /admin/users.

import { useMemo, useRef, useState } from 'react';
import type { GovernanceUser } from '~/services/user-governance';
import { countryFlag, countryName } from '~/services/user-governance';

export interface CountryCluster {
  code: string | null;          // null = the Unknown bucket
  users: GovernanceUser[];
}

interface Props {
  clusters: CountryCluster[];
  total: number;
  onDrill: (code: string | null) => void;
}

const GENDER_COLORS: Record<string, string> = {
  male: '#60a5fa',
  female: '#f472b6',
  unknown: '#71717a',
};

const RING_R = 280;
const MAX_SATS = 12;

export default function UserBrainGraph({ clusters, total, onDrill }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ tx: 0, ty: 0, k: 1 });
  const pan = useRef<{ x0: number; y0: number; tx: number; ty: number } | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const size = { w: 1200, h: 820 };
  const cx = size.w / 2;
  const cy = size.h / 2;

  // Biggest cluster gets the 12 o'clock slot; the rest fan clockwise.
  const placed = useMemo(() => clusters.map((c, i) => {
    const angle = (i / Math.max(clusters.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const r = 22 + Math.min(34, Math.sqrt(c.users.length) * 9);
    return { ...c, key: c.code ?? '??', angle, x: cx + Math.cos(angle) * RING_R, y: cy + Math.sin(angle) * RING_R, r };
  }), [clusters, cx, cy]);

  const onWheel = (ev: React.WheelEvent) => {
    const k = Math.min(2.5, Math.max(0.4, view.k * (ev.deltaY < 0 ? 1.08 : 0.93)));
    setView(v => ({ ...v, k }));
  };
  const onDown = (ev: React.PointerEvent) => {
    pan.current = { x0: ev.clientX, y0: ev.clientY, tx: view.tx, ty: view.ty };
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
  };
  const onMove = (ev: React.PointerEvent) => {
    if (!pan.current) return;
    setView(v => ({ ...v, tx: pan.current!.tx + ev.clientX - pan.current!.x0, ty: pan.current!.ty + ev.clientY - pan.current!.y0 }));
  };
  const onUp = () => { pan.current = null; };

  // One gender-split arc per cluster: three stroked segments around the
  // node circle, proportional to the male/female/unknown mix.
  const genderArcs = (c: CountryCluster, x: number, y: number, r: number) => {
    const counts = { male: 0, female: 0, unknown: 0 };
    for (const u of c.users) counts[u.gender]++;
    const n = c.users.length || 1;
    const circ = 2 * Math.PI * (r + 5);
    let offset = -circ / 4; // start at 12 o'clock
    return (['female', 'male', 'unknown'] as const).map(g => {
      const frac = counts[g] / n;
      if (frac === 0) return null;
      const seg = (
        <circle key={g} cx={x} cy={y} r={r + 5} fill="none"
          stroke={GENDER_COLORS[g]} strokeOpacity={0.85} strokeWidth={2.5}
          strokeDasharray={`${Math.max(frac * circ - 2, 1)} ${circ}`}
          strokeDashoffset={-offset} strokeLinecap="round" />
      );
      offset += frac * circ;
      return seg;
    });
  };

  return (
    <div ref={wrapRef} className="tb-wrap" onWheel={onWheel}>
      <svg
        className="tb-svg" viewBox={`0 0 ${size.w} ${size.h}`}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
      >
        <g transform={`translate(${view.tx}, ${view.ty}) scale(${view.k})`} style={{ transformOrigin: `${cx}px ${cy}px` }}>
          <circle className="tb-ring" cx={cx} cy={cy} r={RING_R} fill="none" />

          {/* Spokes + clusters */}
          {placed.map(c => (
            <line key={`l-${c.key}`} x1={cx} y1={cy} x2={c.x} y2={c.y}
              stroke="#fff" strokeOpacity={0.10} strokeWidth={1} />
          ))}

          {/* Root */}
          <g className="tb-root">
            <circle cx={cx} cy={cy} r={40} />
            <text x={cx} y={cy - 2}>users</text>
            <text x={cx} y={cy + 15} style={{ fontSize: 11, opacity: 0.6 }}>{total}</text>
          </g>

          {placed.map(c => {
            const isHover = hovered === c.key;
            return (
              <g key={c.key} className="ub-node"
                onPointerEnter={() => setHovered(c.key)}
                onPointerLeave={() => setHovered(h => (h === c.key ? null : h))}
                onClick={() => onDrill(c.code)}
                style={{ cursor: 'pointer' }}
              >
                {genderArcs(c, c.x, c.y, c.r)}
                <circle cx={c.x} cy={c.y} r={c.r}
                  fill="#18181b" fillOpacity={0.92}
                  stroke="#fff" strokeOpacity={isHover ? 0.8 : 0.25} strokeWidth={1.4} />
                <text x={c.x} y={c.y + 7} textAnchor="middle" style={{ fontSize: Math.max(15, c.r * 0.8), pointerEvents: 'none' }}>
                  {countryFlag(c.code)}
                </text>
                <text className="tb-label" x={c.x} y={c.y + c.r + 22} textAnchor="middle" fill="#e4e4e7">
                  {countryName(c.code)}
                </text>
                <text x={c.x} y={c.y + c.r + 38} textAnchor="middle" fill="#a1a1aa" style={{ fontSize: 11 }}>
                  {c.users.length} user{c.users.length === 1 ? '' : 's'}
                </text>

                {/* Orbiting avatars (capped; the drill shows everyone) */}
                {c.users.slice(0, MAX_SATS).map((u, i) => {
                  const shown = Math.min(c.users.length, MAX_SATS);
                  const a = (i / shown) * Math.PI * 2 - Math.PI / 2;
                  const ux = c.x + Math.cos(a) * (c.r + 24);
                  const uy = c.y + Math.sin(a) * (c.r + 24);
                  return (
                    <g key={u.id}>
                      <circle cx={ux} cy={uy} r={11} fill="#27272a" stroke={GENDER_COLORS[u.gender]} strokeWidth={1.5} />
                      {u.avatar ? (
                        <>
                          <clipPath id={`ub-${u.id}`}><circle cx={ux} cy={uy} r={9.5} /></clipPath>
                          <image href={u.avatar} x={ux - 9.5} y={uy - 9.5} width={19} height={19}
                            clipPath={`url(#ub-${u.id})`} preserveAspectRatio="xMidYMid slice" />
                        </>
                      ) : (
                        <text x={ux} y={uy + 3.5} textAnchor="middle" fill="#d4d4d8" style={{ fontSize: 8.5, fontWeight: 700, pointerEvents: 'none' }}>
                          {u.name.slice(0, 2).toUpperCase()}
                        </text>
                      )}
                    </g>
                  );
                })}
                {c.users.length > MAX_SATS && (
                  <text x={c.x} y={c.y - c.r - 14} textAnchor="middle" fill="#a1a1aa" style={{ fontSize: 10.5, fontWeight: 700 }}>
                    +{c.users.length - MAX_SATS} more
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

// Ring-locked force layout for the governance type brain. Each tree depth
// lives on a concentric ring around the pinned catalog root (founder's
// call: the structure should read as rings — layer N is exactly the Nth
// ring). Repulsion + link springs only spread nodes ALONG their ring;
// a positional snap keeps them on it. Small enough to own instead of
// pulling in d3-force; O(n²) repulsion is fine at taxonomy scale.

import { useEffect, useMemo, useRef, useState } from 'react';

export interface SimNodeInput {
  id: string;
  /** Tree depth — 0 is the catalog root pinned at the centre. */
  depth: number;
  /** Visual radius, used for collision spacing. */
  r: number;
}

export interface SimLink { source: string; target: string; }

export interface SimNodeState { x: number; y: number; }

interface Body extends SimNodeState {
  id: string; depth: number; r: number;
  vx: number; vy: number;
  /** Pinned by an active drag — forces skip it. */
  pinned: boolean;
}

const REPULSION = 2600;        // many-body strength
const SPRING = 0.07;           // link spring (aligns children to parent's angle)
const RING_SNAP = 0.22;        // positional pull onto own depth ring per tick
const DAMPING = 0.82;
const ALPHA_DECAY = 0.995;
const MIN_ALPHA = 0.005;

/** Ring spacing adapts to the canvas. Wider than strictly fits is fine —
 *  the graph zooms (cmd+wheel), so breathing room beats containment. */
function ringGap(width: number, height: number, maxDepth: number): number {
  const usable = Math.min(width, height) / 2 - 70;
  return Math.max(96, Math.min(176, usable / Math.max(1, maxDepth)));
}

export function useForceSim(
  nodes: SimNodeInput[],
  links: SimLink[],
  width: number,
  height: number,
  /** Admin ring-distance dial — multiplies the auto-computed gap. */
  gapScale = 1,
) {
  const bodiesRef = useRef<Map<string, Body>>(new Map());
  const alphaRef = useRef(1);
  const gapRef = useRef(110);
  const [positions, setPositions] = useState<Map<string, SimNodeState>>(new Map());
  const frameRef = useRef(0);

  const maxDepth = useMemo(() => nodes.reduce((m, n) => Math.max(m, n.depth), 1), [nodes]);
  const gap = Math.max(56, Math.min(320, ringGap(width, height, maxDepth) * gapScale));
  gapRef.current = gap;
  // Reheat when the dial moves so nodes glide to the new rings.
  useEffect(() => { alphaRef.current = Math.max(alphaRef.current, 0.5); }, [gap]);
  /** Guide-ring radii for depths 1..maxDepth, for drawing. */
  const ringRadii = useMemo(
    () => Array.from({ length: maxDepth }, (_, i) => (i + 1) * gap),
    [maxDepth, gap],
  );

  // Reconcile bodies with the node list: keep existing positions, seed new
  // nodes near their ring at a deterministic angle so layout is stable.
  useEffect(() => {
    const bodies = bodiesRef.current;
    const seen = new Set<string>();
    nodes.forEach((n, i) => {
      seen.add(n.id);
      const existing = bodies.get(n.id);
      if (existing) { existing.depth = n.depth; existing.r = n.r; return; }
      const angle = (i * 2.399963) % (Math.PI * 2); // golden-angle spread
      const radius = n.depth * gapRef.current || 0.01;
      bodies.set(n.id, {
        id: n.id, depth: n.depth, r: n.r,
        x: width / 2 + Math.cos(angle) * radius,
        y: height / 2 + Math.sin(angle) * radius,
        vx: 0, vy: 0, pinned: false,
      });
    });
    for (const id of [...bodies.keys()]) if (!seen.has(id)) bodies.delete(id);
    alphaRef.current = 1; // reheat on any structural change
  }, [nodes, width, height]);

  useEffect(() => {
    const cx = width / 2;
    const cy = height / 2;
    const tick = () => {
      const bodies = bodiesRef.current;
      const alpha = alphaRef.current;
      if (alpha > MIN_ALPHA) {
        const arr = [...bodies.values()];
        const ring = gapRef.current;
        // Many-body repulsion (spreads nodes along their rings).
        for (let i = 0; i < arr.length; i++) {
          for (let j = i + 1; j < arr.length; j++) {
            const a = arr[i], b = arr[j];
            let dx = b.x - a.x, dy = b.y - a.y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 1) { dx = (Math.random() - 0.5); dy = (Math.random() - 0.5); d2 = 1; }
            const min = a.r + b.r + 14;
            const f = (REPULSION * alpha) / Math.max(d2, min * min * 0.25);
            const d = Math.sqrt(d2);
            const fx = (dx / d) * f, fy = (dy / d) * f;
            if (!a.pinned) { a.vx -= fx; a.vy -= fy; }
            if (!b.pinned) { b.vx += fx; b.vy += fy; }
          }
        }
        // Link springs keep children near their parent's angle; the ring
        // snap below cancels the radial part, so this acts tangentially.
        for (const l of links) {
          const a = bodies.get(l.source), b = bodies.get(l.target);
          if (!a || !b) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const stretch = (d - ring) * SPRING * alpha;
          const fx = (dx / d) * stretch, fy = (dy / d) * stretch;
          if (!a.pinned) { a.vx += fx; a.vy += fy; }
          if (!b.pinned) { b.vx -= fx; b.vy -= fy; }
        }
        // Integrate, then SNAP onto the depth ring (the ring is a hard
        // constraint, not a suggestion), then clamp to the canvas.
        const pad = 56;
        for (const b of arr) {
          if (b.depth === 0) { b.x = cx; b.y = cy; b.vx = 0; b.vy = 0; continue; }
          if (b.pinned) continue;
          b.vx *= DAMPING; b.vy *= DAMPING;
          b.x += b.vx; b.y += b.vy;
          const dx = b.x - cx, dy = b.y - cy;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const target = b.depth * ring;
          const nd = d + (target - d) * RING_SNAP;
          b.x = cx + (dx / d) * nd;
          b.y = cy + (dy / d) * nd;
          b.x = Math.min(Math.max(b.x, pad), width - pad);
          b.y = Math.min(Math.max(b.y, pad), height - pad);
        }
        alphaRef.current = alpha * ALPHA_DECAY;
        setPositions(new Map([...bodies.entries()].map(([id, b]) => [id, { x: b.x, y: b.y }])));
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [links, width, height]);

  /** Drag API: pin under the pointer, release reheats so neighbours settle. */
  const dragTo = (id: string, x: number, y: number) => {
    const b = bodiesRef.current.get(id);
    if (!b) return;
    b.pinned = true; b.x = x; b.y = y; b.vx = 0; b.vy = 0;
    alphaRef.current = Math.max(alphaRef.current, 0.3);
    setPositions(prev => new Map(prev).set(id, { x, y }));
  };
  const release = (id: string) => {
    const b = bodiesRef.current.get(id);
    if (b) b.pinned = false;
    alphaRef.current = Math.max(alphaRef.current, 0.5);
  };

  return { positions, dragTo, release, ringRadii };
}

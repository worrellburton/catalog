// Slot-assigned radial layout for the governance type brain. Each tree
// depth lives on a concentric ring around the pinned catalog root, and —
// founder's call — spacing is GUARANTEED even: every branch owns an
// angular wedge (blend of equal share and leaf-count share), leaves
// spread evenly inside their wedge, parents sit at wedge midpoints.
// Nodes ease toward their assigned slot instead of drifting under
// repulsion, so branches can never blend and nothing overlaps at rest.
//
// Dragging: the grabbed node pins to the pointer while everyone else
// freezes. On release the dropped ANGLE becomes that node's sibling-order
// override — it keeps the slot nearest where you dropped it (no bounce
// back), and because children's wedges nest inside the parent's, the
// whole subtree glides over with it.

import { useEffect, useMemo, useRef, useState } from 'react';

export interface SimNodeInput {
  id: string;
  /** Tree depth — 0 is the catalog root pinned at the centre. */
  depth: number;
  /** Visual radius (kept for callers; spacing is slot-based now). */
  r: number;
}

export interface SimLink { source: string; target: string; }

export interface SimNodeState { x: number; y: number; }

interface Body extends SimNodeState {
  id: string; depth: number; r: number;
  /** Pinned by an active drag — easing skips it. */
  pinned: boolean;
}

const ROOT_ID = '__root__';
const ANGLE_EASE = 0.16;     // per-tick fraction of the arc to the slot
const RADIUS_EASE = 0.22;    // per-tick fraction of the radial gap
const ALPHA_DECAY = 0.992;
const MIN_ALPHA = 0.004;

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

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
  // While a drag is live the sim is frozen: only the pinned node moves, so
  // every other node holds still and overlap-drops land every time.
  const draggingRef = useRef(false);
  const gapRef = useRef(110);
  /** Assigned slot angle per node id — the layout's source of truth. */
  const targetsRef = useRef<Map<string, number>>(new Map());
  /** Sibling-order hints from drags: node id → the angle it was dropped
   *  at. Sorting by these is what makes a drop STICK. */
  const overridesRef = useRef<Map<string, number>>(new Map());
  /** The most recently dropped node — the layout rotates globally so ITS
   *  slot lands exactly on the drop angle (even spacing preserved). */
  const lastDroppedRef = useRef<string | null>(null);
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

  /** The wedge layout: recursively split the circle. Sibling order comes
   *  from drag overrides (else current angle) so re-assignments move the
   *  fewest nodes; wedge size blends equal share with leaf-count share so
   *  depth-1 nodes stay roughly evenly spaced while big branches breathe. */
  const assignAngles = () => {
    const bodies = bodiesRef.current;
    const kids = new Map<string, string[]>();
    for (const l of links) kids.set(l.source, [...(kids.get(l.source) ?? []), l.target]);
    const leafCount = (id: string): number => {
      const c = kids.get(id) ?? [];
      if (c.length === 0) return 1;
      return c.reduce((acc, k) => acc + leafCount(k), 0);
    };
    const sortAngle = (id: string): number => {
      const o = overridesRef.current.get(id);
      if (o !== undefined) return o;
      const b = bodies.get(id);
      if (!b) return 0;
      return Math.atan2(b.y - height / 2, b.x - width / 2);
    };
    const targets = new Map<string, number>();
    const place = (id: string, a0: number, a1: number) => {
      targets.set(id, (a0 + a1) / 2);
      const c = [...(kids.get(id) ?? [])].sort((x, y) => sortAngle(x) - sortAngle(y));
      if (c.length === 0) return;
      const total = c.reduce((acc, k) => acc + leafCount(k), 0);
      let cursor = a0;
      for (const k of c) {
        const span = (a1 - a0) * (0.5 / c.length + 0.5 * (leafCount(k) / total));
        place(k, cursor, cursor + span);
        cursor += span;
      }
    };
    // Root owns the full circle, starting at 12 o'clock.
    place(ROOT_ID, -Math.PI / 2, Math.PI * 1.5);
    // Honor the latest drop EXACTLY: wedge sizes vary (leaf-weighted), so
    // the dropped node's slot can land away from where the admin let go —
    // which reads as "it bounced". One global rotation pins its slot to
    // the drop angle while keeping every gap even.
    const dropped = lastDroppedRef.current;
    if (dropped) {
      const want = overridesRef.current.get(dropped);
      const got = targets.get(dropped);
      if (want !== undefined && got !== undefined) {
        const delta = wrapAngle(want - got);
        for (const [id, a] of targets) targets.set(id, a + delta);
      }
    }
    targetsRef.current = targets;
  };

  // Reconcile bodies with the node list: keep existing positions, seed new
  // nodes at their parent's slot so they glide outward into place.
  useEffect(() => {
    const bodies = bodiesRef.current;
    const parentOf = new Map(links.map(l => [l.target, l.source]));
    const seen = new Set<string>();
    nodes.forEach((n, i) => {
      seen.add(n.id);
      const existing = bodies.get(n.id);
      if (existing) { existing.depth = n.depth; existing.r = n.r; return; }
      const parent = bodies.get(parentOf.get(n.id) ?? ROOT_ID);
      const angle = parent
        ? Math.atan2(parent.y - height / 2, parent.x - width / 2)
        : (i * 2.399963) % (Math.PI * 2); // golden-angle fallback
      const radius = Math.max(1, (n.depth - 0.5)) * gapRef.current || 0.01;
      bodies.set(n.id, {
        id: n.id, depth: n.depth, r: n.r,
        x: width / 2 + Math.cos(angle) * radius,
        y: height / 2 + Math.sin(angle) * radius,
        pinned: false,
      });
    });
    for (const id of [...bodies.keys()]) {
      if (!seen.has(id)) { bodies.delete(id); overridesRef.current.delete(id); }
    }
    assignAngles();
    alphaRef.current = 1; // reheat on any structural change
    // assignAngles reads only refs + this effect's own deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, links, width, height]);

  useEffect(() => {
    const cx = width / 2;
    const cy = height / 2;
    const tick = () => {
      const bodies = bodiesRef.current;
      const alpha = alphaRef.current;
      if (alpha > MIN_ALPHA && !draggingRef.current) {
        const ring = gapRef.current;
        const targets = targetsRef.current;
        for (const b of bodies.values()) {
          if (b.depth === 0) { b.x = cx; b.y = cy; continue; }
          if (b.pinned) continue;
          const ta = targets.get(b.id);
          if (ta === undefined) continue;
          const dx = b.x - cx, dy = b.y - cy;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const cur = Math.atan2(dy, dx);
          const dA = wrapAngle(ta - cur);
          const na = Math.abs(dA) < 0.002 ? ta : cur + dA * ANGLE_EASE;
          const targetR = b.depth * ring;
          const nd = Math.abs(targetR - d) < 0.75 ? targetR : d + (targetR - d) * RADIUS_EASE;
          b.x = cx + Math.cos(na) * nd;
          b.y = cy + Math.sin(na) * nd;
        }
        alphaRef.current = alpha * ALPHA_DECAY;
        setPositions(new Map([...bodies.entries()].map(([id, b]) => [id, { x: b.x, y: b.y }])));
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [links, width, height]);

  /** Organize: forget every drag override and snap the whole brain to the
   *  clean wedge layout instantly. */
  const organize = () => {
    overridesRef.current.clear();
    lastDroppedRef.current = null;
    assignAngles();
    const bodies = bodiesRef.current;
    const cx = width / 2, cy = height / 2;
    const ring = gapRef.current;
    for (const b of bodies.values()) {
      if (b.depth === 0) { b.x = cx; b.y = cy; continue; }
      const ta = targetsRef.current.get(b.id);
      if (ta === undefined) continue;
      b.x = cx + Math.cos(ta) * b.depth * ring;
      b.y = cy + Math.sin(ta) * b.depth * ring;
    }
    alphaRef.current = 0.02; // already placed — just repaint
    setPositions(new Map([...bodies.entries()].map(([id, b]) => [id, { x: b.x, y: b.y }])));
  };

  /** Drag API: pin under the pointer and freeze everyone else. Release
   *  records the dropped angle as the node's order override — it keeps the
   *  slot nearest the drop (no bounce-back), and re-assignment carries its
   *  whole subtree into the new wedge. */
  const dragTo = (id: string, x: number, y: number) => {
    const b = bodiesRef.current.get(id);
    if (!b) return;
    b.pinned = true; b.x = x; b.y = y;
    draggingRef.current = true;
    setPositions(prev => new Map(prev).set(id, { x, y }));
  };
  const release = (id: string) => {
    const b = bodiesRef.current.get(id);
    if (b) {
      b.pinned = false;
      overridesRef.current.set(id, Math.atan2(b.y - height / 2, b.x - width / 2));
      lastDroppedRef.current = id;
    }
    draggingRef.current = false;
    assignAngles();
    alphaRef.current = Math.max(alphaRef.current, 0.6);
  };

  return { positions, dragTo, release, ringRadii, organize };
}

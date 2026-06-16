// The governance "type brain" — an Obsidian-style force graph of the
// product-type tree. Catalog sits at the centre; rings radiate by depth;
// gender lanes are color-coded and tint their descendants.
//
// Interactions:
//   drag empty canvas   → marquee multi-select
//   hold space + drag   → pan the canvas
//   click / shift-click → select / extend selection
//   drag node(s)        → move; release over another node re-parents (live)
//   double-click        → zoom into the node (drill view; rename lives there)
//   ⌫ / Delete          → delete selection
//   product satellites  → always-on thumbnails orbiting their type when the
//                         products toggle is on; click opens the product,
//                         drag onto another node re-types it
//
// Mutations fire through callbacks immediately — the page owns the undo
// stack and session log.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useForceSim, type SimLink, type SimNodeInput } from '~/hooks/useForceSim';

export interface BrainNode {
  id: string;
  name: string;
  parentId: string | null;   // null = child of the synthetic root
  depth: number;             // root = 0
  color: string;             // resolved lane color
  count: number;             // directly attached products
  locked: boolean;           // synthetic nodes (unassigned) — no edits
  /** 24x24 icon path data, drawn nightly by generate-type-icons. */
  icon?: string | null;
}

export interface BrainProduct { id: string; name: string; image: string | null; }

export type BrainViewMode = 'types' | 'products' | 'all';

/** Imperative camera access for the page's mobile dock: the zoom slider
 *  and orbit joystick drive the view from outside the canvas. */
export interface BrainCameraHandle {
  getZoom(): number;
  /** Zoom about the canvas centre (clamped like wheel/pinch). */
  zoomTo(k: number): void;
  orbitBy(dax: number, day: number): void;
}

interface Props {
  nodes: BrainNode[];        // excludes the synthetic root
  /** Per-node orbiting thumbnails (already capped) + the true total. */
  satellites: Map<string, { items: BrainProduct[]; total: number }>;
  selection: Set<string>;
  /** types = structure only · products = thumbnails dominate, nodes dim
   *  to anchors · all = both at full strength. */
  viewMode: BrainViewMode;
  onSelect: (ids: Set<string>) => void;
  onReparent: (nodeIds: string[], targetId: string) => void;
  /** Click a node's LABEL to rename it inline. */
  onRename: (nodeId: string, name: string) => void;
  onDelete: (nodeIds: string[]) => void;
  onAddChild: (parentId: string) => void;
  onAssignProducts: (productIds: string[], nodeId: string) => void;
  onOpenProduct: (productId: string) => void;
  /** Armed by the selection bar's "Move to…": the next node click becomes
   *  the re-parent target for the whole selection instead of a selection. */
  pickMode?: boolean;
  onPickTarget?: (targetId: string) => void;
  /** Hover-drill: zoom INTO a node — the page opens its product drill view
   *  anchored at the node's canvas position. */
  onDrill: (nodeId: string, x: number, y: number) => void;
  /** Ring dials (admin sliders): guide-ring opacity 0..1, distance ×0.5..2. */
  ringOpacity: number;
  ringScale: number;
  /** Increment to run the tidy radial layout (the Organize button). */
  organizeSignal: number;
  /** Depth-of-field f-stop (1.4 = razor-thin focus … 8 = deep); null = off.
   *  Lower stops blur far/near globes harder, like a fast lens. */
  dofStop?: number | null;
  /** Showcase mode: the camera drifts itself between interesting orbits
   *  with slow ease-in-out; any canvas touch hands control back. */
  showcase?: boolean;
  onShowcaseInterrupt?: () => void;
  /** Mobile dock wiring: the handle drives zoom/orbit from the page;
   *  onZoomChange keeps the dock's slider honest when pinch/showcase
   *  move the zoom from inside the canvas. */
  controlRef?: React.MutableRefObject<BrainCameraHandle | null>;
  onZoomChange?: (k: number) => void;
  /** Increment to fly the camera home: flat 2D plane, zoom 1, rings
   *  level — everything eases back with an overshoot bounce. */
  resetSignal?: number;
  /** "Moving rings": each type's product-satellite ring slowly rotates on its
   *  own (different rate + direction per node) and the guide rings drift on
   *  their own orbital planes — the whole brain churns like a gyratory planet.
   *  Very slow; purely cosmetic. */
  movingRings?: boolean;
}

export const ROOT_ID = '__root__';
/** Below this much pointer travel a satellite gesture counts as a click. */
const CLICK_SLOP = 5;

export default function TypeBrainGraph(p: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1100, h: 720 });
  // Zoom/pan view transform: screen = world * k + (tx, ty). Cmd/ctrl +
  // wheel zooms about the pointer (ctrlKey also covers trackpad pinch).
  const [view, setView] = useState({ k: 1, tx: 0, ty: 0 });
  // 3D orbit (founder's call: the brain is a SPACE, not a sheet). The
  // force layout stays planar (Z=0); rendering projects every point
  // through tilt (ax) + spin (ay) with perspective. Cmd/Ctrl-drag orbits
  // on desktop; three fingers orbit on touch (one pans, two pinch).
  const [orbit, setOrbit] = useState({ ax: -0.38, ay: 0.0 });
  // Ring planes: during showcase each guide ring drifts on its own
  // orbital plane (theta advances, mix fades the effect in) so the
  // space reads as a universe, not a sheet. Both ease home on reset.
  const [ringTheta, setRingTheta] = useState(0);
  const [ringMix, setRingMix] = useState(0);
  // "Moving rings": a single slowly-advancing angle. Each type's satellite ring
  // multiplies it by its own signed rate so they rotate at different speeds and
  // directions ("a different clockwise or a different way").
  const [spin, setSpin] = useState(0);
  const resetAnim = useRef(0);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const touchGesture = useRef<
    | { kind: 'pinch'; d0: number; k0: number; mx: number; my: number; tx0: number; ty0: number }
    | { kind: 'orbit3'; sx: number; sy: number; ax0: number; ay0: number }
    | null
  >(null);
  // Held spacebar arms hand-pan: pointer drags move the view transform
  // instead of selecting/dragging (standard design-tool behaviour).
  const [spaceHeld, setSpaceHeld] = useState(false);
  useEffect(() => {
    const down = (ev: KeyboardEvent) => {
      if (ev.code !== 'Space' || ev.repeat) return;
      const t = ev.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      ev.preventDefault(); // keep the page from scrolling while panning
      setSpaceHeld(true);
    };
    const up = (ev: KeyboardEvent) => { if (ev.code === 'Space') setSpaceHeld(false); };
    const blur = () => setSpaceHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      if (!(ev.metaKey || ev.ctrlKey)) return;
      ev.preventDefault(); // needs a non-passive listener — React's onWheel is passive
      const rect = el.getBoundingClientRect();
      const px = ev.clientX - rect.left;
      const py = ev.clientY - rect.top;
      setView(v => {
        const k = Math.min(2.5, Math.max(0.35, v.k * Math.exp(-ev.deltaY * 0.0016)));
        // Keep the world point under the cursor fixed while scaling.
        return { k, tx: px - ((px - v.tx) / v.k) * k, ty: py - ((py - v.ty) / v.k) * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const simNodes = useMemo<SimNodeInput[]>(() => [
    { id: ROOT_ID, depth: 0, r: 34 },
    ...p.nodes.map(n => ({ id: n.id, depth: n.depth, r: nodeRadius(n) })),
  ], [p.nodes]);
  const simLinks = useMemo<SimLink[]>(() => p.nodes.map(n => ({
    source: n.parentId ?? ROOT_ID, target: n.id,
  })), [p.nodes]);
  const { positions, dragTo, release, ringRadii, organize } = useForceSim(simNodes, simLinks, size.w, size.h, p.ringScale);
  // Organize button lives in the page header — it pokes this counter.
  const organizeRan = useRef(0);
  useEffect(() => {
    if (p.organizeSignal > 0 && p.organizeSignal !== organizeRan.current) {
      organizeRan.current = p.organizeSignal;
      organize();
    }
    // organize is re-created per render but only reads live refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.organizeSignal]);

  const byId = useMemo(() => new Map(p.nodes.map(n => [n.id, n])), [p.nodes]);
  const descendants = useMemo(() => {
    const kids = new Map<string, string[]>();
    p.nodes.forEach(n => {
      const key = n.parentId ?? ROOT_ID;
      kids.set(key, [...(kids.get(key) ?? []), n.id]);
    });
    const collect = (id: string, into: Set<string>) => {
      for (const k of kids.get(id) ?? []) { into.add(k); collect(k, into); }
    };
    return (id: string) => { const s = new Set<string>(); collect(id, s); return s; };
  }, [p.nodes]);

  const gesture = useRef<
    | { kind: 'node'; ids: string[]; grabId: string; moved: boolean }
    | { kind: 'marquee'; x0: number; y0: number }
    | { kind: 'pan'; sx: number; sy: number; tx0: number; ty0: number }
    | { kind: 'orbit'; sx: number; sy: number; ax0: number; ay0: number }
    | null
  >(null);
  const [panning, setPanning] = useState(false);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [prodDrag, setProdDrag] = useState<{ id: string; x: number; y: number; x0: number; y0: number } | null>(null);
  // Inline rename, opened by clicking a node's label.
  const [editing, setEditing] = useState<string | null>(null);
  // Hovered node — surfaces the drill affordance. Small leave-delay so the
  // pointer can travel from the circle to the drill button without flicker.
  const [hovered, setHovered] = useState<string | null>(null);
  const hoverTimer = useRef(0);
  const hoverEnter = (id: string) => { window.clearTimeout(hoverTimer.current); setHovered(id); };
  const hoverLeave = () => {
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setHovered(null), 160);
  };

  // Plane → projected (pre-view-transform) space. FOCAL sets perspective
  // strength; s is the per-point scale (also the depth cue).
  const FOCAL = 1500;
  const projWith = (o: { ax: number; ay: number }, pos: { x: number; y: number }) => {
    const cx = size.w / 2, cy = size.h / 2;
    const X = pos.x - cx, Y = pos.y - cy;
    const cosY = Math.cos(o.ay), sinY = Math.sin(o.ay);
    const cosX = Math.cos(o.ax), sinX = Math.sin(o.ax);
    const x1 = X * cosY;
    const z1 = X * sinY;
    const y2 = Y * cosX - z1 * sinX;
    const z2 = Y * sinX + z1 * cosX;
    const s = FOCAL / Math.max(200, FOCAL - z2);
    return { x: cx + x1 * s, y: cy + y2 * s, s, z: z2 };
  };
  const proj = (pos: { x: number; y: number }) => projWith(orbit, pos);
  // Projected → plane, using a reference scale (the grabbed node's own s)
  // — locally exact, which is all a drag needs.
  const unproj = (px: number, py: number, sRef: number) => {
    const cx = size.w / 2, cy = size.h / 2;
    const cosY = Math.cos(orbit.ay), sinY = Math.sin(orbit.ay);
    const cosX = Math.cos(orbit.ax), sinX = Math.sin(orbit.ax);
    const u = (px - cx) / sRef, v = (py - cy) / sRef;
    const X = Math.abs(cosY) > 0.2 ? u / cosY : u;
    const Y = Math.abs(cosX) > 0.2 ? (v + X * sinY * sinX) / cosX : v;
    return { x: cx + X, y: cy + Y };
  };

  // Depth of field: bucket nodes into shared blur filters by |z| versus
  // the focal width the chosen stop allows.
  const dofFilter = (z: number): string | undefined => {
    if (!p.dofStop) return undefined;
    const width = p.dofStop * 190;
    const d = Math.abs(z) / width;
    if (d < 0.55) return undefined;
    if (d < 1.1) return 'url(#tb-dof-1)';
    if (d < 1.9) return 'url(#tb-dof-2)';
    return 'url(#tb-dof-3)';
  };

  // Showcase: a slow automatic camera. Each leg eases (smooth in-out)
  // to a fresh orbit/zoom over ~5s, forever, until interrupted.
  useEffect(() => {
    if (!p.showcase) return;
    let raf = 0;
    let start = performance.now();
    let from = { ax: orbit.ax, ay: orbit.ay, k: view.k };
    const nextTarget = (prev: { ay: number }) => ({
      ax: -(0.18 + Math.random() * 0.85),
      ay: prev.ay + 0.45 + Math.random() * 1.1,
      k: 0.8 + Math.random() * 0.55,
    });
    let to = nextTarget(from);
    const DUR = 5200;
    const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
    const tick = (now: number) => {
      const u = Math.min(1, (now - start) / DUR);
      const e = ease(u);
      setOrbit({ ax: from.ax + (to.ax - from.ax) * e, ay: from.ay + (to.ay - from.ay) * e });
      setView(v => ({ ...v, k: from.k + (to.k - from.k) * e }));
      // Ring planes drift while the camera tours — theta advances the
      // per-ring orbits, mix ramps the effect in so they don't snap.
      setRingTheta(t => t + 0.0042);
      setRingMix(m => Math.min(1, m + 0.006));
      if (u >= 1) { from = to; to = nextTarget(from); start = now; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Reads live orbit/view only at (re)start — the loop owns them after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.showcase]);

  // Moving rings: one slow rAF advances `spin` (and the guide-ring plane
  // drift) forever while on. Very slow — a premium, barely-there churn. When
  // off, the guide rings ease flat again; satellite rings snap back to rest
  // (spinFor below zeroes out).
  useEffect(() => {
    if (!p.movingRings) {
      if (ringMix === 0) return;
      let raf = 0;
      const ease = () => { setRingMix(m => { const n = Math.max(0, m - 0.02); if (n > 0) raf = requestAnimationFrame(ease); return n; }); };
      raf = requestAnimationFrame(ease);
      return () => cancelAnimationFrame(raf);
    }
    let raf = 0;
    const tick = () => {
      setSpin(s => s + 0.0030);
      setRingTheta(t => t + 0.0030);
      setRingMix(m => Math.min(1, m + 0.01));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // ringMix read only to decide whether the off-branch needs to ease.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.movingRings]);

  // Reset: fly the camera home — flat plane, zoom 1, centred, rings
  // level — on an ease-out-back curve so everything overshoots its
  // resting pose and bounces into place.
  const resetRan = useRef(0);
  useEffect(() => {
    if (!p.resetSignal || p.resetSignal === resetRan.current) return;
    resetRan.current = p.resetSignal;
    cancelAnimationFrame(resetAnim.current);
    const TWO_PI = Math.PI * 2;
    const from = {
      ax: orbit.ax,
      // Nearest whole turn, so a long showcase spin unwinds in under a
      // half-rotation instead of rewinding every lap.
      ay: ((orbit.ay % TWO_PI) + TWO_PI + Math.PI) % TWO_PI - Math.PI,
      k: view.k, tx: view.tx, ty: view.ty, mix: ringMix,
    };
    const start = performance.now();
    const DUR = 900;
    const c1 = 1.70158, c3 = c1 + 1;
    const ease = (u: number) => 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2);
    const tick = (now: number) => {
      const u = Math.min(1, (now - start) / DUR);
      const e = ease(u);
      setOrbit({ ax: from.ax * (1 - e), ay: from.ay * (1 - e) });
      setView({ k: from.k + (1 - from.k) * e, tx: from.tx * (1 - e), ty: from.ty * (1 - e) });
      setRingMix(Math.max(0, from.mix * (1 - e)));
      if (u < 1) resetAnim.current = requestAnimationFrame(tick);
    };
    resetAnim.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(resetAnim.current);
    // Snapshot of camera state at the moment the signal fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.resetSignal]);

  // Camera handle — re-registered every render so getZoom reads live state.
  useEffect(() => {
    const ref = p.controlRef;
    if (!ref) return;
    ref.current = {
      getZoom: () => view.k,
      zoomTo: (k: number) => {
        cancelAnimationFrame(resetAnim.current);
        const kk = Math.min(2.5, Math.max(0.35, k));
        const cx = size.w / 2, cy = size.h / 2;
        setView(v => ({ k: kk, tx: cx - ((cx - v.tx) / v.k) * kk, ty: cy - ((cy - v.ty) / v.k) * kk }));
      },
      orbitBy: (dax: number, day: number) => {
        cancelAnimationFrame(resetAnim.current);
        setOrbit(o => ({ ax: Math.max(-1.35, Math.min(1.35, o.ax + dax)), ay: o.ay + day }));
      },
    };
    return () => { ref.current = null; };
  });
  useEffect(() => {
    p.onZoomChange?.(view.k);
    // p is a fresh object every render; only the zoom matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.k]);

  const toLocal = (ev: { clientX: number; clientY: number }) => {
    const r = wrapRef.current?.getBoundingClientRect();
    return {
      x: ((ev.clientX - (r?.left ?? 0)) - view.tx) / view.k,
      y: ((ev.clientY - (r?.top ?? 0)) - view.ty) / view.k,
    };
  };
  const hitNode = (x: number, y: number, exclude: Set<string>): string | null => {
    let best: string | null = null;
    let bestD = Infinity;
    for (const n of p.nodes) {
      if (exclude.has(n.id)) continue;
      const pos = positions.get(n.id);
      if (!pos) continue;
      const pr = proj(pos);
      const d = Math.hypot(pr.x - x, pr.y - y);
      if (d < nodeRadius(n) * pr.s + 26 && d < bestD) { best = n.id; bestD = d; }
    }
    return best;
  };

  const onNodeDown = (id: string, ev: React.PointerEvent) => {
    if (spaceHeld) return; // let the event bubble to the canvas pan
    ev.stopPropagation();
    if (p.pickMode && p.onPickTarget) { p.onPickTarget(id); return; }
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
    const inSel = p.selection.has(id);
    const ids = inSel ? [...p.selection] : [id];
    if (!inSel) p.onSelect(ev.shiftKey ? new Set([...p.selection, id]) : new Set([id]));
    gesture.current = { kind: 'node', ids, grabId: id, moved: false };
  };
  const onCanvasDown = (ev: React.PointerEvent) => {
    if (p.showcase) p.onShowcaseInterrupt?.();
    cancelAnimationFrame(resetAnim.current); // a touch takes over from a reset-in-flight
    if (ev.pointerType === 'touch') {
      (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId);
      touches.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      const pts = [...touches.current.values()];
      if (pts.length === 1) {
        // One finger moves around.
        gesture.current = { kind: 'pan', sx: ev.clientX, sy: ev.clientY, tx0: view.tx, ty0: view.ty };
        setPanning(true);
      } else if (pts.length === 2) {
        gesture.current = null;
        setPanning(false);
        touchGesture.current = {
          kind: 'pinch',
          d0: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
          k0: view.k,
          mx: (pts[0].x + pts[1].x) / 2, my: (pts[0].y + pts[1].y) / 2,
          tx0: view.tx, ty0: view.ty,
        };
      } else if (pts.length >= 3) {
        const cxm = pts.reduce((a, q) => a + q.x, 0) / pts.length;
        const cym = pts.reduce((a, q) => a + q.y, 0) / pts.length;
        touchGesture.current = { kind: 'orbit3', sx: cxm, sy: cym, ax0: orbit.ax, ay0: orbit.ay };
      }
      return;
    }
    if (ev.metaKey || ev.ctrlKey) {
      // Cmd-drag changes the orbit (founder's call).
      (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId);
      gesture.current = { kind: 'orbit', sx: ev.clientX, sy: ev.clientY, ax0: orbit.ax, ay0: orbit.ay };
      return;
    }
    if (spaceHeld) {
      (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId);
      gesture.current = { kind: 'pan', sx: ev.clientX, sy: ev.clientY, tx0: view.tx, ty0: view.ty };
      setPanning(true);
      return;
    }
    const { x, y } = toLocal(ev);
    gesture.current = { kind: 'marquee', x0: x, y0: y };
    setMarquee({ x0: x, y0: y, x1: x, y1: y });
  };
  const onMove = (ev: React.PointerEvent) => {
    if (ev.pointerType === 'touch' && touches.current.has(ev.pointerId)) {
      touches.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      const tg = touchGesture.current;
      const pts = [...touches.current.values()];
      if (tg?.kind === 'pinch' && pts.length >= 2) {
        const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const k = Math.min(2.5, Math.max(0.35, tg.k0 * (d / Math.max(1, tg.d0))));
        const mx = (pts[0].x + pts[1].x) / 2, my = (pts[0].y + pts[1].y) / 2;
        setView({ k, tx: tg.tx0 + (mx - tg.mx) + ((tg.mx - tg.tx0) * (1 - k / tg.k0)), ty: tg.ty0 + (my - tg.my) + ((tg.my - tg.ty0) * (1 - k / tg.k0)) });
        return;
      }
      if (tg?.kind === 'orbit3' && pts.length >= 3) {
        const cxm = pts.reduce((a, q) => a + q.x, 0) / pts.length;
        const cym = pts.reduce((a, q) => a + q.y, 0) / pts.length;
        setOrbit({
          ay: tg.ay0 + (cxm - tg.sx) * 0.006,
          ax: Math.max(-1.35, Math.min(1.35, tg.ax0 + (cym - tg.sy) * 0.006)),
        });
        return;
      }
      // fall through for one-finger pan via gesture.current
    }
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'orbit') {
      setOrbit({
        ay: g.ay0 + (ev.clientX - g.sx) * 0.005,
        ax: Math.max(-1.35, Math.min(1.35, g.ax0 + (ev.clientY - g.sy) * 0.005)),
      });
      return;
    }
    if (g.kind === 'pan') {
      setView(v => ({ ...v, tx: g.tx0 + (ev.clientX - g.sx), ty: g.ty0 + (ev.clientY - g.sy) }));
      return;
    }
    const { x, y } = toLocal(ev);
    if (g.kind === 'node') {
      g.moved = true;
      const grab = positions.get(g.grabId);
      // Pointer lives in PROJECTED space; map back onto the layout plane
      // (reference scale = the grabbed node's own projection).
      const sRef = grab ? proj(grab).s : 1;
      const plane = unproj(x, y, sRef);
      const dx = grab ? plane.x - grab.x : 0;
      const dy = grab ? plane.y - grab.y : 0;
      for (const id of g.ids) {
        const pos = positions.get(id);
        if (pos) dragTo(id, id === g.grabId ? plane.x : pos.x + dx, id === g.grabId ? plane.y : pos.y + dy);
      }
      const excluded = new Set(g.ids);
      for (const id of g.ids) for (const d of descendants(id)) excluded.add(d);
      setDropTarget(hitNode(x, y, excluded));
    } else {
      setMarquee({ x0: g.x0, y0: g.y0, x1: x, y1: y });
    }
  };
  const onUp = (ev: React.PointerEvent) => {
    if (ev.pointerType === 'touch') {
      touches.current.delete(ev.pointerId);
      if (touches.current.size < 2) touchGesture.current = null;
      if (touches.current.size === 0) setPanning(false);
    }
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.kind === 'orbit') return;
    if (g.kind === 'pan') {
      setPanning(false);
      return;
    }
    if (g.kind === 'node') {
      for (const id of g.ids) release(id);
      if (g.moved && dropTarget) {
        const movable = g.ids.filter(id => !byId.get(id)?.locked);
        if (movable.length) p.onReparent(movable, dropTarget);
      }
      setDropTarget(null);
    } else if (marquee) {
      const { x, y } = toLocal(ev);
      const [lx, hx] = [Math.min(marquee.x0, x), Math.max(marquee.x0, x)];
      const [ly, hy] = [Math.min(marquee.y0, y), Math.max(marquee.y0, y)];
      if (hx - lx < 6 && hy - ly < 6) {
        p.onSelect(new Set());
      } else {
        const hit = new Set<string>();
        for (const n of p.nodes) {
          const pos = positions.get(n.id);
          if (!pos) continue;
          const pr = proj(pos);
          if (pr.x >= lx && pr.x <= hx && pr.y >= ly && pr.y <= hy) hit.add(n.id);
        }
        p.onSelect(ev.shiftKey ? new Set([...p.selection, ...hit]) : hit);
      }
      setMarquee(null);
    }
  };

  // Delete / Backspace removes the selection (lanes excluded).
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (!(ev.key === 'Delete' || ev.key === 'Backspace')) return;
      const target = ev.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      const ids = [...p.selection].filter(id => !byId.get(id)?.locked);
      if (ids.length) { ev.preventDefault(); p.onDelete(ids); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p.selection, byId, p]);

  // Satellite gestures: a still release is a click (open product); a real
  // drag re-types the product on whatever node it lands on.
  const onProdDown = (pid: string, ev: React.PointerEvent) => {
    ev.stopPropagation();
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
    const { x, y } = toLocal(ev);
    setProdDrag({ id: pid, x, y, x0: x, y0: y });
  };
  const onProdMove = (ev: React.PointerEvent) => {
    if (!prodDrag) return;
    const { x, y } = toLocal(ev);
    setProdDrag({ ...prodDrag, x, y });
    if (Math.hypot(x - prodDrag.x0, y - prodDrag.y0) > CLICK_SLOP) {
      setDropTarget(hitNode(x, y, new Set()));
    }
  };
  const onProdUp = () => {
    if (!prodDrag) return;
    const travelled = Math.hypot(prodDrag.x - prodDrag.x0, prodDrag.y - prodDrag.y0);
    if (travelled <= CLICK_SLOP) p.onOpenProduct(prodDrag.id);
    else if (dropTarget) p.onAssignProducts([prodDrag.id], dropTarget);
    setProdDrag(null);
    setDropTarget(null);
  };

  const productsOnly = p.viewMode === 'products';
  const showSatellites = p.viewMode !== 'types';
  const rootPlane = positions.get(ROOT_ID) ?? { x: size.w / 2, y: size.h / 2 };
  const rootPos = proj(rootPlane);
  const singleSel = p.selection.size === 1 ? byId.get([...p.selection][0]) : null;
  const singleSelPosPlane = singleSel ? positions.get(singleSel.id) : null;
  const singleSelPos = singleSelPosPlane ? proj(singleSelPosPlane) : null;
  // Painter's order: far nodes first so near globes overlap them.
  const drawNodes = [...p.nodes]
    .map(n => ({ n, pp: positions.get(n.id) ? proj(positions.get(n.id)!) : null }))
    .filter((e): e is { n: BrainNode; pp: { x: number; y: number; s: number; z: number } } => !!e.pp)
    .sort((a, b) => a.pp.z - b.pp.z);
  // Each guide ring carries its own orbital plane: a per-index pair of
  // slow sinusoids (deterministic, so re-renders agree) layered on the
  // camera orbit, scaled by ringMix (0 = all rings flat on the layout
  // plane, 1 = full universe drift during showcase).
  const ringOrbit = (i: number) => ({
    ax: orbit.ax + Math.sin(ringTheta * (0.5 + i * 0.17) + i * 1.9) * 0.38 * ringMix,
    ay: orbit.ay + Math.sin(ringTheta * (0.33 + i * 0.11) + i * 0.7) * 0.55 * ringMix,
  });
  const ringPath = (r: number, idx: number) => {
    const o = ringOrbit(idx);
    const cx = size.w / 2, cy = size.h / 2;
    const pts: string[] = [];
    for (let i = 0; i <= 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const q = projWith(o, { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
      pts.push(`${i === 0 ? 'M' : 'L'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`);
    }
    return pts.join(' ');
  };

  return (
    <div ref={wrapRef} className={`tb-wrap${p.pickMode ? ' is-picking' : ''}${spaceHeld ? ' is-pan' : ''}${panning ? ' is-panning' : ''}`}>
      <svg
        className="tb-svg"
        width={size.w}
        height={size.h}
        onPointerDown={onCanvasDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
      >
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}>
        <defs>
          {/* Globe shading: a white key-light + a rim shadow layered over
              each node's flat color turn the discs into spheres. */}
          <radialGradient id="tb-globe-hi" cx="0.34" cy="0.3" r="0.75">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
            <stop offset="42%" stopColor="#fff" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="tb-globe-lo" cx="0.5" cy="0.5" r="0.5">
            <stop offset="55%" stopColor="#000" stopOpacity="0" />
            <stop offset="100%" stopColor="#000" stopOpacity="0.78" />
          </radialGradient>
          {/* Depth-of-field blur buckets (the f-stop dial picks how fast
              |z| falls into them). */}
          <filter id="tb-dof-1" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="1.3" /></filter>
          <filter id="tb-dof-2" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2.8" /></filter>
          <filter id="tb-dof-3" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="5" /></filter>
        </defs>
        {/* Depth guide rings — projected through the orbit so they read as
            orbital planes, not flat circles. */}
        {ringRadii.map((r, i) => (
          <path key={`ring-${i}`} className="tb-ring"
            style={{ strokeOpacity: p.ringOpacity }}
            fill="none"
            d={ringPath(r, i)} />
        ))}

        {/* Edges */}
        {p.nodes.map(n => {
          const a = positions.get(n.parentId ?? ROOT_ID);
          const b = positions.get(n.id);
          if (!a || !b) return null;
          const pa = n.parentId ? proj(a) : rootPos;
          const pb = proj(b);
          return (
            <line key={`e-${n.id}`} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
              stroke={n.color} strokeOpacity={0.28} strokeWidth={1.2} />
          );
        })}

        {/* Root — hover it to grow a new tier-1 type */}
        <g className="tb-root"
          onPointerEnter={() => hoverEnter(ROOT_ID)}
          onPointerLeave={hoverLeave}
        >
          <circle cx={rootPos.x} cy={rootPos.y} r={34 * rootPos.s} />
          <circle cx={rootPos.x} cy={rootPos.y} r={34 * rootPos.s} fill="url(#tb-globe-hi)" pointerEvents="none" />
          <circle cx={rootPos.x} cy={rootPos.y} r={34 * rootPos.s} fill="url(#tb-globe-lo)" pointerEvents="none" />
          <text x={rootPos.x} y={rootPos.y + 4}>catalog</text>
        </g>

        {/* Nodes */}
        {drawNodes.map(({ n, pp }) => {
          const r = nodeRadius(n) * pp.s;
          const selected = p.selection.has(n.id);
          const isDrop = dropTarget === n.id;
          return (
            <g
              key={n.id}
              className={`tb-node${selected ? ' is-selected' : ''}${isDrop ? ' is-drop' : ''}${n.locked ? ' is-locked' : ''}`}
              opacity={0.45 + 0.55 * Math.min(1, pp.s)}
              filter={dofFilter(pp.z)}
              onPointerDown={ev => onNodeDown(n.id, ev)}
              onDoubleClick={() => p.onDrill(n.id, pp.x * view.k + view.tx, pp.y * view.k + view.ty)}
              onPointerEnter={() => hoverEnter(n.id)}
              onPointerLeave={hoverLeave}
            >
              <circle cx={pp.x} cy={pp.y} r={productsOnly ? Math.max(7, r * 0.4) : r}
                fill={n.color} fillOpacity={productsOnly ? 0.18 : n.depth === 1 ? 0.4 : 0.32}
                stroke={n.color} strokeOpacity={productsOnly ? 0.4 : 1}
                strokeWidth={selected || isDrop ? 2.5 : 1.4} />
              {!productsOnly && (
                <>
                  <circle cx={pp.x} cy={pp.y} r={r} fill="url(#tb-globe-hi)" pointerEvents="none" />
                  <circle cx={pp.x} cy={pp.y} r={r} fill="url(#tb-globe-lo)" pointerEvents="none" />
                </>
              )}
              {n.icon && !productsOnly && (() => {
                const s = r * 1.15; // icon box inside the globe
                return (
                  <path
                    className="tb-icon"
                    d={n.icon}
                    stroke={n.color}
                    transform={`translate(${pp.x - s / 2}, ${pp.y - s / 2}) scale(${s / 24})`}
                  />
                );
              })()}
              {!productsOnly && (
                <text
                  className="tb-label"
                  x={pp.x} y={pp.y + r + 14} fill={n.color}
                  onPointerDown={ev => ev.stopPropagation()}
                  onClick={ev => { ev.stopPropagation(); if (!n.locked) setEditing(n.id); }}
                >{n.name}</text>
              )}
            </g>
          );
        })}

        {marquee && (
          <rect className="tb-marquee"
            x={Math.min(marquee.x0, marquee.x1)} y={Math.min(marquee.y0, marquee.y1)}
            width={Math.abs(marquee.x1 - marquee.x0)} height={Math.abs(marquee.y1 - marquee.y0)} />
        )}
        </g>
      </svg>

      {/* HTML overlay: product satellites, rename input, add-child button */}
      <div
        className="tb-overlay"
        style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.k})`, transformOrigin: '0 0' }}
        onPointerMove={onProdMove}
        onPointerUp={onProdUp}
      >
        {showSatellites && p.nodes.map(n => {
          const sat = p.satellites.get(n.id);
          const plane = positions.get(n.id);
          if (!sat || !plane || sat.items.length === 0) return null;
          const pos = proj(plane);
          const r = nodeRadius(n) * pos.s;
          const overflow = sat.total - sat.items.length;
          // Moving-rings: this type's whole satellite ring rotates by its own
          // signed rate, so neighbours spin at different speeds + directions.
          const ringSpin = p.movingRings ? spin * ringRate(n.id) : 0;
          return sat.items.map((prod, i) => {
            // Even orbit starting at 12 o'clock; overflow chip takes the
            // 6 o'clock spot below the label.
            const angle = (i / sat.items.length) * Math.PI * 2 - Math.PI / 2 + ringSpin;
            const dragging = prodDrag?.id === prod.id;
            const x = dragging ? prodDrag.x : pos.x + Math.cos(angle) * (r + 28);
            const y = dragging ? prodDrag.y : pos.y + Math.sin(angle) * (r + 28);
            return (
              <button
                key={prod.id}
                className={`tb-sat${dragging ? ' is-dragging' : ''}`}
                style={{ left: x, top: y }}
                title={`${prod.name} — click to open, drag onto a type to reassign`}
                onPointerDown={ev => onProdDown(prod.id, ev)}
              >
                {prod.image
                  ? <img src={prod.image} alt="" loading="lazy" decoding="async" />
                  : <span>{prod.name.slice(0, 2)}</span>}
              </button>
            );
          }).concat(overflow > 0 ? [
            <div key={`more-${n.id}`} className="tb-sat-more"
              style={{ left: pos.x, top: pos.y + r + 30 }}>
              +{overflow}
            </div>,
          ] : []);
        })}

        {hovered === ROOT_ID && !p.pickMode && (
          <button
            className="tb-add"
            style={{ left: rootPos.x + 34 * rootPos.s + 16, top: rootPos.y }}
            title="Add a new top-level type"
            onPointerEnter={() => hoverEnter(ROOT_ID)}
            onPointerLeave={hoverLeave}
            onClick={() => p.onAddChild(ROOT_ID)}
          >+</button>
        )}

        {hovered && !p.pickMode && (() => {
          const n = byId.get(hovered);
          const plane = positions.get(hovered);
          if (!n || !plane) return null;
          const pos = proj(plane);
          const r = nodeRadius(n) * pos.s;
          return (
            <button
              className="tb-drill"
              style={{ left: pos.x - r - 16, top: pos.y }}
              title={`Drill into ${n.name} — see every product inside`}
              onPointerEnter={() => hoverEnter(n.id)}
              onPointerLeave={hoverLeave}
              onClick={() => p.onDrill(n.id, pos.x * view.k + view.tx, pos.y * view.k + view.ty)}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3M8 11h6M11 8v6" />
              </svg>
            </button>
          );
        })()}

        {editing && (() => {
          const n = byId.get(editing);
          const plane = positions.get(editing);
          if (!n || !plane) return null;
          const pos = proj(plane);
          return (
            <input
              key={editing}
              className="tb-rename"
              style={{ left: pos.x, top: pos.y + nodeRadius(n) * pos.s + 14 }}
              defaultValue={n.name}
              autoFocus
              onFocus={ev => ev.currentTarget.select()}
              onPointerDown={ev => ev.stopPropagation()}
              onKeyDown={ev => {
                if (ev.key === 'Enter') {
                  const v = ev.currentTarget.value.trim();
                  if (v && v !== n.name) p.onRename(n.id, v);
                  setEditing(null);
                } else if (ev.key === 'Escape') setEditing(null);
              }}
              onBlur={() => setEditing(null)}
            />
          );
        })()}

        {singleSel && singleSelPos && (
          <button
            className="tb-add"
            style={{ left: singleSelPos.x + nodeRadius(singleSel) * singleSelPos.s + 16, top: singleSelPos.y }}
            title={`Add a type under ${singleSel.name}`}
            onClick={() => p.onAddChild(singleSel.id)}
          >+</button>
        )}
      </div>
    </div>
  );
}

function nodeRadius(n: BrainNode): number {
  const base = n.depth === 1 ? 24 : n.depth === 2 ? 19 : 14;
  return base + Math.min(6, Math.sqrt(n.count) * 1.5);
}

// Deterministic per-node angular rate for "moving rings": a stable hash of the
// id gives each type ring its own speed (0.6..1.5×) and direction (± by parity),
// so the rings churn independently rather than in lockstep.
function ringRate(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const mag = 0.6 + ((h % 1000) / 1000) * 0.9;
  return (h & 1) ? mag : -mag;
}

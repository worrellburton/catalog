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
}

const ROOT_ID = '__root__';
/** Below this much pointer travel a satellite gesture counts as a click. */
const CLICK_SLOP = 5;

export default function TypeBrainGraph(p: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1100, h: 720 });
  // Zoom/pan view transform: screen = world * k + (tx, ty). Cmd/ctrl +
  // wheel zooms about the pointer (ctrlKey also covers trackpad pinch).
  const [view, setView] = useState({ k: 1, tx: 0, ty: 0 });
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
  const { positions, dragTo, release, ringRadii } = useForceSim(simNodes, simLinks, size.w, size.h, p.ringScale);

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
    | null
  >(null);
  const [panning, setPanning] = useState(false);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [prodDrag, setProdDrag] = useState<{ id: string; x: number; y: number; x0: number; y0: number } | null>(null);
  // Hovered node — surfaces the drill affordance. Small leave-delay so the
  // pointer can travel from the circle to the drill button without flicker.
  const [hovered, setHovered] = useState<string | null>(null);
  const hoverTimer = useRef(0);
  const hoverEnter = (id: string) => { window.clearTimeout(hoverTimer.current); setHovered(id); };
  const hoverLeave = () => {
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setHovered(null), 160);
  };

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
      const d = Math.hypot(pos.x - x, pos.y - y);
      if (d < nodeRadius(n) + 26 && d < bestD) { best = n.id; bestD = d; }
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
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'pan') {
      setView(v => ({ ...v, tx: g.tx0 + (ev.clientX - g.sx), ty: g.ty0 + (ev.clientY - g.sy) }));
      return;
    }
    const { x, y } = toLocal(ev);
    if (g.kind === 'node') {
      g.moved = true;
      const grab = positions.get(g.grabId);
      const dx = grab ? x - grab.x : 0;
      const dy = grab ? y - grab.y : 0;
      for (const id of g.ids) {
        const pos = positions.get(id);
        if (pos) dragTo(id, id === g.grabId ? x : pos.x + dx, id === g.grabId ? y : pos.y + dy);
      }
      const excluded = new Set(g.ids);
      for (const id of g.ids) for (const d of descendants(id)) excluded.add(d);
      setDropTarget(hitNode(x, y, excluded));
    } else {
      setMarquee({ x0: g.x0, y0: g.y0, x1: x, y1: y });
    }
  };
  const onUp = (ev: React.PointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
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
          if (pos && pos.x >= lx && pos.x <= hx && pos.y >= ly && pos.y <= hy) hit.add(n.id);
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
  const rootPos = positions.get(ROOT_ID) ?? { x: size.w / 2, y: size.h / 2 };
  const singleSel = p.selection.size === 1 ? byId.get([...p.selection][0]) : null;
  const singleSelPos = singleSel ? positions.get(singleSel.id) : null;

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
        {/* Depth guide rings — layer N of the tree IS ring N */}
        {ringRadii.map((r, i) => (
          <circle key={`ring-${i}`} className="tb-ring"
            style={{ strokeOpacity: p.ringOpacity }}
            cx={size.w / 2} cy={size.h / 2} r={r} />
        ))}

        {/* Edges */}
        {p.nodes.map(n => {
          const a = positions.get(n.parentId ?? ROOT_ID);
          const b = positions.get(n.id);
          if (!a || !b) return null;
          return (
            <line key={`e-${n.id}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={n.color} strokeOpacity={0.28} strokeWidth={1.2} />
          );
        })}

        {/* Root */}
        <g className="tb-root">
          <circle cx={rootPos.x} cy={rootPos.y} r={34} />
          <text x={rootPos.x} y={rootPos.y + 4}>catalog</text>
        </g>

        {/* Nodes */}
        {p.nodes.map(n => {
          const pos = positions.get(n.id);
          if (!pos) return null;
          const r = nodeRadius(n);
          const selected = p.selection.has(n.id);
          const isDrop = dropTarget === n.id;
          return (
            <g
              key={n.id}
              className={`tb-node${selected ? ' is-selected' : ''}${isDrop ? ' is-drop' : ''}${n.locked ? ' is-locked' : ''}`}
              onPointerDown={ev => onNodeDown(n.id, ev)}
              onDoubleClick={() => p.onDrill(n.id, pos.x * view.k + view.tx, pos.y * view.k + view.ty)}
              onPointerEnter={() => hoverEnter(n.id)}
              onPointerLeave={hoverLeave}
            >
              <circle cx={pos.x} cy={pos.y} r={productsOnly ? Math.max(7, r * 0.4) : r}
                fill={n.color} fillOpacity={productsOnly ? 0.1 : n.depth === 1 ? 0.22 : 0.16}
                stroke={n.color} strokeOpacity={productsOnly ? 0.4 : 1}
                strokeWidth={selected || isDrop ? 2.5 : 1.4} />
              {n.icon && !productsOnly && (() => {
                const s = r * 1.15; // icon box inside the circle
                return (
                  <path
                    className="tb-icon"
                    d={n.icon}
                    stroke={n.color}
                    transform={`translate(${pos.x - s / 2}, ${pos.y - s / 2}) scale(${s / 24})`}
                  />
                );
              })()}
              {!productsOnly && <text x={pos.x} y={pos.y + r + 14} fill={n.color}>{n.name}</text>}
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
          const pos = positions.get(n.id);
          if (!sat || !pos || sat.items.length === 0) return null;
          const r = nodeRadius(n);
          const overflow = sat.total - sat.items.length;
          return sat.items.map((prod, i) => {
            // Even orbit starting at 12 o'clock; overflow chip takes the
            // 6 o'clock spot below the label.
            const angle = (i / sat.items.length) * Math.PI * 2 - Math.PI / 2;
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

        {hovered && !p.pickMode && (() => {
          const n = byId.get(hovered);
          const pos = positions.get(hovered);
          if (!n || !pos) return null;
          const r = nodeRadius(n);
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

        {singleSel && singleSelPos && (
          <button
            className="tb-add"
            style={{ left: singleSelPos.x + nodeRadius(singleSel) + 16, top: singleSelPos.y }}
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

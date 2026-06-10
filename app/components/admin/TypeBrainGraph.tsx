// The governance "type brain" — an Obsidian-style force graph of the
// product-type tree. Catalog sits at the centre; rings radiate by depth;
// gender lanes are color-coded and tint their descendants.
//
// Interactions:
//   drag empty canvas   → marquee multi-select
//   click / shift-click → select / extend selection
//   drag node(s)        → move; release over another node stages a re-parent
//   double-click        → inline rename (staged)
//   ⌫ / Delete          → stage delete of selection
//   product satellites  → drag onto a node to (re)assign those products
//
// All mutations are STAGED via callbacks — nothing writes until the page's
// Apply bar commits.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useForceSim, type SimLink, type SimNodeInput } from '~/hooks/useForceSim';

export interface BrainNode {
  id: string;
  name: string;
  parentId: string | null;   // null = child of the synthetic root
  depth: number;             // root = 0
  color: string;             // resolved lane color
  count: number;             // directly attached products
  locked: boolean;           // gender lanes — no rename/move/delete
}

export interface BrainProduct { id: string; name: string; image: string | null; }

interface Props {
  nodes: BrainNode[];        // excludes the synthetic root
  selection: Set<string>;
  showProducts: boolean;
  fannedNodeId: string | null;
  fannedProducts: BrainProduct[];
  onSelect: (ids: Set<string>) => void;
  onReparent: (nodeIds: string[], targetId: string) => void;
  onRename: (nodeId: string, name: string) => void;
  onDelete: (nodeIds: string[]) => void;
  onAddChild: (parentId: string) => void;
  onFan: (nodeId: string | null) => void;
  onAssignProducts: (productIds: string[], nodeId: string) => void;
}

const ROOT_ID = '__root__';
const FAN_MAX = 18;

export default function TypeBrainGraph(p: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1100, h: 720 });
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
  const { positions, dragTo, release } = useForceSim(simNodes, simLinks, size.w, size.h);

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

  // ── Drag / marquee state (refs — no re-render per pointermove except
  //    through the sim's own position updates) ──
  const gesture = useRef<
    | { kind: 'node'; ids: string[]; grabId: string; moved: boolean }
    | { kind: 'marquee'; x0: number; y0: number }
    | null
  >(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [prodDrag, setProdDrag] = useState<{ id: string; x: number; y: number } | null>(null);

  const toLocal = (ev: { clientX: number; clientY: number }) => {
    const r = wrapRef.current?.getBoundingClientRect();
    return { x: ev.clientX - (r?.left ?? 0), y: ev.clientY - (r?.top ?? 0) };
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
    ev.stopPropagation();
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
    const inSel = p.selection.has(id);
    const ids = inSel ? [...p.selection] : [id];
    if (!inSel) p.onSelect(ev.shiftKey ? new Set([...p.selection, id]) : new Set([id]));
    gesture.current = { kind: 'node', ids, grabId: id, moved: false };
  };
  const onCanvasDown = (ev: React.PointerEvent) => {
    const { x, y } = toLocal(ev);
    gesture.current = { kind: 'marquee', x0: x, y0: y };
    setMarquee({ x0: x, y0: y, x1: x, y1: y });
  };
  const onMove = (ev: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
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
    if (g.kind === 'node') {
      for (const id of g.ids) release(id);
      if (g.moved && dropTarget) {
        const movable = g.ids.filter(id => !byId.get(id)?.locked);
        if (movable.length) p.onReparent(movable, dropTarget);
      } else if (!g.moved) {
        // Plain click: fan products open/closed when the toggle is on.
        if (p.showProducts) p.onFan(p.fannedNodeId === g.grabId ? null : g.grabId);
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

  // Delete / Backspace stages deletion of the selection (lanes excluded).
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (editing || !(ev.key === 'Delete' || ev.key === 'Backspace')) return;
      const target = ev.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      const ids = [...p.selection].filter(id => !byId.get(id)?.locked);
      if (ids.length) { ev.preventDefault(); p.onDelete(ids); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p.selection, editing, byId, p]);

  // Product satellite drag → assign to the node it's dropped on.
  const onProdDown = (pid: string, ev: React.PointerEvent) => {
    ev.stopPropagation();
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
    const { x, y } = toLocal(ev);
    setProdDrag({ id: pid, x, y });
  };
  const onProdMove = (ev: React.PointerEvent) => {
    if (!prodDrag) return;
    const { x, y } = toLocal(ev);
    setProdDrag({ ...prodDrag, x, y });
    setDropTarget(hitNode(x, y, new Set()));
  };
  const onProdUp = () => {
    if (prodDrag && dropTarget) p.onAssignProducts([prodDrag.id], dropTarget);
    setProdDrag(null);
    setDropTarget(null);
  };

  const rootPos = positions.get(ROOT_ID) ?? { x: size.w / 2, y: size.h / 2 };
  const fannedPos = p.fannedNodeId ? positions.get(p.fannedNodeId) : null;
  const fanned = p.fannedProducts.slice(0, FAN_MAX);
  const singleSel = p.selection.size === 1 ? byId.get([...p.selection][0]) : null;
  const singleSelPos = singleSel ? positions.get(singleSel.id) : null;

  return (
    <div ref={wrapRef} className="tb-wrap">
      <svg
        className="tb-svg"
        width={size.w}
        height={size.h}
        onPointerDown={onCanvasDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
      >
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
              onDoubleClick={() => { if (!n.locked) setEditing(n.id); }}
            >
              <circle cx={pos.x} cy={pos.y} r={r}
                fill={n.color} fillOpacity={n.depth === 1 ? 0.22 : 0.16}
                stroke={n.color} strokeWidth={selected || isDrop ? 2.5 : 1.4} />
              <text x={pos.x} y={pos.y + r + 14} fill={n.color}>{n.name}</text>
              {p.showProducts && n.count > 0 && (
                <g className="tb-badge">
                  <circle cx={pos.x + r * 0.85} cy={pos.y - r * 0.85} r={10} />
                  <text x={pos.x + r * 0.85} y={pos.y - r * 0.85 + 3.5}>{n.count}</text>
                </g>
              )}
            </g>
          );
        })}

        {marquee && (
          <rect className="tb-marquee"
            x={Math.min(marquee.x0, marquee.x1)} y={Math.min(marquee.y0, marquee.y1)}
            width={Math.abs(marquee.x1 - marquee.x0)} height={Math.abs(marquee.y1 - marquee.y0)} />
        )}
      </svg>

      {/* HTML overlay: product satellites, rename input, add-child button */}
      <div className="tb-overlay" onPointerMove={onProdMove} onPointerUp={onProdUp}>
        {p.showProducts && fannedPos && fanned.map((prod, i) => {
          const angle = (i / Math.max(fanned.length, 1)) * Math.PI * 2 - Math.PI / 2;
          const rad = 64 + (fanned.length > 10 ? 18 : 0);
          const dragging = prodDrag?.id === prod.id;
          const x = dragging ? prodDrag.x : fannedPos.x + Math.cos(angle) * rad;
          const y = dragging ? prodDrag.y : fannedPos.y + Math.sin(angle) * rad;
          return (
            <button
              key={prod.id}
              className={`tb-sat${dragging ? ' is-dragging' : ''}`}
              style={{ left: x, top: y }}
              title={`${prod.name} — drag onto a type to reassign`}
              onPointerDown={ev => onProdDown(prod.id, ev)}
            >
              {prod.image
                ? <img src={prod.image} alt="" loading="lazy" decoding="async" />
                : <span>{prod.name.slice(0, 2)}</span>}
            </button>
          );
        })}
        {p.showProducts && fannedPos && p.fannedProducts.length > FAN_MAX && (
          <div className="tb-sat-more" style={{ left: fannedPos.x, top: fannedPos.y + 96 }}>
            +{p.fannedProducts.length - FAN_MAX} more
          </div>
        )}

        {editing && (() => {
          const n = byId.get(editing);
          const pos = positions.get(editing);
          if (!n || !pos) return null;
          return (
            <input
              key={editing}
              className="tb-rename"
              style={{ left: pos.x, top: pos.y }}
              defaultValue={n.name}
              autoFocus
              onFocus={ev => ev.currentTarget.select()}
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

        {singleSel && singleSelPos && !editing && (
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

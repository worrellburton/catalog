// /admin/governance/types — the type brain. An Obsidian-style force graph
// of the product-type taxonomy with catalog at the centre.
//
// Edits are LIVE (founder's call): every gesture writes to the tree and
// cascades into products immediately — renames rewrite products.type,
// cross-lane moves rewrite products.gender, satellite drags re-type single
// products. Each gesture precomputes its inverse from snapshots, so Undo
// (toast or the session log) restores exact prior values. Writes run
// through a sequential queue so rapid gestures land in order.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TypeBrainGraph, { type BrainNode, type BrainProduct } from '~/components/admin/TypeBrainGraph';
import {
  createTypeNode,
  executeGovernanceOps,
  fetchGovernanceProducts,
  fetchTypeTree,
  normalizeTypeName,
  snapshotGroups,
  type GovernanceOp,
  type GovernanceProduct,
  type TypeNode,
} from '~/services/type-governance';
import { productSlug } from '~/utils/slug';
import '~/styles/governance.css';

const UNASSIGNED_ID = '__unassigned__';
const NEUTRAL = '#cbd5e1';
const GENDER_LANES = new Set(['male', 'female', 'unisex']);
const SAT_CAP = 6;

interface HistoryEntry {
  label: string;
  inverse: GovernanceOp[];
  undone: boolean;
  at: number;
}

export default function AdminGovernanceTypes() {
  const [tree, setTree] = useState<TypeNode[]>([]);
  const [products, setProducts] = useState<GovernanceProduct[]>([]);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [showProducts, setShowProducts] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [toast, setToast] = useState<{ label: string; key: number } | null>(null);
  const toastTimer = useRef(0);
  // Sequential write queue — rapid gestures stay ordered.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const reload = useCallback(async () => {
    const [t, p] = await Promise.all([fetchTypeTree(), fetchGovernanceProducts()]);
    setTree(t);
    setProducts(p);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const showToast = useCallback((label: string) => {
    window.clearTimeout(toastTimer.current);
    setToast({ label, key: Date.now() });
    toastTimer.current = window.setTimeout(() => setToast(null), 5000);
  }, []);

  /** Optimistic local apply + queued DB write + undo recording. */
  const commit = useCallback((
    label: string,
    ops: GovernanceOp[],
    inverse: GovernanceOp[],
    optimistic: () => void,
  ) => {
    optimistic();
    setHistory(prev => [...prev, { label, inverse, undone: false, at: Date.now() }]);
    showToast(label);
    queue.current = queue.current.then(async () => {
      const err = await executeGovernanceOps(ops);
      if (err) {
        showToast(`Failed: ${err} — reloading`);
        await reload();
      }
    });
  }, [reload, showToast]);

  const handleUndo = useCallback(() => {
    setHistory(prev => {
      const idx = [...prev].reverse().findIndex(h => !h.undone);
      if (idx === -1) return prev;
      const real = prev.length - 1 - idx;
      const entry = prev[real];
      queue.current = queue.current.then(async () => {
        const err = await executeGovernanceOps(entry.inverse);
        if (err) showToast(`Undo failed: ${err}`);
        await reload();
      });
      showToast(`Undid: ${entry.label}`);
      return prev.map((h, i) => i === real ? { ...h, undone: true } : h);
    });
  }, [reload, showToast]);

  // ── Derived structure ──
  const meta = useMemo(() => {
    const byId = new Map(tree.map(n => [n.id, n]));
    const out = new Map<string, { depth: number; lane: string | null; color: string }>();
    const resolve = (n: TypeNode): { depth: number; lane: string | null; color: string } => {
      const cached = out.get(n.id);
      if (cached) return cached;
      const parent = n.parentId ? byId.get(n.parentId) : null;
      const up = parent ? resolve(parent) : { depth: 0, lane: null as string | null, color: NEUTRAL };
      const isLane = !!parent && up.depth === 1 && GENDER_LANES.has(n.name);
      const m = {
        depth: up.depth + 1,
        lane: isLane ? n.name : up.lane,
        color: n.color ?? (up.color !== NEUTRAL ? up.color : NEUTRAL),
      };
      out.set(n.id, m);
      return m;
    };
    tree.forEach(resolve);
    return out;
  }, [tree]);

  const { attach, unassigned } = useMemo(() => {
    const byName = new Map<string, string>();
    for (const n of tree) byName.set(normalizeTypeName(n.name), n.id);
    const attach = new Map<string, GovernanceProduct[]>();
    const unassigned: GovernanceProduct[] = [];
    for (const prod of products) {
      const nodeId = prod.type ? byName.get(normalizeTypeName(prod.type)) : undefined;
      if (nodeId) attach.set(nodeId, [...(attach.get(nodeId) ?? []), prod]);
      else unassigned.push(prod);
    }
    return { attach, unassigned };
  }, [tree, products]);

  const brainNodes = useMemo<BrainNode[]>(() => {
    const nodes = tree.map(n => {
      const m = meta.get(n.id) ?? { depth: 1, lane: null, color: NEUTRAL };
      return {
        id: n.id, name: n.name, parentId: n.parentId, depth: m.depth,
        color: m.color, count: attach.get(n.id)?.length ?? 0,
        locked: m.depth === 2 && GENDER_LANES.has(n.name),
      };
    });
    if (showProducts && unassigned.length) {
      nodes.push({
        id: UNASSIGNED_ID, name: 'unassigned', parentId: null, depth: 1,
        color: '#f59e0b', count: unassigned.length, locked: true,
      });
    }
    return nodes;
  }, [tree, meta, attach, showProducts, unassigned.length]);

  const satellites = useMemo(() => {
    const m = new Map<string, { items: BrainProduct[]; total: number }>();
    for (const [nodeId, list] of attach) {
      m.set(nodeId, { items: list.slice(0, SAT_CAP), total: list.length });
    }
    if (unassigned.length) {
      m.set(UNASSIGNED_ID, { items: unassigned.slice(0, SAT_CAP), total: unassigned.length });
    }
    return m;
  }, [attach, unassigned]);

  const subtreeIds = useCallback((rootId: string): Set<string> => {
    const ids = new Set<string>([rootId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const n of tree) {
        if (n.parentId && ids.has(n.parentId) && !ids.has(n.id)) { ids.add(n.id); grew = true; }
      }
    }
    return ids;
  }, [tree]);

  // ── Gestures ──
  const handleRename = (nodeId: string, to: string) => {
    const node = tree.find(n => n.id === nodeId);
    if (!node || node.name === to) return;
    const matched = attach.get(nodeId) ?? [];
    const ids = matched.map(p => p.id);
    commit(
      `Renamed ${node.name} → ${to} · ${ids.length} products`,
      [
        { op: 'node-update', id: nodeId, patch: { name: to } },
        { op: 'products-update', groups: [{ ids, patch: { type: to } }] },
      ],
      [
        { op: 'node-update', id: nodeId, patch: { name: node.name } },
        { op: 'products-update', groups: snapshotGroups(matched, 'type') },
      ],
      () => {
        setTree(prev => prev.map(n => n.id === nodeId ? { ...n, name: to } : n));
        const idSet = new Set(ids);
        setProducts(prev => prev.map(p => idSet.has(p.id) ? { ...p, type: to } : p));
      },
    );
  };

  const handleReparent = (nodeIds: string[], targetId: string) => {
    if (targetId === UNASSIGNED_ID) return;
    const targetLane = meta.get(targetId)?.lane ?? null;
    const ops: GovernanceOp[] = [];
    const inverse: GovernanceOp[] = [];
    const moves: { nodeId: string; genderIds: Set<string> }[] = [];
    const labels: string[] = [];
    for (const nodeId of nodeIds) {
      const node = tree.find(n => n.id === nodeId);
      if (!node || nodeId === targetId || nodeId === UNASSIGNED_ID) continue;
      if (subtreeIds(nodeId).has(targetId)) continue; // no cycles
      if (node.parentId === targetId) continue;
      const lane = meta.get(nodeId)?.lane ?? null;
      const crossesLane = !!targetLane && targetLane !== lane;
      const subProds = crossesLane
        ? [...subtreeIds(nodeId)].flatMap(id => attach.get(id) ?? [])
        : [];
      ops.push({ op: 'node-update', id: nodeId, patch: { parent_id: targetId } });
      inverse.unshift({ op: 'node-update', id: nodeId, patch: { parent_id: node.parentId } });
      if (subProds.length && targetLane) {
        ops.push({ op: 'products-update', groups: [{ ids: subProds.map(p => p.id), patch: { gender: targetLane } }] });
        inverse.unshift({ op: 'products-update', groups: snapshotGroups(subProds, 'gender') });
      }
      moves.push({ nodeId, genderIds: new Set(subProds.map(p => p.id)) });
      labels.push(`${node.name}${subProds.length ? ` (${subProds.length} products → ${targetLane})` : ''}`);
    }
    if (!moves.length) return;
    const targetName = tree.find(n => n.id === targetId)?.name ?? '?';
    commit(
      `Moved ${labels.join(', ')} → ${targetName}`,
      ops, inverse,
      () => {
        const moved = new Map(moves.map(m => [m.nodeId, m]));
        setTree(prev => prev.map(n => moved.has(n.id) ? { ...n, parentId: targetId } : n));
        if (targetLane) {
          const allGenderIds = new Set(moves.flatMap(m => [...m.genderIds]));
          if (allGenderIds.size) {
            setProducts(prev => prev.map(p => allGenderIds.has(p.id) ? { ...p, gender: targetLane } : p));
          }
        }
      },
    );
  };

  const handleDelete = (nodeIds: string[]) => {
    // Only top-most selected nodes — descendants cascade.
    const tops = nodeIds.filter(id =>
      !nodeIds.some(other => other !== id && subtreeIds(other).has(id)));
    const ops: GovernanceOp[] = [];
    const rows: { id: string; name: string; parent_id: string | null; sort: number; color: string | null }[] = [];
    const names: string[] = [];
    let orphaned = 0;
    for (const id of tops) {
      if (id === UNASSIGNED_ID) continue;
      const sub = subtreeIds(id);
      // BFS order (parents first) so the undo re-insert satisfies the FK.
      const ordered = tree.filter(n => sub.has(n.id));
      rows.push(...ordered.map(n => ({
        id: n.id, name: n.name, parent_id: n.parentId, sort: n.sort, color: n.color,
      })));
      orphaned += [...sub].reduce((acc, sid) => acc + (attach.get(sid)?.length ?? 0), 0);
      ops.push({ op: 'node-delete', id });
      names.push(tree.find(n => n.id === id)?.name ?? '?');
    }
    if (!ops.length) return;
    const dead = new Set(rows.map(r => r.id));
    commit(
      `Deleted ${names.join(', ')}${orphaned ? ` · ${orphaned} products unassigned` : ''}`,
      ops,
      [{ op: 'node-insert', rows }],
      () => setTree(prev => prev.filter(n => !dead.has(n.id))),
    );
    setSelection(new Set());
  };

  const handleAddChild = async (parentId: string) => {
    if (parentId === UNASSIGNED_ID) return;
    const created = await createTypeNode('new type', parentId);
    if (!created) { showToast('Failed to add type'); return; }
    setTree(prev => [...prev, created]);
    setHistory(prev => [...prev, {
      label: `Added type under ${tree.find(n => n.id === parentId)?.name ?? '?'}`,
      inverse: [{ op: 'node-delete', id: created.id }],
      undone: false, at: Date.now(),
    }]);
    showToast('Added "new type" — double-click it to rename');
  };

  const handleAssign = (productIds: string[], nodeId: string) => {
    if (nodeId === UNASSIGNED_ID) return;
    const node = tree.find(n => n.id === nodeId);
    if (!node) return;
    const lane = meta.get(nodeId)?.lane ?? undefined;
    const idSet = new Set(productIds);
    const matched = products.filter(p => idSet.has(p.id));
    const patch: { type: string; gender?: string } = { type: node.name };
    if (lane) patch.gender = lane;
    const inverse: GovernanceOp[] = [{ op: 'products-update', groups: snapshotGroups(matched, 'type') }];
    if (lane) inverse.push({ op: 'products-update', groups: snapshotGroups(matched, 'gender') });
    commit(
      `Re-typed ${matched.length} product${matched.length === 1 ? '' : 's'} → ${node.name}`,
      [{ op: 'products-update', groups: [{ ids: productIds, patch }] }],
      inverse,
      () => setProducts(prev => prev.map(p =>
        idSet.has(p.id) ? { ...p, type: node.name, ...(lane ? { gender: lane } : {}) } : p)),
    );
  };

  const handleOpenProduct = (productId: string) => {
    const prod = products.find(p => p.id === productId);
    if (!prod) return;
    window.open(`/p/${productSlug(prod)}`, '_blank', 'noopener');
  };

  const canUndo = history.some(h => !h.undone);

  return (
    <div className="gov-page">
      {/* div, not <header> — the consumer header.css styles the header ELEMENT
          globally (position:fixed), which would yank this out of flow. */}
      <div className="gov-head">
        <div>
          <p className="gov-kicker">Governance</p>
          <h1>Types — set up for more possibilities</h1>
          <p className="gov-sub">
            One editable structure for every product type. Drag to rearrange, double-click to
            rename, marquee to select many. Changes are live — every edit cascades to its
            products immediately, and Undo restores exact prior values.
          </p>
        </div>
        <div className="gov-controls">
          <div className="gov-controls-row">
            <button type="button" className="gov-ghost" disabled={!canUndo} onClick={handleUndo}>
              ↩ Undo
            </button>
            <button type="button" className="gov-ghost" onClick={() => setLogOpen(v => !v)}>
              History{history.length ? ` (${history.length})` : ''}
            </button>
            <button
              type="button"
              className={`gov-toggle${showProducts ? ' is-on' : ''}`}
              onClick={() => setShowProducts(v => !v)}
            >
              <span className="gov-toggle-dot" />
              Products {showProducts ? 'on' : 'off'}
            </button>
          </div>
          <div className="gov-legend">
            <span style={{ ['--c' as string]: '#60a5fa' }}>male</span>
            <span style={{ ['--c' as string]: '#f472b6' }}>female</span>
            <span style={{ ['--c' as string]: '#34d399' }}>unisex</span>
            <span style={{ ['--c' as string]: '#f59e0b' }}>unassigned</span>
          </div>
        </div>
      </div>

      <TypeBrainGraph
        nodes={brainNodes}
        satellites={satellites}
        selection={selection}
        showProducts={showProducts}
        onSelect={setSelection}
        onReparent={handleReparent}
        onRename={handleRename}
        onDelete={handleDelete}
        onAddChild={(id) => { void handleAddChild(id); }}
        onAssignProducts={handleAssign}
        onOpenProduct={handleOpenProduct}
      />

      {logOpen && (
        <div className="gov-log">
          <div className="gov-log-head">
            <span>Session history</span>
            <button type="button" onClick={() => setLogOpen(false)} aria-label="Close history">×</button>
          </div>
          {history.length === 0 && <p className="gov-log-empty">No changes yet this session.</p>}
          {[...history].reverse().map((h, i) => (
            <div key={history.length - i} className={`gov-log-row${h.undone ? ' is-undone' : ''}`}>
              <span>{h.label}</span>
              <time>{new Date(h.at).toLocaleTimeString()}</time>
            </div>
          ))}
        </div>
      )}

      {toast && (
        <div key={toast.key} className="gov-toast">
          <span>{toast.label}</span>
          {canUndo && (
            <button type="button" onClick={handleUndo}>Undo</button>
          )}
        </div>
      )}
    </div>
  );
}

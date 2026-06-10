// /admin/governance/types — the type brain. An Obsidian-style force graph
// of the product-type taxonomy with catalog at the centre, floating on the
// site's WebGL particle universe. This page blacks out the whole admin
// chrome (html.gov-void) so it reads as its own world.
//
// Gender is an ATTRIBUTE rendered as node color (legend bottom-right), not
// a tree node; nodes without their own gender inherit the nearest
// ancestor's. Edits are LIVE: renames rewrite products.type, structure
// changes rewrite products.type_path (the full materialized ancestry — a
// product ten levels deep keeps every level there while type stays the
// leaf), and gender changes cascade products.gender. Each gesture
// precomputes its inverse from snapshots, so Undo restores exact prior
// values. Writes run through a sequential queue so rapid gestures land in
// order.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ParticleBackground from '~/components/ParticleBackground';
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
  type ProductGroup,
  type TypeNode,
} from '~/services/type-governance';
import { productSlug } from '~/utils/slug';
import '~/styles/governance.css';

const UNASSIGNED_ID = '__unassigned__';
const NEUTRAL = '#cbd5e1';
const SAT_CAP = 6;
const GENDER_COLORS: Record<string, string> = {
  male: '#60a5fa',
  female: '#f472b6',
  unisex: '#34d399',
};

interface HistoryEntry {
  label: string;
  inverse: GovernanceOp[];
  undone: boolean;
  at: number;
}

/** Full ancestry string per node, matching products.type_path format. */
function computePaths(nodes: TypeNode[]): Map<string, string> {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const memo = new Map<string, string>();
  const path = (n: TypeNode): string => {
    const cached = memo.get(n.id);
    if (cached) return cached;
    const parent = n.parentId ? byId.get(n.parentId) : null;
    const v = parent ? `${path(parent)} / ${n.name}` : n.name;
    memo.set(n.id, v);
    return v;
  };
  nodes.forEach(path);
  return memo;
}

/** Effective gender per node: its own, else the nearest ancestor's. */
function computeGenders(nodes: TypeNode[]): Map<string, string | null> {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const memo = new Map<string, string | null>();
  const eff = (n: TypeNode): string | null => {
    if (memo.has(n.id)) return memo.get(n.id) ?? null;
    const parent = n.parentId ? byId.get(n.parentId) : null;
    const v = n.gender ?? (parent ? eff(parent) : null);
    memo.set(n.id, v);
    return v;
  };
  nodes.forEach(eff);
  return memo;
}

export default function AdminGovernanceTypes() {
  const [tree, setTree] = useState<TypeNode[]>([]);
  const [products, setProducts] = useState<GovernanceProduct[]>([]);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [showProducts, setShowProducts] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [toast, setToast] = useState<{ label: string; key: number } | null>(null);
  // "Move to…" armed: the next node click re-parents the whole selection.
  const [pickMode, setPickMode] = useState(false);
  const toastTimer = useRef(0);
  // Sequential write queue — rapid gestures stay ordered.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  // This page is its own world: black out the admin chrome while mounted.
  useEffect(() => {
    document.documentElement.classList.add('admin-on-dark-canvas', 'gov-void');
    return () => document.documentElement.classList.remove('admin-on-dark-canvas', 'gov-void');
  }, []);

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
  const paths = useMemo(() => computePaths(tree), [tree]);
  const genders = useMemo(() => computeGenders(tree), [tree]);
  const depths = useMemo(() => {
    const byId = new Map(tree.map(n => [n.id, n]));
    const memo = new Map<string, number>();
    const depth = (n: TypeNode): number => {
      const cached = memo.get(n.id);
      if (cached) return cached;
      const parent = n.parentId ? byId.get(n.parentId) : null;
      const v = parent ? depth(parent) + 1 : 1;
      memo.set(n.id, v);
      return v;
    };
    tree.forEach(depth);
    return memo;
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
    const nodes = tree.map(n => ({
      id: n.id, name: n.name, parentId: n.parentId,
      depth: depths.get(n.id) ?? 1,
      color: GENDER_COLORS[genders.get(n.id) ?? ''] ?? NEUTRAL,
      count: attach.get(n.id)?.length ?? 0,
      locked: false,
      icon: n.iconPath,
    }));
    if (showProducts && unassigned.length) {
      nodes.push({
        id: UNASSIGNED_ID, name: 'unassigned', parentId: null, depth: 1,
        color: '#f59e0b', count: unassigned.length, locked: true, icon: null,
      });
    }
    return nodes;
  }, [tree, depths, genders, attach, showProducts, unassigned.length]);

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

  /** Apply product-update groups to local state (column → TS key). */
  const applyGroupsLocal = useCallback((groups: ProductGroup[]) => {
    const patches = new Map<string, Partial<GovernanceProduct>>();
    for (const g of groups) {
      for (const id of g.ids) {
        patches.set(id, {
          ...patches.get(id),
          ...(g.patch.type !== undefined ? { type: g.patch.type } : {}),
          ...(g.patch.gender !== undefined ? { gender: g.patch.gender } : {}),
          ...(g.patch.type_path !== undefined ? { typePath: g.patch.type_path } : {}),
        });
      }
    }
    if (patches.size) {
      setProducts(prev => prev.map(p => patches.has(p.id) ? { ...p, ...patches.get(p.id) } : p));
    }
  }, []);

  /** Diff current vs hypothetical tree: products whose type_path or
   *  effective gender changes get cascading update groups + inverse
   *  snapshots. This is what makes a multi-select reconnect rewrite the
   *  whole ancestry chain on every affected product row. */
  const buildTreeCascade = useCallback((nextTree: TypeNode[]) => {
    const nextPaths = computePaths(nextTree);
    const nextGenders = computeGenders(nextTree);
    const groups: ProductGroup[] = [];
    const pathAffected: GovernanceProduct[] = [];
    const genderAffected: GovernanceProduct[] = [];
    for (const n of nextTree) {
      const prods = attach.get(n.id) ?? [];
      if (!prods.length) continue;
      const ids = prods.map(p => p.id);
      if (nextPaths.get(n.id) !== paths.get(n.id)) {
        groups.push({ ids, patch: { type_path: nextPaths.get(n.id) ?? null } });
        pathAffected.push(...prods);
      }
      if (nextGenders.get(n.id) !== genders.get(n.id)) {
        groups.push({ ids, patch: { gender: nextGenders.get(n.id) ?? null } });
        genderAffected.push(...prods);
      }
    }
    const inverse: GovernanceOp[] = [];
    if (pathAffected.length) inverse.push({ op: 'products-update', groups: snapshotGroups(pathAffected, 'typePath') });
    if (genderAffected.length) inverse.push({ op: 'products-update', groups: snapshotGroups(genderAffected, 'gender') });
    return { groups, inverse, genderTouched: genderAffected.length };
  }, [attach, paths, genders]);

  // ── Gestures ──
  const handleRename = (nodeId: string, to: string) => {
    const node = tree.find(n => n.id === nodeId);
    if (!node || node.name === to) return;
    const nextTree = tree.map(n => n.id === nodeId ? { ...n, name: to } : n);
    const matched = attach.get(nodeId) ?? [];
    const cascade = buildTreeCascade(nextTree);
    const groups: ProductGroup[] = [
      ...(matched.length ? [{ ids: matched.map(p => p.id), patch: { type: to } }] : []),
      ...cascade.groups,
    ];
    commit(
      `Renamed ${node.name} → ${to} · ${matched.length} products`,
      [
        { op: 'node-update', id: nodeId, patch: { name: to } },
        ...(groups.length ? [{ op: 'products-update' as const, groups }] : []),
      ],
      [
        { op: 'node-update', id: nodeId, patch: { name: node.name } },
        ...(matched.length ? [{ op: 'products-update' as const, groups: snapshotGroups(matched, 'type') }] : []),
        ...cascade.inverse,
      ],
      () => { setTree(nextTree); applyGroupsLocal(groups); },
    );
  };

  const handleReparent = (nodeIds: string[], targetId: string) => {
    if (targetId === UNASSIGNED_ID) return;
    const moved = nodeIds.filter(id => {
      const node = tree.find(n => n.id === id);
      if (!node || id === targetId || id === UNASSIGNED_ID) return false;
      if (subtreeIds(id).has(targetId)) return false; // no cycles
      return node.parentId !== targetId;
    });
    if (!moved.length) return;
    const movedSet = new Set(moved);
    const nextTree = tree.map(n => movedSet.has(n.id) ? { ...n, parentId: targetId } : n);
    const cascade = buildTreeCascade(nextTree);
    const targetName = tree.find(n => n.id === targetId)?.name ?? '?';
    const names = moved.map(id => tree.find(n => n.id === id)?.name ?? '?').join(', ');
    const touched = cascade.groups.reduce((acc, g) => acc + g.ids.length, 0);
    commit(
      `Moved ${names} → ${targetName}${touched ? ` · ${touched} product updates` : ''}`,
      [
        ...moved.map(id => ({ op: 'node-update' as const, id, patch: { parent_id: targetId } })),
        ...(cascade.groups.length ? [{ op: 'products-update' as const, groups: cascade.groups }] : []),
      ],
      [
        ...moved.map(id => ({
          op: 'node-update' as const, id,
          patch: { parent_id: tree.find(n => n.id === id)?.parentId ?? null },
        })),
        ...cascade.inverse,
      ],
      () => { setTree(nextTree); applyGroupsLocal(cascade.groups); },
    );
  };

  const handleSetGender = (nodeIds: string[], gender: TypeNode['gender']) => {
    const editable = nodeIds.filter(id => id !== UNASSIGNED_ID && tree.some(n => n.id === id));
    if (!editable.length) return;
    const idSet = new Set(editable);
    const nextTree = tree.map(n => idSet.has(n.id) ? { ...n, gender } : n);
    const cascade = buildTreeCascade(nextTree);
    const names = editable.map(id => tree.find(n => n.id === id)?.name ?? '?').join(', ');
    commit(
      `${gender ? `Set ${names} → ${gender}` : `Cleared gender on ${names}`}${cascade.genderTouched ? ` · ${cascade.genderTouched} products` : ''}`,
      [
        ...editable.map(id => ({ op: 'node-update' as const, id, patch: { gender } })),
        ...(cascade.groups.length ? [{ op: 'products-update' as const, groups: cascade.groups }] : []),
      ],
      [
        ...editable.map(id => ({
          op: 'node-update' as const, id,
          patch: { gender: tree.find(n => n.id === id)?.gender ?? null },
        })),
        ...cascade.inverse,
      ],
      () => { setTree(nextTree); applyGroupsLocal(cascade.groups); },
    );
  };

  const handleDelete = (nodeIds: string[]) => {
    // Only top-most selected nodes — descendants cascade.
    const tops = nodeIds.filter(id =>
      !nodeIds.some(other => other !== id && subtreeIds(other).has(id)));
    const ops: GovernanceOp[] = [];
    const rows: { id: string; name: string; parent_id: string | null; sort: number; color: string | null; gender: TypeNode['gender'] }[] = [];
    const names: string[] = [];
    let orphaned = 0;
    for (const id of tops) {
      if (id === UNASSIGNED_ID) continue;
      const sub = subtreeIds(id);
      // BFS order (parents first) so the undo re-insert satisfies the FK.
      const ordered = tree.filter(n => sub.has(n.id));
      rows.push(...ordered.map(n => ({
        id: n.id, name: n.name, parent_id: n.parentId, sort: n.sort, color: n.color, gender: n.gender,
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
    const idSet = new Set(productIds);
    const matched = products.filter(p => idSet.has(p.id));
    const eff = genders.get(nodeId) ?? null;
    const groups: ProductGroup[] = [{
      ids: productIds,
      patch: { type: node.name, gender: eff, type_path: paths.get(nodeId) ?? null },
    }];
    commit(
      `Re-typed ${matched.length} product${matched.length === 1 ? '' : 's'} → ${node.name}`,
      [{ op: 'products-update', groups }],
      [
        { op: 'products-update', groups: snapshotGroups(matched, 'type') },
        { op: 'products-update', groups: snapshotGroups(matched, 'gender') },
        { op: 'products-update', groups: snapshotGroups(matched, 'typePath') },
      ],
      () => applyGroupsLocal(groups),
    );
  };

  const handleOpenProduct = (productId: string) => {
    const prod = products.find(p => p.id === productId);
    if (!prod) return;
    window.open(`/p/${productSlug(prod)}`, '_blank', 'noopener');
  };

  // Escape disarms a pending "Move to…".
  useEffect(() => {
    if (!pickMode) return;
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setPickMode(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pickMode]);

  const canUndo = history.some(h => !h.undone);
  const editableSelection = [...selection].filter(id => id !== UNASSIGNED_ID);

  return (
    <div className="gov-page gov-types">
      {/* The particle universe — fixed behind everything; the blacked-out
          admin chrome is translucent so the field reads as one world. */}
      <div className="gov-universe" aria-hidden="true">
        <ParticleBackground />
      </div>

      {/* No page heading (founder's call) — the brain IS the page; the
          controls float inside the canvas instead. */}
      <div className="gov-canvas">
        <div className="gov-controls-row gov-canvas-controls">
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
        <TypeBrainGraph
          nodes={brainNodes}
          satellites={satellites}
          selection={selection}
          showProducts={showProducts}
          onSelect={(ids) => { setPickMode(false); setSelection(ids); }}
          pickMode={pickMode}
          onPickTarget={(targetId) => {
            setPickMode(false);
            handleReparent(editableSelection, targetId);
          }}
          onReparent={handleReparent}
          onRename={handleRename}
          onDelete={handleDelete}
          onAddChild={(id) => { void handleAddChild(id); }}
          onAssignProducts={handleAssign}
          onOpenProduct={handleOpenProduct}
        />

        {editableSelection.length > 0 && (
          <div className="gov-genderbar">
            <span>{editableSelection.length} selected</span>
            <button type="button" className={`gov-moveto${pickMode ? ' is-armed' : ''}`}
              onClick={() => setPickMode(v => !v)}>
              {pickMode ? 'click a target node…' : 'Move to…'}
            </button>
            <em className="gov-bar-divider" aria-hidden="true" />
            {(['male', 'female', 'unisex'] as const).map(g => (
              <button key={g} type="button" style={{ ['--c' as string]: GENDER_COLORS[g] }}
                onClick={() => handleSetGender(editableSelection, g)}>
                <i />{g}
              </button>
            ))}
            <button type="button" style={{ ['--c' as string]: NEUTRAL }}
              onClick={() => handleSetGender(editableSelection, null)}>
              <i />inherit
            </button>
          </div>
        )}

        <div className="gov-legend">
          <span style={{ ['--c' as string]: GENDER_COLORS.male }}>male</span>
          <span style={{ ['--c' as string]: GENDER_COLORS.female }}>female</span>
          <span style={{ ['--c' as string]: GENDER_COLORS.unisex }}>unisex</span>
          <span style={{ ['--c' as string]: '#f59e0b' }}>unassigned</span>
        </div>
      </div>

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

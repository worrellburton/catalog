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
import TypeBrainGraph, { type BrainNode, type BrainProduct, type BrainViewMode } from '~/components/admin/TypeBrainGraph';
import {
  auditProductTypes,
  computeEffectiveGenders,
  computeTypePaths,
  createTypeNode,
  executeGovernanceOps,
  fetchGovernanceProducts,
  fetchTypeTree,
  normalizeTypeName,
  snapshotGroups,
  type GovernanceOp,
  type GovernanceProduct,
  type ProductGroup,
  type TypeAuditRecommendation,
  type TypeNode,
} from '~/services/type-governance';
import DrillAddProducts, { type DrillAddSource } from '~/components/admin/DrillAddProducts';
import TypeAuditPanel from '~/components/admin/TypeAuditPanel';
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

const computePaths = computeTypePaths;
const computeGenders = computeEffectiveGenders;

export default function AdminGovernanceTypes() {
  const [tree, setTree] = useState<TypeNode[]>([]);
  const [products, setProducts] = useState<GovernanceProduct[]>([]);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<BrainViewMode>('types');
  // Drill-down: zoom INTO a node and list every product attached to it.
  // ox/oy anchor the zoom animation at the node's canvas position.
  const [drill, setDrill] = useState<{ nodeId: string; ox: number; oy: number } | null>(null);
  // Multi-select inside the drill view → "Assign to type…" re-types them.
  const [drillSel, setDrillSel] = useState<Set<string>>(new Set());
  // Drag-marquee over the drill grid (client coords; cards re-measured per
  // move so scrolling mid-drag stays correct). base = selection at gesture
  // start so shift-drags extend instead of replace.
  const drillMarquee = useRef<{ x0: number; y0: number; base: Set<string> } | null>(null);
  const [drillRect, setDrillRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignQuery, setAssignQuery] = useState('');
  // Double-click the drill title to rename the type (the canvas double-click
  // is the zoom-in gesture now).
  const [drillRenaming, setDrillRenaming] = useState(false);
  // "Add products" inside the drill: menu + which source flow is open.
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [addSource, setAddSource] = useState<DrillAddSource | null>(null);
  // Collapsible subtype rows at the bottom of the drill — open by default
  // so the subtype products are visible "in here".
  const [openSubs, setOpenSubs] = useState<Set<string>>(new Set());
  // Type-audit report (null = closed).
  const [audit, setAudit] = useState<TypeAuditRecommendation[] | null>(null);
  useEffect(() => {
    setDrillSel(new Set());
    setAssignOpen(false);
    setAssignQuery('');
    setDrillRenaming(false);
    setAddMenuOpen(false);
    setAddSource(null);
    setOpenSubs(new Set(tree.filter(n => n.parentId === drill?.nodeId).map(n => n.id)));
    // Reset on drill change only — `tree` is read fresh at open time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drill?.nodeId]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [toast, setToast] = useState<{ label: string; key: number } | null>(null);
  // "Move to…" armed: the next node click re-parents the whole selection.
  const [pickMode, setPickMode] = useState(false);
  // Organize button: each press re-runs the tidy radial layout.
  const [organizeSignal, setOrganizeSignal] = useState(0);
  // Ring dials — view preferences, sticky per admin via localStorage.
  const [ringOpacity, setRingOpacity] = useState(() =>
    Number(typeof localStorage !== 'undefined' && localStorage.getItem('gov-ring-opacity')) || 0.15);
  const [ringScale, setRingScale] = useState(() =>
    Number(typeof localStorage !== 'undefined' && localStorage.getItem('gov-ring-scale')) || 1);
  useEffect(() => { try { localStorage.setItem('gov-ring-opacity', String(ringOpacity)); } catch { /* private mode */ } }, [ringOpacity]);
  useEffect(() => { try { localStorage.setItem('gov-ring-scale', String(ringScale)); } catch { /* private mode */ } }, [ringScale]);
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
    if (viewMode !== 'types' && unassigned.length) {
      nodes.push({
        id: UNASSIGNED_ID, name: 'unassigned', parentId: null, depth: 1,
        color: '#f59e0b', count: unassigned.length, locked: true, icon: null,
      });
    }
    return nodes;
  }, [tree, depths, genders, attach, viewMode, unassigned.length]);

  const satellites = useMemo(() => {
    // Products mode is about the products — give each node a bigger orbit.
    const cap = viewMode === 'products' ? 10 : SAT_CAP;
    const m = new Map<string, { items: BrainProduct[]; total: number }>();
    for (const [nodeId, list] of attach) {
      m.set(nodeId, { items: list.slice(0, cap), total: list.length });
    }
    if (unassigned.length) {
      m.set(UNASSIGNED_ID, { items: unassigned.slice(0, cap), total: unassigned.length });
    }
    return m;
  }, [attach, unassigned, viewMode]);

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

  /** Products created from the drill's "Add products" flows → the drilled
   *  type. The new rows aren't in local state yet, so the groups are built
   *  straight from the ids and a reload follows the queued write. */
  const handleAssignNew = (productIds: string[], nodeId: string) => {
    const node = tree.find(n => n.id === nodeId);
    if (!node || !productIds.length) return;
    const groups: ProductGroup[] = [{
      ids: productIds,
      patch: { type: node.name, gender: genders.get(nodeId) ?? null, type_path: paths.get(nodeId) ?? null },
    }];
    commit(
      `Added ${productIds.length} product${productIds.length === 1 ? '' : 's'} → ${node.name}`,
      [{ op: 'products-update', groups }],
      [{ op: 'products-update', groups: [{ ids: productIds, patch: { type: null, gender: null, type_path: null } }] }],
      () => { /* rows enter local state via the queued reload */ },
    );
    queue.current = queue.current.then(() => reload());
  };

  /** Apply the checked audit recommendations as one undoable gesture. */
  const applyAudit = (recs: TypeAuditRecommendation[]) => {
    setAudit(null);
    if (!recs.length) return;
    const byNode = new Map<string, TypeAuditRecommendation[]>();
    for (const r of recs) byNode.set(r.toNodeId, [...(byNode.get(r.toNodeId) ?? []), r]);
    const groups: ProductGroup[] = [...byNode.entries()].map(([nodeId, rs]) => ({
      ids: rs.map(r => r.productId),
      patch: {
        type: tree.find(n => n.id === nodeId)?.name ?? null,
        gender: genders.get(nodeId) ?? null,
        type_path: paths.get(nodeId) ?? null,
      },
    }));
    const idSet = new Set(recs.map(r => r.productId));
    const matched = products.filter(p => idSet.has(p.id));
    commit(
      `Type audit: re-typed ${recs.length} product${recs.length === 1 ? '' : 's'}`,
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

  // Escape closes the drill view, else disarms a pending "Move to…".
  useEffect(() => {
    if (!pickMode && !drill) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      if (drill) setDrill(null);
      else setPickMode(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pickMode, drill]);

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
          <button
            type="button"
            className="gov-ghost"
            title="Evenly space every ring and keep branches in their own sectors"
            onClick={() => setOrganizeSignal(n => n + 1)}
          >
            ✦ Organize
          </button>
          <button
            type="button"
            className="gov-ghost"
            title="Scan every product for a better-fitting type and review the recommended moves"
            onClick={() => setAudit(auditProductTypes(products, tree))}
          >
            Type audit
          </button>
          <button type="button" className="gov-ghost" disabled={!canUndo} onClick={handleUndo}>
            ↩ Undo
          </button>
          <button type="button" className="gov-ghost" onClick={() => setLogOpen(v => !v)}>
            History{history.length ? ` (${history.length})` : ''}
          </button>
          <div className="gov-seg" role="group" aria-label="View mode">
            {(['types', 'products', 'all'] as const).map(m => (
              <button
                key={m}
                type="button"
                className={viewMode === m ? 'is-active' : ''}
                onClick={() => setViewMode(m)}
              >{m}</button>
            ))}
          </div>
        </div>
        <TypeBrainGraph
          nodes={brainNodes}
          satellites={satellites}
          selection={selection}
          viewMode={viewMode}
          onSelect={(ids) => { setPickMode(false); setSelection(ids); }}
          onDrill={(nodeId, ox, oy) => setDrill({ nodeId, ox, oy })}
          ringOpacity={ringOpacity}
          ringScale={ringScale}
          pickMode={pickMode}
          onPickTarget={(targetId) => {
            setPickMode(false);
            handleReparent(editableSelection, targetId);
          }}
          onReparent={handleReparent}
          onRename={handleRename}
          organizeSignal={organizeSignal}
          onDelete={handleDelete}
          onAddChild={(id) => { void handleAddChild(id); }}
          onAssignProducts={handleAssign}
          onOpenProduct={handleOpenProduct}
        />

        {drill && (() => {
          const node = tree.find(n => n.id === drill.nodeId);
          const prods = drill.nodeId === UNASSIGNED_ID ? unassigned : (attach.get(drill.nodeId) ?? []);
          const name = node?.name ?? (drill.nodeId === UNASSIGNED_ID ? 'unassigned' : '?');
          const color = drill.nodeId === UNASSIGNED_ID
            ? '#f59e0b'
            : GENDER_COLORS[genders.get(drill.nodeId) ?? ''] ?? NEUTRAL;
          // Subtypes: one collapsible row per direct child at the bottom,
          // each listing its whole subtree's products.
          const children = node
            ? tree
                .filter(n => n.parentId === drill.nodeId)
                .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
            : [];
          const subProducts = (childId: string): GovernanceProduct[] =>
            [...subtreeIds(childId)].flatMap(id => attach.get(id) ?? []);
          const subTotal = children.reduce((acc, c) => acc + subProducts(c.id).length, 0);
          const renderCard = (prod: GovernanceProduct) => {
            const isSel = drillSel.has(prod.id);
            return (
              <button
                key={prod.id}
                type="button"
                data-prod-id={prod.id}
                className={`gov-drill-card${isSel ? ' is-selected' : ''}`}
                title={`${prod.name} — click to select`}
                onClick={() => setDrillSel(prev => {
                  const next = new Set(prev);
                  if (next.has(prod.id)) next.delete(prod.id);
                  else next.add(prod.id);
                  return next;
                })}
              >
                <div className="gov-drill-media">
                  {prod.image
                    ? <img src={prod.image} alt="" loading="lazy" decoding="async" />
                    : <span>{prod.name.slice(0, 2)}</span>}
                  <i className="gov-drill-check" aria-hidden="true">✓</i>
                  <span
                    className="gov-drill-open"
                    role="button"
                    title="Open product page"
                    onClick={ev => { ev.stopPropagation(); handleOpenProduct(prod.id); }}
                  >↗</span>
                </div>
                {prod.brand && <em>{prod.brand}</em>}
                <strong>{prod.name}</strong>
              </button>
            );
          };
          return (
            <div
              className={`gov-drill${drillRect ? ' is-marquee' : ''}`}
              style={{ ['--ox' as string]: `${drill.ox}px`, ['--oy' as string]: `${drill.oy}px` }}
              onPointerDown={ev => {
                // Marquee starts on empty space only — buttons/inputs keep
                // their own gestures (card toggle, pickers, header).
                if ((ev.target as HTMLElement).closest('button, input, a')) return;
                (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId);
                drillMarquee.current = {
                  x0: ev.clientX, y0: ev.clientY,
                  base: ev.shiftKey ? new Set(drillSel) : new Set(),
                };
                if (!ev.shiftKey) setDrillSel(new Set());
              }}
              onPointerMove={ev => {
                const m = drillMarquee.current;
                if (!m) return;
                const [lx, hx] = [Math.min(m.x0, ev.clientX), Math.max(m.x0, ev.clientX)];
                const [ly, hy] = [Math.min(m.y0, ev.clientY), Math.max(m.y0, ev.clientY)];
                setDrillRect({ x: lx, y: ly, w: hx - lx, h: hy - ly });
                if (hx - lx < 4 && hy - ly < 4) return;
                const hits = new Set(m.base);
                document.querySelectorAll<HTMLElement>('.gov-drill [data-prod-id]').forEach(el => {
                  const r = el.getBoundingClientRect();
                  if (r.left < hx && r.right > lx && r.top < hy && r.bottom > ly) {
                    hits.add(el.dataset.prodId!);
                  }
                });
                setDrillSel(hits);
              }}
              onPointerUp={() => { drillMarquee.current = null; setDrillRect(null); }}
            >
              {drillRect && (
                <div
                  className="gov-drill-marquee"
                  style={{ left: drillRect.x, top: drillRect.y, width: drillRect.w, height: drillRect.h }}
                />
              )}
              <div className="gov-drill-head">
                <button type="button" className="gov-ghost" onClick={() => setDrill(null)}>
                  ← Back to the brain
                </button>
                <div className="gov-drill-title">
                  <span className="gov-drill-dot" style={{ background: color }} />
                  {drillRenaming && node ? (
                    <input
                      className="gov-drill-rename"
                      defaultValue={name}
                      autoFocus
                      onFocus={ev => ev.currentTarget.select()}
                      onKeyDown={ev => {
                        if (ev.key === 'Enter') {
                          const v = ev.currentTarget.value.trim();
                          if (v && v !== name) handleRename(node.id, v);
                          setDrillRenaming(false);
                        } else if (ev.key === 'Escape') setDrillRenaming(false);
                      }}
                      onBlur={() => setDrillRenaming(false)}
                    />
                  ) : (
                    <h2
                      title={node ? 'Double-click to rename' : undefined}
                      onDoubleClick={() => { if (node) setDrillRenaming(true); }}
                    >{name}</h2>
                  )}
                  <span>
                    {prods.length} product{prods.length === 1 ? '' : 's'}
                    {subTotal > 0 ? ` · ${subTotal} in subtypes` : ''}
                  </span>
                </div>
                {node && <span className="gov-drill-path">{paths.get(node.id)}</span>}
                {node && (
                  <div className="gov-drill-add">
                    <button type="button" className="gov-moveto" onClick={() => setAddMenuOpen(v => !v)}>
                      + Add products
                    </button>
                    {addMenuOpen && (
                      <div className="gov-drill-addmenu" role="menu">
                        {([
                          ['google', 'Add via Google Shopping'],
                          ['amazon', 'Add via Amazon Shopping'],
                          ['brand', 'Add via Brand Website'],
                          ['manual', 'Add Manually'],
                        ] as [DrillAddSource, string][]).map(([src, label]) => (
                          <button
                            key={src}
                            type="button"
                            role="menuitem"
                            onClick={() => { setAddMenuOpen(false); setAddSource(src); }}
                          >{label}</button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {drillSel.size > 0 && (
                <div className="gov-drill-assign">
                  <span>{drillSel.size} selected</span>
                  <button type="button" className="gov-moveto" onClick={() => setAssignOpen(v => !v)}>
                    Assign to type…
                  </button>
                  <button type="button" className="gov-ghost" onClick={() => { setDrillSel(new Set()); setAssignOpen(false); }}>
                    Clear
                  </button>
                  {assignOpen && (
                    <div className="gov-drill-picker">
                      <input
                        autoFocus
                        placeholder="Find a type…"
                        value={assignQuery}
                        onChange={e => setAssignQuery(e.target.value)}
                      />
                      <div className="gov-drill-picker-list">
                        {tree
                          .filter(n => n.id !== drill.nodeId)
                          .filter(n => !assignQuery.trim()
                            || n.name.toLowerCase().includes(assignQuery.trim().toLowerCase())
                            || (paths.get(n.id) ?? '').toLowerCase().includes(assignQuery.trim().toLowerCase()))
                          .map(n => (
                            <button
                              key={n.id}
                              type="button"
                              onClick={() => {
                                handleAssign([...drillSel], n.id);
                                setDrillSel(new Set());
                                setAssignOpen(false);
                                setAssignQuery('');
                              }}
                            >
                              <i style={{ background: GENDER_COLORS[genders.get(n.id) ?? ''] ?? NEUTRAL }} />
                              <strong>{n.name}</strong>
                              <span>{paths.get(n.id)}</span>
                            </button>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {/* ONE scroll body for direct products + subtype sections.
                  Before, only the grid scrolled (flex:1) and the subtype
                  sections below it got squeezed past the drill's
                  overflow:hidden — cards sliced mid-row on tall content. */}
              <div className="gov-drill-body">
              {prods.length === 0 ? (
                <p className="gov-drill-empty">No products attached directly to this type yet.</p>
              ) : (
                <div className="gov-drill-grid">
                  {prods.map(renderCard)}
                </div>
              )}

              {children.length > 0 && (
                <div className="gov-drill-subs">
                  <h3>Subtypes</h3>
                  {children.map(child => {
                    const list = subProducts(child.id);
                    const open = openSubs.has(child.id);
                    return (
                      <div key={child.id} className={`gov-drill-sub${open ? ' is-open' : ''}`}>
                        <button
                          type="button"
                          className="gov-drill-sub-head"
                          aria-expanded={open}
                          onClick={() => setOpenSubs(prev => {
                            const next = new Set(prev);
                            if (next.has(child.id)) next.delete(child.id);
                            else next.add(child.id);
                            return next;
                          })}
                        >
                          <em className="gov-drill-sub-chevron" aria-hidden="true">{open ? '▾' : '▸'}</em>
                          <span className="gov-drill-dot" style={{ background: GENDER_COLORS[genders.get(child.id) ?? ''] ?? NEUTRAL }} />
                          <strong>{child.name}</strong>
                          <span className="gov-drill-sub-count">{list.length} product{list.length === 1 ? '' : 's'}</span>
                        </button>
                        {open && (
                          list.length === 0
                            ? <p className="gov-drill-empty">No products in this subtype yet.</p>
                            : <div className="gov-drill-grid">{list.map(renderCard)}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              </div>
            </div>
          );
        })()}

        {drill && addSource && (() => {
          const node = tree.find(n => n.id === drill.nodeId);
          if (!node) return null;
          return (
            <DrillAddProducts
              source={addSource}
              typeName={node.name}
              onClose={() => setAddSource(null)}
              onCreated={ids => handleAssignNew(ids, node.id)}
              showToast={showToast}
            />
          );
        })()}

        {editableSelection.length > 0 && !drill && (
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

        {!drill && (
          <div className="gov-ringdials">
            <label>
              <span>Ring opacity</span>
              <input type="range" min={0} max={100} value={Math.round(ringOpacity * 100)}
                onChange={e => setRingOpacity(Number(e.target.value) / 100)} />
            </label>
            <label>
              <span>Ring distance</span>
              <input type="range" min={50} max={200} value={Math.round(ringScale * 100)}
                onChange={e => setRingScale(Number(e.target.value) / 100)} />
            </label>
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

      {audit && (
        <TypeAuditPanel
          recommendations={audit}
          onApply={applyAudit}
          onClose={() => setAudit(null)}
        />
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

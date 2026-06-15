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

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import ParticleBackground from '~/components/ParticleBackground';
import { supabase } from '~/utils/supabase';
import TypeBrainGraph, { ROOT_ID, type BrainCameraHandle, type BrainNode, type BrainProduct, type BrainViewMode } from '~/components/admin/TypeBrainGraph';
import {
  computeEffectiveGenders,
  computeTypePaths,
  createTypeNode,
  executeGovernanceOps,
  fetchGovernanceProducts,
  fetchTypeTree,
  kaizenSweep,
  normalizeTypeName,
  snapshotGroups,
  type GovernanceOp,
  type GovernanceProduct,
  type KaizenReport,
  type ProductGroup,
  type TypeAuditRecommendation,
  type TypeNode,
} from '~/services/type-governance';
import DrillAddProducts, { type DrillAddSource } from '~/components/admin/DrillAddProducts';
import KaizenPanel, { type KaizenPicked } from '~/components/admin/KaizenPanel';
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
  // Drag-to-recategorize: hold the product ids being dragged (the whole
  // selection when the grabbed card is part of it, else just that card) and
  // the node currently hovered as a drop target for the highlight.
  const dragIds = useRef<string[]>([]);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
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
  // Kaizen report (null = closed).
  const [audit, setAudit] = useState<KaizenReport | null>(null);
  // 改 Kaizen splits into two focused sweeps — pick types or garments first.
  const [kaizenMenuOpen, setKaizenMenuOpen] = useState(false);
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
  // Organize signal retained for programmatic re-layout (the header
  // button itself was retired — founder's call).
  const [organizeSignal] = useState(0);
  // Camera: depth-of-field f-stop (null = off) + showcase auto-orbit.
  const [dofStop, setDofStop] = useState<number | null>(2.8);
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false);
  const [showcase, setShowcase] = useState(false);
  // Mobile camera dock: the slider/joystick drive the graph's view
  // through this handle; zoomUi mirrors the live zoom back to the slider.
  const camRef = useRef<BrainCameraHandle | null>(null);
  const [zoomUi, setZoomUi] = useState(1);
  // Reset: bumping the signal makes the graph fly home (flat 2D plane,
  // zoom 1, rings level) with a bounce. Also drops out of showcase.
  const [resetSignal, setResetSignal] = useState(0);
  const fireReset = () => { setShowcase(false); setResetSignal(s => s + 1); };
  const joy = useRef<{ dx: number; dy: number; raf: number } | null>(null);
  const [joyKnob, setJoyKnob] = useState<{ x: number; y: number } | null>(null);
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
    // Hovering catalog itself grows a tier-1 type (no parent).
    const isRoot = parentId === ROOT_ID;
    const created = await createTypeNode('new type', isRoot ? null : parentId);
    if (!created) { showToast('Failed to add type'); return; }
    setTree(prev => [...prev, created]);
    setHistory(prev => [...prev, {
      label: isRoot ? 'Added top-level type' : `Added type under ${tree.find(n => n.id === parentId)?.name ?? '?'}`,
      inverse: [{ op: 'node-delete', id: created.id }],
      undone: false, at: Date.now(),
    }]);
    showToast('Added "new type" — double-click it to rename');
  };

  // A type node's gender only CONSTRAINS its products when it is male or
  // female. 'unisex'/null is permissive — products keep their own gender,
  // so a female pair of heels dropped into the unisex "shoes" node stays
  // female instead of being flattened back to unisex.
  const forcedGender = (nodeId: string): 'male' | 'female' | null => {
    const g = genders.get(nodeId) ?? null;
    return g === 'male' || g === 'female' ? g : null;
  };

  const handleAssign = (productIds: string[], nodeId: string) => {
    if (nodeId === UNASSIGNED_ID) return;
    const node = tree.find(n => n.id === nodeId);
    if (!node) return;
    const idSet = new Set(productIds);
    const matched = products.filter(p => idSet.has(p.id));
    const fg = forcedGender(nodeId);
    const groups: ProductGroup[] = [{
      ids: productIds,
      patch: { type: node.name, type_path: paths.get(nodeId) ?? null, ...(fg ? { gender: fg } : {}) },
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

  // ── Drag-to-recategorize (drill view) ────────────────────────────
  // Grab a product card and drop it on a subtype row (or the type's own
  // direct-products area) to re-type it. Reuses handleAssign so the move
  // is a single undoable gesture. Dragging a card that's part of the
  // current selection moves the whole selection with it.
  const startCardDrag = (prodId: string, ev: ReactDragEvent) => {
    const ids = drillSel.has(prodId) && drillSel.size > 0 ? [...drillSel] : [prodId];
    dragIds.current = ids;
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('text/plain', ids.join(','));
  };
  const overDropTarget = (nodeId: string, ev: ReactDragEvent) => {
    if (dragIds.current.length === 0) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'move';
    if (dropTarget !== nodeId) setDropTarget(nodeId);
  };
  const dropOnNode = (nodeId: string, ev: ReactDragEvent) => {
    ev.preventDefault();
    const ids = dragIds.current;
    dragIds.current = [];
    setDropTarget(null);
    if (ids.length === 0) return;
    handleAssign(ids, nodeId);
    setDrillSel(new Set());
  };
  const endCardDrag = () => { dragIds.current = []; setDropTarget(null); };

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

  /** Apply the checked kaizen improvements as one undoable gesture.
   *  Op order: create nodes → product patches → delete nodes, so product
   *  moves never reference a node mid-delete. */
  /** Resolve a "a / b / c" path to a node id, creating missing segments
   *  (parents first). Returns null only when a create fails. */
  const resolveOrCreatePath = async (path: string): Promise<{ id: string; name: string } | null> => {
    const segments = path.split('/').map(s => s.trim()).filter(Boolean);
    if (segments.length === 0) return null;
    let parentId: string | null = null;
    let node: TypeNode | null = null;
    let liveTree = tree;
    for (const seg of segments) {
      const existing = liveTree.find(n =>
        (n.parentId ?? null) === parentId && normalizeTypeName(n.name) === normalizeTypeName(seg));
      if (existing) {
        node = existing;
      } else {
        const created = await createTypeNode(seg, parentId);
        if (!created) return null;
        liveTree = [...liveTree, created];
        setTree(prev => [...prev, created]);
        node = created;
      }
      parentId = node.id;
    }
    return node ? { id: node.id, name: node.name } : null;
  };

  /** "I think the glasses should go into dishware instead of art" →
   *  kaizen-refine (Claude) maps the note onto real products + paths;
   *  the open report's suggestions update in place for review. */
  const refineKaizen = async (instruction: string): Promise<string | null> => {
    if (!audit || !supabase) return 'No report open';
    const { data, error } = await supabase.functions.invoke('kaizen-refine', {
      body: {
        instruction,
        products: products.map(pr => ({ id: pr.id, name: pr.name, brand: pr.brand, type: pr.type, context: pr.haikuContext })),
        typePaths: [...new Set([...paths.values()])],
      },
    });
    if (error) return error.message;
    const resp = data as { success?: boolean; error?: string; moves?: Array<{ productId: string; toPath: string }>; note?: string | null };
    if (!resp?.success) return resp?.error ?? 'Refine failed';
    const moves = resp.moves ?? [];
    if (moves.length === 0) return resp.note || 'Nothing in the catalog matched that note.';

    const updates: TypeAuditRecommendation[] = [];
    for (const mv of moves) {
      const product = products.find(pr => pr.id === mv.productId);
      if (!product) continue;
      const target = await resolveOrCreatePath(mv.toPath);
      if (!target) continue;
      updates.push({
        productId: product.id,
        name: product.name,
        brand: product.brand,
        image: product.image,
        fromType: product.type,
        toNodeId: target.id,
        toName: target.name,
        toPath: mv.toPath,
        reason: `your note: “${instruction.slice(0, 80)}”`,
      });
    }
    if (updates.length === 0) return 'Could not resolve the destination type.';
    setAudit(prev => {
      if (!prev) return prev;
      const updatedIds = new Set(updates.map(u => u.productId));
      return { ...prev, retypes: [...updates, ...prev.retypes.filter(r => !updatedIds.has(r.productId))] };
    });
    return null;
  };

  /** Drill "Kaizen N": sends ONLY the selected products (with their
   *  Haiku image context) to kaizen-refine and opens the report with the
   *  suggested placements — review + Apply as usual. */
  const [kaizenSelBusy, setKaizenSelBusy] = useState(false);
  const kaizenSelection = async () => {
    if (!drill || !supabase || kaizenSelBusy) return;
    const ids = [...drillSel];
    const sel = products.filter(pr => ids.includes(pr.id));
    if (sel.length === 0) return;
    setKaizenSelBusy(true);
    showToast(`Kaizen is looking at ${sel.length} product${sel.length === 1 ? '' : 's'}…`);
    try {
      const node = tree.find(n => n.id === drill.nodeId);
      const here = node ? (paths.get(node.id) ?? node.name) : 'unassigned';
      const { data, error } = await supabase.functions.invoke('kaizen-refine', {
        body: {
          instruction: `These ${sel.length} selected products currently sit in "${here}". Using each product's image description, give each one its best-fitting type path. Only include a product in moves when a different path clearly fits better than "${here}".`,
          products: sel.map(pr => ({ id: pr.id, name: pr.name, brand: pr.brand, type: pr.type, context: pr.haikuContext })),
          typePaths: [...new Set([...paths.values()])],
        },
      });
      if (error) { showToast(`Kaizen failed: ${error.message}`); return; }
      const resp = data as { success?: boolean; error?: string; moves?: Array<{ productId: string; toPath: string }>; note?: string | null };
      if (!resp?.success) { showToast(resp?.error ?? 'Kaizen failed'); return; }
      const moves = resp.moves ?? [];
      if (moves.length === 0) { showToast(resp.note || 'Kaizen thinks they all belong here.'); return; }
      const recs: TypeAuditRecommendation[] = [];
      for (const mv of moves) {
        const product = sel.find(pr => pr.id === mv.productId);
        if (!product) continue;
        const target = await resolveOrCreatePath(mv.toPath);
        if (!target) continue;
        recs.push({
          productId: product.id, name: product.name, brand: product.brand, image: product.image,
          fromType: product.type, toNodeId: target.id, toName: target.name, toPath: mv.toPath,
          reason: 'image context (Haiku) read by kaizen',
        });
      }
      if (recs.length === 0) { showToast('Could not resolve the suggested types.'); return; }
      setDrill(null);
      setAudit({ retypes: recs, drift: [], genderChanges: [], emptyTypes: [], duplicateTypes: [], orphanTypes: [] });
    } finally {
      setKaizenSelBusy(false);
    }
  };

  const applyKaizen = (picked: KaizenPicked) => {
    setAudit(null);
    const ops: GovernanceOp[] = [];
    const inverse: GovernanceOp[] = [];
    const groups: ProductGroup[] = [];
    const insertedNodes: TypeNode[] = [];
    const deletedIds = new Set<string>();
    const labels: string[] = [];

    // Unowned type names → new tier-1 nodes + path sync for their products.
    if (picked.orphanTypes.length) {
      const rows = picked.orphanTypes.map(o => ({
        id: crypto.randomUUID(), name: o.typeName, parent_id: null, sort: 999,
        color: null, gender: null,
      }));
      ops.push({ op: 'node-insert', rows });
      rows.forEach((row, i) => {
        insertedNodes.push({ id: row.id, name: row.name, parentId: null, sort: 999, color: null, gender: null, iconPath: null });
        groups.push({ ids: picked.orphanTypes[i].productIds, patch: { type: row.name, type_path: row.name } });
        inverse.push({ op: 'node-delete', id: row.id });
      });
      labels.push(`${rows.length} type${rows.length === 1 ? '' : 's'} created`);
    }

    // Better placements + drift syncs are both product patches.
    const byNode = new Map<string, string[]>();
    for (const r of picked.retypes) byNode.set(r.toNodeId, [...(byNode.get(r.toNodeId) ?? []), r.productId]);
    for (const [nodeId, ids] of byNode) {
      const fg = forcedGender(nodeId);
      groups.push({
        ids,
        patch: {
          type: tree.find(n => n.id === nodeId)?.name ?? null,
          type_path: paths.get(nodeId) ?? null,
          ...(fg ? { gender: fg } : {}),
        },
      });
    }
    if (picked.retypes.length) labels.push(`${picked.retypes.length} re-typed`);
    // Type improvements: type/type_path only — never touch gender.
    for (const d of picked.drift) {
      groups.push({ ids: [d.productId], patch: { type: d.toType, type_path: d.toPath } });
    }
    if (picked.drift.length) labels.push(`${picked.drift.length} type${picked.drift.length === 1 ? '' : 's'} synced`);
    // Gender improvements: gender only — never touch type/path.
    for (const g of picked.genderChanges) {
      groups.push({ ids: [g.productId], patch: { gender: g.toGender } });
    }
    if (picked.genderChanges.length) labels.push(`${picked.genderChanges.length} gender${picked.genderChanges.length === 1 ? '' : 's'} set`);

    // Duplicate types: move the drop node's products to the keeper, delete it.
    for (const d of picked.duplicateTypes) {
      const keep = tree.find(n => n.id === d.keepId);
      const drop = tree.find(n => n.id === d.dropId);
      if (!keep || !drop) continue;
      const ids = products
        .filter(p => p.type && normalizeTypeName(p.type) === normalizeTypeName(drop.name))
        .map(p => p.id);
      if (ids.length) groups.push({ ids, patch: { type: keep.name, gender: genders.get(keep.id) ?? null, type_path: paths.get(keep.id) ?? null } });
      ops.push({ op: 'node-delete', id: drop.id });
      deletedIds.add(drop.id);
      inverse.push({ op: 'node-insert', rows: [{ id: drop.id, name: drop.name, parent_id: drop.parentId, sort: drop.sort, color: drop.color, gender: drop.gender }] });
    }
    if (picked.duplicateTypes.length) labels.push(`${picked.duplicateTypes.length} duplicate${picked.duplicateTypes.length === 1 ? '' : 's'} merged`);

    // Empty branches: delete the topmost node (children cascade); the
    // inverse re-inserts the whole subtree, parents first.
    for (const e of picked.emptyTypes) {
      const rows = tree.filter(n => e.subtreeIds.includes(n.id))
        .map(n => ({ id: n.id, name: n.name, parent_id: n.parentId, sort: n.sort, color: n.color, gender: n.gender }));
      ops.push({ op: 'node-delete', id: e.nodeId });
      for (const id of e.subtreeIds) deletedIds.add(id);
      inverse.unshift({ op: 'node-insert', rows });
    }
    if (picked.emptyTypes.length) labels.push(`${picked.emptyTypes.length} empty branch${picked.emptyTypes.length === 1 ? '' : 'es'} removed`);

    if (groups.length) {
      // Product patches run after node inserts, before node deletes.
      const deleteAt = ops.findIndex(o => o.op === 'node-delete');
      ops.splice(deleteAt < 0 ? ops.length : deleteAt, 0, { op: 'products-update', groups });
      const idSet = new Set(groups.flatMap(g => g.ids));
      const matched = products.filter(p => idSet.has(p.id));
      inverse.push(
        { op: 'products-update', groups: snapshotGroups(matched, 'type') },
        { op: 'products-update', groups: snapshotGroups(matched, 'gender') },
        { op: 'products-update', groups: snapshotGroups(matched, 'typePath') },
      );
    }
    if (!ops.length) return;
    commit(
      `Kaizen: ${labels.join(' · ')}`,
      ops,
      inverse,
      () => {
        setTree(prev => [...prev.filter(n => !deletedIds.has(n.id)), ...insertedNodes]);
        if (groups.length) applyGroupsLocal(groups);
      },
    );
  };

  /** 改 Kaizen, scoped. "types" sweeps the taxonomy (placements, type/path
   *  drift, duplicate/empty/unowned types); "garments" sweeps only the
   *  gender dimension. Each opens the panel showing just its findings, so a
   *  type pass never silently touches gender and vice-versa. */
  const runKaizen = (mode: 'types' | 'garments') => {
    setKaizenMenuOpen(false);
    const full = kaizenSweep(products, tree);
    setAudit(mode === 'garments'
      ? { retypes: [], drift: [], genderChanges: full.genderChanges, emptyTypes: [], duplicateTypes: [], orphanTypes: [] }
      : { ...full, genderChanges: [] });
  };

  /** Drill delete: deactivates the products (gone from the consumer feed
   *  AND the brain — fetchGovernanceProducts is is_active-scoped). One
   *  undoable gesture; Undo reactivates. */
  const handleDeleteProducts = (ids: string[]) => {
    const matched = products.filter(p => ids.includes(p.id));
    if (matched.length === 0) return;
    const idSet = new Set(ids);
    commit(
      matched.length === 1
        ? `Deleted ${matched[0].name}`
        : `Deleted ${matched.length} products`,
      [{ op: 'products-update', groups: [{ ids, patch: { is_active: false } }] }],
      [{ op: 'products-update', groups: [{ ids, patch: { is_active: true } }] }],
      () => setProducts(prev => prev.filter(p => !idSet.has(p.id))),
    );
    setDrillSel(new Set());
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

  // Orbit joystick (mobile dock): deflection = orbit RATE, applied per
  // frame while held — a real flight-stick, not a position map.
  const joySet = (ev: React.PointerEvent) => {
    const rect = (ev.currentTarget as Element).getBoundingClientRect();
    const limit = rect.width / 2 - 16;
    let dx = ev.clientX - (rect.left + rect.width / 2);
    let dy = ev.clientY - (rect.top + rect.height / 2);
    const d = Math.hypot(dx, dy);
    if (d > limit) { dx = (dx / d) * limit; dy = (dy / d) * limit; }
    if (joy.current) { joy.current.dx = dx; joy.current.dy = dy; }
    setJoyKnob({ x: dx, y: dy });
  };
  const joyDown = (ev: React.PointerEvent) => {
    ev.preventDefault();
    (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId);
    setShowcase(false);
    joy.current = { dx: 0, dy: 0, raf: 0 };
    joySet(ev);
    const tick = () => {
      const j = joy.current;
      if (!j) return;
      camRef.current?.orbitBy(j.dy * 0.0011, j.dx * 0.0011);
      j.raf = requestAnimationFrame(tick);
    };
    joy.current.raf = requestAnimationFrame(tick);
  };
  const joyEnd = () => {
    if (joy.current) cancelAnimationFrame(joy.current.raf);
    joy.current = null;
    setJoyKnob(null);
  };
  useEffect(() => () => { if (joy.current) cancelAnimationFrame(joy.current.raf); }, []);

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
        <button
          type="button"
          className="gov-c-fab"
          aria-label="Toggle controls"
          onClick={() => setMobileControlsOpen(v => !v)}
        >C</button>
        {/* Mobile-only top bar: the view toggle + Kaizen live in the open,
            not behind the C menu (founder's call). */}
        <div className="gov-mobile-bar">
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
          <div className="gov-kaizen-wrap">
            <button
              type="button"
              className="gov-ghost gov-kaizen-btn"
              aria-haspopup="menu"
              aria-expanded={kaizenMenuOpen}
              onClick={() => setKaizenMenuOpen(v => !v)}
            >
              改 Kaizen
            </button>
            {kaizenMenuOpen && (
              <div className="gov-kaizen-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => runKaizen('types')}>改 Kaizen types</button>
                <button type="button" role="menuitem" onClick={() => runKaizen('garments')}>改 Kaizen garments</button>
              </div>
            )}
          </div>
        </div>
        <div className={`gov-controls-row gov-canvas-controls${mobileControlsOpen ? ' is-open' : ''}`}>
          <div className="gov-kaizen-wrap">
            <button
              type="button"
              className="gov-ghost gov-kaizen-btn"
              title="Continuous improvement: choose a focused sweep — Kaizen types (product placement, drifted columns, duplicate / empty / unowned types) or Kaizen garments (gender). Also runs every morning at 6 a.m. ET."
              aria-haspopup="menu"
              aria-expanded={kaizenMenuOpen}
              onClick={() => setKaizenMenuOpen(v => !v)}
            >
              改 Kaizen
            </button>
            {kaizenMenuOpen && (
              <div className="gov-kaizen-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => runKaizen('types')}>改 Kaizen types</button>
                <button type="button" role="menuitem" onClick={() => runKaizen('garments')}>改 Kaizen garments</button>
              </div>
            )}
          </div>
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
          dofStop={dofStop}
          showcase={showcase}
          onShowcaseInterrupt={() => setShowcase(false)}
          controlRef={camRef}
          onZoomChange={setZoomUi}
          resetSignal={resetSignal}
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
                title={`${prod.name} — click to select, drag onto a subtype to recategorize`}
                draggable
                onDragStart={ev => startCardDrag(prod.id, ev)}
                onDragEnd={endCardDrag}
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
                  <span
                    className="gov-drill-delete"
                    role="button"
                    title="Delete product (hides it from the catalog — undoable)"
                    onClick={ev => { ev.stopPropagation(); handleDeleteProducts([prod.id]); }}
                  >✕</span>
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
                  <button type="button" className="gov-moveto" disabled={kaizenSelBusy} onClick={() => void kaizenSelection()}>
                    {kaizenSelBusy ? 'Thinking…' : `改 Kaizen ${drillSel.size}`}
                  </button>
                  <button type="button" className="gov-ghost gov-drill-delete-bulk" onClick={() => handleDeleteProducts([...drillSel])}>
                    Delete {drillSel.size}
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
              <div
                className={`gov-drill-direct${dropTarget === drill.nodeId ? ' is-drop' : ''}`}
                onDragOver={ev => overDropTarget(drill.nodeId, ev)}
                onDrop={ev => dropOnNode(drill.nodeId, ev)}
              >
              {prods.length === 0 ? (
                <p className="gov-drill-empty">No products attached directly to this type yet. Drag cards here to move them up to this type.</p>
              ) : (
                <div className="gov-drill-grid">
                  {prods.map(renderCard)}
                </div>
              )}
              </div>

              {children.length > 0 && (
                <div className="gov-drill-subs">
                  <h3>Subtypes<span className="gov-drill-subs-hint">drag a product onto a row to recategorize it</span></h3>
                  {children.map(child => {
                    const list = subProducts(child.id);
                    const open = openSubs.has(child.id);
                    return (
                      <div
                        key={child.id}
                        className={`gov-drill-sub${open ? ' is-open' : ''}${dropTarget === child.id ? ' is-drop' : ''}`}
                        onDragOver={ev => overDropTarget(child.id, ev)}
                        onDrop={ev => dropOnNode(child.id, ev)}
                      >
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
            {/* Camera: lens stop (depth of field) + showcase auto-orbit. */}
            <div className="gov-dof">
              <span>Lens</span>
              {([null, 1.4, 2, 2.8, 4, 8] as const).map(stop => (
                <button
                  key={String(stop)}
                  type="button"
                  className={dofStop === stop ? 'is-active' : ''}
                  onClick={() => setDofStop(stop)}
                >{stop === null ? 'off' : `ƒ/${stop}`}</button>
              ))}
            </div>
            <button
              type="button"
              className={`gov-showcase${showcase ? ' is-on' : ''}`}
              onClick={() => setShowcase(v => !v)}
              title="The camera drifts itself between angles — touch the canvas to take back control"
            >
              {showcase ? '◉ Showcase — touring' : '◉ Showcase'}
            </button>
            <button
              type="button"
              className="gov-showcase"
              onClick={fireReset}
              title="Fly home: flat 2D view, zoom 1, rings level — with a bounce"
            >
              ⟲ Reset
            </button>
          </div>
        )}

        <div className="gov-legend">
          <span style={{ ['--c' as string]: GENDER_COLORS.male }}>male</span>
          <span style={{ ['--c' as string]: GENDER_COLORS.female }}>female</span>
          <span style={{ ['--c' as string]: GENDER_COLORS.unisex }}>unisex</span>
          <span style={{ ['--c' as string]: '#f59e0b' }}>unassigned</span>
        </div>

        {/* Mobile-only bottom dock: camera controls (zoom slider + orbit
            joystick) and the display tools (lens, showcase) — everything
            that has no room at the top. Hidden while a drill is open. */}
        {!drill && (
          <div className="gov-dock">
            <label className="gov-dock-zoom">
              <span aria-hidden="true">−</span>
              <input
                type="range"
                min={35}
                max={250}
                value={Math.round(zoomUi * 100)}
                aria-label="Zoom"
                onChange={e => {
                  const k = Number(e.target.value) / 100;
                  setShowcase(false);
                  setZoomUi(k);
                  camRef.current?.zoomTo(k);
                }}
              />
              <span aria-hidden="true">+</span>
            </label>
            <div className="gov-dock-row">
              <div
                className="gov-joystick"
                role="application"
                aria-label="Orbit joystick"
                onPointerDown={joyDown}
                onPointerMove={ev => { if (joy.current) joySet(ev); }}
                onPointerUp={joyEnd}
                onPointerCancel={joyEnd}
              >
                <i
                  className="gov-joystick-knob"
                  style={joyKnob ? { transform: `translate(calc(-50% + ${joyKnob.x}px), calc(-50% + ${joyKnob.y}px))` } : undefined}
                />
              </div>
              <div className="gov-dock-tools">
                <div className="gov-dof">
                  <span>Lens</span>
                  {([null, 1.4, 2, 2.8, 4, 8] as const).map(stop => (
                    <button
                      key={String(stop)}
                      type="button"
                      className={dofStop === stop ? 'is-active' : ''}
                      onClick={() => setDofStop(stop)}
                    >{stop === null ? 'off' : `ƒ/${stop}`}</button>
                  ))}
                </div>
                <div className="gov-dock-actions">
                  <button
                    type="button"
                    className={`gov-showcase${showcase ? ' is-on' : ''}`}
                    onClick={() => setShowcase(v => !v)}
                  >
                    {showcase ? '◉ Showcase — touring' : '◉ Showcase'}
                  </button>
                  <button type="button" className="gov-showcase" onClick={fireReset}>
                    ⟲ Reset
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
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
        <KaizenPanel
          report={audit}
          onRefine={refineKaizen}
          onApply={applyKaizen}
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

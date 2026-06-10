// /admin/governance — the type brain. An Obsidian-style force graph of the
// product-type taxonomy with catalog at the centre. Edits stage in a
// pending bar (with affected-product counts) and commit in one Apply, which
// cascades renames into products.type and cross-lane moves into
// products.gender. Toggle products on to see where the live catalog hangs
// off the tree; unmatched products gather in an amber "unassigned" cluster
// and can be dragged into place.

import { useCallback, useEffect, useMemo, useState } from 'react';
import TypeBrainGraph, { type BrainNode, type BrainProduct } from '~/components/admin/TypeBrainGraph';
import {
  applyGovernanceChanges,
  createTypeNode,
  fetchGovernanceProducts,
  fetchTypeTree,
  normalizeTypeName,
  type GovernanceChange,
  type GovernanceProduct,
  type TypeNode,
} from '~/services/type-governance';
import '~/styles/governance.css';

const UNASSIGNED_ID = '__unassigned__';
const NEUTRAL = '#cbd5e1';
const GENDER_LANES = new Set(['male', 'female', 'unisex']);

export default function AdminGovernance() {
  const [tree, setTree] = useState<TypeNode[]>([]);
  const [products, setProducts] = useState<GovernanceProduct[]>([]);
  const [pending, setPending] = useState<GovernanceChange[]>([]);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [showProducts, setShowProducts] = useState(false);
  const [fanned, setFanned] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [t, p] = await Promise.all([fetchTypeTree(), fetchGovernanceProducts()]);
    setTree(t);
    setProducts(p);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  // ── Effective tree = base + staged rename/move/delete ──
  const effectiveTree = useMemo(() => {
    let nodes = tree.map(n => ({ ...n }));
    for (const ch of pending) {
      if (ch.kind === 'rename') nodes = nodes.map(n => n.id === ch.nodeId ? { ...n, name: ch.to } : n);
      else if (ch.kind === 'move') nodes = nodes.map(n => n.id === ch.nodeId ? { ...n, parentId: ch.toParentId } : n);
      else if (ch.kind === 'delete') {
        const dead = new Set([ch.nodeId]);
        let grew = true;
        while (grew) {
          grew = false;
          for (const n of nodes) {
            if (n.parentId && dead.has(n.parentId) && !dead.has(n.id)) { dead.add(n.id); grew = true; }
          }
        }
        nodes = nodes.filter(n => !dead.has(n.id));
      }
    }
    return nodes;
  }, [tree, pending]);

  // Depth, lane (gender), and resolved color per node.
  const meta = useMemo(() => {
    const byId = new Map(effectiveTree.map(n => [n.id, n]));
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
    effectiveTree.forEach(resolve);
    return out;
  }, [effectiveTree]);

  // ── Product attachment: staged overlays first, then name match ──
  const overlay = useMemo(() => {
    const m = new Map<string, string>(); // productId → effective type name
    for (const ch of pending) {
      if (ch.kind === 'rename') for (const id of ch.productIds) m.set(id, ch.to);
      else if (ch.kind === 'assign') for (const id of ch.productIds) m.set(id, ch.typeName);
    }
    return m;
  }, [pending]);

  const { attach, unassigned } = useMemo(() => {
    const byName = new Map<string, string>(); // normalized name → nodeId
    for (const n of effectiveTree) byName.set(normalizeTypeName(n.name), n.id);
    const attach = new Map<string, GovernanceProduct[]>();
    const unassigned: GovernanceProduct[] = [];
    for (const prod of products) {
      const t = overlay.get(prod.id) ?? prod.type;
      const nodeId = t ? byName.get(normalizeTypeName(t)) : undefined;
      if (nodeId) attach.set(nodeId, [...(attach.get(nodeId) ?? []), prod]);
      else unassigned.push(prod);
    }
    return { attach, unassigned };
  }, [effectiveTree, products, overlay]);

  const brainNodes = useMemo<BrainNode[]>(() => {
    const nodes = effectiveTree.map(n => {
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
  }, [effectiveTree, meta, attach, showProducts, unassigned.length]);

  const productsOf = useCallback((nodeId: string): GovernanceProduct[] =>
    nodeId === UNASSIGNED_ID ? unassigned : (attach.get(nodeId) ?? []),
  [attach, unassigned]);

  /** Every product under a node, including its descendants' — the set a
   *  cross-lane move re-genders. */
  const subtreeProductIds = useCallback((nodeId: string): string[] => {
    const ids: string[] = [];
    const walk = (id: string) => {
      for (const prod of attach.get(id) ?? []) ids.push(prod.id);
      for (const n of effectiveTree) if (n.parentId === id) walk(n.id);
    };
    walk(nodeId);
    return ids;
  }, [attach, effectiveTree]);

  // ── Staging handlers ──
  const stage = (ch: GovernanceChange) => { setPending(prev => [...prev, ch]); setError(null); };

  const handleRename = (nodeId: string, to: string) => {
    const node = effectiveTree.find(n => n.id === nodeId);
    if (!node || node.name === to) return;
    stage({ kind: 'rename', nodeId, from: node.name, to,
      productIds: (attach.get(nodeId) ?? []).map(prod => prod.id) });
  };

  const handleReparent = (nodeIds: string[], targetId: string) => {
    if (targetId === UNASSIGNED_ID) return;
    const targetLane = meta.get(targetId)?.lane ?? null;
    for (const nodeId of nodeIds) {
      if (nodeId === targetId || nodeId === UNASSIGNED_ID) continue;
      const node = effectiveTree.find(n => n.id === nodeId);
      if (!node || node.parentId === targetId) continue;
      const lane = meta.get(nodeId)?.lane ?? null;
      const crossesLane = !!targetLane && targetLane !== lane;
      stage({ kind: 'move', nodeId, toParentId: targetId,
        genderTo: crossesLane ? targetLane : undefined,
        productIds: crossesLane ? subtreeProductIds(nodeId) : [] });
    }
  };

  const handleDelete = (nodeIds: string[]) => {
    for (const nodeId of nodeIds) {
      if (nodeId === UNASSIGNED_ID) continue;
      stage({ kind: 'delete', nodeId, productIds: subtreeProductIds(nodeId) });
    }
    setSelection(new Set());
  };

  const handleAddChild = async (parentId: string) => {
    if (parentId === UNASSIGNED_ID) return;
    const created = await createTypeNode('new type', parentId);
    if (created) setTree(prev => [...prev, created]);
  };

  const handleAssign = (productIds: string[], nodeId: string) => {
    if (nodeId === UNASSIGNED_ID) return;
    const node = effectiveTree.find(n => n.id === nodeId);
    if (!node) return;
    const lane = meta.get(nodeId)?.lane ?? undefined;
    stage({ kind: 'assign', nodeId, typeName: node.name, genderTo: lane, productIds });
  };

  // ── Apply / discard ──
  const affectedCount = useMemo(
    () => new Set(pending.flatMap(ch => ch.productIds)).size,
    [pending],
  );
  const handleApply = async () => {
    setApplying(true);
    const err = await applyGovernanceChanges(pending);
    setApplying(false);
    if (err) { setError(err); return; }
    setPending([]);
    await reload();
  };

  const changeLabel = (ch: GovernanceChange): string => {
    const n = (id: string) => effectiveTree.find(x => x.id === id)?.name ?? tree.find(x => x.id === id)?.name ?? '?';
    if (ch.kind === 'rename') return `rename ${ch.from} → ${ch.to} · ${ch.productIds.length} products`;
    if (ch.kind === 'move') return `move ${n(ch.nodeId)} → ${ch.toParentId ? n(ch.toParentId) : 'catalog'}${ch.genderTo ? ` · ${ch.productIds.length} products → ${ch.genderTo}` : ''}`;
    if (ch.kind === 'delete') return `delete ${n(ch.nodeId)}${ch.productIds.length ? ` · ${ch.productIds.length} products unassigned` : ''}`;
    return `assign ${ch.productIds.length} product${ch.productIds.length === 1 ? '' : 's'} → ${ch.typeName}`;
  };

  return (
    <div className="gov-page">
      <header className="gov-head">
        <div>
          <p className="gov-kicker">Governance</p>
          <h1>Types — set up for more possibilities</h1>
          <p className="gov-sub">
            One editable structure for every product type. Drag to rearrange, double-click to
            rename, marquee to select many — changes stage below and cascade to every attached
            product on Apply.
          </p>
        </div>
        <div className="gov-controls">
          <button
            type="button"
            className={`gov-toggle${showProducts ? ' is-on' : ''}`}
            onClick={() => { setShowProducts(v => !v); setFanned(null); }}
          >
            <span className="gov-toggle-dot" />
            Products {showProducts ? 'on' : 'off'}
          </button>
          <div className="gov-legend">
            <span style={{ ['--c' as string]: '#60a5fa' }}>male</span>
            <span style={{ ['--c' as string]: '#f472b6' }}>female</span>
            <span style={{ ['--c' as string]: '#34d399' }}>unisex</span>
            <span style={{ ['--c' as string]: '#f59e0b' }}>unassigned</span>
          </div>
        </div>
      </header>

      <TypeBrainGraph
        nodes={brainNodes}
        selection={selection}
        showProducts={showProducts}
        fannedNodeId={fanned}
        fannedProducts={(fanned ? productsOf(fanned) : []) as BrainProduct[]}
        onSelect={setSelection}
        onReparent={handleReparent}
        onRename={handleRename}
        onDelete={handleDelete}
        onAddChild={(id) => { void handleAddChild(id); }}
        onFan={setFanned}
        onAssignProducts={handleAssign}
      />

      {pending.length > 0 && (
        <div className="gov-applybar">
          <div className="gov-applybar-list">
            {pending.map((ch, i) => (
              <span key={i} className="gov-chip">
                {changeLabel(ch)}
                <button type="button" aria-label="Discard change"
                  onClick={() => setPending(prev => prev.filter((_, j) => j !== i))}>×</button>
              </span>
            ))}
          </div>
          <div className="gov-applybar-actions">
            {error && <span className="gov-error">{error}</span>}
            <span className="gov-affected">
              {pending.length} change{pending.length === 1 ? '' : 's'} · ~{affectedCount} products affected
            </span>
            <button type="button" className="gov-discard" onClick={() => { setPending([]); setError(null); }}>
              Discard
            </button>
            <button type="button" className="gov-apply" disabled={applying} onClick={() => { void handleApply(); }}>
              {applying ? 'Applying…' : 'Apply'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

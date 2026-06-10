// Data layer for /admin/governance/types — the editable product-type tree
// ("type brain") and its live cascades into the products table.
//
// Contract with the DB (migration 20260610010000):
//   product_types(id, name, parent_id, sort, color, …) — parent_id null is
//   the first ring under the implicit "catalog" root node.
//
// Edits are INSTANT (founder's call: real-time governance), so every
// gesture compiles to a list of low-level ops plus a precomputed INVERSE
// list built from snapshots — executing the inverse is undo. Products
// attach to tree leaves by name match (lowercased, de-pluralized), so the
// tree can use plural display names while products.type keeps whatever
// casing it has.

import { supabase } from '~/utils/supabase';
import { inferProductTypeAndSubtype } from '~/services/product-types';

export interface TypeNode {
  id: string;
  name: string;
  parentId: string | null;
  sort: number;
  color: string | null;
  /** Gender is an ATTRIBUTE rendered as node color, not a tree node
   *  (founder's call). Null inherits the nearest ancestor's gender. */
  gender: 'male' | 'female' | 'unisex' | null;
  /** 24x24 path data drawn by the generate-type-icons function (re-drawn
   *  daily at 6 a.m. by pg_cron, each pass improving on the last). */
  iconPath: string | null;
}

export interface GovernanceProduct {
  id: string;
  name: string;
  brand: string | null;
  type: string | null;
  gender: string | null;
  /** Materialized ancestry chain, e.g. 'catalog / fashion / bottoms /
   *  pants / trousers' minus the implicit root — the answer to "a product
   *  ten levels deep": type stays the leaf, type_path holds every level.
   *  Governance gestures keep it in sync. */
  typePath: string | null;
  image: string | null;
}

/** Low-level mutations. A gesture is a list of these; its undo is another. */
export type GovernanceOp =
  | { op: 'node-update'; id: string; patch: { name?: string; parent_id?: string | null; gender?: string | null } }
  | { op: 'node-insert'; rows: { id: string; name: string; parent_id: string | null; sort: number; color: string | null; gender: string | null }[] }
  | { op: 'node-delete'; id: string }
  | { op: 'products-update'; groups: ProductGroup[] };

export interface ProductGroup {
  ids: string[];
  patch: { type?: string | null; gender?: string | null; type_path?: string | null };
}

/** Lower-case + de-pluralize so 'dresses' ≡ 'Dress', 'phone cases' ≡
 *  'Phone Case'. Both sides of every match run through this. */
export function normalizeTypeName(s: string): string {
  const n = s.toLowerCase().trim();
  if (n.endsWith('ses')) return n.slice(0, -2);
  if (n.endsWith('ss')) return n;
  if (n.endsWith('s') && n.length > 2) return n.slice(0, -1);
  return n;
}

export async function fetchTypeTree(): Promise<TypeNode[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('product_types')
    .select('id, name, parent_id, sort, color, gender, icon_path')
    .order('sort', { ascending: true });
  if (error || !data) return [];
  return (data as { id: string; name: string; parent_id: string | null; sort: number; color: string | null;
    gender: TypeNode['gender']; icon_path: string | null }[])
    .map(r => ({ id: r.id, name: r.name, parentId: r.parent_id, sort: r.sort, color: r.color, gender: r.gender,
      iconPath: r.icon_path }));
}

export async function fetchGovernanceProducts(): Promise<GovernanceProduct[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('products')
    .select('id, name, brand, type, gender, type_path, primary_image_url, image_url')
    .eq('is_active', true)
    .limit(2000);
  if (error || !data) return [];
  return (data as { id: string; name: string; brand: string | null; type: string | null;
    gender: string | null; type_path: string | null;
    primary_image_url: string | null; image_url: string | null }[])
    .map(r => ({
      id: r.id, name: r.name, brand: r.brand, type: r.type, gender: r.gender,
      typePath: r.type_path, image: r.primary_image_url || r.image_url,
    }));
}

/** Executes a gesture's ops in order. Node writes precede product
 *  cascades within a gesture (the callers order them that way), so a
 *  mid-flight failure can't leave products pointing at type names the
 *  tree never adopted. Returns the first error message, if any. */
export async function executeGovernanceOps(ops: GovernanceOp[]): Promise<string | null> {
  if (!supabase) return 'No database connection';
  const sb = supabase;
  const touch = { updated_at: new Date().toISOString() };
  for (const o of ops) {
    if (o.op === 'node-update') {
      const { error } = await sb.from('product_types').update({ ...o.patch, ...touch }).eq('id', o.id);
      if (error) return error.message;
    } else if (o.op === 'node-insert') {
      const { error } = await sb.from('product_types').insert(o.rows);
      if (error) return error.message;
    } else if (o.op === 'node-delete') {
      // Children cascade in the DB; matched products keep their type text
      // and surface in the unassigned cluster.
      const { error } = await sb.from('product_types').delete().eq('id', o.id);
      if (error) return error.message;
    } else {
      for (const g of o.groups) {
        if (!g.ids.length) continue;
        const { error } = await sb.from('products').update(g.patch).in('id', g.ids);
        if (error) return error.message;
      }
    }
  }
  return null;
}

/** Group products by current literal value so an undo restores each
 *  product's EXACT prior type/gender (they vary in casing and history). */
export function snapshotGroups(
  products: GovernanceProduct[],
  field: 'type' | 'gender' | 'typePath',
): ProductGroup[] {
  const column = field === 'typePath' ? 'type_path' : field;
  const byValue = new Map<string | null, string[]>();
  for (const p of products) {
    const v = p[field];
    byValue.set(v, [...(byValue.get(v) ?? []), p.id]);
  }
  return [...byValue.entries()].map(([v, ids]) => ({ ids, patch: { [column]: v } }));
}

// ── Type audit ────────────────────────────────────────────────────────
// Walks every product and asks "is there a better node in the tree for
// this?". Two signals, best (deepest / most specific) match wins:
//   1. a tree node's name appearing as a word in the product name
//      ("Kate Jean - Tidal Blue" → jeans)
//   2. the regex taxonomy's type/subtype (synonyms: "denim" → Jeans),
//      mapped into the tree by normalized name.
// A product already on the recommended node — or on a DEEPER node inside
// the recommended branch — is left alone.

export interface TypeAuditRecommendation {
  productId: string;
  name: string;
  brand: string | null;
  image: string | null;
  fromType: string | null;
  toNodeId: string;
  toName: string;
  toPath: string;
  reason: string;
}

const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function auditProductTypes(
  products: GovernanceProduct[],
  tree: TypeNode[],
): TypeAuditRecommendation[] {
  const byId = new Map(tree.map(n => [n.id, n]));
  const byNorm = new Map<string, TypeNode>();
  for (const n of tree) byNorm.set(normalizeTypeName(n.name), n);

  const depthMemo = new Map<string, number>();
  const depth = (n: TypeNode): number => {
    const cached = depthMemo.get(n.id);
    if (cached !== undefined) return cached;
    const parent = n.parentId ? byId.get(n.parentId) : null;
    const v = parent ? depth(parent) + 1 : 1;
    depthMemo.set(n.id, v);
    return v;
  };
  const pathMemo = new Map<string, string>();
  const path = (n: TypeNode): string => {
    const cached = pathMemo.get(n.id);
    if (cached) return cached;
    const parent = n.parentId ? byId.get(n.parentId) : null;
    const v = parent ? `${path(parent)} / ${n.name}` : n.name;
    pathMemo.set(n.id, v);
    return v;
  };
  const inBranch = (node: TypeNode, ancestor: TypeNode): boolean => {
    let cur: TypeNode | undefined = node;
    while (cur) {
      if (cur.id === ancestor.id) return true;
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return false;
  };

  // Precompiled word-boundary matcher per node ("jean" also hits "jeans").
  const matchers = tree
    .map(n => {
      const norm = normalizeTypeName(n.name);
      return norm.length >= 3
        ? { node: n, norm, rx: new RegExp(`\\b${escapeRx(norm)}(?:s|es)?\\b`, 'i') }
        : null;
    })
    .filter((m): m is { node: TypeNode; norm: string; rx: RegExp } => m !== null);

  const recs: TypeAuditRecommendation[] = [];
  for (const p of products) {
    const currentNode = p.type ? byNorm.get(normalizeTypeName(p.type)) ?? null : null;

    let best: TypeNode | null = null;
    let bestScore = -1;
    let bestReason = '';
    const consider = (node: TypeNode, reason: string) => {
      const score = depth(node) * 100 + normalizeTypeName(node.name).length;
      if (score > bestScore) { best = node; bestScore = score; bestReason = reason; }
    };
    for (const m of matchers) {
      if (m.rx.test(p.name)) consider(m.node, `name contains “${m.node.name}”`);
    }
    const inferred = inferProductTypeAndSubtype(p.name, p.brand);
    for (const cand of [inferred?.subtype, inferred?.type]) {
      if (!cand) continue;
      const node = byNorm.get(normalizeTypeName(cand));
      if (node) consider(node, `taxonomy match: ${cand}`);
    }

    if (!best) continue;
    const target: TypeNode = best;
    if (currentNode && (currentNode.id === target.id || inBranch(currentNode, target))) continue;
    recs.push({
      productId: p.id,
      name: p.name,
      brand: p.brand,
      image: p.image,
      fromType: p.type,
      toNodeId: target.id,
      toName: target.name,
      toPath: path(target),
      reason: bestReason,
    });
  }
  recs.sort((a, b) => (a.toPath + a.name).localeCompare(b.toPath + b.name));
  return recs;
}

export async function createTypeNode(name: string, parentId: string | null): Promise<TypeNode | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('product_types')
    .insert({ name, parent_id: parentId, sort: 999 })
    .select('id, name, parent_id, sort, color, gender, icon_path')
    .single();
  if (error || !data) return null;
  const r = data as { id: string; name: string; parent_id: string | null; sort: number; color: string | null;
    gender: TypeNode['gender']; icon_path: string | null };
  return { id: r.id, name: r.name, parentId: r.parent_id, sort: r.sort, color: r.color, gender: r.gender,
    iconPath: r.icon_path };
}

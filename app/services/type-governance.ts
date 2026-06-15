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
import { haikuIdentity } from '~/utils/haiku';
import { proposeProductGenders, type ProductGender } from '~/services/genders';
import { inferProductTypeAndSubtype } from '~/services/product-types';
import { governanceRendition, warmPosters } from '~/utils/poster-prefetch';

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
  /** Haiku's read of the primary image — what the item ACTUALLY is.
   *  Names lie; the matchers below weigh this alongside the name. */
  haikuContext: string | null;
}

/** Low-level mutations. A gesture is a list of these; its undo is another. */
export type GovernanceOp =
  | { op: 'node-update'; id: string; patch: { name?: string; parent_id?: string | null; gender?: string | null } }
  | { op: 'node-insert'; rows: { id: string; name: string; parent_id: string | null; sort: number; color: string | null; gender: string | null }[] }
  | { op: 'node-delete'; id: string }
  | { op: 'products-update'; groups: ProductGroup[] };

export interface ProductGroup {
  ids: string[];
  patch: { type?: string | null; gender?: string | null; type_path?: string | null; is_active?: boolean };
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
    .select('id, name, brand, type, gender, type_path, primary_image_url, image_url, haiku_context')
    .eq('is_active', true)
    .limit(2000);
  if (error || !data) return [];
  // Warm every thumb into the HTTP cache immediately — by the time the
  // force layout settles, the satellites paint from cache in one frame.
  warmPosters((data as Array<{ primary_image_url: string | null; image_url: string | null }>)
    .map(r => governanceRendition(r.primary_image_url || r.image_url)));
  return (data as { id: string; name: string; brand: string | null; type: string | null;
    gender: string | null; type_path: string | null;
    primary_image_url: string | null; image_url: string | null }[])
    .map(r => ({
      id: r.id, name: r.name, brand: r.brand, type: r.type, gender: r.gender,
      typePath: r.type_path,
      // The governance rendition (tiny square webp) — the brain paints
      // hundreds of these at once, so the poster image goes through the
      // brain-tuned creative spec instead of shipping full-res.
      image: governanceRendition(r.primary_image_url || r.image_url),
      haikuContext: (r as unknown as { haiku_context?: string | null }).haiku_context ?? null,
    }));
}

// product_types has a unique (parent_id, name) — two siblings can't share a
// name. Rather than let a reparent/rename/insert blow up with a 23505, pick
// the next free "name", "name 2", "name 3"… under the target parent. Keeps
// every gesture succeeding instead of erroring out + reloading.
// deno-lint-ignore no-explicit-any
async function uniqueSiblingName(
  sb: any,
  parentId: string | null,
  desired: string,
  excludeId: string | null,
  alsoTaken: Set<string>,
): Promise<string> {
  let q = sb.from('product_types').select('id, name');
  q = parentId === null ? q.is('parent_id', null) : q.eq('parent_id', parentId);
  const { data } = await q;
  const taken = new Set<string>(alsoTaken);
  for (const r of (data ?? []) as { id: string; name: string }[]) {
    if (r.id !== excludeId) taken.add(r.name);
  }
  if (!taken.has(desired)) return desired;
  for (let i = 2; i < 200; i++) {
    const candidate = `${desired} ${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${desired} ${Date.now()}`;
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
      const patch = { ...o.patch };
      // A name or parent change can collide with a sibling — dedupe so the
      // gesture never 23505s. Resolve the node's final parent + name first.
      if (patch.name !== undefined || patch.parent_id !== undefined) {
        const { data: cur } = await sb.from('product_types')
          .select('parent_id, name').eq('id', o.id).maybeSingle();
        const parentId = patch.parent_id !== undefined ? patch.parent_id : (cur?.parent_id ?? null);
        const name = patch.name !== undefined ? patch.name : (cur?.name ?? '');
        const unique = await uniqueSiblingName(sb, parentId, name, o.id, new Set());
        if (unique !== name) patch.name = unique;
      }
      const { error } = await sb.from('product_types').update({ ...patch, ...touch }).eq('id', o.id);
      if (error) return error.message;
    } else if (o.op === 'node-insert') {
      // Dedupe each row against existing siblings AND the others in this
      // batch (per parent) before inserting.
      const batchTaken = new Map<string | null, Set<string>>();
      const rows = [];
      for (const row of o.rows) {
        const seen = batchTaken.get(row.parent_id) ?? new Set<string>();
        const name = await uniqueSiblingName(sb, row.parent_id, row.name, row.id, seen);
        seen.add(name);
        batchTaken.set(row.parent_id, seen);
        rows.push({ ...row, name });
      }
      const { error } = await sb.from('product_types').insert(rows);
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
    const hctx = haikuIdentity(p.haikuContext);
    for (const m of matchers) {
      if (m.rx.test(p.name)) consider(m.node, `name contains “${m.node.name}”`);
      else if (hctx && m.rx.test(hctx)) {
        consider(m.node, `image shows ${m.node.name} (Haiku)`);
      }
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

/** Full ancestry string per node, matching products.type_path format. */
export function computeTypePaths(nodes: TypeNode[]): Map<string, string> {
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
export function computeEffectiveGenders(nodes: TypeNode[]): Map<string, string | null> {
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

export async function createTypeNode(name: string, parentId: string | null): Promise<TypeNode | null> {
  if (!supabase) return null;
  // (parent_id, name) is unique — siblings can't share a name. "Add child"
  // always seeds "new type", so on a collision (an un-renamed placeholder
  // already sits at this level) retry with a numeric suffix instead of
  // failing the whole gesture.
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? name : `${name} ${attempt + 1}`;
    const { data, error } = await supabase
      .from('product_types')
      .insert({ name: candidate, parent_id: parentId, sort: 999 })
      .select('id, name, parent_id, sort, color, gender, icon_path')
      .single();
    if (!error && data) {
      const r = data as { id: string; name: string; parent_id: string | null; sort: number; color: string | null;
        gender: TypeNode['gender']; icon_path: string | null };
      return { id: r.id, name: r.name, parentId: r.parent_id, sort: r.sort, color: r.color, gender: r.gender,
        iconPath: r.icon_path };
    }
    // 23505 = unique_violation → bump the suffix and retry; anything else is fatal.
    if (!error || (error as { code?: string }).code !== '23505') return null;
  }
  return null;
}

// ── Kaizen ────────────────────────────────────────────────────────────
// The audit, widened to EVERYTHING (founder's call): product placement
// (the original type audit) plus the taxonomy's own health — synced
// paths/genders, empty branches, duplicate names, and type strings no
// node owns. A server twin runs every morning at 6 a.m. ET (kaizen edge
// function via pg_cron) auto-applying only the safe sync fixes.

// Type/path sync only — the product's node is right but its denormalized
// type/type_path columns lag the tree. Gender lives in KaizenGenderChange
// so the two kinds of fix stay delineated in the UI and the data.
export interface KaizenDrift {
  productId: string;
  name: string;
  brand: string | null;
  image: string | null;
  nodeId: string;
  toType: string;
  toPath: string;
  fromPath: string | null;
}

// Gender sync only — a male/female type node wants its products to carry
// that gender. Applied as a gender-only patch (never touches type/path).
export interface KaizenGenderChange {
  productId: string;
  name: string;
  brand: string | null;
  image: string | null;
  fromGender: string | null;
  toGender: 'male' | 'female' | 'unisex';
  path: string;
}

export interface KaizenEmptyType { nodeId: string; name: string; path: string; subtreeIds: string[] }
export interface KaizenDuplicate {
  keepId: string; keepPath: string;
  dropId: string; dropPath: string;
  productCount: number;
}
export interface KaizenOrphan { typeName: string; productIds: string[] }

export interface KaizenReport {
  retypes: TypeAuditRecommendation[];
  drift: KaizenDrift[];
  genderChanges: KaizenGenderChange[];
  emptyTypes: KaizenEmptyType[];
  duplicateTypes: KaizenDuplicate[];
  orphanTypes: KaizenOrphan[];
}

export function kaizenSweep(products: GovernanceProduct[], tree: TypeNode[]): KaizenReport {
  const retypes = auditProductTypes(products, tree);
  const retypeIds = new Set(retypes.map(r => r.productId));
  const byId = new Map(tree.map(n => [n.id, n]));
  const byNorm = new Map<string, TypeNode[]>();
  for (const n of tree) {
    const k = normalizeTypeName(n.name);
    byNorm.set(k, [...(byNorm.get(k) ?? []), n]);
  }
  const paths = computeTypePaths(tree);
  const genders = computeEffectiveGenders(tree);

  // Drift: the product's node is right, but its denormalized columns lag
  // the tree. Split by kind so the UI/data delineate them: `drift` is
  // type/path-only; `genderChanges` is gender-only (and only when the node
  // is male/female — unisex is permissive).
  const drift: KaizenDrift[] = [];
  const genderChanges: KaizenGenderChange[] = [];
  const attachCount = new Map<string, number>();
  const orphanBuckets = new Map<string, { typeName: string; productIds: string[] }>();
  for (const p of products) {
    if (!p.type) continue;
    const norm = normalizeTypeName(p.type);
    const node = byNorm.get(norm)?.[0];
    if (!node) {
      if (!retypeIds.has(p.id)) {
        const b = orphanBuckets.get(norm) ?? { typeName: p.type, productIds: [] };
        b.productIds.push(p.id);
        orphanBuckets.set(norm, b);
      }
      continue;
    }
    attachCount.set(node.id, (attachCount.get(node.id) ?? 0) + 1);
    if (retypeIds.has(p.id)) continue; // the re-type patch supersedes drift
    const toPath = paths.get(node.id) ?? node.name;
    const nodeGender = genders.get(node.id) ?? null;
    // A node's gender only constrains products when it's male/female;
    // 'unisex'/null is permissive, so product-level gender (name/photo)
    // wins and a female heel under the unisex "shoes" node stays female.
    const forceGender = nodeGender === 'male' || nodeGender === 'female' ? nodeGender : null;
    if ((p.typePath ?? null) !== toPath) {
      drift.push({
        productId: p.id, name: p.name, brand: p.brand, image: p.image,
        nodeId: node.id, toType: node.name, toPath, fromPath: p.typePath,
      });
    }
    if (forceGender !== null && (p.gender ?? null) !== forceGender) {
      genderChanges.push({
        productId: p.id, name: p.name, brand: p.brand, image: p.image,
        fromGender: p.gender, toGender: forceGender, path: toPath,
      });
    }
  }

  // Subtree product counts → empty branches (topmost only, so one row
  // covers a whole dead branch; the freshly-added "new type" placeholder
  // is exempt).
  const children = new Map<string, string[]>();
  for (const n of tree) {
    if (n.parentId) children.set(n.parentId, [...(children.get(n.parentId) ?? []), n.id]);
  }
  const subtreeOf = (id: string): string[] => {
    const out: string[] = [id];
    for (const c of children.get(id) ?? []) out.push(...subtreeOf(c));
    return out;
  };
  const subtreeCount = (id: string): number =>
    subtreeOf(id).reduce((acc, sid) => acc + (attachCount.get(sid) ?? 0), 0);
  const emptyTypes: KaizenEmptyType[] = [];
  for (const n of tree) {
    if (normalizeTypeName(n.name) === 'new type') continue;
    if (subtreeCount(n.id) > 0) continue;
    const parentEmpty = n.parentId ? subtreeCount(n.parentId) === 0
      && normalizeTypeName(byId.get(n.parentId)?.name ?? '') !== 'new type' : false;
    if (parentEmpty) continue; // the topmost empty ancestor reports instead
    emptyTypes.push({ nodeId: n.id, name: n.name, path: paths.get(n.id) ?? n.name, subtreeIds: subtreeOf(n.id) });
  }

  // Duplicates: two nodes normalizing to the same name. Keep the busier
  // one; only offer drops with no children (deleting cascades children).
  const duplicateTypes: KaizenDuplicate[] = [];
  for (const group of byNorm.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => (attachCount.get(b.id) ?? 0) - (attachCount.get(a.id) ?? 0));
    const keep = sorted[0];
    for (const drop of sorted.slice(1)) {
      if ((children.get(drop.id) ?? []).length > 0) continue;
      duplicateTypes.push({
        keepId: keep.id, keepPath: paths.get(keep.id) ?? keep.name,
        dropId: drop.id, dropPath: paths.get(drop.id) ?? drop.name,
        productCount: attachCount.get(drop.id) ?? 0,
      });
    }
  }

  const orphanTypes = [...orphanBuckets.values()]
    .map(b => ({ typeName: b.typeName, productIds: b.productIds }))
    .sort((a, b) => b.productIds.length - a.productIds.length);

  return { retypes, drift, genderChanges, emptyTypes, duplicateTypes, orphanTypes };
}

/** Kaizen "garments" — re-derive every product's gender from its name,
 *  photo (Haiku) and brand, and flag the ones that disagree with the
 *  current value. Women's heels mis-tagged unisex/male → female; a book
 *  with a stray gender → unisex. Product-level (not the tree-gender drift
 *  in kaizenSweep), reviewed/applied gender-only in the Kaizen panel. */
export function genderAudit(products: GovernanceProduct[]): KaizenGenderChange[] {
  const proposed = proposeProductGenders(products.map(p => ({
    id: p.id, name: p.name, brand: p.brand, type: p.type,
    gender: (p.gender ?? null) as ProductGender, haiku_context: p.haikuContext,
  })));
  const out: KaizenGenderChange[] = [];
  for (const p of products) {
    const to = proposed.get(p.id);
    if (!to) continue;
    const from = p.gender ?? null;
    if (from === to) continue;
    out.push({
      productId: p.id, name: p.name, brand: p.brand, image: p.image,
      fromGender: from, toGender: to, path: p.typePath ?? p.type ?? '',
    });
  }
  return out;
}

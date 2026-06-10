// Data layer for /admin/governance — the editable product-type tree
// ("type brain") and its staged cascades into the products table.
//
// Contract with the DB (migration 20260610010000):
//   product_types(id, name, parent_id, sort, color, …) — parent_id null is
//   the first ring under the implicit "catalog" root node.
//
// Products attach to tree leaves by NAME match: both sides are lowercased
// and de-pluralized (dresses/Dress → dress), so the tree can use plural
// display names while products.type keeps whatever casing it has. Renames
// cascade the node's name into products.type verbatim for every matched
// product; moving a node across gender lanes cascades products.gender.

import { supabase } from '~/utils/supabase';

export interface TypeNode {
  id: string;
  name: string;
  parentId: string | null;
  sort: number;
  color: string | null;
}

export interface GovernanceProduct {
  id: string;
  name: string;
  type: string | null;
  gender: string | null;
  image: string | null;
}

export type GovernanceChange =
  | { kind: 'rename'; nodeId: string; from: string; to: string; productIds: string[] }
  | { kind: 'move'; nodeId: string; toParentId: string | null;
      /** Set when the move crosses gender lanes — cascades products.gender. */
      genderTo?: string; productIds: string[] }
  | { kind: 'delete'; nodeId: string; productIds: string[] }
  | { kind: 'assign'; nodeId: string; typeName: string; genderTo?: string; productIds: string[] };

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
    .select('id, name, parent_id, sort, color')
    .order('sort', { ascending: true });
  if (error || !data) return [];
  return (data as { id: string; name: string; parent_id: string | null; sort: number; color: string | null }[])
    .map(r => ({ id: r.id, name: r.name, parentId: r.parent_id, sort: r.sort, color: r.color }));
}

export async function fetchGovernanceProducts(): Promise<GovernanceProduct[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('products')
    .select('id, name, type, gender, primary_image_url, image_url')
    .eq('is_active', true)
    .limit(2000);
  if (error || !data) return [];
  return (data as { id: string; name: string; type: string | null; gender: string | null;
    primary_image_url: string | null; image_url: string | null }[])
    .map(r => ({
      id: r.id, name: r.name, type: r.type, gender: r.gender,
      image: r.primary_image_url || r.image_url,
    }));
}

/** Creates are live (no product impact, and the new node is immediately a
 *  drop target); everything destructive stages behind Apply. */
export async function createTypeNode(name: string, parentId: string | null): Promise<TypeNode | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('product_types')
    .insert({ name, parent_id: parentId, sort: 999 })
    .select('id, name, parent_id, sort, color')
    .single();
  if (error || !data) return null;
  const r = data as { id: string; name: string; parent_id: string | null; sort: number; color: string | null };
  return { id: r.id, name: r.name, parentId: r.parent_id, sort: r.sort, color: r.color };
}

/** Executes the staged change set in order. Tree writes first, then the
 *  product cascades, so a mid-flight failure leaves products untouched for
 *  the failed change onward. Returns the first error message, if any. */
export async function applyGovernanceChanges(changes: GovernanceChange[]): Promise<string | null> {
  if (!supabase) return 'No database connection';
  const sb = supabase;
  const touch = { updated_at: new Date().toISOString() };
  for (const ch of changes) {
    if (ch.kind === 'rename') {
      const { error } = await sb.from('product_types')
        .update({ name: ch.to, ...touch }).eq('id', ch.nodeId);
      if (error) return error.message;
      if (ch.productIds.length) {
        const { error: pe } = await sb.from('products')
          .update({ type: ch.to }).in('id', ch.productIds);
        if (pe) return pe.message;
      }
    } else if (ch.kind === 'move') {
      const { error } = await sb.from('product_types')
        .update({ parent_id: ch.toParentId, ...touch }).eq('id', ch.nodeId);
      if (error) return error.message;
      if (ch.genderTo && ch.productIds.length) {
        const { error: pe } = await sb.from('products')
          .update({ gender: ch.genderTo }).in('id', ch.productIds);
        if (pe) return pe.message;
      }
    } else if (ch.kind === 'delete') {
      // Children cascade in the DB; matched products keep their type text
      // and surface in the unassigned cluster.
      const { error } = await sb.from('product_types').delete().eq('id', ch.nodeId);
      if (error) return error.message;
    } else {
      const patch: Record<string, string> = { type: ch.typeName };
      if (ch.genderTo) patch.gender = ch.genderTo;
      const { error } = await sb.from('products').update(patch).in('id', ch.productIds);
      if (error) return error.message;
    }
  }
  return null;
}

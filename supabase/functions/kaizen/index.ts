// kaizen — the morning continuous-improvement sweep over the whole
// catalog taxonomy. Server twin of kaizenSweep in
// app/services/type-governance.ts (tree-name matcher only; the client
// adds the regex taxonomy on top).
//
// Runs daily at 6 a.m. ET via pg_cron (public.run_kaizen → net.http_post,
// migration 20260611000000). AUTO-APPLIES only the safe sync fixes —
// products whose type casing / type_path / gender lag the tree — and
// records everything else (better placements, duplicate / empty /
// unowned types) in kaizen_runs for review in the type brain's Kaizen
// panel.
//
// Auth: bearer must be the service-role key (the cron passes it from
// vault); admins review results through RLS on kaizen_runs instead of
// calling this directly.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface Node { id: string; name: string; parent_id: string | null; sort: number; color: string | null; gender: string | null }
interface Product { id: string; name: string; brand: string | null; type: string | null; gender: string | null; type_path: string | null; haiku_context: string | null }

function normalize(s: string): string {
  const n = s.toLowerCase().trim();
  if (n.endsWith('ses')) return n.slice(0, -2);
  if (n.endsWith('ss')) return n;
  if (n.endsWith('s') && n.length > 2) return n.slice(0, -1);
  return n;
}
const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The "identity" half of a Haiku context string — what the item IS, not
// where it sits. haiku-context leads with a one-line object identity
// ("houseplant", "high heels") and follows with a detail sentence that may
// mention the room/setting. Placement matching reads only the identity, or a
// plant shot in a living room gets mis-placed under "home". Falls back to the
// first sentence for legacy single-blob rows.
function haikuIdentity(text: string | null): string {
  if (!text) return '';
  const lines = text.split('\n')
    .map(l => l.replace(/^[#>\-*\s]+/, '').replace(/[*_`]/g, '').trim())
    .filter(Boolean);
  // First real content line — skip bare titles/labels ("Description").
  const line = lines.find(l => l.includes(' ') && !l.endsWith(':')) ?? lines[0] ?? text;
  const firstSentence = line.split(/(?<=[.!?])\s/)[0] ?? line;
  return firstSentence.trim();
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  // The vault-stored key can predate a signing rotation, so capability is
  // what's checked: only a service-role token can hit the auth admin API.
  let isService = !!serviceKey && bearer === serviceKey;
  if (!isService && bearer) {
    const probe = await fetch(`${supabaseUrl}/auth/v1/admin/users?per_page=1`, {
      headers: { apikey: bearer, Authorization: `Bearer ${bearer}` },
    });
    isService = probe.ok;
  }
  if (!isService) {
    return new Response(JSON.stringify({ success: false, error: 'service only' }), { status: 403 });
  }
  const supabase = createClient(supabaseUrl, serviceKey);
  let source = 'cron';
  try { source = String((await req.json())?.source ?? 'cron'); } catch { /* no body */ }

  try {
    const { data: treeRows } = await supabase
      .from('product_types').select('id, name, parent_id, sort, color, gender');
    const tree = (treeRows ?? []) as Node[];
    const { data: prodRows } = await supabase
      .from('products').select('id, name, brand, type, gender, type_path, haiku_context')
      .eq('is_active', true).limit(5000);
    const products = (prodRows ?? []) as Product[];

    const byId = new Map(tree.map(n => [n.id, n]));
    const byNorm = new Map<string, Node[]>();
    for (const n of tree) {
      const k = normalize(n.name);
      byNorm.set(k, [...(byNorm.get(k) ?? []), n]);
    }
    const depth = (n: Node): number => n.parent_id ? depth(byId.get(n.parent_id)!) + 1 : 1;
    const path = (n: Node): string => n.parent_id ? `${path(byId.get(n.parent_id)!)} / ${n.name}` : n.name;
    const effGender = (n: Node): string | null =>
      n.gender ?? (n.parent_id ? effGender(byId.get(n.parent_id)!) : null);
    const inBranch = (node: Node, ancestor: Node): boolean => {
      for (let cur: Node | undefined = node; cur; cur = cur.parent_id ? byId.get(cur.parent_id) : undefined) {
        if (cur.id === ancestor.id) return true;
      }
      return false;
    };
    const matchers = tree
      .filter(n => normalize(n.name).length >= 3)
      .map(n => ({ node: n, rx: new RegExp(`\\b${escapeRx(normalize(n.name))}(?:s|es)?\\b`, 'i') }));

    // ── Findings ─────────────────────────────────────────────────────
    const retypes: Record<string, unknown>[] = [];
    const drift: { product: Product; node: Node }[] = [];
    const orphans = new Map<string, { typeName: string; count: number }>();
    const attachCount = new Map<string, number>();
    const retypeIds = new Set<string>();

    for (const p of products) {
      const currentNode = p.type ? byNorm.get(normalize(p.type))?.[0] ?? null : null;
      const hctx = haikuIdentity(p.haiku_context);
      let best: Node | null = null;
      for (const m of matchers) {
        const hit = m.rx.test(p.name) || (hctx ? m.rx.test(hctx) : false);
        if (hit && (!best || depth(m.node) > depth(best))) best = m.node;
      }
      if (best && (!currentNode || (currentNode.id !== best.id && !inBranch(currentNode, best)))) {
        retypes.push({ productId: p.id, name: p.name, fromType: p.type, toPath: path(best) });
        retypeIds.add(p.id);
      }
      if (!p.type) continue;
      if (!currentNode) {
        if (!retypeIds.has(p.id)) {
          const k = normalize(p.type);
          const o = orphans.get(k) ?? { typeName: p.type, count: 0 };
          o.count++;
          orphans.set(k, o);
        }
        continue;
      }
      attachCount.set(currentNode.id, (attachCount.get(currentNode.id) ?? 0) + 1);
      if (retypeIds.has(p.id)) continue;
      const toPath = path(currentNode);
      const toGender = effGender(currentNode);
      if ((p.type_path ?? null) !== toPath || (toGender !== null && (p.gender ?? null) !== toGender)) {
        drift.push({ product: p, node: currentNode });
      }
    }

    const children = new Map<string, string[]>();
    for (const n of tree) {
      if (n.parent_id) children.set(n.parent_id, [...(children.get(n.parent_id) ?? []), n.id]);
    }
    const subtreeCount = (id: string): number =>
      (attachCount.get(id) ?? 0) + (children.get(id) ?? []).reduce((a, c) => a + subtreeCount(c), 0);
    const emptyTypes = tree
      .filter(n => normalize(n.name) !== 'new type' && subtreeCount(n.id) === 0
        && !(n.parent_id && subtreeCount(n.parent_id) === 0 && normalize(byId.get(n.parent_id)?.name ?? '') !== 'new type'))
      .map(n => ({ nodeId: n.id, path: path(n) }));
    const duplicateTypes = [...byNorm.values()].filter(g => g.length > 1).flatMap(g => {
      const sorted = [...g].sort((a, b) => (attachCount.get(b.id) ?? 0) - (attachCount.get(a.id) ?? 0));
      return sorted.slice(1)
        .filter(d => !(children.get(d.id) ?? []).length)
        .map(d => ({ keepPath: path(sorted[0]), dropPath: path(d), dropId: d.id }));
    });

    // ── Auto-apply the safe sync fixes ───────────────────────────────
    let autoFixed = 0;
    const buckets = new Map<string, { patch: Record<string, string | null>; ids: string[] }>();
    for (const d of drift) {
      const patch = { type: d.node.name, gender: effGender(d.node), type_path: path(d.node) };
      const key = JSON.stringify(patch);
      const b = buckets.get(key) ?? { patch, ids: [] };
      b.ids.push(d.product.id);
      buckets.set(key, b);
    }
    for (const b of buckets.values()) {
      const { error } = await supabase.from('products').update(b.patch).in('id', b.ids);
      if (!error) autoFixed += b.ids.length;
    }

    const trim = <T,>(a: T[]) => a.slice(0, 200);
    const report = {
      retypes: trim(retypes),
      driftFixed: drift.length,
      emptyTypes: trim(emptyTypes),
      duplicateTypes: trim(duplicateTypes),
      orphanTypes: trim([...orphans.values()]),
    };
    const findingCount = retypes.length + drift.length + emptyTypes.length
      + duplicateTypes.length + orphans.size;
    await supabase.from('kaizen_runs').insert({
      source, finding_count: findingCount, auto_fixed: autoFixed, report,
    });
    return new Response(JSON.stringify({ success: true, findingCount, autoFixed }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }), { status: 500 });
  }
});

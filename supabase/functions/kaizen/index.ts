// kaizen — the morning continuous-improvement sweep over the whole
// catalog taxonomy. Server twin of kaizenSweep in
// app/services/type-governance.ts (tree-name matcher only; the client
// adds the regex taxonomy on top).
//
// Runs daily at 6 a.m. ET via pg_cron (public.run_kaizen → net.http_post,
// migration 20260611000000). AUTO-APPLIES only the safe type/type_path
// sync, and records everything else — better placements, GENDER changes
// (kept separate so they're reviewed, never auto-written), duplicate /
// empty / unowned types — in kaizen_runs for review in the type brain's
// Kaizen panel.
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
  // Take the FIRST real line as the identity — it may be a single word
  // ("Sneaker"); skipping single-word lines falls through to the detail
  // sentence ("…and heel…", "…for the home…") and causes false matches.
  const LABEL = /^(description|summary|overview|identity|category|product|item|details?|note)$/i;
  const lines = text.split('\n')
    .map(l => l.replace(/^[#>\-*\s]+/, '').replace(/[*_`]/g, '').trim())
    .filter(l => l && !l.endsWith(':') && !LABEL.test(l));
  const line = lines[0] ?? text;
  return (line.split(/(?<=[.!?])\s/)[0] ?? line).trim();
}

// The EXPLICIT category Haiku reports, when present ("**Category:** Footwear
// / Casual Shoes"). Trusted over the title line for placement — a title like
// "Men's Low-Top Sneaker" contains "top" and mis-matches Tops. '' for the old
// two-line format (caller falls back to haikuIdentity).
function haikuCategory(text: string | null): string {
  if (!text) return '';
  for (const raw of text.split('\n')) {
    const line = raw.replace(/[*_`>#]/g, '').trim();
    const m = line.match(/^category\s*:?\s*(.+)$/i);
    if (m && m[1]) return m[1].trim();
  }
  return '';
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
    const drift: { product: Product; node: Node }[] = [];        // type/path only
    const genderChanges: Record<string, unknown>[] = [];          // gender only (review)
    const orphans = new Map<string, { typeName: string; count: number }>();
    const attachCount = new Map<string, number>();
    const retypeIds = new Set<string>();

    const sameBranch = (a: Node | null, b: Node | null): boolean =>
      !!a && !!b && (inBranch(a, b) || inBranch(b, a));

    for (const p of products) {
      const currentNode = p.type ? byNorm.get(normalize(p.type))?.[0] ?? null : null;
      // Prefer Haiku's explicit Category over the title line (which can carry
      // "top" inside "Low-Top Sneaker"); fall back to the identity line.
      const hctx = haikuCategory(p.haiku_context) || haikuIdentity(p.haiku_context);
      // The IMAGE (haiku identity) is authoritative; the NAME only refines
      // within the branch the image confirms. A confident image read that
      // matches no node suppresses any name-only match — that's the
      // "Twist-Top Lid → tops" false positive (the photo shows a jar).
      let imageBest: Node | null = null, nameBest: Node | null = null;
      for (const m of matchers) {
        if (hctx && m.rx.test(hctx) && (!imageBest || depth(m.node) > depth(imageBest))) imageBest = m.node;
        if (m.rx.test(p.name) && (!nameBest || depth(m.node) > depth(nameBest))) nameBest = m.node;
      }
      let best: Node | null = null;
      if (imageBest) {
        best = (sameBranch(imageBest, nameBest) && depth(nameBest!) > depth(imageBest)) ? nameBest : imageBest;
      } else if (!hctx) {
        best = nameBest; // pre-image set only; no image read to corroborate
      }
      // Already AT or DEEPER than the image's category match → leave it
      // (never downgrade); a shallower current node still deepens to it.
      const imgConfirmsCurrent = !!imageBest && !!currentNode && inBranch(currentNode, imageBest);
      if (best && !imgConfirmsCurrent && (!currentNode || (currentNode.id !== best.id && !inBranch(currentNode, best)))) {
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
      const nodeGender = effGender(currentNode);
      // A node's gender only constrains products when it's male/female;
      // 'unisex'/null is permissive so product-level gender (name/photo) wins.
      const forceGender = nodeGender === 'male' || nodeGender === 'female' ? nodeGender : null;
      if ((p.type_path ?? null) !== toPath) {
        drift.push({ product: p, node: currentNode });
      }
      if (forceGender !== null && (p.gender ?? null) !== forceGender) {
        genderChanges.push({ productId: p.id, name: p.name, brand: p.brand, fromGender: p.gender, toGender: forceGender, path: toPath });
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
      // Auto-apply type/path sync only. Gender changes are recorded in the
      // report for review in the Kaizen panel — never auto-written.
      const patch: Record<string, string | null> = { type: d.node.name, type_path: path(d.node) };
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
      genderChanges: trim(genderChanges),
      emptyTypes: trim(emptyTypes),
      duplicateTypes: trim(duplicateTypes),
      orphanTypes: trim([...orphans.values()]),
    };
    const findingCount = retypes.length + drift.length + genderChanges.length + emptyTypes.length
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

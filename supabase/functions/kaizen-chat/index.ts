// kaizen-chat — conversational Kaizen for a SINGLE item (product or look),
// driven from the super-admin context panel on the consumer detail pages.
//
// Unlike the `kaizen` cron sweep (which batch-analyses the whole catalog and
// records findings for review), this is an interactive assistant scoped to one
// item: it explains WHY the item sits where it does / shows on the feed, takes
// the admin's typed instructions, reasons against the live product_types
// taxonomy, and — only when it proposes a concrete change — returns a
// structured `changes` object the client applies after the admin confirms.
//
// Auth: a signed-in super_admin (validated against profiles.role). The consumer
// client calls it with the user's session JWT.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};
function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

interface Node { id: string; name: string; parent_id: string | null; gender: string | null }
type ChatMsg = { role: 'user' | 'assistant'; content: string };
type Gender = 'male' | 'female' | 'unisex';

const VALID_GENDER = new Set<Gender>(['male', 'female', 'unisex']);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return jsonRes({ error: 'unauthorized' }, 401);

  const supabase = createClient(supabaseUrl, serviceKey);

  // ── Auth: must be a signed-in super_admin ────────────────────────────────
  const { data: userData } = await supabase.auth.getUser(jwt);
  const user = userData?.user;
  if (!user) return jsonRes({ error: 'unauthorized' }, 401);
  const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if ((prof as { role?: string } | null)?.role !== 'super_admin') {
    return jsonRes({ error: 'forbidden' }, 403);
  }

  let body: { kind?: string; id?: string; message?: string; history?: ChatMsg[] };
  try { body = await req.json(); } catch { return jsonRes({ error: 'bad request' }, 400); }
  const kind = body.kind === 'look' ? 'look' : 'product';
  const id = String(body.id ?? '').trim();
  const message = String(body.message ?? '').trim();
  const history = Array.isArray(body.history) ? body.history.slice(-12) : [];
  if (!id || !message) return jsonRes({ error: 'id and message required' }, 400);
  if (!anthropicKey) return jsonRes({ error: 'ANTHROPIC_API_KEY not configured' }, 500);

  // ── Live taxonomy (compact full paths + effective gender) ────────────────
  const { data: treeRows } = await supabase
    .from('product_types').select('id, name, parent_id, gender');
  const tree = (treeRows ?? []) as Node[];
  const byId = new Map(tree.map(n => [n.id, n]));
  const pathOf = (n: Node): string => n.parent_id && byId.get(n.parent_id)
    ? `${pathOf(byId.get(n.parent_id)!)} / ${n.name}` : n.name;
  const effGender = (n: Node): string => n.gender
    ?? (n.parent_id && byId.get(n.parent_id) ? effGender(byId.get(n.parent_id)!) : 'unisex');
  const taxonomy = tree
    .map(n => `${pathOf(n)} [${effGender(n)}]`)
    .sort()
    .slice(0, 600)
    .join('\n');

  // ── Item context ─────────────────────────────────────────────────────────
  let itemBlock = '';
  if (kind === 'product') {
    const { data } = await supabase
      .from('products')
      .select('id, name, brand, type, subtype, gender, type_path, haiku_context')
      .eq('id', id).single();
    if (!data) return jsonRes({ error: 'product not found' }, 404);
    const p = data as Record<string, unknown>;
    itemBlock = [
      `THIS PRODUCT:`,
      `• name: ${p.name ?? ''}`,
      `• brand: ${p.brand ?? ''}`,
      `• gender: ${p.gender ?? '(unset)'}`,
      `• type: ${p.type ?? '(unset)'}`,
      `• subtype: ${p.subtype ?? '(unset)'}`,
      `• type_path: ${p.type_path ?? '(unset)'}`,
      `• haiku_context (what the image shows): ${p.haiku_context ?? '(none)'}`,
    ].join('\n');
  } else {
    const { data } = await supabase
      .from('looks').select('id, title, creator_handle, gender').eq('id', id).single();
    if (!data) return jsonRes({ error: 'look not found' }, 404);
    const l = data as Record<string, unknown>;
    const { data: lp } = await supabase
      .from('look_products').select('product_id, sort_order').eq('look_id', id).order('sort_order').limit(12);
    const pids = ((lp ?? []) as { product_id: string }[]).map(r => r.product_id);
    let prods: Record<string, unknown>[] = [];
    if (pids.length) {
      const { data: pr } = await supabase
        .from('products').select('name, brand, type, gender').in('id', pids);
      prods = (pr ?? []) as Record<string, unknown>[];
    }
    itemBlock = [
      `THIS LOOK:`,
      `• title: ${l.title ?? '(untitled)'}`,
      `• creator: ${l.creator_handle ?? ''}`,
      `• gender: ${l.gender ?? '(unset)'}`,
      `• products in the look:`,
      ...prods.map(p => `   - ${p.name ?? ''} (${p.brand ?? ''}) — type ${p.type ?? '?'}, gender ${p.gender ?? '?'}`),
    ].join('\n');
  }

  const changeSchema = kind === 'product'
    ? `{"gender"?: "male"|"female"|"unisex", "type"?: "<a type NAME from the taxonomy>", "subtype"?: "<child type name>"}`
    : `{"gender": "male"|"female"|"unisex"}`;

  const system = `You are Kaizen, a sharp, candid taxonomy assistant for the "catalog" shopping app, talking to a SUPER-ADMIN about ONE item.

HOW THE FEED WORKS (so you can explain "why is this showing here"):
- The consumer feed and catalogs filter by GENDER (male / female / unisex) and by TYPE. Each item has a type that maps to a node in a tree taxonomy (product_types); the node also carries an effective gender (inherited from its parent unless overridden).
- A product shows for a shopper when its gender matches the shopper's gender filter (unisex shows to everyone) and its type/type_path falls under the browsed category. Looks carry their own gender too.
- So an item appears "in the wrong place" usually because its gender is wrong, or its type points at the wrong node (or a node whose effective gender is wrong).

YOUR JOB:
1. Answer the admin's questions plainly — explain WHY this item currently sits/show where it does, citing its gender + type + type_path + (for products) what the image actually shows (haiku_context) vs. the taxonomy.
2. When the admin asks for a change, FIRST reason out loud about the best fix (correct gender? better type node?), THEN propose it.
3. ONLY when you are proposing a CONCRETE change the admin can apply right now, append — as the very last thing in your reply — a fenced block exactly like:
\`\`\`changes
${changeSchema}
\`\`\`
Include only the fields that should change. Use a "type" value that is a real node NAME from the taxonomy below. If you're only explaining or asking a clarifying question, DO NOT include a changes block. Never invent a type that isn't in the taxonomy.

${itemBlock}

AVAILABLE TYPES (path [effective gender]):
${taxonomy}

Keep replies tight and conversational — a few sentences. You are reasoning WITH the admin, not writing docs.`;

  const messages = [
    ...history.filter(m => (m.role === 'user' || m.role === 'assistant') && m.content)
      .map(m => ({ role: m.role, content: String(m.content).slice(0, 4000) })),
    { role: 'user' as const, content: message.slice(0, 4000) },
  ];

  let text = '';
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system,
        messages,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      return jsonRes({ error: `anthropic ${res.status}: ${t.slice(0, 200)}` }, 502);
    }
    const json = await res.json() as { content?: Array<{ type: string; text?: string }> };
    text = json.content?.find(c => c.type === 'text')?.text?.trim() ?? '';
  } catch (err) {
    return jsonRes({ error: `anthropic call failed: ${err instanceof Error ? err.message : 'error'}` }, 502);
  }
  if (!text) return jsonRes({ error: 'empty response' }, 502);

  // ── Extract an optional proposed-changes block ───────────────────────────
  let changes: Record<string, string> | null = null;
  const m = text.match(/```changes\s*([\s\S]*?)```/i);
  if (m) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const out: Record<string, string> = {};
      if (typeof parsed.gender === 'string' && VALID_GENDER.has(parsed.gender as Gender)) out.gender = parsed.gender;
      if (kind === 'product') {
        if (typeof parsed.type === 'string' && parsed.type.trim()) out.type = parsed.type.trim();
        if (typeof parsed.subtype === 'string' && parsed.subtype.trim()) out.subtype = parsed.subtype.trim();
      }
      if (Object.keys(out).length) changes = out;
    } catch { /* ignore malformed block */ }
    // Strip the machine block from the human-facing reply.
    text = text.replace(/```changes[\s\S]*?```/i, '').trim();
  }

  return jsonRes({ reply: text, changes });
});

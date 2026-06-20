// haiku-context — Claude Haiku looks at a product's primary image and, in ONE
// call, (1) writes a description stored on products.haiku_context AND (2) PLACES
// the product in the live taxonomy (products.type + type_path). Semantic
// placement beats keyword-matching a name ("Men's Low-Top Sneaker" is a shoe,
// not a top; a "ZZ Plant" is home/plants, not decor) and self-completes the
// tree: when nothing fits, Claude proposes a NEW child node and we create it.
//
// Invoked by the products_haiku_context trigger when a primary image is picked
// (body {productId}), by the bulk "Generate Haiku" admin action (regen_haiku_
// context RPC), or with {backfill: N}.
//
// Auth mirrors kaizen (service key by value or capability probe).
// Secrets: ANTHROPIC_API_KEY.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MODEL = 'claude-haiku-4-5-20251001';
const IMAGE_FETCH_TIMEOUT_MS = 10_000;

// Editable in admin → Data → Settings ("Haiku Context"), stored in
// app_settings under this key. The metadata block (title/brand/price/
// materials) is prepended automatically and the TAXONOMY/PLACEMENT block is
// appended automatically; this is the instruction in between. Keep in sync
// with DEFAULT_HAIKU_CONTEXT_PROMPT in app/constants/ai-prompts.ts.
const HAIKU_PROMPT_KEY = 'prompt_haiku_context';
const DEFAULT_HAIKU_INSTRUCTION = [
  'Identify what this item ACTUALLY is. Use the PHOTO as your main reference: titles and metadata often mislead, so trust the image first and treat the title, brand, price and materials as supporting hints only.',
  '',
  'Reply in EXACTLY two lines, nothing else. Plain text only, no markdown, no headings, no labels, no blank line, no bullets:',
  'Line 1: the category in 1-4 plain words, the most common everyday noun for it (for example: potted plant, high heels, denim jacket, table lamp). Name only the object itself, never the room or setting.',
  'Line 2: one dense sentence that STARTS with the main colour(s), then materials and any notable detail.',
  '',
  'No marketing language.',
].join('\n');

// deno-lint-ignore no-explicit-any
async function loadInstruction(supabase: any): Promise<string> {
  try {
    const { data } = await supabase
      .from('app_settings').select('value').eq('key', HAIKU_PROMPT_KEY).maybeSingle();
    const v = typeof data?.value === 'string' ? data.value.trim() : '';
    return v || DEFAULT_HAIKU_INSTRUCTION;
  } catch {
    return DEFAULT_HAIKU_INSTRUCTION;
  }
}

interface Taxo {
  paths: string[];
  byLowerPath: Map<string, { id: string; name: string; path: string }>;
}

// Snapshot the product-type tree as full path strings ("home / decor / art")
// so Claude can pick the best-fitting one verbatim.
// deno-lint-ignore no-explicit-any
async function loadTaxonomy(supabase: any): Promise<Taxo> {
  const { data } = await supabase.from('product_types').select('id, name, parent_id');
  const rows = (data ?? []) as Array<{ id: string; name: string; parent_id: string | null }>;
  const byId = new Map(rows.map(r => [r.id, r]));
  const pathOf = (r: { id: string; name: string; parent_id: string | null }): string => {
    const parts: string[] = [];
    const seen = new Set<string>();
    let cur: { id: string; name: string; parent_id: string | null } | undefined = r;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      parts.unshift(cur.name);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    return parts.join(' / ');
  };
  const byLowerPath = new Map<string, { id: string; name: string; path: string }>();
  const paths: string[] = [];
  for (const r of rows) {
    const path = pathOf(r);
    paths.push(path);
    byLowerPath.set(path.toLowerCase(), { id: r.id, name: r.name, path });
  }
  paths.sort();
  return { paths, byLowerPath };
}

// Apply Claude's PLACEMENT line: assign an existing node, or create + assign a
// NEW child under an existing parent. Silently no-ops on a hallucinated path so
// a bad line never corrupts a product's type.
// deno-lint-ignore no-explicit-any
async function placeProduct(supabase: any, productId: string, placementRaw: string, taxo: Taxo): Promise<void> {
  const placement = placementRaw.trim();
  if (!placement) return;

  if (placement.toLowerCase().startsWith('new:')) {
    const rest = placement.slice(4); // drop "new:"
    const gt = rest.indexOf('>');
    if (gt < 0) return;
    const parent = taxo.byLowerPath.get(rest.slice(0, gt).trim().toLowerCase());
    const rawName = rest.slice(gt + 1).replace(/[*_#>]/g, '').trim();
    if (!parent || !rawName || rawName.length > 40) return;
    let childId: string | null = null;
    const { data: existing } = await supabase.from('product_types')
      .select('id').eq('parent_id', parent.id).ilike('name', rawName).maybeSingle();
    if (existing?.id) childId = existing.id;
    else {
      const { data: ins } = await supabase.from('product_types')
        .insert({ name: rawName, parent_id: parent.id, sort: 999 }).select('id').maybeSingle();
      childId = ins?.id ?? null;
      if (!childId) {
        const { data: again } = await supabase.from('product_types')
          .select('id').eq('parent_id', parent.id).ilike('name', rawName).maybeSingle();
        childId = again?.id ?? null;
      }
    }
    if (!childId) return;
    await supabase.from('products')
      .update({ type: rawName, type_path: `${parent.path} / ${rawName}` })
      .eq('id', productId);
    return;
  }

  const node = taxo.byLowerPath.get(placement.toLowerCase());
  if (!node) return;
  await supabase.from('products')
    .update({ type: node.name, type_path: node.path })
    .eq('id', productId);
}

function b64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

async function fetchImage(url: string): Promise<{ media_type: string; data: string } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), IMAGE_FETCH_TIMEOUT_MS);
  try {
    const small = url.includes('/storage/v1/object/public/')
      ? url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') + (url.includes('?') ? '&' : '?') + 'width=512&quality=75&resize=contain'
      : url;
    const res = await fetch(small, { signal: ctrl.signal });
    if (!res.ok) return null;
    const mime = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0];
    if (!mime.startsWith('image/')) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > 4_500_000) return null;
    return { media_type: mime, data: b64(bytes) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// deno-lint-ignore no-explicit-any
async function describeOne(supabase: any, apiKey: string, productId: string, instruction: string, taxo: Taxo): Promise<boolean> {
  const { data: p } = await supabase
    .from('products').select('id, name, brand, price, materials_care, primary_image_url, image_url')
    .eq('id', productId).maybeSingle();
  if (!p) return false;
  const imgUrl = p.primary_image_url || p.image_url;
  if (!imgUrl) return false;
  const image = await fetchImage(imgUrl);
  if (!image) return false;

  const meta = [
    `Product title: "${p.name}"`,
    p.brand ? `Brand: ${p.brand}` : '',
    p.price ? `Price: ${p.price}` : '',
    p.materials_care ? `Materials / care: ${p.materials_care}` : '',
  ].filter(Boolean).join('\n');

  // Append the taxonomy + placement instruction so the SAME call also slots the
  // product into the tree. Always appended in code (not the editable prompt).
  const taxoBlock = taxo.paths.length
    ? `\n\nTAXONOMY PATHS (the catalog's existing categories):\n${taxo.paths.join('\n')}\n\n` +
      `After everything above, output ONE FINAL line, exactly:\n` +
      `PLACEMENT: <one path copied VERBATIM from the TAXONOMY PATHS list that best fits this product>\n` +
      `Choose the MOST SPECIFIC correct path (a deeper path beats its parent). Judge by what the item ACTUALLY is, not stray words in its title. ` +
      `If, and only if, nothing in the list fits, output instead:\n` +
      `PLACEMENT: NEW: <an existing path copied from the list> > <short lowercase singular category>\n` +
      `Never output a path that is neither copied from the list nor a NEW child of a listed path.`
    : '';
  const promptText = `${meta}\n\n${instruction}${taxoBlock}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 700,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: image.media_type, data: image.data } },
          { type: 'text', text: promptText },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const out = await res.json() as { content?: Array<{ type: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
  const rawText = (out.content?.find(c => c.type === 'text')?.text ?? '').trim();
  if (!rawText) return false;

  // Split out the PLACEMENT line; everything else is the stored context.
  let placement = '';
  const keep: string[] = [];
  for (const l of rawText.split('\n')) {
    const t = l.trim();
    if (!placement && t.toLowerCase().startsWith('placement:')) {
      placement = t.slice(t.indexOf(':') + 1).trim();
    } else {
      keep.push(l);
    }
  }
  const text = keep.join('\n').trim();

  await supabase.from('products')
    .update({ haiku_context: text, haiku_context_at: new Date().toISOString() })
    .eq('id', productId);

  if (placement) {
    try { await placeProduct(supabase, productId, placement, taxo); }
    catch (e) { console.warn('[haiku-context] placement failed', e); }
  }

  void supabase.from('ai_usage_logs').insert({
    platform: 'anthropic', operation: 'haiku-context', model: MODEL,
    input_tokens: out.usage?.input_tokens ?? null, output_tokens: out.usage?.output_tokens ?? null, status: 'success',
  });
  return true;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  let isService = !!serviceKey && bearer === serviceKey;
  if (!isService && bearer) {
    const probe = await fetch(`${supabaseUrl}/auth/v1/admin/users?per_page=1`, {
      headers: { apikey: bearer, Authorization: `Bearer ${bearer}` },
    });
    isService = probe.ok;
  }
  if (!isService) return new Response(JSON.stringify({ success: false, error: 'service only' }), { status: 403 });
  if (!apiKey) return new Response(JSON.stringify({ success: false, error: 'ANTHROPIC_API_KEY not set' }), { status: 500 });
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json().catch(() => ({}));
    const productId = typeof body.productId === 'string' ? body.productId : null;
    const backfill = Number(body.backfill) || 0;

    // Load the editable instruction + the taxonomy snapshot once per invocation.
    const [instruction, taxo] = await Promise.all([loadInstruction(supabase), loadTaxonomy(supabase)]);

    if (productId) {
      const ok = await describeOne(supabase, apiKey, productId, instruction, taxo);
      return new Response(JSON.stringify({ success: ok }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (backfill > 0) {
      const { data: rows } = await supabase
        .from('products').select('id')
        .is('haiku_context', null)
        .not('primary_image_url', 'is', null)
        .eq('is_active', true)
        .limit(Math.min(backfill, 25));
      let done = 0;
      for (const r of (rows ?? []) as Array<{ id: string }>) {
        try { if (await describeOne(supabase, apiKey, r.id, instruction, taxo)) done++; }
        catch { /* skip and continue the batch */ }
      }
      return new Response(JSON.stringify({ success: true, done, remaining_query: 'haiku_context is null' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: false, error: 'pass productId or backfill' }), { status: 400 });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }), { status: 500 });
  }
});

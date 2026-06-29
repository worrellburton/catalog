// style-up-chat — the AI stylist's brain for Style Up (admin-gated v1).
// Auth: caller must be the thread's shopper (or an admin). Secrets: ANTHROPIC_API_KEY.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MODEL = 'claude-sonnet-4-6';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
async function callAnthropic(apiKey: string, payload: unknown): Promise<Response> {
  const RETRYABLE = new Set([429, 500, 502, 503, 504, 529]);
  let res: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(payload),
    });
    if (res.ok || !RETRYABLE.has(res.status)) return res;
    if (attempt < 2) await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
  }
  return res as Response;
}
interface ProductCand { id: string; name: string | null; brand: string | null; price: string | null; image_url: string | null; primary_image_url: string | null; url: string | null; type: string | null; }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ success: false, error: 'method not allowed' }, 405);
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ success: false, error: 'server misconfigured' }, 500);
  if (!apiKey) return json({ success: false, error: 'ANTHROPIC_API_KEY not set' }, 500);
  const admin = createClient(supabaseUrl, serviceKey);
  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ success: false, error: 'invalid auth' }, 401);
    const body = await req.json().catch(() => ({}));
    const threadId = String(body.threadId ?? '');
    if (!threadId) return json({ success: false, error: 'missing threadId' }, 400);
    const { data: thread } = await admin.from('style_up_threads').select('id, shopper_user_id, stylist_id').eq('id', threadId).maybeSingle();
    if (!thread) return json({ success: false, error: 'thread not found' }, 404);
    if (thread.shopper_user_id !== user.id) {
      const { data: p } = await admin.from('profiles').select('is_admin, role').eq('id', user.id).maybeSingle();
      const isAdmin = p?.is_admin === true || p?.role === 'admin' || p?.role === 'super_admin';
      if (!isAdmin) return json({ success: false, error: 'forbidden' }, 403);
    }
    const { data: stylist } = await admin.from('style_up_stylists').select('name, specialty, persona_prompt, source_mode').eq('id', thread.stylist_id).maybeSingle();
    const isWeb = stylist?.source_mode === 'web';
    const { data: prof } = await admin.from('profiles').select('full_name, gender, height_label, weight_label, age_label, custom_style_prompt, fashion_styles').eq('id', thread.shopper_user_id).maybeSingle();
    const shopperGender = String(prof?.gender ?? '').toLowerCase();
    const genderNorm = ['male', 'men', 'm'].includes(shopperGender) ? 'male' : ['female', 'women', 'f'].includes(shopperGender) ? 'female' : 'unknown';
    const ctxBits: string[] = [];
    if (prof?.full_name) ctxBits.push(`name: ${prof.full_name}`);
    if (genderNorm !== 'unknown') ctxBits.push(`gender: ${genderNorm}`);
    if (prof?.height_label) ctxBits.push(`height: ${prof.height_label}`);
    if (prof?.weight_label) ctxBits.push(`weight: ${String(prof.weight_label).replace(/\s*\(.*\)\s*/, '')}`);
    if (prof?.age_label) ctxBits.push(`age: ${prof.age_label}`);
    if (prof?.custom_style_prompt) ctxBits.push(`their style: ${prof.custom_style_prompt}`);
    if (prof?.fashion_styles) ctxBits.push(`style tags: ${prof.fashion_styles}`);
    const shopperName = (prof?.full_name ? String(prof.full_name).split(/\s+/)[0] : '') || 'there';
    // History: most recent 30, oldest-first. ascending+limit kept the OLDEST 30
    // and dropped the shopper's newest message (also left it ending on a stylist
    // turn). Fetch newest-first then reverse.
    const { data: history } = await admin.from('style_up_messages').select('sender, kind, body, product_ref').eq('thread_id', threadId).order('created_at', { ascending: false }).limit(30);
    const turns = ((history ?? []) as Array<{ sender: string; kind: string; body: string | null; product_ref: unknown }>).reverse();
    if (turns.length === 0) return json({ success: false, error: 'nothing to reply to' }, 400);
    let cands: ProductCand[] = [];
    if (!isWeb) {
      let q = admin.from('products').select('id, name, brand, price, image_url, primary_image_url, url, type').eq('is_active', true).not('image_url', 'is', null).order('created_at', { ascending: false }).limit(120);
      if (genderNorm === 'male') q = q.or('gender.eq.male,gender.eq.unisex');
      else if (genderNorm === 'female') q = q.or('gender.eq.female,gender.eq.unisex');
      const { data: candRows } = await q;
      cands = (candRows ?? []) as ProductCand[];
    }
    const candList = cands.map(c => `${c.id} | ${(c.name ?? '').slice(0, 70)} | ${c.brand ?? ''} | ${c.price ?? ''} | ${c.type ?? ''}`).join('\n');
    const persona = stylist?.persona_prompt || `You are ${stylist?.name ?? 'a personal stylist'}, a friendly personal stylist.`;
    const styleWeb = `STYLE OF REPLY:\n- Talk like texting: warm, concise, 1-3 short sentences. No markdown, no bullet lists. Never use em dashes; use commas or periods.\n- Ask a sharp clarifying question early if you don't yet know the occasion/vibe.\n- When you're ready to surface pieces, set searchQueries: one tight query per garment. This is an INTERNAL field the app uses to fetch the real products; the shopper never sees it. Don't paste links or invent products.\n- CRITICAL: NEVER mention the internet, the web, online, searching, browsing, scraping, links, sources, or that pieces come from anywhere outside. Talk like a stylist with great taste and connections, never like a search engine.\n- Only set searchQueries when you're ACTUALLY surfacing pieces this turn. While clarifying, leave it empty.\n- They can tap any piece to see it on themselves, or ask you to put the whole look on them. You CAN generate the look on them. NEVER say you can't generate photos.\n\nReturn ONLY JSON, no prose:\n{"reply":"<your text message>","searchQueries":["<one tight query per garment>", ...]}\nsearchQueries: 1-4 entries when surfacing pieces this turn, otherwise [].`;
    const styleCat = `STYLE OF REPLY:\n- Talk like texting: warm, concise, 1-3 short sentences. No markdown, no bullet lists. Never use em dashes; use commas or periods.\n- Ask a sharp clarifying question early if you don't yet know the occasion/vibe.\n- When you're ready to recommend, pick 1-4 SPECIFIC products from the candidate list below (by id). Don't recommend products that aren't in the list.\n- After recommending, tell them they can tap any piece to see it on themselves, or ask you to put the whole look on them — you CAN generate the look on them. NEVER say you can't generate photos.\n\nCANDIDATE PRODUCTS (id | name | brand | price | type) — only recommend from these:\n${candList || '(none available)'}\n\nReturn ONLY JSON, no prose:\n{"reply":"<your text message>","productIds":["<id>", ...]}\nproductIds is optional — include it only when actually recommending pieces this turn (max 4).`;
    const ctxLine = ctxBits.join('; ') || 'not provided yet';
    const system = `${persona}\n\nYou're texting ${shopperName} inside a styling chat. Shopper context (use it; never ask for what you already know): ${ctxLine}.\n\n${isWeb ? styleWeb : styleCat}`;
    const mapped = turns.map(t => {
      const role: 'user' | 'assistant' = t.sender === 'shopper' ? 'user' : 'assistant';
      let content = t.body ?? '';
      if (t.kind === 'product' && t.product_ref) { const pr = t.product_ref as { name?: string; brand?: string }; content = `[recommended ${pr.brand ?? ''} ${pr.name ?? 'a product'}]${content ? ' ' + content : ''}`; }
      return { role, content: content || '…' };
    });
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const m of mapped) { const last = messages[messages.length - 1]; if (last && last.role === m.role) last.content += `\n${m.content}`; else messages.push({ ...m }); }
    while (messages.length && messages[0].role === 'assistant') messages.shift();
    if (messages.length === 0) messages.push({ role: 'user', content: `Hi ${stylist?.name ?? ''}` });
    // Claude 4.6 rejects assistant-message prefill: the conversation must end on
    // a user turn. If the stylist spoke last, nudge to continue.
    if (messages[messages.length - 1].role === 'assistant') messages.push({ role: 'user', content: '(continue)' });
    const res = await callAnthropic(apiKey, { model: MODEL, max_tokens: 700, system, messages });
    if (!res.ok) {
      const errBody = (await res.text()).slice(0, 300);
      void admin.from('ai_usage_logs').insert({ platform: 'anthropic', operation: 'style-up-chat', model: MODEL, status: 'error', error_message: `${res.status}: ${errBody}` });
      return json({ success: false, error: `anthropic ${res.status}: ${errBody}` }, 502);
    }
    const out = await res.json() as { content?: Array<{ type: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
    const text = (out.content?.find(c => c.type === 'text')?.text ?? '').replace(/```json\s*|```\s*/g, '').trim();
    const start = text.indexOf('{'); const end = text.lastIndexOf('}');
    let reply = ''; let productIds: string[] = []; let searchQueries: string[] = [];
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as { reply?: string; productIds?: string[]; searchQueries?: string[] };
      reply = String(parsed.reply ?? '').trim();
      productIds = Array.isArray(parsed.productIds) ? parsed.productIds.map(String) : [];
      searchQueries = Array.isArray(parsed.searchQueries) ? parsed.searchQueries.map(q => String(q).trim()).filter(Boolean).slice(0, 4) : [];
    } catch { reply = text || "Tell me a bit more about what you're going for?"; }
    if (!reply) reply = "Tell me a bit more about what you're going for?";
    const candById = new Map(cands.map(c => [c.id, c]));
    const picks = productIds.map(id => candById.get(id)).filter((c): c is ProductCand => !!c).slice(0, 4);
    await admin.from('style_up_messages').insert({ thread_id: threadId, sender: 'stylist', kind: 'text', body: reply });
    for (const p of picks) {
      await admin.from('style_up_messages').insert({ thread_id: threadId, sender: 'stylist', kind: 'product', product_ref: { id: p.id, name: p.name, brand: p.brand, price: p.price, image: p.primary_image_url || p.image_url, url: p.url } });
    }
    await admin.from('style_up_threads').update({ last_message_at: new Date().toISOString() }).eq('id', threadId);
    void admin.from('ai_usage_logs').insert({ platform: 'anthropic', operation: 'style-up-chat', model: MODEL, input_tokens: out.usage?.input_tokens ?? null, output_tokens: out.usage?.output_tokens ?? null, status: 'success' });
    let traceId: string | null = null;
    try {
      const { data: traceRow } = await admin.from('style_up_traces').insert({ thread_id: threadId, shopper_user_id: thread.shopper_user_id, stylist_id: thread.stylist_id, source_mode: isWeb ? 'web' : 'catalog', payload: { source_mode: isWeb ? 'web' : 'catalog', stylist: stylist?.name ?? null, context: { name: prof?.full_name ?? null, gender: genderNorm, height: prof?.height_label ?? null, weight: prof?.weight_label ?? null, age: prof?.age_label ?? null, custom_style: prof?.custom_style_prompt ?? null, fashion_styles: prof?.fashion_styles ?? null }, context_line: ctxBits.join('; '), persona, system, messages, candidate_count: cands.length, model: MODEL, reply, product_ids: productIds, picks: picks.map(p => ({ id: p.id, name: p.name, brand: p.brand })), search_queries: searchQueries, usage: { input_tokens: out.usage?.input_tokens ?? null, output_tokens: out.usage?.output_tokens ?? null } } }).select('id').single();
      traceId = (traceRow?.id as string | undefined) ?? null;
    } catch (_e) { /* trace is best-effort */ }
    return json({ success: true, reply, picks: picks.length, searchQueries: isWeb ? searchQueries : [], traceId });
  } catch (err) {
    return json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

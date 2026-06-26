// style-up-chat — the AI stylist's brain for Style Up (admin-gated v1).
//
// Given a thread, it loads the stylist persona, the shopper's context (the
// same AI-look inputs: height / weight / age / gender + saved style), the
// recent chat, and an optional candidate set of catalog products, then asks
// Claude to reply in character. The reply may ALSO recommend specific products
// (chosen from the candidates) — those land as `product` messages the shopper
// can view, buy, or render on themselves. The stylist's text + each pick are
// inserted as style_up_messages (service role) and stream to the client via
// realtime.
//
// Auth: caller must be the thread's shopper (or an admin).
// Secrets: ANTHROPIC_API_KEY.

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

interface ProductCand {
  id: string; name: string | null; brand: string | null; price: string | null;
  image_url: string | null; primary_image_url: string | null; url: string | null; type: string | null;
}

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

    // Thread + ownership (shopper or admin).
    const { data: thread } = await admin
      .from('style_up_threads')
      .select('id, shopper_user_id, stylist_id')
      .eq('id', threadId)
      .maybeSingle();
    if (!thread) return json({ success: false, error: 'thread not found' }, 404);
    if (thread.shopper_user_id !== user.id) {
      const { data: prof } = await admin.from('profiles').select('is_admin, role').eq('id', user.id).maybeSingle();
      const isAdmin = prof?.is_admin === true || prof?.role === 'admin' || prof?.role === 'super_admin';
      if (!isAdmin) return json({ success: false, error: 'forbidden' }, 403);
    }

    // Stylist persona.
    const { data: stylist } = await admin
      .from('style_up_stylists')
      .select('name, specialty, persona_prompt')
      .eq('id', thread.stylist_id)
      .maybeSingle();

    // Shopper context — the same inputs the AI-look flow uses.
    const { data: prof } = await admin
      .from('profiles')
      .select('full_name, gender, height_label, weight_label, age_label, custom_style_prompt, fashion_styles')
      .eq('id', thread.shopper_user_id)
      .maybeSingle();
    const shopperGender = String(prof?.gender ?? '').toLowerCase();
    const genderNorm = ['male', 'men', 'm'].includes(shopperGender) ? 'male'
      : ['female', 'women', 'f'].includes(shopperGender) ? 'female' : 'unknown';
    const ctxBits: string[] = [];
    if (prof?.full_name) ctxBits.push(`name: ${prof.full_name}`);
    if (genderNorm !== 'unknown') ctxBits.push(`gender: ${genderNorm}`);
    if (prof?.height_label) ctxBits.push(`height: ${prof.height_label}`);
    if (prof?.weight_label) ctxBits.push(`weight: ${String(prof.weight_label).replace(/\s*\(.*\)\s*/, '')}`);
    if (prof?.age_label) ctxBits.push(`age: ${prof.age_label}`);
    if (prof?.custom_style_prompt) ctxBits.push(`their style: ${prof.custom_style_prompt}`);
    if (prof?.fashion_styles) ctxBits.push(`style tags: ${prof.fashion_styles}`);
    const shopperName = (prof?.full_name ? String(prof.full_name).split(/\s+/)[0] : '') || 'there';

    // Chat history (oldest first, capped).
    const { data: history } = await admin
      .from('style_up_messages')
      .select('sender, kind, body, product_ref')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true })
      .limit(30);
    const turns = (history ?? []) as Array<{ sender: string; kind: string; body: string | null; product_ref: unknown }>;
    if (turns.length === 0) return json({ success: false, error: 'nothing to reply to' }, 400);

    // Candidate products to recommend FROM — gender-filtered active catalog.
    // The model may only pick ids that appear here (we validate below).
    let q = admin.from('products')
      .select('id, name, brand, price, image_url, primary_image_url, url, type')
      .eq('is_active', true)
      .not('image_url', 'is', null)
      .order('created_at', { ascending: false })
      .limit(120);
    if (genderNorm === 'male') q = q.or('gender.eq.male,gender.eq.unisex');
    else if (genderNorm === 'female') q = q.or('gender.eq.female,gender.eq.unisex');
    const { data: candRows } = await q;
    const cands = (candRows ?? []) as ProductCand[];
    const candList = cands.map(c =>
      `${c.id} | ${(c.name ?? '').slice(0, 70)} | ${c.brand ?? ''} | ${c.price ?? ''} | ${c.type ?? ''}`,
    ).join('\n');

    const persona = stylist?.persona_prompt
      || `You are ${stylist?.name ?? 'a personal stylist'}, a friendly personal stylist.`;
    const system = `${persona}

You're texting ${shopperName} inside a styling chat. Shopper context (use it; never ask for what you already know): ${ctxBits.join('; ') || 'not provided yet'}.

STYLE OF REPLY:
- Talk like texting: warm, concise, 1-3 short sentences. No markdown, no bullet lists.
- Ask a sharp clarifying question early if you don't yet know the occasion/vibe.
- When you're ready to recommend, pick 1-4 SPECIFIC products from the candidate list below (by id). Recommend things that actually fit their context and the conversation. Don't recommend products that aren't in the list.
- After recommending, invite them to tap a piece to see it on themselves.

CANDIDATE PRODUCTS (id | name | brand | price | type) — only recommend from these:
${candList || '(none available)'}

Return ONLY JSON, no prose:
{"reply":"<your text message>","productIds":["<id>", ...]}
productIds is optional — include it only when you're actually recommending pieces this turn (max 4).`;

    const messages = turns
      .map(t => {
        const role = t.sender === 'shopper' ? 'user' : 'assistant';
        let content = t.body ?? '';
        if (t.kind === 'product' && t.product_ref) {
          const pr = t.product_ref as { name?: string; brand?: string };
          content = `[recommended ${pr.brand ?? ''} ${pr.name ?? 'a product'}]${content ? ' ' + content : ''}`;
        }
        return { role, content: content || '…' };
      })
      // Claude requires the first message to be a user turn.
      .filter((m, i, arr) => !(i === 0 && m.role === 'assistant') || arr.length === 0);
    if (messages.length === 0 || messages[0].role !== 'user') {
      messages.unshift({ role: 'user', content: `Hi ${stylist?.name ?? ''}` });
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 700, system, messages }),
    });
    if (!res.ok) return json({ success: false, error: `anthropic ${res.status}: ${(await res.text()).slice(0, 200)}` }, 502);
    const out = await res.json() as { content?: Array<{ type: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
    const text = (out.content?.find(c => c.type === 'text')?.text ?? '').replace(/```json\s*|```\s*/g, '').trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    let reply = '';
    let productIds: string[] = [];
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as { reply?: string; productIds?: string[] };
      reply = String(parsed.reply ?? '').trim();
      productIds = Array.isArray(parsed.productIds) ? parsed.productIds.map(String) : [];
    } catch {
      reply = text || "Tell me a bit more about what you're going for?";
    }
    if (!reply) reply = "Tell me a bit more about what you're going for?";

    // Validate picks against the candidate set (no hallucinated ids).
    const candById = new Map(cands.map(c => [c.id, c]));
    const picks = productIds.map(id => candById.get(id)).filter((c): c is ProductCand => !!c).slice(0, 4);

    // Insert the stylist's text reply, then a product message per pick.
    const inserted: unknown[] = [];
    const { data: textMsg } = await admin.from('style_up_messages')
      .insert({ thread_id: threadId, sender: 'stylist', kind: 'text', body: reply })
      .select('id').single();
    if (textMsg) inserted.push(textMsg.id);

    for (const p of picks) {
      await admin.from('style_up_messages').insert({
        thread_id: threadId, sender: 'stylist', kind: 'product',
        product_ref: {
          id: p.id, name: p.name, brand: p.brand, price: p.price,
          image: p.primary_image_url || p.image_url, url: p.url,
        },
      });
    }

    await admin.from('style_up_threads').update({ last_message_at: new Date().toISOString() }).eq('id', threadId);
    void admin.from('ai_usage_logs').insert({
      platform: 'anthropic', operation: 'style-up-chat', model: MODEL,
      input_tokens: out.usage?.input_tokens ?? null, output_tokens: out.usage?.output_tokens ?? null, status: 'success',
    });

    return json({ success: true, reply, picks: picks.length });
  } catch (err) {
    return json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

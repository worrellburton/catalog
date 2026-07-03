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
import { retrieveOccasionCandidates } from '../_shared/style-retrieval.ts';

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

// Call the Anthropic Messages API, retrying transient failures (rate-limit /
// overload / 5xx) with a short backoff before giving up — so a momentary blip
// doesn't surface as a dead chat to the shopper.
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
      .select('name, specialty, persona_prompt, source_mode')
      .eq('id', thread.stylist_id)
      .maybeSingle();
    // Web stylists (e.g. Theo) source from the open web — the client searches +
    // auto-imports their picks, so the brain never recommends from our catalog.
    const isWeb = stylist?.source_mode === 'web';

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

    // History: most recent 30, oldest-first. ascending+limit kept the OLDEST 30
    // and dropped the shopper's newest message (also left it ending on a stylist
    // turn). Fetch newest-first then reverse.
    const { data: history } = await admin
      .from('style_up_messages')
      .select('sender, kind, body, product_ref')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: false })
      .limit(30);
    const turns = ((history ?? []) as Array<{ sender: string; kind: string; body: string | null; product_ref: unknown }>).reverse();
    if (turns.length === 0) return json({ success: false, error: 'nothing to reply to' }, 400);

    // Retrieval method is an admin dial (app_settings.stylist_engine_method):
    //   'style_engine' (default) → occasion-aware style_slot_search
    //   'legacy'                 → the pre-engine 120-newest recency scan
    const { data: methodRow } = await admin
      .from('app_settings').select('value').eq('key', 'stylist_engine_method').maybeSingle();
    const method = (methodRow?.value === 'legacy') ? 'legacy' : 'style_engine';
    const mode = String(body.mode ?? '');

    // Candidate products to recommend FROM. Web stylists skip this (live web search).
    let cands: ProductCand[] = [];
    if (!isWeb && method === 'legacy') {
      // LEGACY: the 120 most-recently-added active products, gender-filtered.
      let q = admin.from('products')
        .select('id, name, brand, price, image_url, primary_image_url, url, type')
        .eq('is_active', true)
        .not('image_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(120);
      if (genderNorm === 'male') q = q.or('gender.eq.male,gender.eq.unisex');
      else if (genderNorm === 'female') q = q.or('gender.eq.female,gender.eq.unisex');
      const { data: candRows } = await q;
      cands = (candRows ?? []) as ProductCand[];
      console.log(`[style-up-chat] thread=${threadId} retrieval=LEGACY(recency-120) candidates=${cands.length}`);
    } else if (!isWeb) {
      // STYLE ENGINE: occasion-aware per-slot style_slot_search.
      // Occasion = the recent SHOPPER asks only, NOT the whole thread. Joining
      // every turn made the BM25 query a ~100-word blob that matched almost
      // nothing on long threads (pool collapsed to ~1); and the 600-char slice of
      // the joined thread kept the OLDEST text, dropping the current ask entirely.
      const occasion = turns.filter(t => t.sender === 'shopper' && t.body)
        .slice(-3).map(t => (t.body ?? '').trim()).join(' ').slice(0, 300);
      const found = await retrieveOccasionCandidates(admin, {
        occasion, gender: genderNorm, aesthetic: stylist?.specialty ?? '',
      });
      cands = found.filter(c => c.image).map(c => ({
        id: c.id, name: c.name, brand: c.brand, price: c.price,
        image_url: c.image, primary_image_url: c.image, url: c.url, type: c.type,
      }));
      console.log(`[style-up-chat] thread=${threadId} retrieval=ENGINE(style_slot_search) candidates=${cands.length} mode=${mode || 'default'} (occasion-aware, NOT recency scan)`);
    }
    const candList = cands.map(c =>
      `${c.id} | ${(c.name ?? '').slice(0, 70)} | ${c.brand ?? ''} | ${c.price ?? ''} | ${c.type ?? ''}`,
    ).join('\n');

    const persona = stylist?.persona_prompt
      || `You are ${stylist?.name ?? 'a personal stylist'}, a friendly personal stylist.`;
    const specialty = (stylist?.specialty ?? '').trim();
    const outfitClause = (!isWeb && method === 'style_engine' && mode === 'outfit')
      ? `\n- The shopper wants a COMPLETE outfit this turn. Recommend ONE coherent full look from the candidates: a top (or a dress), a bottom, shoes, plus an optional layer — one piece per slot, all matching in colour, formality and season. Put every piece's id in productIds.`
      : '';
    const system = isWeb ? `${persona}

You're texting ${shopperName} inside a styling chat. Shopper context (use it; never ask for what you already know): ${ctxBits.join('; ') || 'not provided yet'}.

STYLE OF REPLY:
- Talk like texting: warm, concise, 1-3 short sentences. No markdown, no bullet lists. Never use em dashes; use commas or periods.
- Your signature aesthetic is ${specialty || 'your own point of view'}. Treat it as the DEFAULT vibe. Once you know the occasion, do NOT ask about style or formality, just assume your own aesthetic and go straight to pieces. Only ask a question when you don't yet know the occasion itself, or it's genuinely ambiguous. Keep questions to a minimum.
- When you're ready to surface pieces, set searchQueries: one tight query per garment (e.g. "men's sand linen short sleeve button up shirt", "white leather low top sneakers"). This is an INTERNAL field the app uses to fetch the real products; the shopper never sees it. Don't paste links or invent products.
- CRITICAL: NEVER mention the internet, the web, online, searching, browsing, scraping, links, sources, or that pieces come from anywhere outside. To the shopper you simply know where to find things. Talk like a stylist with great taste and connections, never like a search engine.
- Only set searchQueries when you're ACTUALLY surfacing pieces this turn. While you're still clarifying (asking a question), leave it empty.
- When you do surface, keep the reply SHORT and easy, like "Let me see what I can find for this…", one relaxed line, at most a quick read of the vibe first. Do NOT explain how to tap, try on, or generate; the app shows those controls itself.
- You CAN generate the look on them. NEVER say you can't generate photos.
- When your reply asks the shopper a question, ALSO set quickReplies: 2-4 short tap-to-answer options (under 25 characters each, first-person where natural) that DIRECTLY answer your question. Otherwise [].

Return ONLY JSON, no prose:
{"reply":"<your text message>","searchQueries":["<one tight query per garment>", ...],"quickReplies":["<tap answer>", ...]}
searchQueries: 1-4 entries when surfacing pieces this turn, otherwise [].` : `${persona}

You're texting ${shopperName} inside a styling chat. Shopper context (use it; never ask for what you already know): ${ctxBits.join('; ') || 'not provided yet'}.

STYLE OF REPLY:
- Talk like texting: warm, concise, 1-3 short sentences. No markdown, no bullet lists. Never use em dashes; use commas or periods.
- Your signature aesthetic is ${specialty || 'your own point of view'}. Treat it as the DEFAULT vibe. Once you know the occasion, do NOT ask about style or formality, just assume your own aesthetic and go straight to pieces. Only ask a question when you don't yet know the occasion itself, or it's genuinely ambiguous. Keep questions to a minimum.
- When you're ready to recommend, pick SPECIFIC products from the candidate list below (by id). Recommend things that actually fit their context and the conversation. Don't recommend products that aren't in the list.
- COMPLETE LOOKS ONLY: whenever you present a LOOK or outfit — which is the default any time they ask for something to wear, "a new one", a fresh look, or name an occasion — recommend a COMPLETE head-to-toe outfit: a top (or a dress), a bottom, and shoes, plus an optional layer. One piece per slot, all coordinated in colour, formality and season. Put every piece's id in productIds. NEVER offer a lone single piece as "a look". Recommend just one item ONLY when the shopper explicitly asked for a single garment (e.g. "just shoes", "a new jacket").
- After recommending, tell them they can tap any piece to see it on themselves, or just ask you to put the whole look on them — you CAN generate the look on them (it kicks off automatically when they ask). NEVER say you can't generate photos.${outfitClause}

CANDIDATE PRODUCTS (id | name | brand | price | type) — only recommend from these:
${candList || '(none available)'}

- When your reply asks the shopper a question, ALSO set quickReplies: 2-4 short tap-to-answer options (under 25 characters each, first-person where natural) that DIRECTLY answer your question. Otherwise [].

Return ONLY JSON, no prose:
{"reply":"<your text message>","productIds":["<id>", ...],"quickReplies":["<tap answer>", ...]}
productIds is optional — include it only when you're actually recommending pieces this turn (max 4).`;

    const mapped = turns.map(t => {
      const role: 'user' | 'assistant' = t.sender === 'shopper' ? 'user' : 'assistant';
      let content = t.body ?? '';
      if (t.kind === 'product' && t.product_ref) {
        const pr = t.product_ref as { name?: string; brand?: string };
        content = `[recommended ${pr.brand ?? ''} ${pr.name ?? 'a product'}]${content ? ' ' + content : ''}`;
      }
      return { role, content: content || '…' };
    });
    // Collapse consecutive same-role turns into one — Anthropic rejects two
    // assistant (or two user) messages in a row, which happens whenever the
    // stylist sends a text reply + product cards as separate rows. Without this
    // a product-heavy thread deterministically 400s.
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const m of mapped) {
      const last = messages[messages.length - 1];
      if (last && last.role === m.role) last.content += `\n${m.content}`;
      else messages.push({ ...m });
    }
    // Claude requires the first message to be a user turn.
    while (messages.length && messages[0].role === 'assistant') messages.shift();
    if (messages.length === 0) {
      messages.push({ role: 'user', content: `Hi ${stylist?.name ?? ''}` });
    }
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
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    let reply = '';
    let productIds: string[] = [];
    let searchQueries: string[] = [];
    let quickReplies: string[] = [];
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as { reply?: string; productIds?: string[]; searchQueries?: string[]; quickReplies?: string[] };
      reply = String(parsed.reply ?? '').trim();
      productIds = Array.isArray(parsed.productIds) ? parsed.productIds.map(String) : [];
      searchQueries = Array.isArray(parsed.searchQueries)
        ? parsed.searchQueries.map(q => String(q).trim()).filter(Boolean).slice(0, 4)
        : [];
      quickReplies = Array.isArray(parsed.quickReplies)
        ? parsed.quickReplies.map(q => String(q).trim()).filter(Boolean).slice(0, 4).map(s => s.slice(0, 40))
        : [];
    } catch {
      reply = text || "Tell me a bit more about what you're going for?";
    }
    if (!reply) reply = "Tell me a bit more about what you're going for?";

    // Validate picks against the candidate set (no hallucinated ids).
    const candById = new Map(cands.map(c => [c.id, c]));
    const picks = productIds.map(id => candById.get(id)).filter((c): c is ProductCand => !!c).slice(0, 4);

    // Insert the stylist's text reply (with its tap-to-answer options when the
    // reply is a question), then a product message per pick.
    await admin.from('style_up_messages')
      .insert({ thread_id: threadId, sender: 'stylist', kind: 'text', body: reply, quick_replies: quickReplies.length ? quickReplies : null });

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

    // Research trace — a structured record of exactly how this turn was produced
    // (context, persona, what was sent to the model, the reply + queries), for
    // the admin "view research" node diagram. Best-effort; never blocks the turn.
    let traceId: string | null = null;
    try {
      const { data: traceRow } = await admin.from('style_up_traces').insert({
        thread_id: threadId,
        shopper_user_id: thread.shopper_user_id,
        stylist_id: thread.stylist_id,
        source_mode: isWeb ? 'web' : 'catalog',
        payload: {
          source_mode: isWeb ? 'web' : 'catalog',
          stylist: stylist?.name ?? null,
          context: {
            name: prof?.full_name ?? null, gender: genderNorm,
            height: prof?.height_label ?? null, weight: prof?.weight_label ?? null,
            age: prof?.age_label ?? null, custom_style: prof?.custom_style_prompt ?? null,
            fashion_styles: prof?.fashion_styles ?? null,
          },
          context_line: ctxBits.join('; '),
          persona,
          system,
          messages,
          candidate_count: cands.length,
          model: MODEL,
          reply,
          product_ids: productIds,
          picks: picks.map(p => ({ id: p.id, name: p.name, brand: p.brand })),
          search_queries: searchQueries,
          usage: { input_tokens: out.usage?.input_tokens ?? null, output_tokens: out.usage?.output_tokens ?? null },
        },
      }).select('id').single();
      traceId = (traceRow?.id as string | undefined) ?? null;
    } catch (_e) { /* trace is best-effort */ }

    // ── Web stylists: run the piece hunt SERVER-SIDE so it finishes even if the
    // shopper refreshes or leaves the page. Products stream in via realtime; a
    // `hunting_until` marker on the thread drives the "working" indicator. The
    // text reply above already posted, so nothing here can break the chat. ──
    if (isWeb && searchQueries.length > 0) {
      // Each search+ingest realistically runs 10-15s; a low estimate made the
      // indicator look done (or vanish) while the pull was still going.
      const estSec = Math.max(15, searchQueries.length * 14);
      await admin.from('style_up_threads')
        .update({ hunting_until: new Date(Date.now() + estSec * 1000).toISOString() })
        .eq('id', threadId);

      const g = genderNorm === 'male' ? 'men' : genderNorm === 'female' ? 'women' : 'unisex';
      const hunt = (async () => {
        const traceSearches: unknown[] = [];
        try {
          const used = new Set<string>();
          const found: Array<Record<string, unknown>> = [];
          for (const q of searchQueries.slice(0, 4)) {
            try {
              const { data: sData } = await admin.functions.invoke('product-search', { body: { query: q, ingest: true, gender: g } });
              const sResp = sData as { success?: boolean; error?: string; products?: Array<{ url?: string }> } | null;
              const urls = (sResp?.products ?? []).map(p => p.url).filter((u): u is string => !!u).slice(0, 30);
              let importedId: string | null = null, importedName: string | null = null;
              if (urls.length) {
                const { data: rows } = await admin.from('products')
                  .select('id, name, brand, price, image_url, primary_image_url, url')
                  .in('url', urls);
                const byUrl = new Map(((rows ?? []) as Array<Record<string, unknown>>).map(r => [String(r.url), r]));
                for (const u of urls) {
                  const r = byUrl.get(u);
                  if (r && !used.has(String(r.id))) {
                    used.add(String(r.id)); found.push(r);
                    importedId = String(r.id);
                    importedName = [r.brand, r.name].filter(Boolean).join(' ') || null;
                    break;
                  }
                }
              }
              traceSearches.push({ query: q, ok: !!sResp?.success, error: sResp?.error ?? null, rawCount: (sResp?.products ?? []).length, withUrl: urls.length, matched: importedId ? 1 : 0, importedId, importedName });
            } catch (e) {
              traceSearches.push({ query: q, ok: false, error: e instanceof Error ? e.message : String(e), rawCount: 0, withUrl: 0, matched: 0, importedId: null, importedName: null });
            }
          }
          if (found.length) {
            await admin.from('style_up_messages').insert({ thread_id: threadId, sender: 'stylist', kind: 'text', body: "Here's what I found. Hit Generate this look and I'll put it on you." });
            for (const r of found) {
              await admin.from('style_up_messages').insert({
                thread_id: threadId, sender: 'stylist', kind: 'product',
                product_ref: { id: r.id, name: r.name, brand: r.brand, price: r.price, image: r.primary_image_url || r.image_url, url: r.url },
              });
            }
          } else {
            await admin.from('style_up_messages').insert({ thread_id: threadId, sender: 'stylist', kind: 'text', body: "Couldn't quite pin those down. Give me a brand or a budget and I'll take another run at it." });
          }
          if (traceId) { try { await admin.from('style_up_traces').update({ searches: traceSearches }).eq('id', traceId); } catch (_e) { /* best-effort */ } }
        } catch (_e) {
          /* swallow — the reply already posted */
        } finally {
          await admin.from('style_up_threads')
            .update({ hunting_until: null, last_message_at: new Date().toISOString() })
            .eq('id', threadId);
        }
      })();

      // Keep the function alive until the hunt finishes, even after we respond.
      const er = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
      if (er?.waitUntil) er.waitUntil(hunt);
      else await hunt;
    }

    // searchQueries are NOT returned anymore — the hunt runs server-side.
    return json({ success: true, reply, picks: picks.length, searchQueries: [], hunting: isWeb && searchQueries.length > 0, traceId });
  } catch (err) {
    return json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

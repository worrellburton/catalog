// style-engine — the STANDALONE Style Up stylist engine (simulation cockpit).
//
// Given a scenario (occasion + structured intent), a stylist persona, and a
// shopper (real profile or a synthetic gender), it:
//   1. retrieves an occasion-aware candidate set PER GARMENT SLOT from the live
//      catalog via style_slot_search (BM25 over occasion text, gender-filtered),
//   2. assembles up to 3 DISTINCT outfit options with Claude in the stylist's
//      persona (heuristic cycle-the-candidates fallback when credits are out),
//   3. returns the option sets + the GAPS (slots with no candidate at all) so the
//      cockpit can show choices and seed the gaps as demand.
//
// This is deliberately SEPARATE from the live style-up-chat (left untouched).
// The assembly prompt/validation intentionally mirrors ai-stylist rather than
// importing it, so iterating here never risks the live /generate path.
// ponytail: duplicates ai-stylist's assembler on purpose (isolation); DRY them
//           into _shared/outfit-assembly.ts once this engine is the one we ship.
//
// Auth: admin (Styling tab) or service role (future batch cron).
// Secrets: ANTHROPIC_API_KEY (optional — heuristic fallback without it).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { logAiUsage } from '../_shared/ai-usage.ts';

// Assembly model is operator-selectable from the cockpit (cost vs quality).
// Sonnet is the default — plenty for assembling from a fixed candidate list,
// and the same model the live style-up-chat runs.
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MODEL_PRICE: Record<string, { in: number; out: number }> = {
  'claude-sonnet-4-6': { in: 3 / 1e6, out: 15 / 1e6 },
  'claude-haiku-4-5':  { in: 1 / 1e6, out: 5 / 1e6 },
  'claude-opus-4-8':   { in: 5 / 1e6, out: 25 / 1e6 },
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
function jwtRole(token: string): string | null {
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null; } catch { return null; }
}

type Slot = 'hats' | 'tops' | 'jackets' | 'dresses' | 'bottoms' | 'shoes';
const ALL_SLOTS: Slot[] = ['hats', 'tops', 'jackets', 'dresses', 'bottoms', 'shoes'];

// Slot → the garment noun that triggers search_products' category route, so each
// per-slot query is occasion-ranked WITHIN the right garment type.
const SLOT_NOUN: Record<Slot, string> = {
  hats: 'hat', tops: 'shirt', jackets: 'jacket', dresses: 'dress', bottoms: 'pants', shoes: 'shoes',
};

// Women-only garment classes a male shopper must never be shown (name-level
// belt-and-suspenders on top of the gender-filtered retrieval).
const WOMEN_ONLY_NAME_RE = /\b(heel|heels|stiletto|pump|pumps|gown|dress|skirt|blouse|camisole|cami|bodysuit|slingback|wedge|wedges|espadrille|thong sandal|peep[\s-]?toe|bralette|bustier|corset|romper|jumpsuit|maxi|midi dress|mini dress)\b/i;

interface Cand {
  id: string; name: string; brand: string | null; price: string | null;
  image: string | null; url: string | null; type: string | null; gender: string | null; score: number;
}
interface ProductRef { id: string; name: string; brand: string | null; price: string | null; image: string | null; url: string | null; }
interface OutfitSet { outfit: Record<string, ProductRef | null>; gaps: string[]; rationale: string; }

function refOf(c: Cand): ProductRef {
  return { id: c.id, name: c.name, brand: c.brand, price: c.price, image: c.image, url: c.url };
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
    if (attempt < 2) await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
  }
  return res as Response;
}

function formalityWord(f: number): string {
  return ['very casual / athleisure', 'casual', 'smart casual', 'business / cocktail', 'formal', 'black-tie'][Math.max(0, Math.min(5, f))] ?? 'smart casual';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ success: false, error: 'method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return json({ success: false, error: 'server misconfigured' }, 500);
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    let authorized = token === serviceKey || jwtRole(token) === 'service_role';
    if (!authorized && token) {
      const { data: { user } } = await admin.auth.getUser(token);
      if (user) {
        const { data: prof } = await admin.from('profiles').select('is_admin, role').eq('id', user.id).maybeSingle();
        authorized = prof?.is_admin === true || prof?.role === 'admin' || prof?.role === 'super_admin';
      }
    }
    if (!authorized) return json({ success: false, error: 'forbidden' }, 403);

    const body = await req.json().catch(() => ({}));
    const intent = (body.intent ?? {}) as { occasion?: string; gender?: string; formality?: number; season?: string; slots?: string[]; palette?: string };
    const occasion = String(body.scenario_text ?? intent.occasion ?? '').trim();
    if (!occasion) return json({ success: false, error: 'missing scenario' }, 400);
    const stylistId = String(body.stylist_id ?? '');
    const shopperUserId = body.shopper_user_id ? String(body.shopper_user_id) : null;
    const model = MODEL_PRICE[String(body.model)] ? String(body.model) : DEFAULT_MODEL;

    // Stylist persona (optional). The specialty also biases RETRIEVAL (so each
    // stylist shops a vibe-skewed candidate pool), not just the assembly voice —
    // e.g. Devon's "streetwear sneakers" surfaces sneakers, Margot's "quiet
    // luxury" surfaces tailored pieces. Differentiation is still capped by what
    // the catalog actually stocks for that aesthetic.
    let persona = 'a sharp personal stylist with great taste';
    let stylistName = 'the stylist';
    let aesthetic = '';
    if (stylistId) {
      const { data: st } = await admin.from('style_up_stylists').select('name, specialty, persona_prompt').eq('id', stylistId).maybeSingle();
      if (st?.persona_prompt) persona = String(st.persona_prompt);
      if (st?.name) stylistName = String(st.name);
      if (st?.specialty) aesthetic = String(st.specialty).toLowerCase().replace(/[&/]/g, ' ').replace(/\s+/g, ' ').trim();
    }

    // Shopper context: a real profile's gender/body wins; else the scenario's gender.
    let gender = String(intent.gender ?? '').toLowerCase();
    const ctxBits: string[] = [];
    if (shopperUserId) {
      const { data: prof } = await admin.from('profiles')
        .select('gender, height_label, weight_label, age_label, custom_style_prompt, fashion_styles')
        .eq('id', shopperUserId).maybeSingle();
      const g = String(prof?.gender ?? '').toLowerCase();
      if (['male', 'men', 'm'].includes(g)) gender = 'male';
      else if (['female', 'women', 'f'].includes(g)) gender = 'female';
      if (prof?.height_label) ctxBits.push(`height: ${prof.height_label}`);
      if (prof?.weight_label) ctxBits.push(`weight: ${String(prof.weight_label).replace(/\s*\(.*\)\s*/, '')}`);
      if (prof?.age_label) ctxBits.push(`age: ${prof.age_label}`);
      if (prof?.custom_style_prompt) ctxBits.push(`their style: ${prof.custom_style_prompt}`);
      if (prof?.fashion_styles) ctxBits.push(`style tags: ${prof.fashion_styles}`);
    }
    if (!['male', 'female'].includes(gender)) gender = 'unknown';
    const filterGender = gender === 'unknown' ? null : gender;

    // Slot plan (no dresses for men).
    let slots = (Array.isArray(intent.slots) ? intent.slots : [])
      .map(s => String(s).toLowerCase()).filter((s): s is Slot => (ALL_SLOTS as string[]).includes(s));
    if (gender === 'male') slots = slots.filter(s => s !== 'dresses');
    if (slots.length === 0) slots = gender === 'female' ? ['dresses', 'shoes'] : ['tops', 'bottoms', 'shoes'];
    // Completeness — every outfit needs torso + bottom + shoes (a dress covers
    // torso+bottom). This also REPAIRS a gender flip: a female 'dresses' scenario
    // run on a male shopper drops the dress, which would otherwise leave shoes
    // alone — substitute top+bottom so he still gets a full look.
    if (!(slots.includes('dresses') || slots.includes('tops'))) slots.push('tops');
    if (!(slots.includes('dresses') || slots.includes('bottoms'))) slots.push('bottoms');
    if (!slots.includes('shoes')) slots.push('shoes');
    slots = [...new Set(slots)];

    // Per-slot, occasion-aware retrieval from the live catalog.
    const candBySlot: Record<string, Cand[]> = {};
    const candById = new Map<string, { cand: Cand; slot: Slot }>();
    for (const slot of slots) {
      // Persona-aware query: the stylist's aesthetic skews the ranking so
      // different stylists shop different pools (k bumped to give room to diverge).
      const q = `${aesthetic} ${occasion} ${SLOT_NOUN[slot]}`.trim();
      const { data, error } = await admin.rpc('style_slot_search', { p_query: q, p_k: 12, p_gender: filterGender });
      if (error) continue;
      let rows = ((data ?? []) as Array<Record<string, unknown>>).map(r => ({
        id: String(r.product_id), name: String(r.product_name ?? ''), brand: (r.product_brand as string) ?? null,
        price: (r.product_price as string) ?? null, image: (r.product_image_url as string) ?? null,
        url: (r.product_url as string) ?? null, type: (r.product_type as string) ?? null,
        gender: (r.product_gender as string) ?? null, score: Number(r.score ?? 0),
      } as Cand));
      if (gender === 'male') rows = rows.filter(c => !WOMEN_ONLY_NAME_RE.test(c.name));
      candBySlot[slot] = rows;
      for (const c of rows) if (!candById.has(c.id)) candById.set(c.id, { cand: c, slot });
    }

    // Assemble up to SET_COUNT DISTINCT outfit options so the shopper has a
    // choice. Claude in persona when available; else heuristic (cycle candidates
    // per slot). Identical sets are de-duped (a slot with one candidate can't vary).
    const SET_COUNT = 3;
    const candidateCounts: Record<string, number> = {};
    for (const s of slots) candidateCounts[s] = candBySlot[s]?.length ?? 0;

    const setKey = (o: Record<string, ProductRef | null>) => slots.map(s => o[s]?.id ?? '-').join('|');
    const dedupe = (arr: OutfitSet[]): OutfitSet[] => {
      const seen = new Set<string>(); const out: OutfitSet[] = [];
      for (const st of arr) { const k = setKey(st.outfit); if (seen.has(k)) continue; seen.add(k); out.push(st); }
      return out;
    };
    const heuristicSets = (): OutfitSet[] => {
      const out: OutfitSet[] = [];
      for (let k = 0; k < SET_COUNT; k++) {
        const outfit: Record<string, ProductRef | null> = {};
        for (const s of slots) { const a = candBySlot[s] ?? []; outfit[s] = a.length ? refOf(a[Math.min(k, a.length - 1)]) : null; }
        out.push({ outfit, gaps: slots.filter(s => !outfit[s]), rationale: '' });
      }
      return dedupe(out);
    };

    let sets: OutfitSet[] = [];
    let source: 'claude' | 'heuristic' = 'heuristic';
    let usage: { input_tokens: number; output_tokens: number } | null = null;
    let cost = 0;

    if (apiKey && Object.values(candBySlot).some(a => a.length)) {
      const lines: string[] = [];
      for (const s of slots) for (const c of (candBySlot[s] ?? [])) {
        lines.push(`${c.id} | ${s} | ${[c.brand, c.name].filter(Boolean).join(' ')}${c.price ? ` | ${c.price}` : ''}`);
      }
      const genderRule = gender === 'male'
        ? 'The shopper is a MAN — menswear / unisex only. Never pick dresses, skirts, heels, or women\'s-cut pieces.'
        : gender === 'female' ? 'The shopper is a WOMAN — womenswear / unisex only.'
        : 'Gender unspecified — favour unisex pieces.';
      const slotJson = slots.map(s => `"${s}":"<id|null>"`).join(',');
      const sys = `You are ${stylistName}: ${persona}

Assemble ${SET_COUNT} DISTINCT complete outfits for this occasion from ONLY the candidate products below, so the shopper has options to choose from.
OCCASION: "${occasion}"
TARGET FORMALITY: ${formalityWord(Number(intent.formality ?? 2))}${intent.season && intent.season !== 'any' ? `\nSEASON: ${intent.season}` : ''}${intent.palette ? `\nPALETTE HINT: ${intent.palette}` : ''}${ctxBits.length ? `\nSHOPPER: ${ctxBits.join('; ')}` : ''}
GENDER RULE: ${genderRule}

RULES:
- Each outfit fills ONLY these slots: ${slots.join(', ')}. Every other slot must be null.
- Pick exactly ONE candidate id per slot, of that slot's type. Choose only ids in the list.
- Make the ${SET_COUNT} outfits MEANINGFULLY DIFFERENT from each other (vary the hero pieces) while each stays coherent: colour, formality (all within one level), season consistent. At most one statement piece per outfit.
- If a slot has no good on-occasion option, set it null rather than forcing a bad pick.

CANDIDATES (id | slot | brand name | price):
${lines.join('\n')}

Return ONLY JSON: {"sets":[{${slotJson},"rationale":"<1-2 sentences naming the pieces and why they work>"}, … ${SET_COUNT} entries]}`;

      try {
        const res = await callAnthropic(apiKey, { model, max_tokens: 2000, messages: [{ role: 'user', content: sys }] });
        if (!res.ok) throw new Error(`anthropic ${res.status}`);
        const out = await res.json() as { content?: Array<{ type: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
        const text = (out.content?.find(c => c.type === 'text')?.text ?? '').replace(/```json\s*|```\s*/g, '').trim();
        const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as { sets?: Array<Record<string, unknown>> };
        const raw = Array.isArray(parsed.sets) ? parsed.sets : [];
        for (const rs of raw.slice(0, SET_COUNT)) {
          const outfit: Record<string, ProductRef | null> = {};
          for (const s of slots) {
            const id = typeof rs[s] === 'string' ? String(rs[s]).trim() : '';
            const hit = id && id !== 'null' ? candById.get(id) : null;
            outfit[s] = hit && hit.slot === s ? refOf(hit.cand) : null;
          }
          sets.push({ outfit, gaps: slots.filter(s => !outfit[s]), rationale: typeof rs.rationale === 'string' ? rs.rationale.trim() : '' });
        }
        sets = dedupe(sets).filter(st => Object.values(st.outfit).some(Boolean));
        if (sets.length === 0) throw new Error('no valid sets');
        source = 'claude';
        const inTok = out.usage?.input_tokens ?? 0;
        const outTok = out.usage?.output_tokens ?? 0;
        usage = { input_tokens: inTok, output_tokens: outTok };
        const p = MODEL_PRICE[model];
        cost = inTok * p.in + outTok * p.out;
        // Ledger entry — powers the cockpit's running simulation-spend total.
        logAiUsage({ platform: 'anthropic', operation: 'style-engine', model, input_tokens: inTok, output_tokens: outTok });
      } catch {
        sets = heuristicSets();
      }
    } else {
      sets = heuristicSets();
    }

    // True catalog gaps = slots with no candidate at all — the seed-demand signal.
    const gaps = slots.filter(s => (candidateCounts[s] ?? 0) === 0);

    return json({
      success: true, source, model, occasion, gender, stylist: stylistName,
      slots, sets, gaps, candidateCounts, usage, cost,
    });
  } catch (err) {
    return json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

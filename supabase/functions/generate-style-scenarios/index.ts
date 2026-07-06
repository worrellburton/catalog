// generate-style-scenarios — Claude brainstorms a diverse set of styling
// scenarios for the Style Up simulation cockpit (admin/seeding → Styling tab).
//
// Each scenario is an occasion the stylist engine will be simulated against:
// a natural phrase ("evening at a rooftop night club") plus structured intent
// (gender, formality 0-5, season, garment slots, palette). They are inserted as
// seed_targets(kind='scenario', status='paused', intent=<jsonb>) — PAUSED so the
// paid demand-driver (which only runs 'approved') never auto-spends on them;
// they exist to be SIMULATED. Approving one (or seeding its gaps) is what turns
// it into real demand.
//
// Auth: the weekly cron calls with the service-role key; an admin can also
// invoke it from the Styling tab ("Generate scenarios now").
// Secrets: ANTHROPIC_API_KEY (degrades to a small heuristic set if unset).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { logAiUsage } from '../_shared/ai-usage.ts';

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

// The `role` claim of a (gateway-verified) JWT, so we can recognise the cron's
// service-role token without it being byte-equal to SUPABASE_SERVICE_ROLE_KEY.
function jwtRole(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))).role ?? null;
  } catch { return null; }
}

// The engine's garment slots (must match style-engine / ai-stylist).
const SLOTS = ['hats', 'tops', 'jackets', 'dresses', 'bottoms', 'shoes'];

interface Scenario {
  scenario_text: string;
  gender: 'male' | 'female';
  formality: number;        // 0 athleisure → 5 black-tie
  season: string;           // spring | summer | fall | winter | any
  slots: string[];          // subset of SLOTS (no 'dresses' for male)
  palette: string;          // short hint, e.g. "dark neutrals, one metallic accent"
}

function normGender(g: unknown): 'male' | 'female' {
  return String(g).toLowerCase().startsWith('f') ? 'female' : 'male';
}
function cleanSlots(slots: unknown, gender: 'male' | 'female'): string[] {
  const arr = Array.isArray(slots) ? slots.map(s => String(s).toLowerCase()) : [];
  let out = arr.filter(s => SLOTS.includes(s));
  if (gender === 'male') out = out.filter(s => s !== 'dresses');
  // Guarantee a wearable minimum.
  if (out.length === 0) out = gender === 'female' ? ['dresses', 'shoes'] : ['tops', 'bottoms', 'shoes'];
  return [...new Set(out)];
}

async function brainstorm(count: number, existing: string[], apiKey: string): Promise<{ scenarios: Scenario[]; inputTokens: number | null; outputTokens: number | null }> {
  const avoid = existing.length ? `\nAVOID duplicating these existing scenarios:\n${existing.slice(0, 80).join('\n')}\n` : '';
  const prompt = `You are a fashion stylist designing test scenarios to evaluate an AI stylist.
Generate ${count} DIVERSE, realistic styling scenarios a real shopper might bring.

Spread them across: nightlife (club, bar), date night, work (interview, office, smart casual), formal events (wedding guest, cocktail, gala, funeral), athletic (gym, run, yoga), travel/vacation (beach, resort, city trip), casual/weekend (brunch, errands), and seasonal moments. Mix BOTH genders roughly evenly. Vary formality and season.
${avoid}
For EACH scenario return an object with:
- "scenario_text": a short natural occasion phrase (e.g. "evening at a rooftop night club", "first-round job interview at a startup"). No gender words in the text.
- "gender": "male" or "female".
- "formality": integer 0-5 (0 athleisure, 2 smart casual, 3 business/cocktail, 4 formal, 5 black-tie).
- "season": one of "spring","summer","fall","winter","any".
- "slots": array from ["hats","tops","jackets","dresses","bottoms","shoes"] — the garments this outfit needs. Use "dresses" ONLY for female scenarios (a dress replaces tops+bottoms). Always include "shoes". Most looks are 3-4 slots.
- "palette": a short colour/aesthetic hint (e.g. "dark neutrals with one metallic accent").

Return ONLY a JSON array of ${count} objects. No prose, no code fences.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 4096, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const out = await res.json() as { content?: Array<{ type: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
  const text = (out.content?.find(c => c.type === 'text')?.text ?? '').replace(/```json\s*|```\s*/g, '').trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error(`No JSON array in response: ${text.slice(0, 200)}`);
  const parsed = JSON.parse(text.slice(start, end + 1)) as unknown[];
  const scenarios: Scenario[] = (Array.isArray(parsed) ? parsed : []).map((r) => {
    const o = r as Record<string, unknown>;
    const gender = normGender(o.gender);
    return {
      scenario_text: String(o.scenario_text ?? '').trim(),
      gender,
      formality: Math.max(0, Math.min(5, Math.round(Number(o.formality)) || 2)),
      season: String(o.season ?? 'any').toLowerCase(),
      slots: cleanSlots(o.slots, gender),
      palette: String(o.palette ?? '').trim(),
    };
  }).filter(s => s.scenario_text.length > 3);
  return { scenarios, inputTokens: out.usage?.input_tokens ?? null, outputTokens: out.usage?.output_tokens ?? null };
}

// Deterministic fallback so the feature works without an API key.
function heuristicScenarios(count: number): Scenario[] {
  const base: Scenario[] = [
    { scenario_text: 'evening at a night club', gender: 'male', formality: 3, season: 'any', slots: ['tops', 'bottoms', 'shoes', 'jackets'], palette: 'all black' },
    { scenario_text: 'cocktail party downtown', gender: 'female', formality: 4, season: 'any', slots: ['dresses', 'shoes'], palette: 'jewel tones' },
    { scenario_text: 'first day at an office job', gender: 'male', formality: 3, season: 'fall', slots: ['tops', 'bottoms', 'shoes', 'jackets'], palette: 'navy and grey' },
    { scenario_text: 'summer wedding guest, garden', gender: 'female', formality: 4, season: 'summer', slots: ['dresses', 'shoes'], palette: 'soft pastels' },
    { scenario_text: 'beach day on vacation', gender: 'female', formality: 1, season: 'summer', slots: ['dresses', 'shoes', 'hats'], palette: 'sand and white' },
    { scenario_text: 'gym then brunch', gender: 'male', formality: 1, season: 'any', slots: ['tops', 'bottoms', 'shoes'], palette: 'greys' },
  ];
  const out: Scenario[] = [];
  for (let i = 0; i < count; i++) out.push(base[i % base.length]);
  return out;
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
    // Auth — the cron passes the service key; an admin passes their JWT.
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
    const count = Math.max(1, Math.min(40, Number(body.count) || 25));

    // Existing scenario terms (for de-duplication, both in the prompt and after).
    const { data: existingRows } = await admin
      .from('seed_targets').select('term').eq('kind', 'scenario').limit(500);
    const existing = (existingRows ?? []).map(r => String(r.term));
    const existingLower = new Set(existing.map(t => t.toLowerCase()));

    let scenarios: Scenario[];
    let source: 'claude' | 'heuristic' = 'heuristic';
    if (apiKey) {
      try {
        const r = await brainstorm(count, existing, apiKey);
        scenarios = r.scenarios;
        source = 'claude';
        logAiUsage({ platform: 'anthropic', operation: 'style-scenarios', model: MODEL, input_tokens: r.inputTokens, output_tokens: r.outputTokens });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logAiUsage({ platform: 'anthropic', operation: 'style-scenarios', model: MODEL, status: 'error', error_message: msg.slice(0, 500) });
        scenarios = heuristicScenarios(count);
      }
    } else {
      scenarios = heuristicScenarios(count);
    }

    // Drop dupes (vs existing + within this batch), then insert as paused
    // simulation scenarios with structured intent.
    const seen = new Set<string>();
    const rows = scenarios
      .filter(s => {
        const key = s.scenario_text.toLowerCase();
        if (existingLower.has(key) || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(s => ({
        term: s.scenario_text,
        kind: 'scenario',
        status: 'paused',
        priority: 40,
        intent: {
          occasion: s.scenario_text,
          gender: s.gender,
          formality: s.formality,
          season: s.season,
          slots: s.slots,
          palette: s.palette,
        },
      }));

    let inserted = 0;
    if (rows.length) {
      const { data, error } = await admin.from('seed_targets').insert(rows).select('id');
      if (error) return json({ success: false, error: error.message }, 500);
      inserted = data?.length ?? 0;
    }

    return json({ success: true, source, generated: scenarios.length, inserted, skipped: scenarios.length - rows.length });
  } catch (err) {
    return json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

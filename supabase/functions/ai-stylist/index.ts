// AI Stylist — turns a free-text occasion ("dinner in Tulum", "first day at a
// startup") into a single cohesive outfit assembled from the live product
// catalog. Used by the /generate "AI Stylist" path: the client sends the
// shopper's occasion + a gender-filtered candidate set (semantic prefilter
// happens client-side by capping to the active catalog), and Claude reasons
// over it to pick ONE item per slot — Tops · Dresses · Bottoms · Shoes.
//
// Required Supabase secret (degrades to a heuristic outfit if unset):
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxxxxx

import { logAiUsage } from '../_shared/ai-usage.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// Reasoning model — latest Claude Opus with extended thinking so the stylist
// actually reasons about the occasion (formality, season, palette) before it
// picks, rather than keyword-matching.
const STYLIST_MODEL = 'claude-opus-4-8';

interface Candidate {
  id: string;
  name: string;
  brand?: string | null;
  price?: string | null;
  /** Top | Dress | Pants | Shoes | Hat | Bag | … (client roleTagFromName). */
  role?: string | null;
  /** Optional short AI description (products.haiku_context) for richer reasoning. */
  context?: string | null;
}

type Slot = 'tops' | 'dresses' | 'bottoms' | 'shoes';

interface Outfit {
  tops: string | null;
  dresses: string | null;
  bottoms: string | null;
  shoes: string | null;
}

interface ClaudeResponse {
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
}

// Map a client role tag to the outfit slot it fills.
function slotForRole(role?: string | null): Slot | null {
  const r = (role || '').toLowerCase();
  if (r === 'dress') return 'dresses';
  if (r === 'top' || r === 'jacket') return 'tops';
  if (r === 'pants' || r === 'bottoms' || r === 'skirt') return 'bottoms';
  if (r === 'shoes') return 'shoes';
  return null;
}

// Deterministic fallback when there's no API key or Claude fails: one item per
// slot, first available. Keeps the feature usable (the shopper can still swap).
function heuristicOutfit(candidates: Candidate[]): Outfit {
  const pick = (slot: Slot) => candidates.find(c => slotForRole(c.role) === slot)?.id ?? null;
  const dresses = pick('dresses');
  return {
    tops: dresses ? null : pick('tops'),
    dresses,
    bottoms: dresses ? null : pick('bottoms'),
    shoes: pick('shoes'),
  };
}

async function styleWithClaude(
  occasion: string,
  gender: string,
  candidates: Candidate[],
  apiKey: string,
): Promise<{ outfit: Outfit; rationale: string; inputTokens: number | null; outputTokens: number | null }> {
  const list = candidates
    .map(c => `${c.id} | ${c.role || 'item'} | ${[c.brand, c.name].filter(Boolean).join(' ')}${c.price ? ` | ${c.price}` : ''}${c.context ? ` — ${c.context}` : ''}`)
    .join('\n');

  const prompt = `You are a sharp personal stylist assembling ONE cohesive outfit for a real shopper.

OCCASION (what they want to wear / be doing): "${occasion}"
SHOPPER GENDER: ${gender}

STEP 1 — Read the occasion. In your head, infer formality, season, setting and a
coherent palette/aesthetic.

STEP 2 — Assemble ONE outfit from the AVAILABLE PRODUCTS below (and ONLY these).
Each line is: id | role | brand name | price | description.
Rules:
  • Pick AT MOST ONE item per slot: a Top, a Bottom, and Shoes — OR a Dress
    INSTEAD of a top+bottom (if you pick a dress, leave tops and bottoms null).
  • Everything must work together — color, formality, and season coherent.
  • Choose only ids that appear in the list. Never invent an id.
  • If a slot has no good option, set it to null rather than forcing a bad pick.

AVAILABLE PRODUCTS:
${list}

Return ONLY JSON, no prose or code fences:
{"tops": "<id|null>", "dresses": "<id|null>", "bottoms": "<id|null>", "shoes": "<id|null>", "rationale": "<one short sentence on why this works for the occasion>"}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: STYLIST_MODEL,
      max_tokens: 3000,
      thinking: { type: 'enabled', budget_tokens: 2000 },
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as ClaudeResponse;
  const text = json.content?.find(c => c.type === 'text')?.text?.trim() ?? '';
  if (!text) throw new Error('Claude returned no text');

  const cleaned = text.replace(/```json\s*|```\s*/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error(`No JSON object in Claude response: ${cleaned.slice(0, 200)}`);
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;

  // Validate every chosen id against the candidate set — never trust a
  // hallucinated id through to the client.
  const valid = new Set(candidates.map(c => c.id));
  const norm = (v: unknown): string | null => {
    const s = typeof v === 'string' ? v.trim() : '';
    return s && s !== 'null' && valid.has(s) ? s : null;
  };
  const outfit: Outfit = {
    tops: norm(parsed.tops),
    dresses: norm(parsed.dresses),
    bottoms: norm(parsed.bottoms),
    shoes: norm(parsed.shoes),
  };
  // A dress replaces top+bottom.
  if (outfit.dresses) { outfit.tops = null; outfit.bottoms = null; }

  return {
    outfit,
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale.trim() : '',
    inputTokens: json.usage?.input_tokens ?? null,
    outputTokens: json.usage?.output_tokens ?? null,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const occasion = String(body.occasion || '').trim();
    const gender = String(body.gender || 'unknown').trim() || 'unknown';
    const candidates: Candidate[] = Array.isArray(body.candidates)
      ? (body.candidates as Candidate[]).filter(c => c && typeof c.id === 'string').slice(0, 180)
      : [];

    if (!occasion) return jsonRes({ success: false, error: 'missing occasion' }, 400);
    if (candidates.length === 0) return jsonRes({ success: false, error: 'no candidates' }, 400);

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY') || '';
    if (!apiKey) {
      return jsonRes({ success: true, outfit: heuristicOutfit(candidates), rationale: '', source: 'heuristic' });
    }

    try {
      const { outfit, rationale, inputTokens, outputTokens } = await styleWithClaude(occasion, gender, candidates, apiKey);
      // Best-effort usage logging (never blocks the response).
      try { await logAiUsage({ platform: 'anthropic', operation: 'ai-stylist', model: STYLIST_MODEL, input_tokens: inputTokens, output_tokens: outputTokens }); } catch { /* ignore */ }
      return jsonRes({ success: true, outfit, rationale, source: 'claude' });
    } catch (err) {
      console.warn('[ai-stylist] Claude failed, falling back:', err);
      return jsonRes({ success: true, outfit: heuristicOutfit(candidates), rationale: '', source: 'heuristic' });
    }
  } catch (err) {
    return jsonRes({ success: false, error: err instanceof Error ? err.message : 'stylist failed' }, 500);
  }
});

// AI Stylist — turns a free-text occasion ("dinner in Tulum", "first day at a
// startup") into a single cohesive outfit assembled from the live product
// catalog. Used by the /generate "AI Stylist" path: the client sends the
// shopper's occasion + a gender-filtered candidate set, and Claude reasons over
// it to pick items per slot — Hat (optional) · Tops · Dresses · Bottoms · Shoes.
//
// Required Supabase secret (degrades to a heuristic outfit if unset):
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxxxxx

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
  role?: string | null;
  context?: string | null;
}

type Slot = 'hats' | 'tops' | 'dresses' | 'bottoms' | 'shoes';

interface Outfit {
  hats: string | null;
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

function slotForRole(role?: string | null): Slot | null {
  const r = (role || '').toLowerCase();
  if (r === 'hat') return 'hats';
  if (r === 'dress') return 'dresses';
  if (r === 'top' || r === 'jacket') return 'tops';
  if (r === 'pants' || r === 'bottoms' || r === 'skirt') return 'bottoms';
  if (r === 'shoes') return 'shoes';
  return null;
}

function heuristicOutfit(candidates: Candidate[]): Outfit {
  const pick = (slot: Slot) => candidates.find(c => slotForRole(c.role) === slot)?.id ?? null;
  const dresses = pick('dresses');
  return {
    hats: null, // hats are optional — don't force one
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
): Promise<{ outfit: Outfit; rationale: string }> {
  const list = candidates
    .map(c => `${c.id} | ${c.role || 'item'} | ${[c.brand, c.name].filter(Boolean).join(' ')}${c.price ? ` | ${c.price}` : ''}${c.context ? ` — ${c.context}` : ''}`)
    .join('\n');

  // Strong gender guidance — never put a man in women's pieces (or vice-versa).
  const genderRule = gender === 'male'
    ? 'The shopper is a MAN. Choose only menswear or genuinely unisex pieces. NEVER pick dresses, skirts, or women\'s-cut garments — leave "dresses" null.'
    : gender === 'female'
      ? 'The shopper is a WOMAN. Choose only womenswear or genuinely unisex pieces. NEVER pick men\'s-specific garments.'
      : 'The shopper\'s gender is unspecified — favor unisex pieces.';

  const prompt = `You are a sharp personal stylist assembling ONE cohesive outfit for a real shopper.

OCCASION (what they want to wear / be doing): "${occasion}"
SHOPPER GENDER: ${gender}
GENDER RULE: ${genderRule}

STEP 1 — Read the occasion. In your head, infer formality, season, setting and a
coherent palette/aesthetic.

STEP 2 — Assemble ONE outfit from the AVAILABLE PRODUCTS below (and ONLY these).
Each line is: id | role | brand name | price | description.
Rules:
  • Pick ONE Top, ONE Bottom, and ONE pair of Shoes — OR a Dress INSTEAD of a
    top+bottom (if you pick a dress, leave tops and bottoms null).
  • A Hat is OPTIONAL: add one only if it genuinely suits the occasion, else null.
  • Everything must work together — color, formality, and season coherent.
  • Obey the GENDER RULE above without exception.
  • Choose only ids that appear in the list. Never invent an id.
  • If a slot has no good option, set it to null rather than forcing a bad pick.

AVAILABLE PRODUCTS:
${list}

Return ONLY JSON, no prose or code fences:
{"hats": "<id|null>", "tops": "<id|null>", "dresses": "<id|null>", "bottoms": "<id|null>", "shoes": "<id|null>", "rationale": "<one short sentence on why this works for the occasion>"}`;

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

  // Validate every chosen id against the candidate set AND its role, so a
  // hallucinated id — or a dress slipped to a man — never reaches the client.
  const byId = new Map(candidates.map(c => [c.id, c]));
  const pick = (v: unknown, slot: Slot): string | null => {
    const s = typeof v === 'string' ? v.trim() : '';
    if (!s || s === 'null') return null;
    const c = byId.get(s);
    if (!c) return null;
    if (slotForRole(c.role) !== slot) return null;
    return s;
  };
  const outfit: Outfit = {
    hats: pick(parsed.hats, 'hats'),
    tops: pick(parsed.tops, 'tops'),
    dresses: gender === 'male' ? null : pick(parsed.dresses, 'dresses'),
    bottoms: pick(parsed.bottoms, 'bottoms'),
    shoes: pick(parsed.shoes, 'shoes'),
  };
  if (outfit.dresses) { outfit.tops = null; outfit.bottoms = null; }

  return {
    outfit,
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale.trim() : '',
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
      const { outfit, rationale } = await styleWithClaude(occasion, gender, candidates, apiKey);
      return jsonRes({ success: true, outfit, rationale, source: 'claude' });
    } catch (err) {
      console.warn('[ai-stylist] Claude failed, falling back:', err);
      return jsonRes({ success: true, outfit: heuristicOutfit(candidates), rationale: '', source: 'heuristic' });
    }
  } catch (err) {
    return jsonRes({ success: false, error: err instanceof Error ? err.message : 'stylist failed' }, 500);
  }
});

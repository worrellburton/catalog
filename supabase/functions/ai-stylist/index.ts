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
  /** 'male' | 'female' | 'unisex' | null — used to drop off-gender picks. */
  gender?: string | null;
}

type Slot = 'hats' | 'tops' | 'jackets' | 'dresses' | 'bottoms' | 'shoes';

const ALL_SLOTS: Slot[] = ['hats', 'tops', 'jackets', 'dresses', 'bottoms', 'shoes'];

interface Outfit {
  hats: string | null;
  tops: string | null;
  jackets: string | null;
  dresses: string | null;
  bottoms: string | null;
  shoes: string | null;
}

// Women-only garment classes a male shopper must never be shown (belt-and-
// suspenders for when a row is mis-tagged unisex/null but the NAME gives it
// away — e.g. "Femme LA Tokyo Thong Sandal" heels). Matched against the name.
const WOMEN_ONLY_NAME_RE = /\b(heel|heels|stiletto|pump|pumps|gown|dress|skirt|blouse|camisole|cami|bodysuit|slingback|wedge|wedges|espadrille|thong sandal|peep[\s-]?toe|bralette|bustier|corset|romper|jumpsuit|maxi|midi dress|mini dress)\b/i;

// Keep a candidate for the shopper's gender. Drops opposite-sex-tagged rows
// AND, for men, anything whose name reads women-only even if the gender tag
// says unisex/null. Unisex / unknown otherwise pass.
function allowedForGender(c: Candidate, gender: string): boolean {
  const g = (c.gender || '').toLowerCase();
  if (gender === 'male') {
    if (g === 'female') return false;
    if (WOMEN_ONLY_NAME_RE.test(c.name || '')) return false;
    if (slotForRole(c.role) === 'dresses') return false;
    return true;
  }
  if (gender === 'female') {
    return g !== 'male';
  }
  return true;
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
  if (r === 'jacket') return 'jackets';
  if (r === 'top') return 'tops';
  if (r === 'pants' || r === 'bottoms' || r === 'skirt') return 'bottoms';
  if (r === 'shoes') return 'shoes';
  return null;
}

// Only the slots the shopper asked for are assembled; the rest stay null.
function heuristicOutfit(candidates: Candidate[], wanted: Set<Slot>): Outfit {
  const pick = (slot: Slot) =>
    wanted.has(slot) ? (candidates.find(c => slotForRole(c.role) === slot)?.id ?? null) : null;
  const dresses = pick('dresses');
  return {
    hats: pick('hats'),
    jackets: pick('jackets'),
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
  wanted: Set<Slot>,
  apiKey: string,
): Promise<{ outfit: Outfit; rationale: string }> {
  const list = candidates
    .map(c => `${c.id} | ${c.role || 'item'} | ${[c.brand, c.name].filter(Boolean).join(' ')}${c.price ? ` | ${c.price}` : ''}${c.context ? ` — ${c.context}` : ''}`)
    .join('\n');

  // Strong gender guidance — never put a man in women's pieces (or vice-versa).
  const genderRule = gender === 'male'
    ? 'The shopper is a MAN. Choose ONLY menswear or genuinely unisex pieces. NEVER pick dresses, skirts, gowns, blouses, heels, pumps, or any women\'s-cut garment. If a piece reads as women\'s (e.g. "thong sandal", "stiletto", "heel", "blouse", "gown"), it is FORBIDDEN — skip it entirely. Leave "dresses" null.'
    : gender === 'female'
      ? 'The shopper is a WOMAN. Choose only womenswear or genuinely unisex pieces. NEVER pick men\'s-specific garments.'
      : 'The shopper\'s gender is unspecified — favor unisex pieces.';

  // Only the slots the shopper requested get filled; the rest must stay null.
  const requestedList = ALL_SLOTS.filter(s => wanted.has(s)).join(', ');
  const slotsRule = `The shopper ONLY wants these slots filled: ${requestedList}. Every OTHER slot MUST be null, even if good options exist.`;

  const prompt = `You are a sharp personal stylist assembling ONE cohesive outfit for a real shopper.

OCCASION (what they want to wear / be doing): "${occasion}"
SHOPPER GENDER: ${gender}
GENDER RULE: ${genderRule}
REQUESTED SLOTS: ${slotsRule}

STEP 1 — Read the occasion. In your head, infer formality, season, setting and a
coherent palette/aesthetic.

STEP 2 — Assemble ONE outfit from the AVAILABLE PRODUCTS below (and ONLY these).
Each line is: id | role | brand name | price | description.
Rules:
  • Fill ONLY the REQUESTED SLOTS above. Leave every non-requested slot null.
  • For each requested slot pick ONE item of the matching role: Hat→hats,
    Jacket/outerwear→jackets, Top→tops, Pants/skirt→bottoms, Shoes→shoes,
    Dress→dresses.
  • A Dress replaces a top+bottom: if "dresses" is requested AND you pick one,
    leave tops and bottoms null.
  • Footwear (sneaker, boot, heel, sandal, loafer) is ALWAYS the shoes slot —
    NEVER place footwear in tops. Outerwear (jacket, coat, blazer, hoodie) is the
    jackets slot — never tops.
  • Everything must work together — color, formality, and season coherent.
  • Obey the GENDER RULE above without exception.
  • Choose only ids that appear in the list. Never invent an id.
  • If a requested slot has no good option, set it to null rather than forcing a
    bad pick.

AVAILABLE PRODUCTS:
${list}

For "rationale", write a short, warm narrative paragraph (about 2 to 4
sentences) explaining why THIS specific outfit was chosen for THIS shopper.
Reference the occasion and vibe, and name the actual pieces you picked and how
they work together (palette, formality, season). Speak to the shopper directly,
like a stylist who is excited about the look. Keep it concise and readable. Do
not use em dashes.

Return ONLY JSON, no prose or code fences:
{"hats": "<id|null>", "jackets": "<id|null>", "tops": "<id|null>", "dresses": "<id|null>", "bottoms": "<id|null>", "shoes": "<id|null>", "rationale": "<a short, warm 2 to 4 sentence paragraph on why this specific look was chosen for the occasion, naming the chosen pieces>"}`;

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

  // Validate every chosen id against the candidate set, its role, the requested
  // slots, AND gender — so a hallucinated id, an off-slot item (e.g. footwear
  // landing in tops), a non-requested slot, or a women's piece slipped to a man
  // never reaches the client.
  const byId = new Map(candidates.map(c => [c.id, c]));
  const pick = (v: unknown, slot: Slot): string | null => {
    if (!wanted.has(slot)) return null;
    const s = typeof v === 'string' ? v.trim() : '';
    if (!s || s === 'null') return null;
    const c = byId.get(s);
    if (!c) return null;
    if (slotForRole(c.role) !== slot) return null;
    if (!allowedForGender(c, gender)) return null;
    return s;
  };
  const outfit: Outfit = {
    hats: pick(parsed.hats, 'hats'),
    jackets: pick(parsed.jackets, 'jackets'),
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
    const rawCandidates: Candidate[] = Array.isArray(body.candidates)
      ? (body.candidates as Candidate[]).filter(c => c && typeof c.id === 'string').slice(0, 180)
      : [];

    // Which slots the shopper asked to fill. Empty / missing → all slots, so an
    // older client that doesn't send `slots` keeps the prior behaviour. A male
    // shopper never gets the dresses slot regardless of what was requested.
    const requested = Array.isArray(body.slots)
      ? (body.slots as unknown[]).filter((s): s is Slot => typeof s === 'string' && (ALL_SLOTS as string[]).includes(s))
      : [];
    const wanted = new Set<Slot>(requested.length ? requested : ALL_SLOTS);
    if (gender === 'male') wanted.delete('dresses');

    // GENDER GATE — drop off-gender candidates BEFORE the model ever sees them,
    // so a women's heel can't be picked or even suggested as an alternative.
    const candidates = rawCandidates.filter(c => allowedForGender(c, gender));

    if (!occasion) return jsonRes({ success: false, error: 'missing occasion' }, 400);
    if (candidates.length === 0) return jsonRes({ success: false, error: 'no candidates' }, 400);

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY') || '';
    if (!apiKey) {
      return jsonRes({ success: true, outfit: heuristicOutfit(candidates, wanted), rationale: '', source: 'heuristic' });
    }

    try {
      const { outfit, rationale } = await styleWithClaude(occasion, gender, candidates, wanted, apiKey);
      return jsonRes({ success: true, outfit, rationale, source: 'claude' });
    } catch (err) {
      console.warn('[ai-stylist] Claude failed, falling back:', err);
      return jsonRes({ success: true, outfit: heuristicOutfit(candidates, wanted), rationale: '', source: 'heuristic' });
    }
  } catch (err) {
    return jsonRes({ success: false, error: err instanceof Error ? err.message : 'stylist failed' }, 500);
  }
});

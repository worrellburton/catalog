// embed-entity — generates a semantic concept document + embedding for a
// single entity (product_creative or look row) and writes it back to the DB.
//
// Two-step per entity:
//   1. Claude Haiku             → concept_doc (factual semantic description) + concept_facets JSON
//   2. OpenAI text-embedding-3-small (1536-dim) → text_embedding
//
// Required Supabase secrets:
//   ANTHROPIC_API_KEY   — Claude Haiku for concept generation
//   OPENAI_API_KEY      — text-embedding-3-small (1536-dim)
//
// Request body:
//   { id: string, entity_type: 'creative' | 'look' | 'product', force?: boolean }
//
// entity_type='creative': reads product_creative joined to products, writes back
//   to product_creative.{concept_doc, concept_facets, text_embedding, concept_at}.
// entity_type='look': reads looks joined to its products via look_products, writes
//   back to looks.{concept_doc, concept_facets, text_embedding, concept_at}.
// entity_type='product': reads products row, writes back to
//   products.{concept_doc, concept_facets, text_embedding, concept_at}.
//
// All entity types route the concept-generation system prompt by the
// product's `category` (fashion / beauty / home / tech / lifestyle / other)
// so non-fashion items don't get hallucinated outfit copy.
//
// force=true regenerates even if concept_doc already exists.
//
// IMPORTANT — concept_doc must be a FACTUAL description, not a query bait
// list. Earlier versions of this prompt seeded example shopper phrases
// ("summer outfit", "date night look") which Claude obediently injected into
// every doc, polluting BM25 with verbatim matches on items that didn't
// actually fit the query. Keep the prompt descriptive only.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// ── Claude: concept_doc + facets ─────────────────────────────────────────────

interface ConceptResult {
  concept_doc: string;
  concept_facets: {
    garment_type: string;
    color_family: string[];
    occasion: string[];
    style_tags: string[];
    formality_score: number;
  };
  /**
   * Shopper-language facet phrases — short comma-joined list of plausible
   * occasions, seasons, and vibes (e.g. "date night, evening out, dinner;
   * spring, summer; minimal, polished"). Indexed at BM25 weight C in the
   * search RPCs so queries like "date night" or "summer outfit" hit the
   * index without polluting the factual concept_doc. Also appended to the
   * embedding input so dense vectors incorporate the same shopper signal.
   */
  facet_text: string;
}

type EntityType = 'creative' | 'look' | 'product';
type Category = 'fashion' | 'beauty' | 'home' | 'tech' | 'lifestyle' | 'other';

const VALID_CATEGORIES: Set<Category> = new Set(['fashion', 'beauty', 'home', 'tech', 'lifestyle', 'other']);
function normalizeCategory(c: unknown): Category {
  if (typeof c === 'string' && VALID_CATEGORIES.has(c as Category)) return c as Category;
  return 'other';
}

// Per-category indexer prompts. The shared invariant: write a FACTUAL doc
// describing what the item IS, who it's for, and realistic use cases. Never
// invent occasions or pad with synonyms — the doc feeds both BM25 and the
// dense embedding, so accuracy beats coverage.
function systemPromptFor(category: Category, entityType: EntityType): string {
  if (entityType === 'look') {
    return `You are a fashion search indexer. Write a FACTUAL semantic document for a shoppable outfit look — a curated set of fashion items worn together. Describe the overall aesthetic, the key garments and their colours, who the look is designed for, and the realistic occasions it suits. Do NOT invent occasions; do NOT list speculative shopper search phrases; do NOT pad with synonyms.`;
  }
  const subject = entityType === 'product' ? 'a single product in our shoppable catalog' : 'a short shoppable video creative for a single product';
  switch (category) {
    case 'fashion':
      return `You are a fashion catalog search indexer. Write a FACTUAL semantic document for ${subject}. Describe what the product IS (garment type, colour, material), the body part it covers, and the realistic occasions it suits. Do NOT invent occasions; do NOT list shopper search phrases; do NOT pad with synonyms. If an item is underwear, it is underwear — do not also call it a "summer outfit".`;
    case 'beauty':
      return `You are a beauty & personal-care catalog search indexer. Write a FACTUAL semantic document for ${subject}. Describe what the product IS (category — e.g. fragrance, hair cream, skincare serum, lipstick), key ingredients or scent notes, the body part / hair type / skin type it targets, and the realistic use cases. Do NOT call beauty products "outfits" or list fashion occasions. Do NOT pad with synonyms.`;
    case 'home':
      return `You are a home-goods catalog search indexer. Write a FACTUAL semantic document for ${subject}. Describe what the product IS (category — e.g. candle, throw blanket, lamp, kitchenware), the room it belongs in, the material / scent / finish, and the realistic use cases. Do NOT use fashion vocabulary (no "outfit", "wear", "styling"). Do NOT pad with synonyms.`;
    case 'tech':
      return `You are a tech & gadget catalog search indexer. Write a FACTUAL semantic document for ${subject}. Describe what the product IS (category — e.g. headphones, charger, smart speaker), the key specs or features, the user it's designed for, and the realistic use cases. Do NOT use fashion vocabulary. Do NOT pad with synonyms.`;
    case 'lifestyle':
      return `You are a lifestyle catalog search indexer. Write a FACTUAL semantic document for ${subject} (book, fitness, wellness, travel, food, hobby item). Describe what the product IS, the genre / discipline / use case, and who it's designed for. Do NOT use fashion vocabulary. Do NOT pad with synonyms.`;
    default:
      return `You are a catalog search indexer. Write a FACTUAL semantic document for ${subject}. Describe what the product IS, who it's designed for, and the realistic use cases based on the product itself. Do NOT invent uses; do NOT list speculative shopper search phrases; do NOT pad with synonyms; do NOT use fashion vocabulary unless the item is actually clothing.`;
  }
}

function userPromptFor(category: Category, entityType: EntityType, inputTruncated: string): string {
  // Shared facet_text guidance — included in every prompt so every entity
  // gets shopper-language phrases alongside the factual concept_doc.
  const facetTextRules = `\n- "facet_text": comma-joined list of 6-12 SHORT shopper-language phrases that real users would type when searching for this item. Include realistic occasions, seasons, settings, vibes, and use cases. Examples for a fashion item: "date night, dinner out, evening, going out, weekend, fall, winter, minimal, elevated casual, smart casual". Examples for a candle: "home decor, living room, bedroom, gift, cosy, autumn, winter, evening, relaxation, mood lighting". Examples for a fragrance: "date night, evening, going out, fall, winter, sensual, warm, gift, signature scent, cocktail party". Be specific to what the item ACTUALLY is — never invent a use case the item doesn't suit (e.g. don't write "summer outfit" for a wool coat). 6-12 phrases, comma-separated, lowercase, no quotes, no full sentences.`;

  if (entityType === 'look') {
    return `Generate a factual semantic document for this shoppable outfit look:\n\n${inputTruncated}\n\nOutput a JSON object with exactly these keys:\n- "concept_doc": 2-4 sentences. Cover (1) the overall aesthetic or vibe of the look; (2) the key garments, their colours and materials; (3) who it is designed for; (4) realistic occasions. Write plain descriptive prose.\n- "concept_facets": {"garment_type":"...","color_family":["..."],"occasion":["..."],"style_tags":["..."],"formality_score":0.0-1.0}${facetTextRules}\n\nRespond with ONLY the JSON object, no other text.`;
  }
  const facetHint =
    category === 'fashion'
      ? `"garment_type":"...","color_family":["..."],"occasion":["..."],"style_tags":["..."],"formality_score":0.0-1.0`
      : category === 'beauty'
        ? `"product_kind":"e.g. fragrance / hair cream / skincare","target":["hair / face / body / scent notes"],"use_cases":["..."],"style_tags":["..."],"formality_score":0.0-1.0`
        : category === 'home'
          ? `"product_kind":"e.g. candle / blanket / lamp","room":["living / bedroom / kitchen"],"use_cases":["..."],"style_tags":["..."],"formality_score":0.0-1.0`
          : category === 'tech'
            ? `"product_kind":"e.g. headphones / charger","features":["..."],"use_cases":["..."],"style_tags":["..."],"formality_score":0.0-1.0`
            : category === 'lifestyle'
              ? `"product_kind":"e.g. book / yoga mat / supplement","discipline":["..."],"use_cases":["..."],"style_tags":["..."],"formality_score":0.0-1.0`
              : `"product_kind":"...","attributes":["..."],"use_cases":["..."],"style_tags":["..."],"formality_score":0.0-1.0`;
  return `Generate a factual semantic document for this catalog item:\n\n${inputTruncated}\n\nOutput a JSON object with exactly these keys:\n- "concept_doc": 2-4 sentences. Cover (1) what the product IS — its category, key attributes, materials/scent/specs as appropriate; (2) who it's designed for; (3) the realistic use cases based on the product itself, not aspirational stretches. Write plain descriptive prose. Do NOT list shopper search phrases. Do NOT use fashion vocabulary unless the item is actually clothing.\n- "concept_facets": {${facetHint}}${facetTextRules}\n\nRespond with ONLY the JSON object, no other text.`;
}

async function generateConcept(
  input: string,
  entityType: EntityType,
  category: Category,
  anthropicKey: string
): Promise<ConceptResult> {
  const inputTruncated = input.length > 1500 ? input.slice(0, 1500) + '…' : input;
  const systemPrompt = systemPromptFor(category, entityType);
  const userPrompt = userPromptFor(category, entityType, inputTruncated);

  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 900,
        messages: [{ role: 'user', content: userPrompt }],
        system: systemPrompt,
      }),
    });
  } catch (err) {
    // Network failure → degrade to heuristic, never block the embed pipeline.
    console.warn('[embed-entity] anthropic fetch failed, using heuristic:', err);
    return heuristicConcept(input, entityType, category);
  }

  if (!res.ok) {
    // 4xx (e.g. credit exhausted) and 5xx → degrade. Better to ship a
    // heuristic concept_doc than to mark the row as un-embedded forever.
    const text = await res.text().catch(() => '');
    console.warn(`[embed-entity] anthropic ${res.status}, using heuristic: ${text.slice(0, 200)}`);
    return heuristicConcept(input, entityType, category);
  }

  const json = await res.json() as { content?: Array<{ type: string; text?: string }> };
  const text = json.content?.find(b => b.type === 'text')?.text ?? '';

  // Strip potential markdown code fences before parsing
  const cleaned = text.replace(/^```json?\s*/i, '').replace(/\s*```$/, '').trim();

  // If Claude refused or returned prose instead of JSON, fall back to heuristic
  try {
    const parsed = JSON.parse(cleaned) as Partial<ConceptResult>;
    if (!parsed.concept_doc || !parsed.concept_facets) {
      throw new Error('incomplete');
    }
    // facet_text is best-effort: if Haiku omits it, derive from concept_facets
    // so the column always has something useful to index. Also normalise (lowercase,
    // trim, dedupe phrases).
    const facet_text = normaliseFacetText(
      parsed.facet_text,
      parsed.concept_facets as ConceptResult['concept_facets'],
    );
    return {
      concept_doc: parsed.concept_doc,
      concept_facets: parsed.concept_facets as ConceptResult['concept_facets'],
      facet_text,
    };
  } catch {
    return heuristicConcept(input, entityType, category);
  }
}

// Normalise Haiku's facet_text into a clean, lowercase, deduped, comma-joined
// phrase list. Falls back to deriving phrases from concept_facets when Haiku
// omits the field (e.g. when it returns the older two-key schema).
function normaliseFacetText(raw: unknown, facets: ConceptResult['concept_facets']): string {
  let phrases: string[] = [];
  if (typeof raw === 'string' && raw.trim().length > 0) {
    phrases = raw.split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
  } else if (Array.isArray(raw)) {
    phrases = raw.map(p => String(p).trim()).filter(Boolean);
  }
  if (phrases.length === 0 && facets) {
    // Derive a minimal facet_text from concept_facets so the column is never
    // null on a successful Haiku response.
    phrases = [
      ...(Array.isArray(facets.occasion) ? facets.occasion : []),
      ...(Array.isArray(facets.style_tags) ? facets.style_tags : []),
      ...(Array.isArray(facets.color_family) ? facets.color_family : []),
    ].map(s => String(s).trim()).filter(Boolean);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of phrases) {
    const k = p.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!k || k.length > 60 || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
    if (out.length >= 16) break;
  }
  return out.join(', ');
}

// Fallback when Claude refuses or returns non-JSON.
//
// Bad fallbacks are worse than no fallback: if every refused product gets the
// same boilerplate ("A versatile piece suitable for a range of occasions"),
// they all collapse into the same vector cluster and pollute every search.
// Instead, mine the raw fields (name, brand, type, description) for concrete
// signals — garment type, color, gender, formality, occasion — so each
// fallback row gets a distinctive concept_doc that still reads naturally.

const GARMENT_PATTERNS: Array<[RegExp, string]> = [
  [/\b(t-?shirt|tee|tank top|polo|henley|crew\s*neck)\b/i, 't-shirt'],
  [/\b(button[- ]?down|button[- ]?up|oxford shirt|dress shirt|blouse|shirt)\b/i, 'shirt'],
  [/\b(hoodie|sweatshirt|crewneck sweater|sweater|cardigan|jumper|pullover|knit)\b/i, 'sweater'],
  [/\b(jacket|blazer|coat|trench|parka|puffer|bomber|peacoat|overcoat)\b/i, 'jacket'],
  [/\b(jeans|denim)\b/i, 'jeans'],
  [/\b(trousers?|chinos|slacks|pants|cargos?|joggers?|sweatpants|leggings)\b/i, 'pants'],
  [/\b(shorts)\b/i, 'shorts'],
  [/\b(skirt|midi skirt|maxi skirt|mini skirt)\b/i, 'skirt'],
  [/\b(dress|gown|maxi|midi)\b/i, 'dress'],
  [/\b(jumpsuit|romper|playsuit)\b/i, 'jumpsuit'],
  [/\b(sneakers?|trainers?|kicks)\b/i, 'sneakers'],
  [/\b(boots?|booties?|chelseas?)\b/i, 'boots'],
  [/\b(heels?|pumps?|stilettos?)\b/i, 'heels'],
  [/\b(loafers?|mules?|slides?|sandals?|flats?)\b/i, 'shoes'],
  [/\b(bag|tote|backpack|clutch|crossbody|satchel|purse)\b/i, 'bag'],
  [/\b(belt|scarf|hat|beanie|cap|sunglasses|jewellery|jewelry|necklace|earrings?|ring|watch)\b/i, 'accessory'],
  [/\b(swim(suit|wear)?|bikini|trunks)\b/i, 'swimwear'],
  [/\b(suit|tuxedo)\b/i, 'suit'],
];

const COLOR_PATTERNS: Array<[RegExp, string]> = [
  [/\b(black|jet|onyx|noir)\b/i, 'black'],
  [/\b(white|ivory|cream|ecru|off[- ]white)\b/i, 'white'],
  [/\b(grey|gray|charcoal|slate|graphite)\b/i, 'grey'],
  [/\b(navy|midnight blue|indigo)\b/i, 'navy'],
  [/\b(blue|cobalt|sapphire|cerulean|sky blue|powder blue)\b/i, 'blue'],
  [/\b(red|crimson|scarlet|burgundy|maroon|wine)\b/i, 'red'],
  [/\b(pink|blush|rose|fuchsia|magenta|coral)\b/i, 'pink'],
  [/\b(green|olive|sage|forest|emerald|mint|khaki)\b/i, 'green'],
  [/\b(yellow|mustard|gold|ochre|amber)\b/i, 'yellow'],
  [/\b(orange|rust|terracotta|tangerine)\b/i, 'orange'],
  [/\b(purple|lilac|lavender|violet|plum)\b/i, 'purple'],
  [/\b(brown|tan|camel|cognac|chocolate|espresso|taupe|beige|nude|sand)\b/i, 'brown'],
  [/\b(silver|metallic|chrome)\b/i, 'silver'],
];

const FORMAL_KEYWORDS = /\b(suit|tuxedo|gown|formal|cocktail|evening|black tie|dressy|tailored|wedding|red carpet)\b/i;
const CASUAL_KEYWORDS = /\b(joggers?|sweatpants|hoodie|tee|t-shirt|sneakers?|loungewear|athleisure|relaxed|casual|everyday)\b/i;

function heuristicConcept(input: string, _entityType: EntityType, category: Category = 'fashion'): ConceptResult {
  const lines = input.split('\n');
  const get = (prefix: string) =>
    lines.find(l => l.startsWith(prefix))?.slice(prefix.length).trim() ?? '';

  const name  = get('Product:') || get('Name:') || '';
  const brand = get('Brand:');
  const type  = get('Type:');
  const desc  = get('Description:');
  const gender = get('Gender:').toLowerCase();

  // Non-fashion fallback: write a generic, factual line that doesn't pretend
  // the item is clothing. Each row still gets distinctive content via the
  // name / brand / type / description verbatim (no fashion-only regex).
  if (category !== 'fashion') {
    const brandPhrase = brand ? ` from ${brand}` : '';
    const typePhrase = type ? ` — a ${type.toLowerCase()}` : '';
    const descPhrase = desc ? ' ' + desc.slice(0, 220) : '';
    const concept_doc = `${name || 'This catalog item'}${brandPhrase}${typePhrase}.${descPhrase}`.trim();
    return {
      concept_doc,
      concept_facets: {
        garment_type: type || category,
        color_family: [],
        occasion: [],
        style_tags: [category],
        formality_score: 0.5,
      },
      facet_text: heuristicFacetText(category, type, name),
    };
  }

  const corpus = [name, type, desc].filter(Boolean).join(' ');

  // Garment type
  let garment = 'clothing';
  for (const [re, g] of GARMENT_PATTERNS) {
    if (re.test(corpus)) { garment = g; break; }
  }

  // Colors (multiple allowed)
  const colorSet = new Set<string>();
  for (const [re, c] of COLOR_PATTERNS) {
    if (re.test(corpus)) colorSet.add(c);
  }
  const colors = Array.from(colorSet).slice(0, 3);

  // Formality
  const formality = FORMAL_KEYWORDS.test(corpus) ? 0.85
                  : CASUAL_KEYWORDS.test(corpus) ? 0.25
                  : 0.5;

  // Occasion suggestions derived from formality
  const occasions = formality > 0.7  ? ['formal', 'evening', 'special occasion']
                  : formality < 0.35 ? ['casual', 'everyday', 'weekend']
                  : ['casual', 'work', 'going out'];

  // Style tags from common buzzwords
  const styleTags: string[] = [];
  const styleHits: Array<[RegExp, string]> = [
    [/\b(minimal|minimalist|clean|simple)\b/i, 'minimalist'],
    [/\b(quiet luxury|stealth wealth|elevated)\b/i, 'quiet luxury'],
    [/\b(streetwear|street|urban|grunge)\b/i, 'streetwear'],
    [/\b(vintage|retro|y2k|nineties|90s|80s)\b/i, 'vintage'],
    [/\b(classic|timeless|preppy|heritage)\b/i, 'classic'],
    [/\b(bohemian|boho|coastal|cottagecore)\b/i, 'bohemian'],
    [/\b(athleisure|sporty|athletic|active)\b/i, 'sporty'],
    [/\b(romantic|feminine|girly|pretty|floral)\b/i, 'romantic'],
    [/\b(edgy|punk|gothic|leather)\b/i, 'edgy'],
  ];
  for (const [re, t] of styleHits) {
    if (re.test(corpus)) styleTags.push(t);
  }

  // Build a varied, descriptive concept_doc that won't collapse into one cluster
  const colorPhrase = colors.length ? colors.join(' and ') + ' ' : '';
  const brandPhrase = brand ? ` from ${brand}` : '';
  const stylePhrase = styleTags.length ? ` It has a ${styleTags.slice(0, 2).join(' and ')} aesthetic.` : '';
  const occasionPhrase = ` Suited to ${occasions.join(', ')} settings.`;
  const genderPhrase = gender && gender !== 'unisex' ? ` Designed for ${gender}.` : '';

  const concept_doc =
    `A short shoppable video featuring ${name || 'this piece'}${brandPhrase} — a ${colorPhrase}${garment}.${stylePhrase}${occasionPhrase}${genderPhrase}${desc ? ' ' + desc.slice(0, 200) : ''}`.trim();

  return {
    concept_doc,
    concept_facets: {
      garment_type: garment,
      color_family: colors,
      occasion: occasions,
      style_tags: styleTags,
      formality_score: formality,
    },
    facet_text: normaliseFacetText(
      [...occasions, ...styleTags, ...colors, garment].join(', '),
      undefined as unknown as ConceptResult['concept_facets'],
    ),
  };
}

// Lightweight per-category fallback phrases when Haiku is unavailable AND
// the heuristic has nothing to derive from. Better than an empty facet_text
// because the BM25 lane still has *something* to match against.
function heuristicFacetText(category: Category, type: string, name: string): string {
  const base: string[] = [];
  if (type) base.push(type.toLowerCase());
  if (category === 'beauty') base.push('self care', 'wellness', 'gift', 'everyday');
  else if (category === 'home') base.push('home decor', 'gift', 'cosy', 'styling');
  else if (category === 'tech') base.push('gadget', 'gift', 'everyday');
  else if (category === 'lifestyle') base.push('gift', 'hobby', 'everyday');
  else if (category === 'fashion') base.push('everyday', 'casual', 'going out');
  if (name) {
    const words = name.toLowerCase().split(/\s+/).slice(0, 3);
    base.push(...words);
  }
  return normaliseFacetText(base.join(', '), undefined as unknown as ConceptResult['concept_facets']);
}

// ── OpenAI: text embedding (text-embedding-3-small, 1536-dim) ──────────────

/**
 * Build the input string fed to the embedding model. concept_doc is the
 * factual core; facet_text appends shopper-language phrases so the resulting
 * vector incorporates "date night / summer outfit / cosy" signal alongside
 * the factual description. Keeps both lanes (dense + BM25) consistent.
 */
function buildEmbeddingInput(concept: ConceptResult): string {
  if (!concept.facet_text) return concept.concept_doc;
  return `${concept.concept_doc}\n\nShoppers search for this with: ${concept.facet_text}.`;
}

async function embedText(text: string, openaiKey: string): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI embed error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const json = await res.json() as { data?: Array<{ embedding?: number[] }> };
  const embedding = json.data?.[0]?.embedding;
  if (!embedding?.length) throw new Error('OpenAI returned empty embedding');
  return embedding;
}

function toPgVector(v: number[]): string {
  return '[' + v.join(',') + ']';
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonRes({ ok: false, error: 'Use POST' }, 405);

  const supabaseUrl    = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const anthropicKey   = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  const openaiKey      = Deno.env.get('OPENAI_API_KEY') ?? '';

  if (!supabaseUrl || !serviceKey) return jsonRes({ ok: false, error: 'Supabase env missing' }, 500);
  if (!anthropicKey)   return jsonRes({ ok: false, error: 'ANTHROPIC_API_KEY missing' }, 500);
  if (!openaiKey)      return jsonRes({ ok: false, error: 'OPENAI_API_KEY missing' }, 500);

  let body: { id?: string; entity_type?: string; force?: boolean };
  try { body = await req.json(); } catch { return jsonRes({ ok: false, error: 'Invalid JSON' }, 400); }

  const { id, entity_type = 'creative', force = false } = body;
  if (!id) return jsonRes({ ok: false, error: 'id required' }, 400);
  if (entity_type !== 'creative' && entity_type !== 'look' && entity_type !== 'product') {
    return jsonRes({ ok: false, error: 'entity_type must be "creative", "look" or "product"' }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey);

  // ── Route to the appropriate handler ────────────────────────────────────
  if (entity_type === 'look')    return handleLook(id, force, admin, anthropicKey, openaiKey);
  if (entity_type === 'product') return handleProduct(id, force, admin, anthropicKey, openaiKey);
  return handleCreative(id, force, admin, anthropicKey, openaiKey);
});

// ── Creative handler ─────────────────────────────────────────────────────────
async function handleCreative(
  id: string,
  force: boolean,
  admin: ReturnType<typeof createClient>,
  anthropicKey: string,
  openaiKey: string,
): Promise<Response> {
  const { data: row, error: fetchErr } = await admin
    .from('product_creative')
    .select('id, style, prompt, prompt_extra, title, description, concept_doc, concept_facets, concept_at, product:products(id, name, brand, description, price, type, gender, category)')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr) return jsonRes({ ok: false, error: fetchErr.message }, 500);
  if (!row)     return jsonRes({ ok: false, error: 'creative not found' }, 404);

  // Skip only when fully embedded (concept_at is set when both concept_doc and
  // text_embedding have been written). If concept_doc exists but concept_at is
  // null the embedding step was never completed — fall through to re-run it
  // without calling Anthropic again.
  if (!force && row.concept_doc && (row as Record<string, unknown>).concept_at) {
    return jsonRes({ ok: true, skipped: 'already embedded', id });
  }

  const p = (row as Record<string, unknown>).product as Record<string, unknown> | null;
  if (!p) return jsonRes({ ok: false, error: 'creative is missing joined product' }, 400);
  const category = normalizeCategory((p as { category?: unknown }).category);

  // Concept generation: skip Anthropic when concept_doc is already set.
  let concept: ConceptResult;
  if (!force && row.concept_doc) {
    concept = {
      concept_doc: row.concept_doc as string,
      concept_facets: ((row as Record<string, unknown>).concept_facets as ConceptResult['concept_facets'])
        ?? { garment_type: '', color_family: [], occasion: [], style_tags: [], formality_score: 0.5 },
      facet_text: ((row as Record<string, unknown>).facet_text as string | null) ?? '',
    };
  } else {
    const inputStr = [
      `Product: ${p.name ?? 'Unknown'}`,
      p.brand       ? `Brand: ${p.brand}` : null,
      p.type        ? `Type: ${p.type}` : null,
      p.price       ? `Price: ${p.price}` : null,
      p.gender      ? `Gender: ${p.gender}` : null,
      p.description ? `Description: ${p.description}` : null,
      row.style          ? `Creative style: ${row.style}` : null,
      row.prompt         ? `Generation prompt: ${row.prompt}` : null,
      row.prompt_extra   ? `Prompt notes: ${row.prompt_extra}` : null,
      row.title          ? `Creative title: ${row.title}` : null,
      row.description    ? `Creative description: ${row.description}` : null,
    ].filter(Boolean).join('\n');
    try { concept = await generateConcept(inputStr, 'creative', category, anthropicKey); }
    catch (err) { return jsonRes({ ok: false, stage: 'concept_generation', error: String(err) }, 502); }
  }

  let embedding: number[];
  try { embedding = await embedText(buildEmbeddingInput(concept), openaiKey); }
  catch (err) { return jsonRes({ ok: false, stage: 'embedding', error: String(err) }, 502); }

  const { error: updateErr } = await admin
    .from('product_creative')
    .update({
      concept_doc:    concept.concept_doc,
      concept_facets: concept.concept_facets,
      facet_text:     concept.facet_text,
      concept_at:     new Date().toISOString(),
      text_embedding: toPgVector(embedding),
    })
    .eq('id', id);

  if (updateErr) return jsonRes({ ok: false, stage: 'db_update', error: updateErr.message }, 500);
  return jsonRes({ ok: true, id, entity_type: 'creative', category, concept_doc_length: concept.concept_doc.length });
}

// ── Product handler ─────────────────────────────────────────────────────────
async function handleProduct(
  id: string,
  force: boolean,
  admin: ReturnType<typeof createClient>,
  anthropicKey: string,
  openaiKey: string,
): Promise<Response> {
  const { data: p, error: fetchErr } = await admin
    .from('products')
    .select('id, name, brand, description, price, type, gender, category, concept_doc, concept_facets, concept_at')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr) return jsonRes({ ok: false, error: fetchErr.message }, 500);
  if (!p)       return jsonRes({ ok: false, error: 'product not found' }, 404);

  const r = p as Record<string, unknown>;
  // Skip only when fully embedded.
  if (!force && r.concept_doc && r.concept_at) {
    return jsonRes({ ok: true, skipped: 'already embedded', id });
  }

  const category = normalizeCategory((p as { category?: unknown }).category);

  // Concept generation: skip Anthropic when concept_doc is already set.
  let concept: ConceptResult;
  if (!force && r.concept_doc) {
    concept = {
      concept_doc: r.concept_doc as string,
      concept_facets: (r.concept_facets as ConceptResult['concept_facets'])
        ?? { garment_type: '', color_family: [], occasion: [], style_tags: [], formality_score: 0.5 },
      facet_text: (r.facet_text as string | null) ?? '',
    };
  } else {
    const inputStr = [
      `Product: ${r.name ?? 'Unknown'}`,
      r.brand       ? `Brand: ${r.brand}` : null,
      r.type        ? `Type: ${r.type}` : null,
      r.price       ? `Price: ${r.price}` : null,
      r.gender      ? `Gender: ${r.gender}` : null,
      r.description ? `Description: ${r.description}` : null,
    ].filter(Boolean).join('\n');
    try { concept = await generateConcept(inputStr, 'product', category, anthropicKey); }
    catch (err) { return jsonRes({ ok: false, stage: 'concept_generation', error: String(err) }, 502); }
  }

  let embedding: number[];
  try { embedding = await embedText(buildEmbeddingInput(concept), openaiKey); }
  catch (err) { return jsonRes({ ok: false, stage: 'embedding', error: String(err) }, 502); }

  const { error: updateErr } = await admin
    .from('products')
    .update({
      concept_doc:    concept.concept_doc,
      concept_facets: concept.concept_facets,
      facet_text:     concept.facet_text,
      concept_at:     new Date().toISOString(),
      text_embedding: toPgVector(embedding),
    })
    .eq('id', id);

  if (updateErr) return jsonRes({ ok: false, stage: 'db_update', error: updateErr.message }, 500);
  return jsonRes({ ok: true, id, entity_type: 'product', category, concept_doc_length: concept.concept_doc.length });
}

// ── Look handler ─────────────────────────────────────────────────────────────
async function handleLook(
  id: string,
  force: boolean,
  admin: ReturnType<typeof createClient>,
  anthropicKey: string,
  openaiKey: string,
): Promise<Response> {
  // Fetch the look with its tagged products via look_products junction.
  const { data: look, error: lookErr } = await admin
    .from('looks')
    .select('id, title, creator_handle, description, gender, concept_doc, concept_facets, concept_at, look_products(product:products(name, brand, type, description))')
    .eq('id', id)
    .maybeSingle();

  if (lookErr) return jsonRes({ ok: false, error: lookErr.message }, 500);
  if (!look)   return jsonRes({ ok: false, error: 'look not found' }, 404);

  const l = look as Record<string, unknown>;
  // Skip only when fully embedded.
  if (!force && l.concept_doc && l.concept_at) {
    return jsonRes({ ok: true, skipped: 'already embedded', id });
  }

  // Build input string: look metadata + its products
  const lpRows = (l.look_products as Array<Record<string, unknown>> | null) ?? [];
  const productLines = lpRows
    .map(lp => {
      const p = (lp.product as Record<string, unknown> | null);
      if (!p) return null;
      return [p.name, p.brand, p.type].filter(Boolean).join(' · ');
    })
    .filter(Boolean)
    .slice(0, 10);

  // Concept generation: skip Anthropic when concept_doc is already set.
  let concept: ConceptResult;
  if (!force && l.concept_doc) {
    concept = {
      concept_doc: l.concept_doc as string,
      concept_facets: (l.concept_facets as ConceptResult['concept_facets'])
        ?? { garment_type: '', color_family: [], occasion: [], style_tags: [], formality_score: 0.5 },
      facet_text: (l.facet_text as string | null) ?? '',
    };
  } else {
    const inputStr = [
      l.title       ? `Look title: ${l.title}` : null,
      l.creator_handle ? `Creator: ${l.creator_handle}` : null,
      l.description ? `Description: ${l.description}` : null,
      l.gender      ? `Gender: ${l.gender}` : null,
      productLines.length ? `Products in look:\n${productLines.map(s => `  • ${s}`).join('\n')}` : null,
    ].filter(Boolean).join('\n');
    try { concept = await generateConcept(inputStr, 'look', 'fashion', anthropicKey); }
    catch (err) { return jsonRes({ ok: false, stage: 'concept_generation', error: String(err) }, 502); }
  }

  let embedding: number[];
  try { embedding = await embedText(buildEmbeddingInput(concept), openaiKey); }
  catch (err) { return jsonRes({ ok: false, stage: 'embedding', error: String(err) }, 502); }

  const { error: updateErr } = await admin
    .from('looks')
    .update({
      concept_doc:    concept.concept_doc,
      concept_facets: concept.concept_facets,
      facet_text:     concept.facet_text,
      concept_at:     new Date().toISOString(),
      text_embedding: toPgVector(embedding),
    })
    .eq('id', id);

  if (updateErr) return jsonRes({ ok: false, stage: 'db_update', error: updateErr.message }, 500);
  return jsonRes({ ok: true, id, entity_type: 'look', concept_doc_length: concept.concept_doc.length });
}



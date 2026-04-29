// embed-entity — generates a semantic concept document + embeddings for a
// single product or look and writes them back to the DB.
//
// Two-step per entity:
//   1. Claude Haiku             → concept_doc (rich semantic description) + concept_facets JSON
//   2. TwelveLabs Marengo-retrieval-2.7 text embed (1024-dim) → text_embedding
//
// Required Supabase secrets:
//   ANTHROPIC_API_KEY   — Claude Haiku for concept generation
//   TWELVELABS_API_KEY  — Marengo-retrieval-2.7 text embedding
//
// Request body:
//   { id: string, entity_type: 'product' | 'look', force?: boolean }
//
// force=true regenerates even if concept_doc already exists.

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
}

async function generateConcept(
  input: string,
  entityType: 'product' | 'look',
  anthropicKey: string
): Promise<ConceptResult> {
  const systemPrompt = entityType === 'product'
    ? `You are a fashion search indexer. Your job is to write a rich semantic document for a product that will be used to match natural-language fashion queries like "what to wear with white jeans" or "red carpet evening look". Capture physical details, styling context, occasions, and cultural/trend references.`
    : `You are a fashion search indexer. Your job is to write a rich semantic document for a fashion "look" (an outfit video) that will match natural-language queries. Describe the overall vibe, component pieces, occasion fit, and aesthetic references.`;

  // Truncate long inputs to avoid overflowing Claude's context and getting back a truncated JSON response
  const inputTruncated = input.length > 1500 ? input.slice(0, 1500) + '…' : input;

  const userPrompt = entityType === 'product'
    ? `Generate a semantic search document for this product:\n\n${inputTruncated}\n\nOutput a JSON object with exactly these keys:\n- "concept_doc": 3-5 sentences describing what the item IS, who wears it, what occasions it suits, what it pairs with, and what aesthetic/trend it belongs to. Write naturally, as if a stylish person is describing it. Include synonyms and style terms a shopper might search.\n- "concept_facets": {"garment_type":"...","color_family":["..."],"occasion":["..."],"style_tags":["..."],"formality_score":0.0-1.0}\n\nRespond with ONLY the JSON object, no other text.`
    : `Generate a semantic search document for this fashion look:\n\n${inputTruncated}\n\nOutput a JSON object with exactly these keys:\n- "concept_doc": 3-5 sentences describing the look's vibe, the pieces in it, the occasion it suits, and the aesthetic it represents. Write naturally for search.\n- "concept_facets": {"garment_type":"outfit","color_family":["..."],"occasion":["..."],"style_tags":["..."],"formality_score":0.0-1.0}\n\nRespond with ONLY the JSON object, no other text.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 600,
      messages: [{ role: 'user', content: userPrompt }],
      system: systemPrompt,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic error ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json() as { content?: Array<{ type: string; text?: string }> };
  const text = json.content?.find(b => b.type === 'text')?.text ?? '';

  // Strip potential markdown code fences before parsing
  const cleaned = text.replace(/^```json?\s*/i, '').replace(/\s*```$/, '').trim();

  // If Claude refused or returned prose instead of JSON, fall back to heuristic
  try {
    const parsed = JSON.parse(cleaned) as ConceptResult;
    if (!parsed.concept_doc || !parsed.concept_facets) {
      throw new Error('incomplete');
    }
    return parsed;
  } catch {
    return heuristicConcept(input, entityType);
  }
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

function heuristicConcept(input: string, entityType: 'product' | 'look'): ConceptResult {
  const lines = input.split('\n');
  const get = (prefix: string) =>
    lines.find(l => l.startsWith(prefix))?.slice(prefix.length).trim() ?? '';

  const name  = get('Name:') || get('Title:') || '';
  const brand = get('Brand:');
  const type  = get('Type:');
  const desc  = get('Description:');
  const gender = get('Gender:').toLowerCase();

  const corpus = [name, type, desc].filter(Boolean).join(' ');

  // Garment type
  let garment = entityType === 'look' ? 'outfit' : 'clothing';
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

  const concept_doc = entityType === 'product'
    ? `${name || 'A piece'}${brandPhrase} — a ${colorPhrase}${garment}.${stylePhrase}${occasionPhrase}${genderPhrase}${desc ? ' ' + desc.slice(0, 200) : ''}`.trim()
    : `A ${colorPhrase}${garment} look${brandPhrase ? brandPhrase : ''}, "${name}".${stylePhrase}${occasionPhrase}${genderPhrase}${desc ? ' ' + desc.slice(0, 200) : ''}`.trim();

  return {
    concept_doc,
    concept_facets: {
      garment_type: garment,
      color_family: colors,
      occasion: occasions,
      style_tags: styleTags,
      formality_score: formality,
    },
  };
}

// ── TwelveLabs: text embedding (Marengo 3.0, 512-dim) ───────────────────────

async function embedText(text: string, twelveLabsKey: string): Promise<number[]> {
  const res = await fetch('https://api.twelvelabs.io/v1.3/embed-v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': twelveLabsKey,
    },
    body: JSON.stringify({
      input_type: 'text',
      model_name: 'marengo3.0',
      text: { input_text: text },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`TwelveLabs embed error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const json = await res.json() as { data?: Array<{ embedding?: number[] }> };
  const embedding = json.data?.[0]?.embedding;
  if (!embedding?.length) throw new Error('TwelveLabs returned empty text embedding');
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
  const twelveLabsKey  = Deno.env.get('TWELVELABS_API_KEY') ?? '';

  if (!supabaseUrl || !serviceKey) return jsonRes({ ok: false, error: 'Supabase env missing' }, 500);
  if (!anthropicKey)   return jsonRes({ ok: false, error: 'ANTHROPIC_API_KEY missing' }, 500);
  if (!twelveLabsKey)  return jsonRes({ ok: false, error: 'TWELVELABS_API_KEY missing' }, 500);

  let body: { id?: string; entity_type?: string; force?: boolean };
  try { body = await req.json(); } catch { return jsonRes({ ok: false, error: 'Invalid JSON' }, 400); }

  const { id, entity_type, force = false } = body;
  if (!id)          return jsonRes({ ok: false, error: 'id required' }, 400);
  if (!entity_type || !['product', 'look'].includes(entity_type)) {
    return jsonRes({ ok: false, error: 'entity_type must be product or look' }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey);

  // ── Fetch entity ────────────────────────────────────────────────────────────
  const table = entity_type === 'product' ? 'products' : 'looks';
  const { data: row, error: fetchErr } = await admin
    .from(table)
    .select(entity_type === 'product'
      ? 'id, name, brand, description, price, type, gender, concept_doc'
      : 'id, title, creator_handle, description, gender, concept_doc')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr) return jsonRes({ ok: false, error: fetchErr.message }, 500);
  if (!row)     return jsonRes({ ok: false, error: `${entity_type} not found` }, 404);

  // Skip if already embedded and force=false
  if (!force && row.concept_doc) {
    return jsonRes({ ok: true, skipped: 'already has concept_doc', id });
  }

  // ── Build input string for concept generation ────────────────────────────
  let inputStr: string;
  if (entity_type === 'product') {
    inputStr = [
      `Name: ${row.name ?? 'Unknown'}`,
      row.brand       ? `Brand: ${row.brand}` : null,
      row.type        ? `Type: ${row.type}` : null,
      row.price       ? `Price: ${row.price}` : null,
      row.gender      ? `Gender: ${row.gender}` : null,
      row.description ? `Description: ${row.description}` : null,
    ].filter(Boolean).join('\n');
  } else {
    inputStr = [
      `Title: ${row.title ?? 'Untitled look'}`,
      row.creator_handle ? `Creator: ${row.creator_handle}` : null,
      row.gender         ? `Gender: ${row.gender}` : null,
      row.description    ? `Description: ${row.description}` : null,
    ].filter(Boolean).join('\n');
  }

  // ── Step 1: Generate concept_doc + facets via Claude ────────────────────
  let concept: ConceptResult;
  try {
    concept = await generateConcept(inputStr, entity_type as 'product' | 'look', anthropicKey);
  } catch (err) {
    return jsonRes({ ok: false, stage: 'concept_generation', error: String(err) }, 502);
  }

  // ── Step 2: Embed concept_doc via TwelveLabs ───────────────────────────────
  let embedding: number[];
  try {
    embedding = await embedText(concept.concept_doc, twelveLabsKey);
  } catch (err) {
    return jsonRes({ ok: false, stage: 'embedding', error: String(err) }, 502);
  }

  // ── Step 3: Write back to DB ─────────────────────────────────────────────
  const { error: updateErr } = await admin
    .from(table)
    .update({
      concept_doc:    concept.concept_doc,
      concept_facets: concept.concept_facets,
      concept_at:     new Date().toISOString(),
      text_embedding: toPgVector(embedding),
      embedded_at:    new Date().toISOString(),
    })
    .eq('id', id);

  if (updateErr) return jsonRes({ ok: false, stage: 'db_update', error: updateErr.message }, 500);

  return jsonRes({ ok: true, id, entity_type, concept_doc_length: concept.concept_doc.length });
});

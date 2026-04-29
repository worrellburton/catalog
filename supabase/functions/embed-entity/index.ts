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
//   { id: string, entity_type: 'creative' | 'look', force?: boolean }
//
// entity_type='creative': reads product_creative joined to products, writes back
//   to product_creative.{concept_doc, concept_facets, text_embedding, concept_at}.
// entity_type='look': reads looks joined to its products via look_products, writes
//   back to looks.{concept_doc, concept_facets, text_embedding, concept_at}.
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
}

type EntityType = 'creative' | 'look';

async function generateConcept(
  input: string,
  entityType: EntityType,
  anthropicKey: string
): Promise<ConceptResult> {
  const isLook = entityType === 'look';

  const systemPrompt = isLook
    ? `You are a fashion search indexer. Your job is to write a FACTUAL semantic document for a shoppable outfit look — a curated set of fashion items worn together. The document is used both as a BM25 keyword source and as the input to a dense embedding, so accuracy beats coverage. Describe the overall aesthetic, the key garments and their colours, who the look is designed for, and the realistic occasions it suits. Do NOT invent occasions to widen reach; do NOT list speculative shopper search phrases; do NOT pad with synonyms.`
    : `You are a fashion search indexer. Your job is to write a FACTUAL semantic document for a short shoppable video creative that advertises a single fashion product. The document is used both as a BM25 keyword source and as the input to a dense embedding, so accuracy beats coverage. Describe what the product IS, the colour and material, the body part it covers, the styling actually shown in the video, and the realistic occasions it suits. Do NOT invent occasions to widen reach; do NOT list speculative shopper search phrases; do NOT pad with synonyms. If an item is underwear, it is underwear — do not also call it a "summer outfit".`;

  // Truncate long inputs to avoid overflowing Claude's context and getting back a truncated JSON response
  const inputTruncated = input.length > 1500 ? input.slice(0, 1500) + '…' : input;

  const userPrompt = isLook
    ? `Generate a factual semantic document for this shoppable outfit look:\n\n${inputTruncated}\n\nOutput a JSON object with exactly these keys:\n- "concept_doc": 2-4 sentences. Cover (1) the overall aesthetic or vibe of the look; (2) the key garments, their colours and materials; (3) who it is designed for; (4) realistic occasions. Write plain descriptive prose. Do NOT list shopper search phrases.\n- "concept_facets": {"garment_type":"...","color_family":["..."],"occasion":["..."],"style_tags":["..."],"formality_score":0.0-1.0}\n\nRespond with ONLY the JSON object, no other text.`
    : `Generate a factual semantic document for this shoppable video creative:\n\n${inputTruncated}\n\nOutput a JSON object with exactly these keys:\n- "concept_doc": 2-4 sentences. Cover (1) what the product is — garment type, colour, material; (2) who it's designed for; (3) the realistic occasions it suits based on the product type itself, not aspirational stretches. Write plain descriptive prose. Do NOT include lists of shopper search phrases. Do NOT call accessories or underwear an "outfit" or "look".\n- "concept_facets": {"garment_type":"...","color_family":["..."],"occasion":["..."],"style_tags":["..."],"formality_score":0.0-1.0}\n  • occasion must be honest: only list occasions where this single item is the headline piece, not occasions where it might be worn under something else.\n\nRespond with ONLY the JSON object, no other text.`;

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
    return heuristicConcept(input, _entityType);
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

function heuristicConcept(input: string, _entityType: EntityType): ConceptResult {
  const lines = input.split('\n');
  const get = (prefix: string) =>
    lines.find(l => l.startsWith(prefix))?.slice(prefix.length).trim() ?? '';

  const name  = get('Product:') || get('Name:') || '';
  const brand = get('Brand:');
  const type  = get('Type:');
  const desc  = get('Description:');
  const gender = get('Gender:').toLowerCase();

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
  };
}

// ── OpenAI: text embedding (text-embedding-3-small, 1536-dim) ──────────────

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
  if (entity_type !== 'creative' && entity_type !== 'look') {
    return jsonRes({ ok: false, error: 'entity_type must be "creative" or "look"' }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey);

  // ── Route to the appropriate handler ────────────────────────────────────
  if (entity_type === 'look') {
    return handleLook(id, force, admin, anthropicKey, openaiKey);
  }
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
    .select('id, style, prompt, prompt_extra, title, description, concept_doc, product:products(id, name, brand, description, price, type, gender)')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr) return jsonRes({ ok: false, error: fetchErr.message }, 500);
  if (!row)     return jsonRes({ ok: false, error: 'creative not found' }, 404);

  if (!force && row.concept_doc) {
    return jsonRes({ ok: true, skipped: 'already has concept_doc', id });
  }

  const p = (row as Record<string, unknown>).product as Record<string, unknown> | null;
  if (!p) return jsonRes({ ok: false, error: 'creative is missing joined product' }, 400);

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

  let concept: ConceptResult;
  try { concept = await generateConcept(inputStr, 'creative', anthropicKey); }
  catch (err) { return jsonRes({ ok: false, stage: 'concept_generation', error: String(err) }, 502); }

  let embedding: number[];
  try { embedding = await embedText(concept.concept_doc, openaiKey); }
  catch (err) { return jsonRes({ ok: false, stage: 'embedding', error: String(err) }, 502); }

  const { error: updateErr } = await admin
    .from('product_creative')
    .update({
      concept_doc:    concept.concept_doc,
      concept_facets: concept.concept_facets,
      concept_at:     new Date().toISOString(),
      text_embedding: toPgVector(embedding),
    })
    .eq('id', id);

  if (updateErr) return jsonRes({ ok: false, stage: 'db_update', error: updateErr.message }, 500);
  return jsonRes({ ok: true, id, entity_type: 'creative', concept_doc_length: concept.concept_doc.length });
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
    .select('id, title, creator_handle, description, gender, concept_doc, look_products(product:products(name, brand, type, description))')
    .eq('id', id)
    .maybeSingle();

  if (lookErr) return jsonRes({ ok: false, error: lookErr.message }, 500);
  if (!look)   return jsonRes({ ok: false, error: 'look not found' }, 404);

  if (!force && (look as Record<string, unknown>).concept_doc) {
    return jsonRes({ ok: true, skipped: 'already has concept_doc', id });
  }

  // Build input string: look metadata + its products
  const l = look as Record<string, unknown>;
  const lpRows = (l.look_products as Array<Record<string, unknown>> | null) ?? [];
  const productLines = lpRows
    .map(lp => {
      const p = (lp.product as Record<string, unknown> | null);
      if (!p) return null;
      return [p.name, p.brand, p.type].filter(Boolean).join(' · ');
    })
    .filter(Boolean)
    .slice(0, 10);

  const inputStr = [
    l.title       ? `Look title: ${l.title}` : null,
    l.creator_handle ? `Creator: ${l.creator_handle}` : null,
    l.description ? `Description: ${l.description}` : null,
    l.gender      ? `Gender: ${l.gender}` : null,
    productLines.length ? `Products in look:\n${productLines.map(s => `  • ${s}`).join('\n')}` : null,
  ].filter(Boolean).join('\n');

  let concept: ConceptResult;
  try { concept = await generateConcept(inputStr, 'look', anthropicKey); }
  catch (err) { return jsonRes({ ok: false, stage: 'concept_generation', error: String(err) }, 502); }

  let embedding: number[];
  try { embedding = await embedText(concept.concept_doc, openaiKey); }
  catch (err) { return jsonRes({ ok: false, stage: 'embedding', error: String(err) }, 502); }

  const { error: updateErr } = await admin
    .from('looks')
    .update({
      concept_doc:    concept.concept_doc,
      concept_facets: concept.concept_facets,
      concept_at:     new Date().toISOString(),
      text_embedding: toPgVector(embedding),
    })
    .eq('id', id);

  if (updateErr) return jsonRes({ ok: false, stage: 'db_update', error: updateErr.message }, 500);
  return jsonRes({ ok: true, id, entity_type: 'look', concept_doc_length: concept.concept_doc.length });
}



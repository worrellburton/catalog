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

  const userPrompt = entityType === 'product'
    ? `Generate a semantic search document for this product:\n\n${input}\n\nOutput a JSON object with exactly these keys:\n- "concept_doc": 3-5 sentences describing what the item IS, who wears it, what occasions it suits, what it pairs with, and what aesthetic/trend it belongs to. Write naturally, as if a stylish person is describing it. Include synonyms and style terms a shopper might search.\n- "concept_facets": {"garment_type":"...","color_family":["..."],"occasion":["..."],"style_tags":["..."],"formality_score":0.0-1.0}\n\nRespond with ONLY the JSON object, no other text.`
    : `Generate a semantic search document for this fashion look:\n\n${input}\n\nOutput a JSON object with exactly these keys:\n- "concept_doc": 3-5 sentences describing the look's vibe, the pieces in it, the occasion it suits, and the aesthetic it represents. Write naturally for search.\n- "concept_facets": {"garment_type":"outfit","color_family":["..."],"occasion":["..."],"style_tags":["..."],"formality_score":0.0-1.0}\n\nRespond with ONLY the JSON object, no other text.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
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
  const parsed = JSON.parse(cleaned) as ConceptResult;

  if (!parsed.concept_doc || !parsed.concept_facets) {
    throw new Error('Claude returned incomplete concept: ' + cleaned.slice(0, 200));
  }
  return parsed;
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

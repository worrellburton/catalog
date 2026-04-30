#!/usr/bin/env node
/**
 * seed-query-embeddings — pre-warm the query_embeddings cache.
 *
 * For every query in QUERIES, in parallel:
 *   - OpenAI text-embedding-3-small  → query_embeddings.embedding
 *   - Claude Haiku query expansion   → query_embeddings.expansion
 *
 * Both are upserted together. Any existing row missing either column is
 * backfilled. Idempotent — re-running is safe and only does work for the
 * pieces actually missing.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   OPENAI_API_KEY=... ANTHROPIC_API_KEY=... \
 *     node agents/seed-query-embeddings/seed.mjs
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY   = process.env.OPENAI_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

if (!SUPABASE_URL || !SERVICE_KEY || !OPENAI_KEY || !ANTHROPIC_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY');
  process.exit(1);
}

const CONCURRENCY = 3;

const CANONICAL_TYPES = [
  'Top', 'Jacket', 'Pants', 'Shorts', 'Skirt', 'Dress', 'Coat',
  'Underwear', 'Activewear', 'Loungewear', 'Swimwear',
  'Sneakers', 'Boots', 'Sandals', 'Heels', 'Loafers', 'Flats', 'Mules',
  'Hat', 'Bag', 'Scarf', 'Socks',
  'Fragrance', 'Skincare', 'Book', 'Yoga',
];

// Pre-warm list. Common + uncommon but realistic. Anything in this file
// gets hit by every user instantly via the global query_embeddings cache.
const QUERIES = [
  // ── Footwear (broad → specific) ─────────────────────────────────────
  'shoes', 'footwear',
  'sneakers', 'trainers', 'runners', 'tennis shoes', 'kicks',
  'white sneakers', 'black sneakers', 'chunky sneakers', 'low top sneakers', 'high top sneakers',
  'platform sneakers', 'retro sneakers', 'designer sneakers', 'leather sneakers',
  'nike sneakers', 'adidas sneakers', 'new balance', 'jordans', 'air force 1',
  'running shoes', 'gym shoes', 'walking shoes', 'court shoes',
  'boots', 'ankle boots', 'knee high boots', 'over the knee boots', 'combat boots',
  'cowboy boots', 'western boots', 'chelsea boots', 'hiking boots', 'snow boots',
  'rain boots', 'leather boots', 'suede boots', 'work boots', 'moto boots',
  'sandals', 'flat sandals', 'strappy sandals', 'slide sandals', 'birkenstocks',
  'gladiator sandals', 'thong sandals', 'sport sandals',
  'heels', 'high heels', 'kitten heels', 'block heels', 'stiletto', 'pumps',
  'mary janes', 'ballet flats', 'flats', 'ballerinas',
  'loafers', 'penny loafers', 'horsebit loafers', 'chunky loafers', 'mules', 'clogs',
  'slippers', 'house shoes', 'flip flops', 'espadrilles',

  // ── Tops ────────────────────────────────────────────────────────────
  'top', 'tops', 'shirt', 'shirts', 't-shirt', 'tshirt', 'tee', 'tees', 'graphic tee',
  'white tee', 'black tee', 'vintage tee', 'band tee', 'oversized tee', 'baby tee',
  'tank top', 'tank', 'crop top', 'tube top', 'halter top', 'corset top', 'bustier',
  'bodysuit', 'camisole', 'cami',
  'blouse', 'silk blouse', 'button down', 'button up', 'oxford shirt', 'flannel shirt',
  'linen shirt', 'denim shirt', 'collared shirt', 'polo shirt',
  'sweater', 'knit', 'knitwear', 'cardigan', 'pullover', 'turtleneck', 'mock neck',
  'cashmere sweater', 'wool sweater', 'cable knit', 'fair isle', 'crewneck',
  'hoodie', 'sweatshirt', 'zip up', 'pullover hoodie',
  'vest', 'sweater vest', 'puffer vest',

  // ── Bottoms ─────────────────────────────────────────────────────────
  'pants', 'trousers', 'bottoms',
  'jeans', 'denim', 'blue jeans', 'black jeans', 'white jeans', 'mom jeans',
  'boyfriend jeans', 'skinny jeans', 'straight leg jeans', 'wide leg jeans',
  'flare jeans', 'bootcut jeans', 'baggy jeans', 'low rise jeans', 'high waisted jeans',
  'distressed jeans', 'vintage jeans',
  'wide leg pants', 'cargo pants', 'parachute pants', 'tailored pants', 'dress pants',
  'pleated trousers', 'linen pants', 'leather pants', 'corduroy pants', 'cropped pants',
  'palazzo pants', 'capri pants', 'culottes',
  'leggings', 'yoga pants', 'flare leggings', 'athletic leggings',
  'joggers', 'sweatpants', 'track pants', 'lounge pants',
  'shorts', 'bike shorts', 'denim shorts', 'jorts', 'cargo shorts', 'bermuda shorts',
  'running shorts', 'tennis shorts', 'linen shorts',
  'skirt', 'mini skirt', 'midi skirt', 'maxi skirt', 'pleated skirt', 'pencil skirt',
  'a-line skirt', 'tennis skirt', 'denim skirt', 'leather skirt', 'slip skirt',
  'tiered skirt', 'wrap skirt',

  // ── Dresses ─────────────────────────────────────────────────────────
  'dress', 'dresses',
  'mini dress', 'midi dress', 'maxi dress',
  'summer dress', 'sundress', 'beach dress', 'fall dress', 'winter dress',
  'cocktail dress', 'party dress', 'club dress', 'going out dress',
  'wedding guest dress', 'bridesmaid dress', 'rehearsal dinner dress',
  'slip dress', 'wrap dress', 'shirt dress', 'sweater dress', 'tshirt dress',
  'bodycon dress', 'a-line dress', 'tiered dress', 'smock dress',
  'black dress', 'little black dress', 'lbd', 'white dress', 'red dress', 'floral dress',
  'linen dress', 'satin dress', 'velvet dress', 'lace dress',

  // ── Outerwear ───────────────────────────────────────────────────────
  'jacket', 'coat', 'outerwear',
  'denim jacket', 'jean jacket', 'leather jacket', 'biker jacket', 'moto jacket',
  'bomber jacket', 'varsity jacket', 'letterman jacket',
  'puffer jacket', 'down jacket', 'puffer coat',
  'trench coat', 'overcoat', 'wool coat', 'pea coat', 'duster coat', 'cape',
  'parka', 'anorak', 'windbreaker', 'rain jacket', 'shell jacket',
  'blazer', 'sport coat', 'tuxedo jacket', 'tweed jacket',
  'shearling', 'fur coat', 'faux fur coat', 'teddy coat', 'fleece',
  'kimono', 'shawl', 'poncho',

  // ── Accessories ─────────────────────────────────────────────────────
  'bag', 'bags', 'handbag', 'purse',
  'tote bag', 'crossbody bag', 'shoulder bag', 'clutch', 'baguette bag',
  'bucket bag', 'satchel', 'hobo bag', 'mini bag', 'belt bag', 'fanny pack',
  'backpack', 'duffle bag', 'weekender bag', 'gym bag',
  'hat', 'baseball cap', 'beanie', 'bucket hat', 'cowboy hat', 'fedora', 'beret',
  'visor', 'sun hat', 'wide brim hat',
  'scarf', 'silk scarf', 'pashmina', 'wool scarf',
  'belt', 'leather belt', 'chain belt',
  'sunglasses', 'cat eye sunglasses', 'aviators', 'wayfarers', 'oversized sunglasses',
  'jewelry', 'necklace', 'gold necklace', 'pearl necklace', 'choker', 'pendant',
  'earrings', 'gold earrings', 'hoop earrings', 'studs', 'huggies',
  'bracelet', 'tennis bracelet', 'bangle', 'cuff',
  'ring', 'signet ring', 'stacking rings',
  'watch', 'gold watch', 'luxury watch',
  'socks', 'tube socks', 'crew socks', 'tights', 'stockings', 'hosiery',

  // ── Activewear / swim / loungewear ──────────────────────────────────
  'activewear', 'workout clothes', 'gym clothes', 'sports bra', 'athletic shorts',
  'tennis outfit', 'pickleball outfit', 'golf outfit', 'running gear',
  'pilates outfit', 'yoga outfit', 'crossfit',
  'swimwear', 'swimsuit', 'bikini', 'one piece', 'cover up', 'sarong', 'rash guard',
  'board shorts', 'swim trunks',
  'loungewear', 'matching set', 'lounge set', 'pajamas', 'pjs', 'robe', 'sleep shirt',
  'underwear', 'bra', 'bralette', 'thong', 'briefs', 'boxer briefs', 'shapewear',

  // ── Beauty / fragrance / skincare / lifestyle ───────────────────────
  'fragrance', 'perfume', 'cologne', 'body mist', 'body oil',
  'skincare', 'moisturizer', 'serum', 'sunscreen', 'spf', 'cleanser', 'toner',
  'retinol', 'vitamin c', 'lip balm', 'face mask', 'exfoliator',
  'makeup', 'mascara', 'lipstick', 'lip gloss', 'eyeshadow', 'blush', 'foundation',
  'haircare', 'shampoo', 'conditioner', 'hair oil',
  'book', 'books', 'cookbook', 'novel',
  'yoga mat', 'foam roller', 'water bottle', 'reusable bottle',

  // ── Vibes / aesthetics ──────────────────────────────────────────────
  'minimalist', 'maximalist', 'streetwear', 'preppy', 'preppy outfit',
  'quiet luxury', 'old money', 'old money aesthetic', 'stealth wealth',
  'coastal grandmother', 'coastal cowgirl', 'tomato girl', 'strawberry girl',
  'clean girl', 'clean girl aesthetic', 'soft girl', 'that girl',
  'cottagecore', 'fairycore', 'dark academia', 'light academia',
  'y2k', '90s', '80s', '70s', '60s', 'vintage', 'thrifted',
  'gorpcore', 'normcore', 'balletcore', 'mob wife', 'office siren', 'librarian chic',
  'french girl', 'parisian style', 'scandi style', 'tokyo style', 'la style', 'nyc style',
  'edgy', 'feminine', 'masculine', 'androgynous', 'unisex',
  'boho', 'bohemian', 'grunge', 'punk', 'goth',
  'effortless', 'put together', 'elevated basics', 'capsule wardrobe',

  // ── Occasions ───────────────────────────────────────────────────────
  'work outfit', 'office outfit', 'business casual', 'work from home outfit',
  'interview outfit', 'first day outfit',
  'date night outfit', 'first date outfit', 'dinner outfit', 'drinks outfit',
  'wedding guest outfit', 'wedding outfit', 'rehearsal dinner outfit',
  'black tie', 'cocktail attire', 'formal wear', 'gala outfit',
  'beach outfit', 'pool outfit', 'vacation outfit', 'resort wear', 'cruise wear',
  'concert outfit', 'festival outfit', 'coachella outfit', 'rave outfit',
  'travel outfit', 'airport outfit', 'plane outfit', 'road trip outfit',
  'birthday outfit', 'brunch outfit', 'coffee date outfit',
  'school outfit', 'college outfit', 'first day of school',
  'gym outfit', 'workout outfit', 'hot girl walk',

  // ── Seasons / weather ───────────────────────────────────────────────
  'summer outfit', 'spring outfit', 'fall outfit', 'autumn outfit', 'winter outfit',
  'hot weather outfit', 'cold weather outfit', 'rainy day outfit', 'transitional outfit',
  'layered outfit', 'sweater weather',

  // ── Pairing queries (Haiku → pair_types) ────────────────────────────
  'what to wear with white sneakers', 'what to wear with black jeans',
  'what to wear with a slip dress', 'what to wear with combat boots',
  'what to wear with cowboy boots', 'what to wear with a leather jacket',
  'what to wear with wide leg pants', 'what to wear with a midi skirt',
  'what to wear with a blazer', 'what to wear with a denim jacket',
  'what goes with mom jeans', 'what goes with cargo pants',
  'pair with ballet flats', 'pair with sandals',

  // ── Color / pattern / fabric modifiers ──────────────────────────────
  'black outfit', 'all black outfit', 'monochrome outfit',
  'beige outfit', 'cream outfit', 'neutral outfit', 'tonal outfit',
  'red outfit', 'pink outfit', 'blue outfit', 'green outfit', 'brown outfit',
  'pastel outfit', 'jewel tone',
  'floral', 'plaid', 'check', 'gingham', 'stripes', 'polka dot', 'animal print',
  'leopard print', 'snake print', 'cow print', 'tie dye',
  'denim on denim', 'canadian tuxedo',
  'leather', 'suede', 'silk', 'satin', 'velvet', 'corduroy', 'tweed', 'cashmere',
  'linen', 'cotton', 'merino wool', 'shearling',

  // ── Body type / fit ─────────────────────────────────────────────────
  'oversized', 'fitted', 'tailored', 'cropped', 'high waisted', 'low rise',
  'petite', 'tall', 'plus size', 'curvy',

  // ── Brand / tier signals (vibe queries, not literal brand match) ───
  'designer', 'luxury', 'high end', 'investment piece', 'splurge',
  'budget friendly', 'affordable', 'dupes', 'amazon finds',
  'sustainable', 'ethical', 'second hand', 'vintage finds',
];

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const normalize = q => q.trim().toLowerCase().replace(/\s+/g, ' ');
const toPgVector = v => '[' + v.join(',') + ']';

async function embed(text) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const vec = json.data?.[0]?.embedding;
  if (!Array.isArray(vec)) throw new Error('OpenAI returned no embedding');
  return vec;
}

async function expandWithHaiku(query) {
  const typeList = CANONICAL_TYPES.join(', ');
  const prompt = `You are a fashion catalog search planner. The catalog has these exact product types:\n${typeList}\n\nUser query: "${query}"\n\nDecide intent and return ONLY a JSON object with these exact fields:\n- "intent": "browse" if shopping a category | "pairing" if they want what to wear with something | "vibe" if abstract aesthetic / mood\n- "types": product types from the list above. Broad terms include adjacent types (e.g. "pants" → ["Pants","Shorts","Activewear"], "shoes" → ["Sneakers","Boots","Sandals","Heels","Loafers","Flats","Mules"]). Specific terms narrow it (e.g. "loafers" → ["Loafers"]). Empty array when intent is "pairing" or "vibe".\n- "anchor_type": for intent=pairing, the anchor item type. null otherwise.\n- "pair_types": for intent=pairing, complementary types (NOT the anchor). null otherwise.\n- "keywords": query stripped of category noun for in-category ranking. Short phrase.\n\nRespond with ONLY the JSON object, no prose, no markdown.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 250, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const text = json.content?.find(b => b.type === 'text')?.text ?? '';
  const cleaned = text.replace(/^```json?\s*/i, '').replace(/\s*```$/, '').trim();
  const raw = JSON.parse(cleaned);

  const allowed = new Set(CANONICAL_TYPES);
  const intent = raw.intent === 'pairing' || raw.intent === 'vibe' ? raw.intent : 'browse';
  const types = (raw.types ?? []).filter(t => allowed.has(t));
  const pair_types = (raw.pair_types ?? []).filter(t => allowed.has(t));
  const anchor_type = raw.anchor_type && allowed.has(raw.anchor_type) ? raw.anchor_type : null;

  return {
    intent,
    types,
    anchor_type: intent === 'pairing' ? anchor_type : null,
    pair_types: intent === 'pairing' && pair_types.length > 0 ? pair_types : null,
    keywords: typeof raw.keywords === 'string' ? raw.keywords : query,
  };
}

async function readExisting(key) {
  const { data } = await admin
    .from('query_embeddings')
    .select('embedding, expansion')
    .eq('query_text', key)
    .maybeSingle();
  if (!data) return { embedding: null, expansion: null };
  return { embedding: data.embedding, expansion: data.expansion ?? null };
}

async function processOne(raw, stats) {
  const key = normalize(raw);
  const existing = await readExisting(key);
  const needEmbed = !existing.embedding;
  const needExpansion = !existing.expansion;

  if (!needEmbed && !needExpansion) {
    stats.skipped++;
    process.stdout.write('.');
    return;
  }

  try {
    const [vec, expansion] = await Promise.all([
      needEmbed ? embed(raw) : Promise.resolve(null),
      needExpansion ? expandWithHaiku(raw) : Promise.resolve(null),
    ]);

    let error;
    if (needEmbed && needExpansion) {
      // New row — full upsert
      ({ error } = await admin.from('query_embeddings')
        .upsert({ query_text: key, embedding: toPgVector(vec), expansion }, { onConflict: 'query_text' }));
    } else if (needExpansion && !needEmbed) {
      // Row exists with embedding — only write expansion to avoid NOT NULL violation
      ({ error } = await admin.from('query_embeddings')
        .update({ expansion })
        .eq('query_text', key));
    } else if (needEmbed && !needExpansion) {
      // Row exists with expansion — only write embedding
      ({ error } = await admin.from('query_embeddings')
        .upsert({ query_text: key, embedding: toPgVector(vec) }, { onConflict: 'query_text' }));
    }
    if (error) throw error;

    if (needEmbed && needExpansion) { stats.full++; process.stdout.write('+'); }
    else if (needExpansion) { stats.expansionOnly++; process.stdout.write('e'); }
    else { stats.embedOnly++; process.stdout.write('v'); }
  } catch (err) {
    stats.failed++;
    process.stdout.write('x');
    const msg = err instanceof Error ? err.message : (err?.message ?? JSON.stringify(err));
    console.error(`\n  ${key}: ${msg}`);
  }
}

async function runPool(items, worker) {
  const queue = items.slice();
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const stats = { full: 0, expansionOnly: 0, embedOnly: 0, skipped: 0, failed: 0 };

  console.log(`Pre-warming ${QUERIES.length} queries (concurrency=${CONCURRENCY})…`);
  console.log(`Legend: + new full row | e expansion only | v embedding only | . skipped | x failed`);

  await runPool(QUERIES, raw => processOne(raw, stats));

  console.log(`\n\nDone.`);
  console.log(`  full new:        ${stats.full}`);
  console.log(`  expansion only:  ${stats.expansionOnly}  (backfilled existing rows)`);
  console.log(`  embedding only:  ${stats.embedOnly}`);
  console.log(`  skipped:         ${stats.skipped}  (already complete)`);
  console.log(`  failed:          ${stats.failed}`);
  console.log(`  total:           ${QUERIES.length}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

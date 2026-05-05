// query-analyzer — static keyword-expansion search planner.
//
// Hard-timeout fallback for the Haiku-driven expander in nl-search/index.ts.
// When Haiku is unavailable / times out / errors, we run this pure function
// (<1 ms) so the request never stalls.
//
// Output shapes:
//   { kind: 'typed',   types, keywords }
//     User asked for a category we know ("shoes", "jackets", "white sneakers").
//     The DB query gets a hard `filter_types=[...]` so results can never bleed
//     into other categories.
//
//   { kind: 'pairing', pair_types, anchor_type, keywords }
//     User asked "what to wear with X" / "pair with X" / "goes with X".
//     We extract the anchor's catalog type from CATALOG_TYPE_SYNONYMS and
//     look up complementary types in OUTFIT_PAIRS.
//
//   { kind: 'vibe',    keywords }
//     No catalog type detected. Caller falls back to vibe-mode handling
//     ("quiet luxury", "Y2K aesthetic", "coastal grandmother").
//
// Source-of-truth note: CATALOG_TYPE_SYNONYMS mirrors
// app/services/product-creative.ts. When you add a new entry, update both.

// ── Synonym map (lowercase keys → product.type values) ─────────────────────
//
// Every value MUST match the canonical casing used in `products.type`.
// Plural & singular both map to the same type set so the analyzer is
// natural-language tolerant.

// SEARCH_V3 Phase A fix: generic shoe terms map to the canonical "Shoes"
// type that actually has rows in the active catalog. Specific subtypes
// (Sneakers, Boots, etc.) stay narrow so when a user asks "sneakers" and
// such products go active later, the filter still works.
const CATALOG_TYPE_SYNONYMS: Record<string, string[]> = {
  // Footwear
  shoes:        ['Shoes', 'Sneakers', 'Boots', 'Sandals', 'Heels', 'Loafers', 'Flats', 'Mules'],
  shoe:         ['Shoes', 'Sneakers', 'Boots', 'Sandals', 'Heels', 'Loafers', 'Flats', 'Mules'],
  footwear:     ['Shoes', 'Sneakers', 'Boots', 'Sandals', 'Heels', 'Loafers', 'Flats', 'Mules'],
  sneakers:     ['Sneakers'],
  sneaker:      ['Sneakers'],
  trainers:     ['Sneakers'],
  runners:      ['Sneakers'],
  boots:        ['Boots'],
  boot:         ['Boots'],
  sandals:      ['Sandals'],
  sandal:       ['Sandals'],
  heels:        ['Heels'],
  heel:         ['Heels'],
  loafers:      ['Loafers'],
  loafer:       ['Loafers'],
  flats:        ['Flats'],
  mules:        ['Mules'],
  // Tops
  tops:         ['Top'],
  top:          ['Top'],
  shirts:       ['Top'],
  shirt:        ['Top'],
  tshirts:      ['Top'],
  tshirt:       ['Top'],
  't-shirts':   ['Top'],
  't-shirt':    ['Top'],
  tee:          ['Top'],
  tees:         ['Top'],
  blouses:      ['Top'],
  blouse:       ['Top'],
  sweaters:     ['Top'],
  sweater:      ['Top'],
  hoodies:      ['Top'],
  hoodie:       ['Top'],
  // Bottoms — "pants" is generic shopper speech: yoga pants/leggings get
  // tagged Activewear, athletic shorts get tagged Shorts. Map the generic
  // term to the full bottom-wear set so users see the breadth they expect.
  // Specific terms (jeans, trousers) stay narrow.
  pants:        ['Pants', 'Shorts', 'Activewear'],
  pant:         ['Pants', 'Shorts', 'Activewear'],
  bottoms:      ['Pants', 'Shorts', 'Skirt', 'Activewear'],
  trousers:     ['Pants'],
  trouser:      ['Pants'],
  jeans:        ['Pants'],
  jean:         ['Pants'],
  denim:        ['Pants', 'Jacket'],
  leggings:     ['Activewear', 'Pants'],
  legging:      ['Activewear', 'Pants'],
  joggers:      ['Pants', 'Activewear'],
  jogger:       ['Pants', 'Activewear'],
  sweatpants:   ['Pants', 'Activewear'],
  shorts:       ['Shorts'],
  short:        ['Shorts'],
  skirts:       ['Skirt'],
  skirt:        ['Skirt'],
  // Dresses
  dresses:      ['Dress'],
  dress:        ['Dress'],
  // Outerwear
  jackets:      ['Jacket'],
  jacket:       ['Jacket'],
  coats:        ['Coat'],
  coat:         ['Coat'],
  // Accessories
  hats:         ['Hat'],
  hat:          ['Hat'],
  cap:          ['Hat'],
  caps:         ['Hat'],
  'baseball cap': ['Hat'],
  'baseball caps': ['Hat'],
  beanie:       ['Hat'],
  beanies:      ['Hat'],
  headwear:     ['Hat'],
  'bucket hat': ['Hat'],
  bags:         ['Bag'],
  bag:          ['Bag'],
  purse:        ['Bag'],
  purses:       ['Bag'],
  handbag:      ['Bag'],
  handbags:     ['Bag'],
  scarves:      ['Scarf'],
  scarf:        ['Scarf'],
  socks:        ['Socks'],
  sock:         ['Socks'],
  // Activewear / others
  activewear:   ['Activewear'],
  underwear:    ['Underwear'],
  swimwear:     ['Swimwear'],
  swimsuit:     ['Swimwear'],
  loungewear:   ['Loungewear'],
  fragrance:    ['Fragrance'],
  fragrances:   ['Fragrance'],
  perfume:      ['Fragrance'],
  perfumes:     ['Fragrance'],
  cologne:      ['Fragrance'],
  skincare:     ['Skincare'],
  // Haircare
  haircare:        ['Haircare'],
  shampoo:         ['Haircare'],
  conditioner:     ['Haircare'],
  'dry shampoo':   ['Haircare'],
  'dandruff shampoo': ['Haircare'],
  'hair cream':    ['Haircare'],
  'hair clay':     ['Haircare'],
  'hair pomade':   ['Haircare'],
  pomade:          ['Haircare'],
  cream:           ['Haircare', 'Skincare'],
  // Decor / candles
  candle:       ['Decor'],
  candles:      ['Decor'],
  diffuser:     ['Decor'],
  'reed diffuser': ['Decor'],
  book:         ['Book'],
  books:        ['Book'],
};

// ── Outfit pair map (anchor type → complementary types to surface) ─────────
//
// Used when intent is "what to wear with X". We resolve X's type via
// CATALOG_TYPE_SYNONYMS, then look up which other categories typically
// complete an outfit with that anchor.
//
// Bias: complementary categories only — we never include the anchor type
// itself (asking "what to wear with jeans" should NOT return more jeans).

const OUTFIT_PAIRS: Record<string, string[]> = {
  Top:        ['Pants', 'Shorts', 'Skirt', 'Jacket', 'Shoes', 'Sneakers', 'Boots', 'Loafers', 'Bag', 'Hat'],
  Pants:      ['Top', 'Jacket', 'Shoes', 'Sneakers', 'Boots', 'Loafers', 'Bag', 'Hat'],
  Shorts:     ['Top', 'Shoes', 'Sneakers', 'Sandals', 'Hat', 'Bag'],
  Skirt:      ['Top', 'Jacket', 'Shoes', 'Heels', 'Boots', 'Bag'],
  Dress:      ['Jacket', 'Coat', 'Shoes', 'Heels', 'Sandals', 'Bag'],
  Jacket:     ['Top', 'Pants', 'Shorts', 'Shoes', 'Boots', 'Sneakers', 'Bag'],
  Coat:       ['Top', 'Pants', 'Shoes', 'Boots', 'Bag', 'Scarf'],
  // Generic Shoes (the canonical type used by active catalog rows)
  Shoes:      ['Top', 'Pants', 'Shorts', 'Skirt', 'Dress', 'Jacket', 'Bag'],
  Sneakers:   ['Top', 'Pants', 'Shorts', 'Hat'],
  Boots:      ['Pants', 'Skirt', 'Dress', 'Coat', 'Jacket'],
  Heels:      ['Dress', 'Skirt', 'Pants'],
  Loafers:    ['Pants', 'Top', 'Jacket'],
  Hat:        ['Top', 'Jacket', 'Coat'],
  Bag:        ['Top', 'Dress', 'Jacket', 'Coat'],
  Activewear: ['Sneakers', 'Shoes', 'Hat'],
  Swimwear:   ['Sandals', 'Shoes', 'Hat', 'Bag'],
  Underwear:  ['Top', 'Pants', 'Loungewear'],
  Decor:      [],
};

// ── Pair-intent triggers ───────────────────────────────────────────────────
const PAIR_PHRASE_RE = /\b(?:what(?:'s| is)?(?: i)?(?: to)? wear with|wear with|pair with|go(?:es)? with|match(?:es)? with|style with|looks? good with|to wear with)\s+([a-z][a-z\s'-]{0,40})/i;

// Stopwords to drop when extracting keywords (BM25 stems handle these but we
// also want a clean keyword payload for logging / future use).
const STOPWORDS = new Set([
  'a','an','the','and','or','for','with','to','of','in','on','at','my','your',
  'i','you','it','this','that','what','should','can','i\'m','im','am','will',
]);

export type AnalyzerResult =
  | { kind: 'typed';   types: string[]; keywords: string[] }
  | { kind: 'pairing'; pair_types: string[]; anchor_type: string; keywords: string[] }
  | { kind: 'vibe';    keywords: string[] };

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 0);
}

function extractKeywords(query: string): string[] {
  return tokenize(query).filter(t => !STOPWORDS.has(t));
}

// Resolve a phrase ("white jeans", "pants", "running shoes") to the FIRST
// catalog type whose synonym appears as a whole word. Returns null when no
// catalog noun is found.
//
// We scan the longest tokens last so multi-word phrases collapse correctly:
//   "running shoes" → tokens [running, shoes] → matches `shoes` → ['Sneakers',...]
function resolveTypesFromPhrase(phrase: string): { types: string[]; matched: string } | null {
  const tokens = tokenize(phrase);
  // Try multi-word matches first ("t-shirts", "swim suit") — currently the
  // synonym map only has single-word keys, but join+lookup is cheap and lets
  // future entries like "tank top" work without code changes.
  for (let len = Math.min(3, tokens.length); len >= 1; len--) {
    for (let i = 0; i <= tokens.length - len; i++) {
      const ngram = tokens.slice(i, i + len).join(' ');
      const types = CATALOG_TYPE_SYNONYMS[ngram];
      if (types) return { types, matched: ngram };
    }
  }
  return null;
}

export function analyzeQuery(rawQuery: string): AnalyzerResult {
  const query = rawQuery.trim();
  const keywords = extractKeywords(query);

  // ── Pairing intent ────────────────────────────────────────────────────
  // "what to wear with white jeans" / "pair with sneakers"
  const pairMatch = query.match(PAIR_PHRASE_RE);
  if (pairMatch) {
    const anchor = pairMatch[1].trim();
    const anchorResolved = resolveTypesFromPhrase(anchor);
    if (anchorResolved) {
      // OUTFIT_PAIRS keys are canonical type names (capitalised). Use the
      // FIRST resolved type as the anchor's canonical type — for "shoes"
      // that's 'Sneakers', which is reasonable but errs on one side.
      // For more specific queries ("with boots") it picks 'Boots' exactly.
      const anchorType = anchorResolved.types[0];
      const pairs = OUTFIT_PAIRS[anchorType];
      if (pairs && pairs.length > 0) {
        return {
          kind: 'pairing',
          pair_types: pairs,
          anchor_type: anchorType,
          keywords,
        };
      }
    }
    // Pair phrase detected but anchor wasn't a catalog noun — fall through
    // to typed/vibe as if no pair phrase was present, so we still get useful
    // results instead of dropping into pure vibe mode.
  }

  // ── Typed intent ──────────────────────────────────────────────────────
  // Any catalog noun in the query → strict type filter. The remaining tokens
  // ("white", "running", "summer") feed BM25 within the type subset.
  const typedMatch = resolveTypesFromPhrase(query);
  if (typedMatch) {
    return {
      kind: 'typed',
      types: typedMatch.types,
      keywords,
    };
  }

  // ── Vibe (fallback) ───────────────────────────────────────────────────
  // No catalog noun, no pair phrase → genuine vibe / aesthetic query.
  // Caller should fall through to the slow Claude+OpenAI+Marengo pipeline.
  return { kind: 'vibe', keywords };
}

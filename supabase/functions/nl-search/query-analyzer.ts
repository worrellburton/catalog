// query-analyzer — static keyword-expansion search planner.
//
// Hard-timeout fallback for the Haiku-driven expander in nl-search/index.ts.
// When Haiku is unavailable / times out / errors, this pure function (<1 ms)
// resolves the query against the LIVE catalog type vocabulary so the request
// never stalls and never depends on a hand-curated synonym map that drifts.
//
// The caller passes `canonicalTypes` (the live `select distinct type from
// products` list) so this analyzer always uses the same vocabulary as the
// rest of the search pipeline. Adding a new product type in the admin
// surfaces here automatically — no code changes required.

// ── Outfit pair map (anchor type → complementary types to surface) ─────────
// Domain knowledge about which categories complete an outfit. Only used when
// pair-intent is detected AND the anchor matches a known fashion type.
// Catalog types not in this map (Phone, Book, Drink, etc.) skip pairing —
// "what to wear with my phone" gracefully falls through to vibe.
//
// Output is always intersected with the live canonicalTypes set, so removing
// a type from the catalog removes it from results.

const OUTFIT_PAIRS: Record<string, string[]> = {
  Top:        ['Pants', 'Jacket', 'Sneakers', 'Boots', 'Loafers', 'Bag', 'Hat'],
  Pants:      ['Top', 'Jacket', 'Sneakers', 'Boots', 'Loafers', 'Bag'],
  Shorts:     ['Top', 'Sneakers', 'Sandals', 'Hat', 'Bag'],
  Skirt:      ['Top', 'Jacket', 'Heels', 'Boots', 'Bag'],
  Dress:      ['Jacket', 'Coat', 'Heels', 'Sandals', 'Bag'],
  Jacket:     ['Top', 'Pants', 'Boots', 'Sneakers', 'Bag'],
  Coat:       ['Top', 'Pants', 'Boots', 'Bag', 'Scarf'],
  Sneakers:   ['Top', 'Pants', 'Shorts', 'Hat'],
  Boots:      ['Pants', 'Skirt', 'Dress', 'Coat', 'Jacket'],
  Heels:      ['Dress', 'Skirt', 'Pants'],
  Loafers:    ['Pants', 'Top', 'Jacket'],
  Hat:        ['Top', 'Jacket', 'Coat'],
  Bag:        ['Top', 'Dress', 'Jacket', 'Coat'],
  Activewear: ['Sneakers', 'Hat'],
  Swimwear:   ['Sandals', 'Hat', 'Bag'],
};

// ── Pair-intent triggers ───────────────────────────────────────────────────
const PAIR_PHRASE_RE = /\b(?:what(?:'s| is)?(?: i)?(?: to)? wear with|wear with|pair with|go(?:es)? with|match(?:es)? with|style with|looks? good with|to wear with)\s+([a-z][a-z\s'-]{0,40})/i;

const STOPWORDS = new Set([
  'a','an','the','and','or','for','with','to','of','in','on','at','my','your',
  'i','you','it','this','that','what','should','can','im','am','will',
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

// Dead-simple singular/plural normaliser. Catches the common cases
// ("phones"→"phone", "shoes"→"shoe", "boxes"→"box") without pulling in a
// stemmer dependency. False positives are fine — we always map back through
// the live type list before returning, so a non-match just yields no result.
function singularize(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.endsWith('es') && /(s|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

// Resolve a phrase to catalog types whose name matches a token in the phrase.
// Match is case-insensitive on both sides and handles singular ↔ plural.
// Multi-word types (e.g. "Smart Watch") are matched by substring on the full
// phrase. Returns ALL matching types ("shoes and bags" → both).
function resolveTypesFromPhrase(
  phrase: string,
  canonicalTypes: string[],
): { types: string[] } | null {
  const lowerPhrase = phrase.toLowerCase();
  const tokens = tokenize(phrase);
  const tokenSet = new Set<string>([...tokens, ...tokens.map(singularize)]);

  const matches: string[] = [];
  for (const type of canonicalTypes) {
    const lt = type.toLowerCase();
    if (lt.includes(' ')) {
      if (lowerPhrase.includes(lt)) matches.push(type);
      continue;
    }
    const ltSingular = singularize(lt);
    if (tokenSet.has(lt) || tokenSet.has(ltSingular)) {
      matches.push(type);
    }
  }
  return matches.length > 0 ? { types: matches } : null;
}

export function analyzeQuery(rawQuery: string, canonicalTypes: string[]): AnalyzerResult {
  const query = rawQuery.trim();
  const keywords = extractKeywords(query);
  const allowed = new Set(canonicalTypes);

  // ── Pairing intent ────────────────────────────────────────────────────
  const pairMatch = query.match(PAIR_PHRASE_RE);
  if (pairMatch) {
    const anchor = pairMatch[1].trim();
    const anchorResolved = resolveTypesFromPhrase(anchor, canonicalTypes);
    if (anchorResolved) {
      const anchorType = anchorResolved.types[0];
      const pairs = OUTFIT_PAIRS[anchorType];
      if (pairs && pairs.length > 0) {
        const livePairs = pairs.filter(t => allowed.has(t));
        if (livePairs.length > 0) {
          return { kind: 'pairing', pair_types: livePairs, anchor_type: anchorType, keywords };
        }
      }
    }
    // Pair phrase but anchor unrecognised — fall through to typed/vibe.
  }

  // ── Typed intent ──────────────────────────────────────────────────────
  const typedMatch = resolveTypesFromPhrase(query, canonicalTypes);
  if (typedMatch) {
    return { kind: 'typed', types: typedMatch.types, keywords };
  }

  // ── Vibe (fallback) ───────────────────────────────────────────────────
  return { kind: 'vibe', keywords };
}

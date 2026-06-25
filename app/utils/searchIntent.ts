// Search intent — turns a conversational query ("I need a dress for italy")
// into (a) a clean search string the semantic engine can match on, and
// (b) a fun, on-topic catalog name to crown the result.
//
// Both are deterministic per query so the same search always reads the same
// (no jitter on re-render) and is shareable/repeatable.

// Conversational openers + filler we strip before searching. Order matters —
// multi-word phrases are removed first.
const FILLER_PHRASES = [
  "i'm looking for", 'i am looking for', 'looking for', 'i need some', 'i need a',
  'i need an', 'i need', 'i want some', 'i want a', 'i want an', 'i want',
  'show me some', 'show me', 'find me some', 'find me', 'get me some', 'get me',
  'can you find', 'can i get', 'help me find', 'i would like', "i'd like",
  'something for', 'outfit for', 'outfits for', 'a fit for', 'fits for',
];
// Standalone words that carry no search signal once the phrases are gone.
const FILLER_WORDS = new Set([
  'a', 'an', 'the', 'some', 'any', 'for', 'to', 'of', 'my', 'me', 'i',
  'need', 'want', 'please', 'pls', 'thanks', 'with', 'and', 'that', 'this',
  'is', 'are', 'be', 'on', 'in', 'at', 'wear', 'wearing', 'something',
]);

/** Strip conversational scaffolding so "I need a dress for italy" → "dress
 *  italy" before it hits the semantic search. Falls back to the trimmed
 *  original if cleaning would empty it out. */
export function cleanSearchQuery(raw: string): string {
  let q = ` ${raw.toLowerCase().trim()} `;
  for (const phrase of FILLER_PHRASES) q = q.split(` ${phrase} `).join(' ');
  const kept = q
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w && !FILLER_WORDS.has(w));
  const cleaned = kept.join(' ').trim();
  return cleaned || raw.trim();
}

/** True when a query reads as a CONVERSATIONAL ask ("I want to dress for this",
 *  "outfit for a wedding") rather than a direct product search ("black shoes").
 *  Conversational asks get the reasoning + pick-a-catalog beat instead of
 *  auto-landing on one catalog. Detected by a conversational opener phrase, an
 *  occasion preposition (" for "), or a long rambling ask. */
export function isConversationalQuery(raw: string): boolean {
  const q = ` ${raw.toLowerCase().trim()} `;
  for (const phrase of FILLER_PHRASES) if (q.includes(` ${phrase} `)) return true;
  if (q.includes(' for ')) return true;
  return raw.trim().split(/\s+/).filter(Boolean).length >= 5;
}

/** The short garment subject of a query ("dresses") for the pick-a-catalog
 *  reasoning line, or null when no known garment is present. */
export function searchSubject(raw: string): string | null {
  const words = cleanSearchQuery(raw).toLowerCase().split(/\s+/).filter(Boolean);
  const g = words.find(w => SUBJECT_PLURALS[w]);
  return g ? SUBJECT_PLURALS[g].toLowerCase() : null;
}

// Garment / product nouns we treat as the "subject" of the catalog. Plurals
// are normalized for the title so "dress" reads as "Dresses".
const SUBJECT_PLURALS: Record<string, string> = {
  dress: 'Dresses', dresses: 'Dresses', shoe: 'Shoes', shoes: 'Shoes',
  sneaker: 'Sneakers', sneakers: 'Sneakers', boot: 'Boots', boots: 'Boots',
  bag: 'Bags', bags: 'Bags', top: 'Tops', tops: 'Tops', shirt: 'Shirts',
  shirts: 'Shirts', pant: 'Pants', pants: 'Pants', jean: 'Jeans', jeans: 'Jeans',
  jacket: 'Jackets', jackets: 'Jackets', coat: 'Coats', coats: 'Coats',
  skirt: 'Skirts', skirts: 'Skirts', suit: 'Suits', suits: 'Suits',
  hat: 'Hats', hats: 'Hats', sunglasses: 'Sunglasses', watch: 'Watches',
  jewelry: 'Jewelry', sandal: 'Sandals', sandals: 'Sandals', heel: 'Heels',
  heels: 'Heels', sweater: 'Sweaters', sweaters: 'Sweaters', fit: 'Fits',
  fits: 'Fits', outfit: 'Outfits', outfits: 'Outfits',
};

// Witty frames. {s} = subject (e.g. "Dresses"), {c} = context (e.g. "Italy").
// Kept tasteful + on-topic so the joke is about the query, not random.
const FRAMES_WITH_CONTEXT = [
  '{c}-Coded {s}',
  '{s} for Your {c} Era',
  '{s}, but Make It {c}',
  'Big {c} Energy',
  '{s} for the {c} Arc',
  'Main Character {s} in {c}',
  'Romanticizing {c}: {s}',
  '{c} or Nothing',
];
const FRAMES_SUBJECT_ONLY = [
  'The {s} Spiral',
  'Down the {s} Rabbit Hole',
  'Certified {s} Behavior',
  '{s}, Obviously',
  'A Dangerous Amount of {s}',
  'New {s}, Who Dis',
];

function titleWord(w: string): string {
  return SUBJECT_PLURALS[w] ?? (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase());
}

// Tiny deterministic hash → index, so a given query always picks the same
// frame (stable across renders / shares).
function seededIndex(seed: string, len: number): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h) % Math.max(1, len);
}

/** A fun, on-topic catalog title for a typed query. "I need a dress for italy"
 *  → e.g. "Italy-Coded Dresses". Deterministic per query. Falls back to a
 *  playful subject-only frame, or the cleaned query title-cased. */
export function funnyCatalogName(raw: string): string {
  const cleaned = cleanSearchQuery(raw);
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 0) return raw.trim();

  // Subject = first recognized garment/category; context = the rest (capped to
  // 3 words so a long, rambling query can't produce a runaway title).
  const subjectIdx = words.findIndex(w => SUBJECT_PLURALS[w]);
  if (subjectIdx >= 0) {
    const subject = SUBJECT_PLURALS[words[subjectIdx]];
    const context = words.filter((_, i) => i !== subjectIdx).slice(0, 3).map(titleWord).join(' ').trim();
    if (context) {
      const frame = FRAMES_WITH_CONTEXT[seededIndex(cleaned, FRAMES_WITH_CONTEXT.length)];
      return frame.replace('{s}', subject).replace('{c}', context);
    }
    const frame = FRAMES_SUBJECT_ONLY[seededIndex(cleaned, FRAMES_SUBJECT_ONLY.length)];
    return frame.replace('{s}', subject);
  }

  // No known garment — treat the cleaned query as the subject (capped to 4
  // words so the frame stays punchy on long queries).
  const subject = words.slice(0, 4).map(titleWord).join(' ');
  const frame = FRAMES_SUBJECT_ONLY[seededIndex(cleaned, FRAMES_SUBJECT_ONLY.length)];
  return frame.replace('{s}', subject);
}

// Singular forms of the recognized garment subjects — used by the search
// fallback (we search the bare garment, e.g. "dress", not its title plural).
const SUBJECT_SINGULAR: Record<string, string> = {
  dress: 'dress', dresses: 'dress', shoe: 'shoe', shoes: 'shoes',
  sneaker: 'sneaker', sneakers: 'sneakers', boot: 'boot', boots: 'boots',
  bag: 'bag', bags: 'bags', top: 'top', tops: 'top', shirt: 'shirt',
  shirts: 'shirt', pant: 'pants', pants: 'pants', jean: 'jeans', jeans: 'jeans',
  jacket: 'jacket', jackets: 'jacket', coat: 'coat', coats: 'coat',
  skirt: 'skirt', skirts: 'skirt', suit: 'suit', suits: 'suit',
  hat: 'hat', hats: 'hat', sunglasses: 'sunglasses', watch: 'watch',
  jewelry: 'jewelry', sandal: 'sandal', sandals: 'sandals', heel: 'heel',
  heels: 'heels', sweater: 'sweater', sweaters: 'sweater',
};

/**
 * A broader retry query for when the full cleaned query returns nothing. A
 * conversational query like "dress italy" matches no inventory (products aren't
 * tagged by destination), so fall back to the garment alone ("dress") to fill
 * the catalog. Returns null when there's nothing broader to try (single token,
 * or no recognized garment among multiple words).
 */
export function searchFallbackQuery(cleaned: string): string | null {
  const words = cleaned.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return null;
  const garment = words.find(w => SUBJECT_SINGULAR[w]);
  if (garment) {
    const fb = SUBJECT_SINGULAR[garment];
    return fb !== cleaned ? fb : null;
  }
  return null;
}

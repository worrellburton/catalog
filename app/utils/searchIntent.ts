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

  // Subject = first recognized garment/category; context = the rest.
  const subjectIdx = words.findIndex(w => SUBJECT_PLURALS[w]);
  if (subjectIdx >= 0) {
    const subject = SUBJECT_PLURALS[words[subjectIdx]];
    const context = words.filter((_, i) => i !== subjectIdx).map(titleWord).join(' ').trim();
    if (context) {
      const frame = FRAMES_WITH_CONTEXT[seededIndex(cleaned, FRAMES_WITH_CONTEXT.length)];
      return frame.replace('{s}', subject).replace('{c}', context);
    }
    const frame = FRAMES_SUBJECT_ONLY[seededIndex(cleaned, FRAMES_SUBJECT_ONLY.length)];
    return frame.replace('{s}', subject);
  }

  // No known garment — treat the whole cleaned query as the subject.
  const subject = words.map(titleWord).join(' ');
  const frame = FRAMES_SUBJECT_ONLY[seededIndex(cleaned, FRAMES_SUBJECT_ONLY.length)];
  return frame.replace('{s}', subject);
}

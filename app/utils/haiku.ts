// haikuIdentity — the "identity" half of a product's haiku_context (Claude
// Haiku's read of the primary image). The context leads with a one-line
// object identity ("potted plant", "high heels") and follows with a detail
// sentence that may mention the room/setting. Type-matching and gender
// inference read ONLY the identity, or a plant photographed in a living room
// gets dragged under "home" by the detail sentence.
//
// Lives in utils (app-core chunk) so both genders.ts (app-core) and
// type-governance.ts (admin chunk) can share it WITHOUT app-core importing
// the admin chunk — that cross-chunk edge created an app-core ↔ admin cycle
// and a cascade of "Cannot access … before initialization" TDZs at build.

export function haikuIdentity(text: string | null | undefined): string {
  if (!text) return '';
  // Strip markdown, drop blank lines and bare label lines ("Description").
  // Take the FIRST real line as the identity — it may be a single word
  // ("Sneaker", "Wristwatch"); skipping single-word lines would fall through
  // to the detail sentence, which mentions parts/settings ("…and heel…",
  // "…for the home…") and re-introduces false type matches.
  const LABEL = /^(description|summary|overview|identity|category|product|item|details?|note)$/i;
  const lines = text.split('\n')
    .map(l => l.replace(/^[#>\-*\s]+/, '').replace(/[*_`]/g, '').trim())
    .filter(l => l && !l.endsWith(':') && !LABEL.test(l));
  const line = lines[0] ?? text;
  return (line.split(/(?<=[.!?])\s/)[0] ?? line).trim();
}

// haikuCategory — the EXPLICIT category Haiku reports for a product, when the
// context carries one (the richer prompt emits a "Category:" field, e.g.
// "**Category:** Footwear / Casual Shoes"). Type placement should trust this
// over the title line: a title like "Men's Low-Top Sneaker" contains the word
// "top", which mis-matches the Tops node — the Category ("Footwear / Casual
// Shoes") is the unambiguous signal. Returns '' for the older two-line format
// (callers fall back to haikuIdentity).
export function haikuCategory(text: string | null | undefined): string {
  if (!text) return '';
  for (const raw of text.split('\n')) {
    const line = raw.replace(/[*_`>#]/g, '').trim();
    const m = line.match(/^category\s*:?\s*(.+)$/i);
    if (m && m[1]) return m[1].trim();
  }
  return '';
}

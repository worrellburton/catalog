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

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
  const lines = text.split('\n')
    .map(l => l.replace(/^[#>\-*\s]+/, '').replace(/[*_`]/g, '').trim())
    .filter(Boolean);
  // First real content line — skip bare titles/labels ("Description").
  const line = lines.find(l => l.includes(' ') && !l.endsWith(':')) ?? lines[0] ?? text;
  const firstSentence = line.split(/(?<=[.!?])\s/)[0] ?? line;
  return firstSentence.trim();
}

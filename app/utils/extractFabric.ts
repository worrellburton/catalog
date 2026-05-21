/**
 * Pull the fabric composition out of the freeform materials_care
 * blob the scraper extracts. The blob mixes composition + care
 * instructions: "75% wool, 25% lyocell. Dry clean only. Imported."
 *
 * We just want the composition for inline display in the Fabric
 * column on /admin/data?tab=products. Heuristic: take the first
 * sentence-ish segment that contains a percent literal; fall back
 * to a sensible truncation of the whole blob if nothing matches.
 */

export function extractFabric(materialsCare: string | null | undefined): string | null {
  if (!materialsCare) return null;
  const trimmed = materialsCare.trim();
  if (!trimmed) return null;

  // Split on sentence-terminators (period / ! / ?) followed by space.
  // Keeps trailing fragments together so "100% cotton" doesn't get
  // chopped by a stray period at the end of the string.
  const segments = trimmed.split(/[.!?]\s+/);
  for (const seg of segments) {
    if (/\d+\s*%/.test(seg)) return seg.trim();
  }

  return trimmed.length > 60 ? trimmed.slice(0, 60) + '…' : trimmed;
}

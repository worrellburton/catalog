/**
 * Canonical head-to-toe garment ordering. Used to sort the Products
 * panel in every Look surface (overlay, bookmarks, creator catalogs)
 * so a look reads top-to-bottom the way a stylist would call it out:
 * hat → eyewear → outerwear → top → dress → bottom → shoes → bag →
 * jewelry → other.
 *
 * Items without a recognisable role tag fall to the bottom of the
 * list in original order (stable sort).
 */

export const ROLE_PRIORITY: Record<string, number> = {
  hat: 10,
  sunglasses: 15,
  scarf: 20,
  jacket: 30,
  top: 40,
  shirt: 40,
  dress: 50,
  belt: 55,
  pants: 60,
  shorts: 60,
  skirt: 60,
  shoes: 70,
  bag: 80,
  watch: 85,
  jewelry: 90,
};

/** Light name-based role inference — mirrors user-generations.ts. */
export function inferRoleFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  if (/\b(hat|cap|beanie|fedora|visor|bucket\s*hat)\b/.test(lower)) return 'hat';
  if (/\b(sunglass|shades|aviator|eyewear)\b/.test(lower)) return 'sunglasses';
  if (/\b(scarf|stole|wrap|shawl)\b/.test(lower)) return 'scarf';
  if (/\b(jacket|coat|parka|blazer|bomber|puffer|trench)\b/.test(lower)) return 'jacket';
  if (/\b(dress|gown)\b/.test(lower)) return 'dress';
  if (/\b(skirt)\b/.test(lower)) return 'skirt';
  if (/\b(short|bermuda)\b/.test(lower)) return 'shorts';
  if (/\b(pant|trouser|chino|jean|denim|legging|jogger)\b/.test(lower)) return 'pants';
  if (/\b(belt)\b/.test(lower)) return 'belt';
  if (/\b(sneaker|trainer|shoe|boot|heel|loafer|sandal)\b/.test(lower)) return 'shoes';
  if (/\b(bag|tote|clutch|purse|backpack|handbag)\b/.test(lower)) return 'bag';
  if (/\b(watch|wristwatch)\b/.test(lower)) return 'watch';
  if (/\b(necklace|ring|earring|bracelet|chain|pendant)\b/.test(lower)) return 'jewelry';
  if (/\b(shirt|tee|top|sweater|hoodie|polo|henley|tank|sweatshirt|knit|cardigan)\b/.test(lower)) return 'top';
  return null;
}

function rolePriority(name: string | null | undefined, roleTag?: string | null): number {
  const role = (roleTag || inferRoleFromName(name) || '').toLowerCase();
  return ROLE_PRIORITY[role] ?? 999;
}

/**
 * Stable head-to-toe sort: items with a recognised garment role come
 * first in canonical order; everything else keeps its original
 * relative position at the end.
 */
export function sortByGarmentRole<T extends { name?: string | null; role_tag?: string | null }>(
  products: readonly T[],
): T[] {
  return products
    .map((p, i) => ({ p, i, prio: rolePriority(p.name, p.role_tag) }))
    .sort((a, b) => (a.prio - b.prio) || (a.i - b.i))
    .map(x => x.p);
}

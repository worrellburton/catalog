/**
 * Centralised audience-gender filter applied to product/look/creative
 * surfaces (You-might-also-like, search, similar rails). The rule:
 *
 *   shopper gender = male    → show items tagged male  + unisex
 *   shopper gender = female  → show items tagged female + unisex
 *   shopper gender = unknown → show everything (no filter)
 *
 * `male`/`female` (UserGender) and `men`/`women`/`unisex`
 * (ProductGender) use different vocabularies in the codebase, so we
 * normalise here so callers can hand us either.
 */

type ShopperGender = 'male' | 'female' | 'unknown' | string | null | undefined;

export function isGenderAllowed(
  itemGender: string | null | undefined,
  shopperGender: ShopperGender,
): boolean {
  const u = (shopperGender || 'unknown').toLowerCase();
  if (u !== 'male' && u !== 'female') return true; // no filter when unknown
  const i = (itemGender || '').toLowerCase();
  if (!i || i === 'unisex' || i === 'both') return true;
  if (u === 'male')   return i === 'male'   || i === 'men';
  if (u === 'female') return i === 'female' || i === 'women';
  return true;
}

/**
 * Convenience filter for arrays of items that carry a `gender`
 * field. Items with no gender or `unisex`/`both` pass for every
 * shopper. Reads `gender` at runtime so callers can use this with
 * any row shape without first widening the type.
 */
export function filterByShopperGender<T>(
  items: readonly T[],
  shopperGender: ShopperGender,
): T[] {
  const u = (shopperGender || 'unknown').toLowerCase();
  if (u !== 'male' && u !== 'female') return items.slice();
  return items.filter(it => {
    const g = (it as { gender?: string | null } | null | undefined)?.gender;
    return isGenderAllowed(g, shopperGender);
  });
}

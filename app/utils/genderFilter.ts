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
  if (i === 'unisex' || i === 'both') return true;
  // Untagged items are dropped for gendered shoppers so the opposite
  // catalog never leaks in. Callers that want to allow untagged can
  // pre-tag their items before handing them off.
  if (!i) return false;
  if (u === 'male')   return i === 'male'   || i === 'men';
  if (u === 'female') return i === 'female' || i === 'women';
  return true;
}

/**
 * Convenience filter for arrays of items that carry a `gender`
 * field. Reads gender from BOTH `it.gender` (Looks, raw products)
 * AND `it.product?.gender` (ProductAd creatives) so callers don't
 * have to widen their types or pre-flatten.
 */
export function filterByShopperGender<T>(
  items: readonly T[],
  shopperGender: ShopperGender,
): T[] {
  const u = (shopperGender || 'unknown').toLowerCase();
  if (u !== 'male' && u !== 'female') return items.slice();
  return items.filter(it => {
    const obj = it as {
      gender?: string | null;
      product?: { gender?: string | null } | null;
    } | null | undefined;
    const g = obj?.gender ?? obj?.product?.gender ?? null;
    return isGenderAllowed(g, shopperGender);
  });
}

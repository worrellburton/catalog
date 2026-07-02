// Shared product-role helpers used by the /generate product picker and the
// AI Stylist. A "role" is the garment slot a product fills, inferred from its
// name (we don't always have a clean taxonomy tag on every row).

export interface PickedProduct {
  id: string;
  name: string | null;
  brand: string | null;
  price: string | null;
  image_url: string | null;
  role_tag: string | null;
  // Optional richer media for the unified field cards (poster + product video).
  primary_image_url?: string | null;
  primary_video_url?: string | null;
  primary_video_poster_url?: string | null;
}

export const ROLE_TAGS = ['Hat', 'Top', 'Jacket', 'Dress', 'Pants', 'Shoes', 'Bag', 'Jewelry', 'Sunglasses', 'Accessory'];

// Governed `products.type` → picker/stylist role. The stored type is the
// curated value (set + corrected in /admin/governance), so when a product
// HAS one we trust it over the name-guess — that's what stops a skincare
// item ("type: skincare") landing in the Tops slot just because its name
// happens to contain a clothing word.
//
//   • a ROLE_TAG string → goes to that garment/accessory bucket
//   • null              → a KNOWN non-garment (beauty, home, tech, food…)
//                         or a wearable that isn't an outfit slot (underwear,
//                         loungewear, swimwear) → the picker's "Objects"
//                         bucket, never a clothing slot
//   • undefined         → type unrecognised → defer to the name heuristic
const TYPE_TO_ROLE: Record<string, string | null> = {
  // ── worn → a real slot ──
  shoes: 'Shoes',
  top: 'Top',
  outerwear: 'Jacket',
  suit: 'Jacket',
  dress: 'Dress',
  bottoms: 'Pants',
  hat: 'Hat',
  bag: 'Bag',
  wallet: 'Accessory',
  belt: 'Accessory',
  scarf: 'Accessory',
  gloves: 'Accessory',
  socks: 'Accessory',
  jewelry: 'Jewelry',
  watch: 'Jewelry',
  eyewear: 'Sunglasses',
  // ── real catalog `type` vocabulary (plurals + specific classes the
  //    curator actually stores). Without these, "Shirt"/"Sneakers"/"Shorts"
  //    (the common values) fall through to the fragile name heuristic —
  //    which mis-reads "Short Sleeve" as Pants and can't place a sneaker
  //    whose name carries no shoe word. The governed type must win. ──
  shirt: 'Top', shirts: 'Top', tops: 'Top',
  tee: 'Top', tees: 'Top', 't-shirt': 'Top', 't-shirts': 'Top', tshirt: 'Top', tshirts: 'Top',
  sweater: 'Top', sweaters: 'Top', knit: 'Top', knitwear: 'Top', pullover: 'Top',
  sweatshirt: 'Top', polo: 'Top', henley: 'Top', tank: 'Top', blouse: 'Top', bodysuit: 'Top',
  hoodie: 'Jacket', cardigan: 'Jacket', jacket: 'Jacket', jackets: 'Jacket',
  coat: 'Jacket', coats: 'Jacket', blazer: 'Jacket', bomber: 'Jacket', parka: 'Jacket', vest: 'Jacket',
  pants: 'Pants', trousers: 'Pants', shorts: 'Pants', jeans: 'Pants',
  leggings: 'Pants', skirt: 'Pants', skirts: 'Pants', joggers: 'Pants', chinos: 'Pants',
  dresses: 'Dress', gown: 'Dress',
  sneakers: 'Shoes', boots: 'Shoes', sandals: 'Shoes', heels: 'Shoes', loafers: 'Shoes', flats: 'Shoes', trainers: 'Shoes',
  bags: 'Bag', handbag: 'Bag', backpack: 'Bag', tote: 'Bag', purse: 'Bag', clutch: 'Bag',
  necklace: 'Jewelry', bracelet: 'Jewelry', ring: 'Jewelry', earrings: 'Jewelry', watches: 'Jewelry',
  sunglasses: 'Sunglasses',
  hats: 'Hat', cap: 'Hat', beanie: 'Hat',
  accessory: 'Accessory', accessories: 'Accessory',
  // Non-garment `type`s present in the catalog → keep out of outfit slots.
  art: null, plants: null, electronics: null, laptops: null, candles: null,
  beauty: null, snowboard: null, lamp: null, home: null, 'home fragrance': null,
  sunscreen: null, 'gift card': null, 'winter sports equipment': null,
  // ── wearable, but NOT an outfit slot → keep out of garment reels ──
  underwear: null,
  loungewear: null,
  swimwear: null,
  activewear: null,
  // ── non-garment → Objects ──
  skincare: null, fragrance: null, makeup: null, haircare: null, bodycare: null,
  book: null, magazine: null, stationery: null, toy: null, puzzle: null, game: null,
  phone: null, 'phone case': null, tablet: null, laptop: null, headphones: null,
  speaker: null, camera: null, tech: null,
  lighting: null, bedding: null, kitchenware: null, glassware: null, tableware: null,
  decor: null, furniture: null,
  coffee: null, tea: null, wine: null, spirits: null, drink: null, food: null, pet: null,
  yoga: null, fitness: null, bike: null, outdoor: null, camping: null,
};

/** Map a governed `products.type` to a role. Returns `undefined` (not
 *  `null`) when the type is unknown so the caller can fall back to the
 *  name heuristic; `null` means a known non-garment / non-slot item. */
export function roleTagFromType(type: string | null | undefined): string | null | undefined {
  if (!type) return undefined;
  const key = type.toLowerCase().trim();
  return key in TYPE_TO_ROLE ? TYPE_TO_ROLE[key] : undefined;
}

/** Resolve a product's role: the governed type wins (including a deliberate
 *  null for non-garments); only when there's no usable type do we guess
 *  from the name. */
export function roleForProduct(
  type: string | null | undefined,
  name: string | null | undefined,
): string | null {
  const fromType = roleTagFromType(type);
  if (fromType !== undefined) return fromType;
  return roleTagFromName(name ?? null);
}

// Order matters: the FIRST pattern that matches wins, so the most specific /
// least ambiguous garment classes are tested first. Footwear is checked BEFORE
// tops so a "track shoe" or "boot" can never fall through to the Top bucket
// (that was the "shoes under Tops" bug); outerwear is checked before tops so a
// "shirt jacket"/"shacket" lands in Jacket, not Top.
export function roleTagFromName(name: string | null): string | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  if (/\b(hat|cap|beanie|visor|fedora|bucket\s*hat)\b/.test(lower)) return 'Hat';
  if (/\b(sunglass|shades|eyewear|goggles)\b/.test(lower)) return 'Sunglasses';
  // Footwear — checked early so it never leaks into Top/Jacket. Covers the
  // women's-heel family that previously slipped through (pump, stiletto, mule,
  // wedge, slingback) plus thong/flip-flop sandals.
  if (/\b(sneaker|trainer|shoe|boot|bootie|heel|heels|loafer|sandal|slide|mule|pump|stiletto|wedge|espadrille|flip[\s-]?flop|moccasin|oxford|derby|brogue|clog|slingback|flat|flats|thong)\b/.test(lower)) return 'Shoes';
  // Outerwear — before tops so "shirt jacket"/"shacket" reads as a Jacket.
  if (/\b(jacket|shacket|coat|parka|blazer|hoodie|cardigan|overshirt|windbreaker|anorak|vest|gilet|bomber|trench|puffer|raincoat)\b/.test(lower)) return 'Jacket';
  if (/\b(dress|gown|frock)\b/.test(lower)) return 'Dress';
  // "short(s)" must NOT match "short sleeve" (that's a top) — negative lookahead.
  if (/\b(pant|pants|trouser|trousers|chino|chinos|jean|jeans|denim|shorts?(?!\s+sleeve)|skirt|legging|leggings|joggers|sweatpant|sweatpants|cargo|cargos|slacks|culotte|culottes)\b/.test(lower)) return 'Pants';
  if (/\b(bag|tote|clutch|purse|backpack|handbag|crossbody|satchel|duffel|duffle)\b/.test(lower)) return 'Bag';
  if (/\b(necklace|ring|earring|earrings|bracelet|watch|chain|pendant|anklet|brooch|cufflink|cufflinks)\b/.test(lower)) return 'Jewelry';
  if (/\b(shirt|tee|t-shirt|tshirt|top|sweater|jumper|knit|polo|henley|tank|camisole|cami|blouse|bodysuit|turtleneck|crewneck|crew|pullover|sweatshirt)\b/.test(lower)) return 'Top';
  return null;
}

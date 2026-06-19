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
  if (/\b(pant|pants|trouser|trousers|chino|chinos|jean|jeans|denim|short|shorts|skirt|legging|leggings|joggers|sweatpant|sweatpants|cargo|cargos|slacks|culotte|culottes)\b/.test(lower)) return 'Pants';
  if (/\b(bag|tote|clutch|purse|backpack|handbag|crossbody|satchel|duffel|duffle)\b/.test(lower)) return 'Bag';
  if (/\b(necklace|ring|earring|earrings|bracelet|watch|chain|pendant|anklet|brooch|cufflink|cufflinks)\b/.test(lower)) return 'Jewelry';
  if (/\b(shirt|tee|t-shirt|tshirt|top|sweater|jumper|knit|polo|henley|tank|camisole|cami|blouse|bodysuit|turtleneck|crewneck|crew|pullover|sweatshirt)\b/.test(lower)) return 'Top';
  return null;
}

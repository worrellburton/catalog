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

export function roleTagFromName(name: string | null): string | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  if (/\b(hat|cap|beanie)\b/.test(lower)) return 'Hat';
  if (/\b(sunglass|shades|eyewear)\b/.test(lower)) return 'Sunglasses';
  if (/\b(jacket|coat|parka|blazer)\b/.test(lower)) return 'Jacket';
  if (/\b(dress|gown)\b/.test(lower)) return 'Dress';
  if (/\b(pant|trouser|chino|jean|denim|short|skirt|legging)\b/.test(lower)) return 'Pants';
  if (/\b(sneaker|trainer|shoe|boot|heel|loafer|sandal)\b/.test(lower)) return 'Shoes';
  if (/\b(bag|tote|clutch|purse|backpack)\b/.test(lower)) return 'Bag';
  if (/\b(necklace|ring|earring|bracelet|watch|chain|pendant)\b/.test(lower)) return 'Jewelry';
  if (/\b(shirt|tee|top|sweater|hoodie|polo|henley|tank)\b/.test(lower)) return 'Top';
  return null;
}

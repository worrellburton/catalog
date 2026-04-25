import { supabase } from '~/utils/supabase';

/**
 * Single-value product type vocabulary. Used for the `type` column on
 * products. Order matters: more specific patterns must come before
 * generic ones (e.g. "Sunglasses" before "Glasses", "Phone Case"
 * before "Phone").
 */
export const PRODUCT_TYPES = [
  'Hat', 'Sunglasses', 'Glasses',
  'Top', 'Jacket', 'Coat', 'Dress', 'Skirt', 'Pants', 'Shorts', 'Suit',
  'Shoes', 'Sneakers', 'Boots', 'Sandals', 'Heels',
  'Bag', 'Wallet', 'Belt', 'Scarf', 'Gloves', 'Socks',
  'Watch', 'Necklace', 'Ring', 'Earrings', 'Bracelet', 'Jewelry',
  'Swimwear', 'Underwear', 'Loungewear', 'Activewear',
  'Book', 'Magazine', 'Stationery',
  'Skincare', 'Fragrance', 'Makeup', 'Haircare', 'Bodycare',
  'Phone Case', 'Headphones', 'Speaker', 'Camera', 'Phone', 'Tablet', 'Laptop', 'Tech',
  'Furniture', 'Decor', 'Bedding', 'Lighting', 'Kitchenware', 'Glassware', 'Tableware',
  'Fitness', 'Yoga', 'Outdoor', 'Camping', 'Bike',
  'Toy', 'Game', 'Puzzle',
  'Food', 'Drink', 'Coffee', 'Tea', 'Wine', 'Spirits',
  'Pet',
  'Accessory',
] as const;

export type ProductType = (typeof PRODUCT_TYPES)[number];

interface TypeRule {
  type: ProductType;
  patterns: RegExp[];
}

// Order from most-specific to least-specific. The first match wins.
const TYPE_RULES: TypeRule[] = [
  { type: 'Phone Case',  patterns: [/\b(iphone|phone)\s*case\b/i, /\bcase\s*for\s*(iphone|phone)\b/i] },
  { type: 'Sunglasses',  patterns: [/\b(sunglass|shades|sunnies|aviator|wayfarer)\b/i] },
  { type: 'Glasses',     patterns: [/\b(eyewear|eyeglasses|reading\s*glasses|optical\s*frame)\b/i] },
  { type: 'Hat',         patterns: [/\b(hat|cap|beanie|fedora|bucket\s*hat|visor|trucker)\b/i] },
  { type: 'Sneakers',    patterns: [/\b(sneaker|trainer|runner|kicks)\b/i] },
  { type: 'Boots',       patterns: [/\b(boot|chelsea|combat|hiking\s*boot)\b/i] },
  { type: 'Heels',       patterns: [/\b(heel|stiletto|pump|high-heel)\b/i] },
  { type: 'Sandals',     patterns: [/\b(sandal|flip[-\s]?flop|slide|espadrille)\b/i] },
  { type: 'Shoes',       patterns: [/\b(shoe|loafer|oxford|moccasin|derby|brogue|mule|clog)\b/i] },
  { type: 'Wallet',      patterns: [/\b(wallet|cardholder|card\s*case|coin\s*purse)\b/i] },
  { type: 'Bag',         patterns: [/\b(bag|tote|clutch|purse|backpack|handbag|crossbody|satchel|duffel|messenger|shoulder\s*bag)\b/i] },
  { type: 'Belt',        patterns: [/\bbelt\b/i] },
  { type: 'Scarf',       patterns: [/\b(scarf|stole|wrap|shawl)\b/i] },
  { type: 'Gloves',      patterns: [/\b(glove|mitten|mitt)\b/i] },
  { type: 'Socks',       patterns: [/\b(sock|hosiery|tights)\b/i] },
  { type: 'Watch',       patterns: [/\b(watch|wristwatch|timepiece)\b/i] },
  { type: 'Necklace',    patterns: [/\b(necklace|pendant|chain)\b/i] },
  { type: 'Ring',        patterns: [/\bring\b/i] },
  { type: 'Earrings',    patterns: [/\bearring\b/i] },
  { type: 'Bracelet',    patterns: [/\b(bracelet|cuff|bangle)\b/i] },
  { type: 'Jewelry',     patterns: [/\b(jewelry|jewellery)\b/i] },
  { type: 'Swimwear',    patterns: [/\b(swim|bikini|swimsuit|trunks|board\s*short|one[-\s]piece)\b/i] },
  { type: 'Underwear',   patterns: [/\b(underwear|brief|boxer|panty|panties|bra|lingerie)\b/i] },
  { type: 'Loungewear',  patterns: [/\b(lounge|pajama|pyjama|pj|sleepwear|robe|slipper)\b/i] },
  { type: 'Activewear',  patterns: [/\b(activewear|legging|sport[-\s]?bra|gym\s*short)\b/i] },
  { type: 'Yoga',        patterns: [/\b(yoga\s*(mat|block|strap)|pilates)\b/i] },
  { type: 'Fitness',     patterns: [/\b(dumbbell|kettlebell|barbell|resistance\s*band|jump\s*rope|treadmill|bike\s*trainer|gym\s*equipment)\b/i] },
  { type: 'Bike',        patterns: [/\b(bicycle|mountain\s*bike|road\s*bike|e[-\s]?bike)\b/i] },
  { type: 'Outdoor',     patterns: [/\b(tent|sleeping\s*bag|backpacking\s*pack|hiking\s*pole)\b/i] },
  { type: 'Camping',     patterns: [/\b(camp\s*stove|cooler|lantern|hammock)\b/i] },
  { type: 'Phone',       patterns: [/\b(iphone|smartphone|android\s*phone|pixel\s*phone|galaxy\s*phone)\b/i] },
  { type: 'Tablet',      patterns: [/\b(ipad|tablet)\b/i] },
  { type: 'Laptop',      patterns: [/\b(macbook|laptop|notebook\s*pc|chromebook)\b/i] },
  { type: 'Headphones',  patterns: [/\b(headphone|earbud|earphone|airpods|over[-\s]ear|in[-\s]ear)\b/i] },
  { type: 'Speaker',     patterns: [/\b(speaker|soundbar|subwoofer|smart\s*speaker)\b/i] },
  { type: 'Camera',      patterns: [/\b(camera|dslr|mirrorless|gopro|camcorder|film\s*camera)\b/i] },
  { type: 'Tech',        patterns: [/\b(charger|cable|adapter|power\s*bank|hub|dongle|usb[-\s]?c|keyboard|mouse|monitor|webcam)\b/i] },
  { type: 'Lighting',    patterns: [/\b(lamp|light\s*fixture|chandelier|sconce|pendant\s*light)\b/i] },
  { type: 'Bedding',     patterns: [/\b(sheet\s*set|duvet|comforter|pillow|pillowcase|bedding|quilt|throw\s*blanket)\b/i] },
  { type: 'Kitchenware', patterns: [/\b(pan|skillet|saucepan|dutch\s*oven|cookware|knife|chef'?s\s*knife|cutting\s*board|spatula)\b/i] },
  { type: 'Glassware',   patterns: [/\b(wine\s*glass|tumbler|champagne\s*flute|coupe|highball)\b/i] },
  { type: 'Tableware',   patterns: [/\b(plate\s*set|bowl\s*set|dinner\s*set|flatware|cutlery)\b/i] },
  { type: 'Decor',       patterns: [/\b(vase|candle|frame|art\s*print|poster|mirror|rug|tapestry)\b/i] },
  { type: 'Furniture',   patterns: [/\b(sofa|couch|chair|stool|table|desk|shelf|bookcase|nightstand|dresser)\b/i] },
  { type: 'Coffee',      patterns: [/\b(coffee\s*beans|espresso|french\s*press|moka\s*pot|coffee\s*maker)\b/i] },
  { type: 'Tea',         patterns: [/\b(tea\s*(bag|leaves|set)|matcha|herbal\s*tea)\b/i] },
  { type: 'Wine',        patterns: [/\b(wine|cabernet|merlot|chardonnay|pinot|sauvignon|riesling|prosecco|champagne)\b/i] },
  { type: 'Spirits',     patterns: [/\b(whisk(e)?y|bourbon|scotch|tequila|mezcal|gin|vodka|rum)\b/i] },
  { type: 'Drink',       patterns: [/\b(soda|beverage|sparkling\s*water|kombucha|juice)\b/i] },
  { type: 'Food',        patterns: [/\b(snack|chocolate|granola|cereal|pasta|cookie|popcorn|jerky|sauce|seasoning)\b/i] },
  { type: 'Pet',         patterns: [/\b(pet|dog\s*(toy|leash|bed|food)|cat\s*(toy|tree|food)|aquarium|fish\s*tank)\b/i] },
  { type: 'Skincare',    patterns: [/\b(serum|moisturizer|cleanser|toner|sunscreen|spf|exfoliant|retinol|niacinamide)\b/i] },
  { type: 'Fragrance',   patterns: [/\b(perfume|cologne|eau\s*de\s*(toilette|parfum)|fragrance)\b/i] },
  { type: 'Makeup',      patterns: [/\b(lipstick|mascara|foundation|blush|eyeshadow|concealer|highlighter|eyeliner)\b/i] },
  { type: 'Haircare',    patterns: [/\b(shampoo|conditioner|hair\s*(oil|mask|spray|gel|cream))\b/i] },
  { type: 'Bodycare',    patterns: [/\b(body\s*(wash|lotion|oil|scrub|butter)|deodorant|hand\s*cream)\b/i] },
  { type: 'Magazine',    patterns: [/\b(magazine|issue\s*\d|periodical)\b/i] },
  { type: 'Book',        patterns: [/\b(book|novel|memoir|biography|hardcover|paperback|audiobook|cookbook)\b/i] },
  { type: 'Stationery',  patterns: [/\b(pen|pencil|notebook(?!\s*pc)|journal|planner|sticky\s*note|marker)\b/i] },
  { type: 'Toy',         patterns: [/\b(toy|stuffed\s*animal|action\s*figure|lego|building\s*block|doll)\b/i] },
  { type: 'Puzzle',      patterns: [/\bpuzzle\b/i] },
  { type: 'Game',        patterns: [/\b(board\s*game|card\s*game|video\s*game|console\s*game|tabletop)\b/i] },
  { type: 'Suit',        patterns: [/\b(suit|tuxedo|blazer\s*(and|&)\s*pants)\b/i] },
  { type: 'Coat',        patterns: [/\b(coat|parka|trench|peacoat|overcoat|topcoat)\b/i] },
  { type: 'Jacket',      patterns: [/\b(jacket|bomber|windbreaker|fleece|puffer|gilet|vest|cardigan|blazer)\b/i] },
  { type: 'Dress',       patterns: [/\b(dress|gown|frock|sundress|maxi)\b/i] },
  { type: 'Skirt',       patterns: [/\bskirt\b/i] },
  { type: 'Shorts',      patterns: [/\b(short|bermuda|cargo\s*short)\b/i] },
  { type: 'Pants',       patterns: [/\b(pant|trouser|chino|jean|denim|legging|joggers|sweatpant|cargo)\b/i] },
  { type: 'Top',         patterns: [/\b(shirt|tee|t-shirt|top|sweater|hoodie|polo|henley|tank|tunic|knit|sweatshirt|jersey|button[-\s]?up|button[-\s]?down)\b/i] },
];

/**
 * Pick the most specific matching product type for a given name. The
 * brand is ignored for now; the product name carries the signal in
 * 99% of cases. Returns `null` when nothing matches so callers can
 * decide whether to skip writing anything to the row.
 */
export function inferProductType(
  name: string | null | undefined,
  _brand?: string | null,
): ProductType | null {
  if (!name) return null;
  for (const rule of TYPE_RULES) {
    if (rule.patterns.some(rx => rx.test(name))) return rule.type;
  }
  return null;
}

interface AuditResult {
  scanned: number;
  updated: number;
  skipped: number;
  errors: number;
}

/**
 * Walk every product, infer a type from its name, and write it back
 * if the existing value is null or different. Returns counters so
 * the admin UI can report what changed.
 */
export async function auditAllProductTypes(): Promise<AuditResult> {
  const result: AuditResult = { scanned: 0, updated: 0, skipped: 0, errors: 0 };
  if (!supabase) return result;
  const { data, error } = await supabase
    .from('products')
    .select('id, name, brand, type');
  if (error || !data) return result;
  const updates: { id: string; type: ProductType }[] = [];
  for (const row of data) {
    result.scanned++;
    const inferred = inferProductType(row.name, row.brand);
    if (!inferred) { result.skipped++; continue; }
    if (row.type === inferred) { result.skipped++; continue; }
    updates.push({ id: row.id, type: inferred });
  }
  for (const u of updates) {
    const { error: updErr } = await supabase
      .from('products')
      .update({ type: u.type })
      .eq('id', u.id);
    if (updErr) result.errors++;
    else result.updated++;
  }
  return result;
}

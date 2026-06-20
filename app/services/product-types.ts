import { supabase } from '~/utils/supabase';

/**
 * Two-level product taxonomy.
 *
 *   • `type`    — the broad bucket a shopper filters by (Shoes, Top,
 *                 Outerwear, Bottoms, Bag, …).
 *   • `subtype` — the finer classifier WITHIN a type (Shoes → Sneakers /
 *                 Boots / Sandals / Heels / Loafers …).
 *
 * Example: "UGG Classic Micro" → type "Shoes", subtype "Boots".
 *          "Birkenstock Arizona" → type "Shoes", subtype "Sandals".
 *
 * The consumer chip shows `subtype || type`, so a broad type paired with a
 * specific subtype reads naturally ("Sandals") while ungrouped types still
 * show their own label.
 */

interface TaxonomyRule {
  type: string;
  /** null = a broad fallback for the type when no subtype pattern matched. */
  subtype: string | null;
  patterns: RegExp[];
}

// Ordered most-specific → least-specific. The FIRST rule that matches the
// product name wins, so within a category the subtype rules must precede that
// category's broad fallback, and narrow categories (Phone Case) precede the
// generic ones (Phone). Adding a rule? Drop it above the broad fallback for
// its type.
const RULES: TaxonomyRule[] = [
  // ── Tech accessories that collide with broader words ──
  { type: 'Phone Case',  subtype: null,          patterns: [/\b(iphone|phone)\s*case\b/i, /\bcase\s*for\s*(iphone|phone)\b/i] },

  // ── Eyewear ──
  { type: 'Eyewear',     subtype: 'Sunglasses',  patterns: [/\b(sunglass|shades|sunnies|aviator|wayfarer)\b/i] },
  { type: 'Eyewear',     subtype: 'Glasses',     patterns: [/\b(eyewear|eyeglasses|reading\s*glasses|optical\s*frame|glasses)\b/i] },

  // ── Headwear ──
  { type: 'Hat',         subtype: 'Beanie',      patterns: [/\bbeanie\b/i] },
  { type: 'Hat',         subtype: 'Bucket Hat',  patterns: [/\bbucket\s*hat\b/i] },
  { type: 'Hat',         subtype: 'Fedora',      patterns: [/\b(fedora|panama\s*hat|trilby)\b/i] },
  { type: 'Hat',         subtype: 'Visor',       patterns: [/\bvisor\b/i] },
  { type: 'Hat',         subtype: 'Cap',         patterns: [/\b(cap|trucker|snapback|dad\s*hat)\b/i] },
  { type: 'Hat',         subtype: null,          patterns: [/\bhat\b/i] },

  // ── Footwear (type = Shoes) ──
  { type: 'Shoes',       subtype: 'Sneakers',    patterns: [/\b(sneaker|trainer|runner|kicks|hi[-\s]?top)\b/i] },
  { type: 'Shoes',       subtype: 'Boots',       patterns: [/\b(boot|chelsea|combat\s*boot|hiking\s*boot|ugg|chukka)\b/i] },
  { type: 'Shoes',       subtype: 'Heels',       patterns: [/\b(heel|stiletto|pump|high-?heel)\b/i] },
  { type: 'Shoes',       subtype: 'Sandals',     patterns: [/\b(sandal|flip[-\s]?flop|slide|espadrille|thong|birkenstock)\b/i] },
  { type: 'Shoes',       subtype: 'Loafers',     patterns: [/\b(loafer|moccasin|driving\s*shoe|boat\s*shoe)\b/i] },
  { type: 'Shoes',       subtype: 'Oxfords',     patterns: [/\b(oxford|derby|brogue|dress\s*shoe|wingtip)\b/i] },
  { type: 'Shoes',       subtype: 'Flats',       patterns: [/\b(ballet\s*flat|flats|mule|clog)\b/i] },
  { type: 'Shoes',       subtype: null,          patterns: [/\b(shoe|footwear)\b/i] },

  // ── Bags & small leather goods ──
  { type: 'Bag',         subtype: 'Backpack',    patterns: [/\b(backpack|rucksack|book\s*bag)\b/i] },
  { type: 'Bag',         subtype: 'Tote',        patterns: [/\btote\b/i] },
  { type: 'Bag',         subtype: 'Clutch',      patterns: [/\bclutch\b/i] },
  { type: 'Bag',         subtype: 'Crossbody',   patterns: [/\b(crossbody|messenger|shoulder\s*bag)\b/i] },
  { type: 'Bag',         subtype: 'Duffel',      patterns: [/\b(duffel|weekender|gym\s*bag)\b/i] },
  { type: 'Bag',         subtype: 'Handbag',     patterns: [/\b(handbag|purse|satchel|hobo|baguette)\b/i] },
  { type: 'Bag',         subtype: null,          patterns: [/\bbag\b/i] },
  { type: 'Wallet',      subtype: null,          patterns: [/\b(wallet|cardholder|card\s*case|coin\s*purse)\b/i] },

  // ── Worn accessories ──
  { type: 'Belt',        subtype: null,          patterns: [/\bbelt\b/i] },
  { type: 'Scarf',       subtype: null,          patterns: [/\b(scarf|stole|wrap|shawl)\b/i] },
  { type: 'Gloves',      subtype: null,          patterns: [/\b(glove|mitten|mitt)\b/i] },
  { type: 'Socks',       subtype: null,          patterns: [/\b(sock|hosiery|tights)\b/i] },

  // ── Jewelry & watches ──
  { type: 'Watch',       subtype: null,          patterns: [/\b(watch|wristwatch|timepiece)\b/i] },
  { type: 'Jewelry',     subtype: 'Necklace',    patterns: [/\b(necklace|pendant|chain)\b/i] },
  { type: 'Jewelry',     subtype: 'Ring',        patterns: [/\bring\b/i] },
  { type: 'Jewelry',     subtype: 'Earrings',    patterns: [/\bearring\b/i] },
  { type: 'Jewelry',     subtype: 'Bracelet',    patterns: [/\b(bracelet|cuff|bangle)\b/i] },
  { type: 'Jewelry',     subtype: null,          patterns: [/\b(jewelry|jewellery|anklet|brooch)\b/i] },

  // ── Specialised apparel (before the generic Top/Bottoms catch-alls) ──
  { type: 'Swimwear',    subtype: 'Bikini',      patterns: [/\bbikini\b/i] },
  { type: 'Swimwear',    subtype: 'Trunks',      patterns: [/\b(trunks|board\s*short)\b/i] },
  { type: 'Swimwear',    subtype: null,          patterns: [/\b(swim|swimsuit|one[-\s]piece)\b/i] },
  { type: 'Underwear',   subtype: 'Bra',         patterns: [/\b(bra|bralette)\b/i] },
  { type: 'Underwear',   subtype: null,          patterns: [/\b(underwear|brief|boxer|panty|panties|lingerie)\b/i] },
  { type: 'Loungewear',  subtype: null,          patterns: [/\b(lounge|pajama|pyjama|pj|sleepwear|robe|slipper)\b/i] },
  { type: 'Activewear',  subtype: 'Sports Bra',  patterns: [/\bsport[-\s]?bra\b/i] },
  { type: 'Activewear',  subtype: null,          patterns: [/\b(activewear|gym\s*short)\b/i] },

  // ── Outerwear (type = Outerwear) ──
  { type: 'Outerwear',   subtype: 'Puffer',      patterns: [/\b(puffer|down\s*jacket)\b/i] },
  { type: 'Outerwear',   subtype: 'Parka',       patterns: [/\bparka\b/i] },
  { type: 'Outerwear',   subtype: 'Trench',      patterns: [/\btrench\b/i] },
  { type: 'Outerwear',   subtype: 'Bomber',      patterns: [/\bbomber\b/i] },
  { type: 'Outerwear',   subtype: 'Blazer',      patterns: [/\bblazer\b/i] },
  { type: 'Outerwear',   subtype: 'Coat',        patterns: [/\b(coat|peacoat|overcoat|topcoat)\b/i] },
  { type: 'Outerwear',   subtype: 'Windbreaker', patterns: [/\b(windbreaker|anorak|rain\s*jacket|raincoat)\b/i] },
  { type: 'Outerwear',   subtype: 'Fleece',      patterns: [/\bfleece\b/i] },
  { type: 'Outerwear',   subtype: 'Vest',        patterns: [/\b(vest|gilet)\b/i] },
  { type: 'Outerwear',   subtype: 'Jacket',      patterns: [/\bjacket\b/i] },

  // ── Suit / formalwear ──
  { type: 'Suit',        subtype: null,          patterns: [/\b(suit|tuxedo|tux\b)/i] },

  // ── Dresses ──
  { type: 'Dress',       subtype: 'Gown',        patterns: [/\bgown\b/i] },
  { type: 'Dress',       subtype: null,          patterns: [/\b(dress|frock|sundress|maxi)\b/i] },

  // ── Bottoms (type = Bottoms) ──
  { type: 'Bottoms',     subtype: 'Jeans',       patterns: [/\b(jean|denim)\b/i] },
  { type: 'Bottoms',     subtype: 'Shorts',      patterns: [/\b(short|bermuda|cargo\s*short)\b/i] },
  { type: 'Bottoms',     subtype: 'Skirt',       patterns: [/\bskirt\b/i] },
  { type: 'Bottoms',     subtype: 'Leggings',    patterns: [/\b(legging|yoga\s*pant)\b/i] },
  { type: 'Bottoms',     subtype: 'Joggers',     patterns: [/\b(jogger|sweatpant|track\s*pant)\b/i] },
  { type: 'Bottoms',     subtype: 'Chinos',      patterns: [/\b(chino|khaki)\b/i] },
  { type: 'Bottoms',     subtype: null,          patterns: [/\b(pant|trouser|cargo|slacks)\b/i] },

  // ── Tops (type = Top) — keep last among apparel; "shirt/tee" is broad ──
  { type: 'Top',         subtype: 'Hoodie',      patterns: [/\b(hoodie|hooded\s*sweatshirt)\b/i] },
  { type: 'Top',         subtype: 'Sweatshirt',  patterns: [/\b(sweatshirt|crewneck)\b/i] },
  { type: 'Top',         subtype: 'Sweater',     patterns: [/\b(sweater|knit|pullover|jumper|cardigan|turtleneck)\b/i] },
  { type: 'Top',         subtype: 'Polo',        patterns: [/\bpolo\b/i] },
  { type: 'Top',         subtype: 'Henley',      patterns: [/\bhenley\b/i] },
  { type: 'Top',         subtype: 'Tank',        patterns: [/\b(tank|camisole|cami)\b/i] },
  { type: 'Top',         subtype: 'T-Shirt',     patterns: [/\b(t-?shirt|tee)\b/i] },
  { type: 'Top',         subtype: 'Shirt',       patterns: [/\b(shirt|button[-\s]?up|button[-\s]?down|blouse)\b/i] },
  { type: 'Top',         subtype: 'Tunic',       patterns: [/\btunic\b/i] },
  { type: 'Top',         subtype: null,          patterns: [/\b(top|jersey)\b/i] },

  // ── Fitness / outdoor gear ──
  { type: 'Yoga',        subtype: null,          patterns: [/\b(yoga\s*(mat|block|strap)|pilates)\b/i] },
  { type: 'Fitness',     subtype: null,          patterns: [/\b(dumbbell|kettlebell|barbell|resistance\s*band|jump\s*rope|treadmill|gym\s*equipment)\b/i] },
  { type: 'Bike',        subtype: null,          patterns: [/\b(bicycle|mountain\s*bike|road\s*bike|e[-\s]?bike)\b/i] },
  { type: 'Outdoor',     subtype: null,          patterns: [/\b(tent|sleeping\s*bag|backpacking\s*pack|hiking\s*pole)\b/i] },
  { type: 'Camping',     subtype: null,          patterns: [/\b(camp\s*stove|cooler|lantern|hammock)\b/i] },

  // ── Tech ──
  { type: 'Phone',       subtype: null,          patterns: [/\b(iphone|smartphone|android\s*phone|pixel\s*phone|galaxy\s*phone)\b/i] },
  { type: 'Tablet',      subtype: null,          patterns: [/\b(ipad|tablet)\b/i] },
  { type: 'Laptop',      subtype: null,          patterns: [/\b(macbook|laptop|notebook\s*pc|chromebook)\b/i] },
  { type: 'Headphones',  subtype: null,          patterns: [/\b(headphone|earbud|earphone|airpods|over[-\s]ear|in[-\s]ear)\b/i] },
  { type: 'Speaker',     subtype: null,          patterns: [/\b(speaker|soundbar|subwoofer|smart\s*speaker)\b/i] },
  { type: 'Camera',      subtype: null,          patterns: [/\b(camera|dslr|mirrorless|gopro|camcorder|film\s*camera)\b/i] },
  { type: 'Tech',        subtype: null,          patterns: [/\b(charger|cable|adapter|power\s*bank|hub|dongle|usb[-\s]?c|keyboard|mouse|monitor|webcam)\b/i] },

  // ── Home ──
  { type: 'Lighting',    subtype: null,          patterns: [/\b(lamp|light\s*fixture|chandelier|sconce|pendant\s*light)\b/i] },
  { type: 'Bedding',     subtype: null,          patterns: [/\b(sheet\s*set|duvet|comforter|pillow|pillowcase|bedding|quilt|throw\s*blanket)\b/i] },
  { type: 'Kitchenware', subtype: null,          patterns: [/\b(pan|skillet|saucepan|dutch\s*oven|cookware|knife|chef'?s\s*knife|cutting\s*board|spatula)\b/i] },
  { type: 'Glassware',   subtype: null,          patterns: [/\b(wine\s*glass|tumbler|champagne\s*flute|coupe|highball)\b/i] },
  { type: 'Tableware',   subtype: null,          patterns: [/\b(plate\s*set|bowl\s*set|dinner\s*set|flatware|cutlery)\b/i] },
  { type: 'Decor',       subtype: null,          patterns: [/\b(vase|candle|frame|art\s*print|poster|mirror|rug|tapestry)\b/i] },
  { type: 'Furniture',   subtype: null,          patterns: [/\b(sofa|couch|chair|stool|table|desk|shelf|bookcase|nightstand|dresser)\b/i] },

  // ── Consumables ──
  { type: 'Coffee',      subtype: null,          patterns: [/\b(coffee\s*beans|espresso|french\s*press|moka\s*pot|coffee\s*maker)\b/i] },
  { type: 'Tea',         subtype: null,          patterns: [/\b(tea\s*(bag|leaves|set)|matcha|herbal\s*tea)\b/i] },
  { type: 'Wine',        subtype: null,          patterns: [/\b(wine|cabernet|merlot|chardonnay|pinot|sauvignon|riesling|prosecco|champagne)\b/i] },
  { type: 'Spirits',     subtype: null,          patterns: [/\b(whisk(e)?y|bourbon|scotch|tequila|mezcal|gin|vodka|rum)\b/i] },
  { type: 'Drink',       subtype: null,          patterns: [/\b(soda|beverage|sparkling\s*water|kombucha|juice)\b/i] },
  { type: 'Food',        subtype: null,          patterns: [/\b(snack|chocolate|granola|cereal|pasta|cookie|popcorn|jerky|sauce|seasoning)\b/i] },
  { type: 'Pet',         subtype: null,          patterns: [/\b(pet|dog\s*(toy|leash|bed|food)|cat\s*(toy|tree|food)|aquarium|fish\s*tank)\b/i] },

  // ── Beauty ──
  { type: 'Skincare',    subtype: null,          patterns: [/\b(serum|moisturizer|cleanser|toner|sunscreen|spf|exfoliant|retinol|niacinamide)\b/i] },
  { type: 'Fragrance',   subtype: null,          patterns: [/\b(perfume|cologne|eau\s*de\s*(toilette|parfum)|fragrance|home\s*fragrance)\b/i] },
  { type: 'Makeup',      subtype: null,          patterns: [/\b(lipstick|mascara|foundation|blush|eyeshadow|concealer|highlighter|eyeliner)\b/i] },
  { type: 'Haircare',    subtype: null,          patterns: [/\b(shampoo|conditioner|hair\s*(oil|mask|spray|gel|cream))\b/i] },
  { type: 'Bodycare',    subtype: null,          patterns: [/\b(body\s*(wash|lotion|oil|scrub|butter)|deodorant|hand\s*cream)\b/i] },

  // ── Media & misc ──
  { type: 'Magazine',    subtype: null,          patterns: [/\b(magazine|issue\s*\d|periodical)\b/i] },
  { type: 'Book',        subtype: null,          patterns: [/\b(book|novel|memoir|biography|hardcover|paperback|audiobook|cookbook)\b/i] },
  { type: 'Stationery',  subtype: null,          patterns: [/\b(pen|pencil|notebook(?!\s*pc)|journal|planner|sticky\s*note|marker)\b/i] },
  { type: 'Toy',         subtype: null,          patterns: [/\b(toy|stuffed\s*animal|action\s*figure|lego|building\s*block|doll)\b/i] },
  { type: 'Puzzle',      subtype: null,          patterns: [/\bpuzzle\b/i] },
  { type: 'Game',        subtype: null,          patterns: [/\b(board\s*game|card\s*game|video\s*game|console\s*game|tabletop)\b/i] },
];

/** Broad types, derived from the taxonomy (handy for filters / validation). */
export const PRODUCT_TYPES: string[] = Array.from(new Set(RULES.map(r => r.type)));

export interface TaxonomyResult {
  type: string;
  subtype: string | null;
}

/**
 * Infer the broad `type` AND finer `subtype` for a product from its name.
 * First matching rule wins (rules ordered specific → generic). Returns null
 * when nothing matches so callers can decide whether to skip the row.
 */
export function inferProductTypeAndSubtype(
  name: string | null | undefined,
  _brand?: string | null,
): TaxonomyResult | null {
  if (!name) return null;
  for (const rule of RULES) {
    if (rule.patterns.some(rx => rx.test(name))) {
      return { type: rule.type, subtype: rule.subtype };
    }
  }
  return null;
}

export interface InferenceExplanation extends TaxonomyResult {
  /** The exact substring in the name that triggered the match — so the admin
   *  can SEE why "Premier Low Top" became a Top (it matched "top"). */
  matchedText: string;
}

/**
 * Same as {@link inferProductTypeAndSubtype} but also returns the exact
 * substring in the name that triggered the matching rule. Powers the "how
 * this type was constructed" derivation map in the admin products table.
 */
export function explainProductTypeInference(
  name: string | null | undefined,
): InferenceExplanation | null {
  if (!name) return null;
  for (const rule of RULES) {
    for (const rx of rule.patterns) {
      const m = rx.exec(name);
      if (m) return { type: rule.type, subtype: rule.subtype, matchedText: m[0] };
    }
  }
  return null;
}

/**
 * Back-compat helper — returns just the broad `type` (or null). Prefer
 * {@link inferProductTypeAndSubtype} for new code that wants the subtype too.
 */
export function inferProductType(
  name: string | null | undefined,
  brand?: string | null,
): string | null {
  return inferProductTypeAndSubtype(name, brand)?.type ?? null;
}

interface AuditResult {
  scanned: number;
  updated: number;
  skipped: number;
  errors: number;
}

/**
 * Walk every product, infer its type + subtype from the name, and write
 * BOTH back when either differs from what's stored. Returns counters so the
 * admin UI can report what changed.
 */
export async function auditAllProductTypes(): Promise<AuditResult> {
  const result: AuditResult = { scanned: 0, updated: 0, skipped: 0, errors: 0 };
  if (!supabase) return result;
  const { data, error } = await supabase
    .from('products')
    .select('id, name, brand, type, subtype');
  if (error || !data) return result;
  const updates: { id: string; type: string; subtype: string | null }[] = [];
  for (const row of data) {
    result.scanned++;
    const inferred = inferProductTypeAndSubtype(row.name, row.brand);
    if (!inferred) { result.skipped++; continue; }
    const current = row as { type?: string | null; subtype?: string | null };
    if (current.type === inferred.type && (current.subtype ?? null) === inferred.subtype) {
      result.skipped++;
      continue;
    }
    updates.push({ id: row.id, type: inferred.type, subtype: inferred.subtype });
  }
  for (const u of updates) {
    const { error: updErr } = await supabase
      .from('products')
      .update({ type: u.type, subtype: u.subtype })
      .eq('id', u.id);
    if (updErr) result.errors++;
    else result.updated++;
  }
  return result;
}

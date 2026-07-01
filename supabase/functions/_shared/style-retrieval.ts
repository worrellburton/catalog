// style-retrieval — occasion-aware candidate retrieval for the Style Up stylist.
//
// Per garment slot, run style_slot_search (BM25 over occasion text + name,
// gender-filtered) so the candidate pool actually matches what the shopper's
// after — the same retrieval the seeding cockpit's style-engine validates, now
// shared so the live style-up-chat and the engine draw from one implementation.
//
// ponytail: style-engine still carries its own inline copy of this loop; collapse
//           it onto this helper next time that file is touched.

type Slot = 'hats' | 'tops' | 'jackets' | 'dresses' | 'bottoms' | 'shoes';

// Slot → the garment noun that triggers search_products' category route, so each
// per-slot query is occasion-ranked WITHIN the right garment type.
const SLOT_NOUN: Record<Slot, string> = {
  hats: 'hat', tops: 'shirt', jackets: 'jacket', dresses: 'dress', bottoms: 'pants', shoes: 'shoes',
};
const ALL_SLOTS: Slot[] = ['tops', 'bottoms', 'shoes', 'jackets', 'hats', 'dresses'];

// Women-only garment classes a male shopper must never be shown (name-level
// belt-and-suspenders on top of the gender-filtered retrieval).
const WOMEN_ONLY_NAME_RE = /\b(heel|heels|stiletto|pump|pumps|gown|dress|skirt|blouse|camisole|cami|bodysuit|slingback|wedge|wedges|espadrille|thong sandal|peep[\s-]?toe|bralette|bustier|corset|romper|jumpsuit|maxi|midi dress|mini dress)\b/i;

export interface OccasionCand {
  id: string; name: string | null; brand: string | null; price: string | null;
  image: string | null; url: string | null; type: string | null; gender: string | null;
  slot: Slot; score: number;
}

interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

// Retrieve a flat, de-duped candidate pool spanning the outfit slots, ranked by
// occasion relevance. gender 'unknown' skips the gender filter; 'male' also drops
// dresses and any women-only-named pieces that slip through.
export async function retrieveOccasionCandidates(
  admin: RpcClient,
  opts: { occasion: string; gender: 'male' | 'female' | 'unknown'; aesthetic?: string; kPerSlot?: number },
): Promise<OccasionCand[]> {
  const { gender } = opts;
  const filterGender = gender === 'unknown' ? null : gender;
  const slots = gender === 'male' ? ALL_SLOTS.filter(s => s !== 'dresses') : ALL_SLOTS;
  const k = opts.kPerSlot ?? 8;
  const aesthetic = (opts.aesthetic ?? '').toLowerCase().replace(/[&/]/g, ' ').replace(/\s+/g, ' ').trim();

  const perSlot = await Promise.all(slots.map(async (slot) => {
    const q = `${aesthetic} ${opts.occasion} ${SLOT_NOUN[slot]}`.trim();
    const { data, error } = await admin.rpc('style_slot_search', { p_query: q, p_k: k, p_gender: filterGender });
    if (error || !Array.isArray(data)) return [] as OccasionCand[];
    let rows = (data as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.product_id), name: (r.product_name as string) ?? null, brand: (r.product_brand as string) ?? null,
      price: (r.product_price as string) ?? null, image: (r.product_image_url as string) ?? null,
      url: (r.product_url as string) ?? null, type: (r.product_type as string) ?? null,
      gender: (r.product_gender as string) ?? null, slot, score: Number(r.score ?? 0),
    } as OccasionCand));
    if (gender === 'male') rows = rows.filter(c => !WOMEN_ONLY_NAME_RE.test(c.name ?? ''));
    return rows;
  }));

  const seen = new Set<string>();
  const out: OccasionCand[] = [];
  for (const rows of perSlot) for (const c of rows) {
    if (seen.has(c.id)) continue;
    seen.add(c.id); out.push(c);
  }
  // Observability: proves this path (per-slot style_slot_search) produced the pool.
  console.log(
    `[style-retrieval] ENGINE via style_slot_search × ${slots.length} slots ` +
    `[${perSlot.map((r, i) => `${slots[i]}:${r.length}`).join(' ')}] ` +
    `gender=${gender} occasion="${opts.occasion.slice(0, 80)}" -> ${out.length} unique candidates`,
  );
  return out;
}

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
  /** Position within this candidate's OWN slot after rotate/trim. Lets the admin
   *  audit say "2nd of 8 in tops" as a recorded fact rather than a UI guess. */
  rank: number;
}

/** Per-slot record of what the retrieval actually did — which query ran, which
 *  fallback tier it took, and how many rows survived. This is the diagnostic
 *  that makes a collapsed slot visible; without it the only evidence is a
 *  console.log that nobody reads. */
export interface SlotDiag {
  slot: Slot;
  query: string;
  tier: 1 | 2 | 3;   // 1 aesthetic+occasion · 2 occasion only · 3 occasion, exclude ignored
  returned: number;  // rows the RPC gave back
  kept: number;      // after the women-only name filter + rotate/trim
  error: string | null;
}

export interface RetrievalResult {
  cands: OccasionCand[];
  slots: SlotDiag[];
}

interface RpcClient {
  // PromiseLike, not Promise: supabase-js .rpc() returns a thenable
  // PostgrestFilterBuilder, which `await` handles but isn't a strict Promise.
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

// Rotate a ranked slot list forward by `rotate`, keeping the top ANCHOR rows
// pinned (so the single best piece for the occasion is always offered) and
// cycling the tail, then trim to `out`. rotate=0 is a no-op (an un-rotated first
// turn). Deterministic — same rotate re-runs identically, so the admin research
// trace stays reproducible. Exported for a unit test of the modulo/anchor math.
const ANCHOR = 2;
export function rotateWithAnchors<T>(rows: T[], rotate: number, out: number): T[] {
  if (rotate > 0 && rows.length > ANCHOR) {
    const head = rows.slice(0, ANCHOR);
    const tail = rows.slice(ANCHOR);
    const off = rotate % tail.length;
    rows = head.concat(tail.slice(off), tail.slice(0, off));
  }
  return rows.slice(0, out);
}

// Retrieve a flat, de-duped candidate pool spanning the outfit slots, ranked by
// occasion relevance. gender 'unknown' skips the gender filter; 'male' also drops
// dresses and any women-only-named pieces that slip through.
export async function retrieveOccasionCandidates(
  admin: RpcClient,
  opts: {
    occasion: string; gender: 'male' | 'female' | 'unknown'; aesthetic?: string; kPerSlot?: number;
    // Stylist Engine (anti-repeat): product ids already shown in the thread to
    // skip, and a rotation offset (shopper turn count) so a re-asked occasion
    // walks the ranked pool forward instead of re-serving the same top pieces.
    excludeIds?: string[]; rotate?: number;
  },
): Promise<RetrievalResult> {
  const { gender } = opts;
  const filterGender = gender === 'unknown' ? null : gender;
  const slots = gender === 'male' ? ALL_SLOTS.filter(s => s !== 'dresses') : ALL_SLOTS;
  const k = opts.kPerSlot ?? 8;
  const exclude = opts.excludeIds ?? [];
  const rotate = opts.rotate ?? 0;
  // Only deepen the pool when we're actually varying (exclude/rotate active) so an
  // un-rotated first turn is byte-identical to the pre-anti-repeat path (k=8).
  const fetchK = (rotate > 0 || exclude.length > 0) ? k * 3 : k;
  const aesthetic = (opts.aesthetic ?? '').toLowerCase().replace(/[&/]/g, ' ').replace(/\s+/g, ' ').trim();

  const perSlot = await Promise.all(slots.map(async (slot): Promise<{ rows: OccasionCand[]; diag: SlotDiag }> => {
    // style_slot_search AND-s every query term, so folding the stylist's
    // specialty into the query ("occasion red carpet … shirt") zeroes the WHOLE
    // slot when that vocab isn't in the (thin) catalog — that's why a red-carpet
    // stylist returned "no pieces" while a smart-casual one worked. Query WITH
    // the aesthetic for the bias, then fall back to the occasion alone when it
    // comes back empty, so the specialty only RANKS, never empties the pool.
    //
    // `tier` and `query` are captured AT the point each fallback is taken, not
    // reconstructed afterwards — the admin audit reports on exactly this.
    let tier: 1 | 2 | 3 = 1;
    let query = `${aesthetic} ${opts.occasion} ${SLOT_NOUN[slot]}`.trim();
    let res = await admin.rpc('style_slot_search', {
      p_query: query, p_k: fetchK, p_gender: filterGender, p_exclude_ids: exclude,
    });
    if (aesthetic && (res.error || !Array.isArray(res.data) || res.data.length === 0)) {
      tier = 2;
      query = `${opts.occasion} ${SLOT_NOUN[slot]}`.trim();
      res = await admin.rpc('style_slot_search', {
        p_query: query, p_k: fetchK, p_gender: filterGender, p_exclude_ids: exclude,
      });
    }
    // Anti-repeat exhaustion: if excluding shown ids emptied this slot (thin
    // catalog), allow repeats for THIS slot only rather than showing nothing.
    if (exclude.length > 0 && (res.error || !Array.isArray(res.data) || res.data.length === 0)) {
      tier = 3;
      query = `${opts.occasion} ${SLOT_NOUN[slot]}`.trim();
      res = await admin.rpc('style_slot_search', {
        p_query: query, p_k: fetchK, p_gender: filterGender, p_exclude_ids: [],
      });
    }
    const { data, error } = res;
    const errMsg = error ? String((error as { message?: unknown }).message ?? error) : null;
    if (error || !Array.isArray(data)) {
      return { rows: [], diag: { slot, query, tier, returned: 0, kept: 0, error: errMsg } };
    }
    const returned = data.length;
    let rows = (data as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.product_id), name: (r.product_name as string) ?? null, brand: (r.product_brand as string) ?? null,
      price: (r.product_price as string) ?? null, image: (r.product_image_url as string) ?? null,
      url: (r.product_url as string) ?? null, type: (r.product_type as string) ?? null,
      gender: (r.product_gender as string) ?? null, slot, score: Number(r.score ?? 0), rank: 0,
    } as OccasionCand));
    if (gender === 'male') rows = rows.filter(c => !WOMEN_ONLY_NAME_RE.test(c.name ?? ''));
    // Rank AFTER rotate/trim so it describes the pool the model actually saw.
    const kept = rotateWithAnchors(rows, rotate, k).map((c, i) => ({ ...c, rank: i }));
    return { rows: kept, diag: { slot, query, tier, returned, kept: kept.length, error: null } };
  }));

  const seen = new Set<string>();
  const out: OccasionCand[] = [];
  for (const { rows } of perSlot) for (const c of rows) {
    if (seen.has(c.id)) continue;
    seen.add(c.id); out.push(c);
  }
  const diags = perSlot.map(p => p.diag);
  // Observability: proves this path (per-slot style_slot_search) produced the pool.
  console.log(
    `[style-retrieval] ENGINE via style_slot_search × ${slots.length} slots ` +
    `[${diags.map(d => `${d.slot}:${d.kept}/t${d.tier}`).join(' ')}] ` +
    `gender=${gender} exclude=${exclude.length} rotate=${rotate} ` +
    `occasion="${opts.occasion.slice(0, 80)}" -> ${out.length} unique candidates`,
  );
  return { cands: out, slots: diags };
}

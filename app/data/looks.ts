export interface Product {
  name: string;
  brand: string;
  price: string;
  url: string;
  image?: string;
  size_fit?: string | null;
  materials_care?: string | null;
  measurements?: Record<string, number> | null;
  variants?: Array<{
    size: string | null;
    color: string | null;
    availability: boolean | null;
  }> | null;
  size_chart?: Record<string, Record<string, number>> | null;
  fit_intelligence?: {
    fit_type: string;
    body_type_match: string[];
    layering: boolean;
    warmth_rating: string;
    stretch_behavior: string;
    likely_feel: string;
    true_to_size: string;
    best_for_occasions: string[];
    season: string[];
  } | null;
  materials_structured?: Array<{ fiber: string; pct: number | null }> | null;
  product_taxonomy?: {
    category: string;
    subcategory: string;
    style: string | null;
  } | null;
  styling_metadata?: {
    works_with: string[];
    occasion: string[];
    season: string[];
  } | null;
  video_url?: string;
  thumbnail_url?: string;
  creative_id?: string;
  /** Broad category (Shoes / Top / Pants / etc.). Sourced from
   *  products.type — surfaced in the look-overlay product row as a
   *  small chip so shoppers see the garment family at a glance. */
  type?: string;
  /** Sub-category under type (Sneakers / Sandals / Boots …). Sourced
   *  from products.subtype. When both type and subtype exist we
   *  render only subtype (the more specific label); when only type
   *  exists we render that. */
  subtype?: string;
}

export interface Creator {
  name: string;
  displayName: string;
  avatar: string;
  bio?: string;
}

export interface Look {
  id: number;
  /** Supabase UUID - present for DB-sourced looks, absent for static seed data. */
  uuid?: string;
  /** Admin-assigned unified feed position (shared rank space with products
   *  via apply_feed_order). Drives the consumer home-feed order so it
   *  matches the /admin/catalogs FEED editor. null/undefined = unranked. */
  feed_rank?: number | null;
  title: string;
  video: string;
  // 'unisex' looks (and the rare untyped null in the DB) stay visible
  // to every shopper regardless of profile.gender.
  gender: 'men' | 'women' | 'unisex';
  creator: string;
  description: string;
  color: string;
  products: Product[];
  // Set when the look's creator isn't in the seed creators map  -
  // typically a user-published look whose creator_handle is null
  // and whose author lives in profiles instead. The admin Looks
  // table reads these as a fallback so the row still shows a name
  // and avatar.
  creatorDisplayName?: string;
  creatorAvatar?: string;
  /** True when the owning profile/creator is_ai=true. Drives the
   *  Human / AI split filter on the admin Looks (Published) tab. */
  creatorIsAi?: boolean;
  /** Server-extracted first frame of the video, used as the
   *  <video poster=> so the card paints a real image while the MP4
   *  streams. Populated by the Modal worker on upload + by the
   *  backfill job for legacy rows. Omitted means we fall back to the
   *  cover image (or nothing). */
  thumbnail_url?: string;
  /** Mobile-optimized variant of the look video (480p H.264 ~600kbps).
   *  Renderer picks this on narrow viewports / slow connections, same
   *  contract as ProductAd.mobile_video_url. */
  mobile_video_url?: string;
  /** Trimmer in/out window (seconds). When set, look video players loop
   *  [trimStart, trimEnd] instead of the whole clip. */
  trimStart?: number;
  trimEnd?: number;
  /** Static cover image - alternative to thumbnail_url, used by some
   *  legacy looks. Lower priority than thumbnail_url because it's
   *  often a product still rather than a video frame. */
  cover?: string;
}

// Static seed creators + looks (@lilywittman, @garrett with their
// gradient-placeholder looks) deleted intentionally — they don't
// represent real creators or real content, just historical mock
// data. All surfaces fall back to live Supabase data instead.
export const creators: Record<string, Creator> = {};

export const looks: Look[] = [];

export const searchSuggestions = [
  'beach day', 'mens shorts', 'omg shoes', 'make me hot',
  'date night outfit', 'gym fits', 'summer dresses', 'streetwear',
  'brunch outfit', 'skincare routine', 'festival looks', 'quiet luxury',
  'clean girl aesthetic', 'wedding guest dress', 'vintage finds',
  'sneaker rotation', 'concert outfit', 'airport outfit',
  'first date fit', 'matcha everything', 'pilates princess',
  'cozy fall vibes', 'coffee shops LA', 'travel essentials',
  'old money style', 'dopamine dressing', 'it girl energy',
  'minimalist wardrobe', 'hot girl walk essentials', 'lazy sunday'
];

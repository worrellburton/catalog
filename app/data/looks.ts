export interface Product {
  name: string;
  brand: string;
  price: string;
  url: string;
  image?: string;
  // Optional copy hydrated by ProductPage on open. The main loaders
  // intentionally don't carry these to keep the look/grid payloads
  // small — ProductPage fetches them once per product open.
  size_fit?: string | null;
  materials_care?: string | null;
  /** Structured garment measurements keyed by code → centimeters.
   *  Surfaced as the SVG measurement diagram on /p/<slug>. Null until
   *  the scraper backfills it; the diagram self-hides when empty. */
  measurements?: Record<string, number> | null;
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

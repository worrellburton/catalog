// Shared admin Data types. Extracted from app/routes/admin/data.tsx
// (god-file split #8) so the route file and its split-out components share one
// definition instead of importing types across an odd route→component edge.

export interface CrawledProduct {
  id: string;
  name: string | null;
  brand: string | null;
  price: string | null;
  url: string | null;
  image_url: string | null;
  images?: string[] | null;
  /** Vision-picked solo-product image (no human, no other products).
   *  Falls back to image_url when null. Populated by the
   *  pick-primary-image edge function or the admin star-click. */
  primary_image_url?: string | null;
  /** True once polish-primary-image has reframed the primary into a
   *  uniform 3:4 packshot. Drives the "polish wand" affordance in the
   *  admin Primary column — unpolished primaries get a tappable wand
   *  icon overlay, polished ones don't. */
  primary_image_polished?: boolean | null;
  /** Original primary_image_url before the polish step. Kept so the
   *  polish node-graph modal can render input → model → output. */
  primary_image_pre_polish_url?: string | null;
  /** Short cinematic-motion video of the product, generated from
   *  primary_image_url via generate-primary-video. Rendered in the
   *  detail-row "Primary Video" tile; null rows get a Generate CTA. */
  primary_video_url?: string | null;
  /** Async pipeline state: 'pending' (submitted to fal queue, waiting
   *  on webhook), 'done' (webhook landed with primary_video_url),
   *  'failed' (webhook landed with error). Null = never started. */
  primary_video_status?: 'pending' | 'done' | 'failed' | null;
  /** Fal request id used by fal-webhook to match the inbound callback
   *  back to this product row. */
  primary_video_request_id?: string | null;
  /** 3:4 hero still extracted from primary_video_url (Modal poster job).
   *  This is the poster the feed renders before the clip plays; null
   *  rows fall back to the square primary_image_url. Re-extracted via
   *  the detail-row "Primary Poster" tile's Regen button. */
  primary_video_poster_url?: string | null;
  scraped_at: string | null;
  scrape_status: string;
  is_crawled: boolean;
  is_active?: boolean;
  is_elite?: boolean;
  /** Sister flag to is_active. When false the product is hidden from
   *  search results / catalog-wide listings (admin keeps the row).
   *  Default true so existing inventory keeps surfacing. */
  is_platform?: boolean;
  type?: string | null;
  /** Sub-category under `type`. For Shoes → Sneakers / Sandals / Boots /
   *  Heels / Loafers / Flats. Search broadens "shoes" to include all
   *  subtypes; Try-It-On groups by type and offers subtype as a
   *  secondary filter. Nullable — older categories haven't been split
   *  yet. */
  subtype?: string | null;
  gender?: 'male' | 'female' | 'unisex' | null;
  created_at?: string | null;
  source?: string | null;
  /** Freeform measurements / fit copy scraped from the product page.
   *  Surfaced on the row via the measurements icon column. ~1% of
   *  rows have it filled in today; the rest fall back to "Not
   *  available" in the hover panel. */
  size_fit?: string | null;
  materials_care?: string | null;
}

export interface LookRow {
  id: number;
  creator: string;
  creatorDisplay: string;
  creatorAvatar: string;
  /** True when the owning creator profile is_ai=true — drives the
   *  Human / AI source filter on the Published tab. */
  creatorIsAi: boolean;
  video: string;
  products: number;
  /** DB looks.created_at — drives the Created At column + sort. */
  created_at: string | null;
}

export interface UnpublishedLook {
  id: string;
  user_id: string;
  status: 'pending' | 'generating' | 'done' | 'failed';
  style: string;
  height_label: string | null;
  age_label: string | null;
  model: 'fast' | 'pro' | null;
  video_url: string | null;
  error: string | null;
  created_at: string;
  // Pipeline-detail columns surfaced when the user clicks the Model
  // cell on a row in the Unpublished table - see the model-details
  // expansion row in the render below.
  prompt: string | null;
  height_cm: number | null;
  fal_request_id: string | null;
  completed_at: string | null;
  storage_path: string | null;
  veo_model: string | null;
  product_count: number;
  creator_name: string | null;
  creator_avatar: string | null;
  creator_email: string | null;
  /** True when the look's owning profile is_ai=true. Drives the
   *  AI vs Human split filter on the /admin/data Looks tab. */
  creator_is_ai: boolean;
}

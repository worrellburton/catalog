import { useState, Fragment, useMemo, useCallback, useEffect, useRef, useId } from 'react';
import { useNavigate, useSearchParams } from '@remix-run/react';
import { extractFabric } from '~/utils/extractFabric';
import { looks as staticLooks, creators as staticCreators } from '~/data/looks';
import type { Look, Creator } from '~/data/looks';
import { getLooks, getCreators, invalidateLooksCache } from '~/services/looks';
import { createLook, addProductToLook } from '~/services/manage-looks';
import { useSortableTable, SortableTh } from '~/components/SortableTable';
import { inferProductType, auditAllProductTypes } from '~/services/product-types';
import { inferProductGenderFromName, auditAllProductGenders } from '~/services/genders';
import { addProductUrl, triggerScrape, triggerScrapeFlush } from '~/services/scrape-product';
import { isLikelyProductUrl } from '~/utils/productUrl';
import { supabase } from '~/utils/supabase';
import { VIDEO_MODELS, DEFAULT_VIDEO_MODEL } from '~/constants/video-models';
import { useAdminSearch } from '~/hooks/useAdminSearch';
import { createBatchAds, promoteQueuedAds } from '~/services/product-creative';
import { researchProducts, type ResearchedProduct, type ProductGender } from '~/services/product-research';
import AmazonLookupModal from '~/components/AmazonLookupModal';
import PromptSettingsModal from '~/components/admin/PromptSettingsModal';
import { startGenerationJob } from '~/services/generation-queue';
import { useAdminConfirm } from '~/components/AdminConfirm';
import { generateAndStorePoster } from '~/utils/video-poster';

interface CrawledProduct {
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

// localStorage fallback for hidden looks/products. Module-scope so
// the useState initializers inside AdminData (which run on mount,
// before the body has finished evaluating its own local const list)
// can call them without TDZ. Was the cause of the production
// "Cannot access 'tn' before initialization" 500 on /admin/data.
const LOCAL_LOOKS_KEY = 'admin:hiddenLookIds';
const LOCAL_PRODUCTS_KEY = 'admin:hiddenProductKeys';
function readLocalSet<T extends string | number>(key: string): Set<T> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
}
function writeLocalSet(key: string, set: Set<string | number>) {
  try { localStorage.setItem(key, JSON.stringify([...set])); } catch { /* quota */ }
}

// Pull every http(s) URL out of a free-form paste — newlines, commas,
// spaces, or smushed-together all work. De-duplicates within the
// batch so admins can paste from a clipboard list without worrying
// about accidental repeats.
function extractUrls(raw: string): string[] {
  if (!raw) return [];
  const matches = raw.match(/https?:\/\/[^\s,;'"<>()]+/gi) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of matches) {
    // Strip trailing punctuation that's not part of a URL.
    const cleaned = m.replace(/[.,;:!?)]+$/, '');
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

const SOURCE_LABELS: Record<string, string> = {
  google_shopping: 'Google Shopping',
  amazon: 'Amazon',
  brand_url: 'Brand URL',
};

// Compact, unambiguous date format that's friendly to scan.
// Recent dates use a relative phrase ("3h ago", "Yesterday", "Mon");
// anything older falls back to "May 19" (current year) or "May 19, 2025"
// (older years). The old DD/MM/YY format was ambiguous against MM/DD/YY
// and unreadable at a glance.
function formatDateAdded(iso: string | null | undefined): string {
  if (!iso) return ' - ';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return ' - ';
  const now = Date.now();
  const diffMs = now - d.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  // Future timestamps (clock skew, server-ahead) read awkwardly as
  // negative — clamp to "just now".
  if (diffMs < 0 || diffMs < 90_000) return 'Just now';
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}m ago`;
  if (diffMs < 12 * hour) return `${Math.floor(diffMs / hour)}h ago`;
  // Within today or yesterday → relative day.
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dDay = new Date(d); dDay.setHours(0, 0, 0, 0);
  const dayDiff = Math.round((today.getTime() - dDay.getTime()) / day);
  if (dayDiff === 0) return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (dayDiff === 1) return 'Yesterday';
  if (dayDiff < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
  // Within current year: "May 19". Older: "May 19, 2025".
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}

const COLOR_WORDS = ['white', 'black', 'blue', 'navy', 'red', 'green', 'yellow', 'pink', 'purple', 'gray', 'grey', 'brown', 'tan', 'beige', 'cream', 'gold', 'silver', 'orange', 'khaki', 'olive', 'charcoal', 'burgundy', 'ivory'];
const MATERIAL_WORDS = ['leather', 'denim', 'cotton', 'silk', 'satin', 'wool', 'cashmere', 'linen', 'suede', 'velvet', 'knit', 'canvas', 'nylon', 'polyester'];
const TYPE_WORDS = [
  { match: ['shoulder bag', 'tote', 'crossbody', 'handbag', 'clutch', 'purse'], tag: 'Bag' },
  { match: ['sunglasses', 'eyewear', 'shades'], tag: 'Sunglasses' },
  { match: ['sneaker', 'trainer'], tag: 'Sneakers' },
  { match: ['shoe', 'boot', 'heel', 'loafer'], tag: 'Shoes' },
  { match: ['iphone case', 'phone case', 'case for'], tag: 'Phone Case' },
  { match: ['necklace', 'pendant'], tag: 'Necklace' },
  { match: ['ring '], tag: 'Ring' },
  { match: ['earring'], tag: 'Earrings' },
  { match: ['bracelet'], tag: 'Bracelet' },
  { match: ['watch'], tag: 'Watch' },
  { match: ['jean', 'denim'], tag: 'Denim' },
  { match: ['pant', 'trouser', 'chino'], tag: 'Pants' },
  { match: ['dress'], tag: 'Dress' },
  { match: ['skirt'], tag: 'Skirt' },
  { match: ['shirt', 't-shirt', 'tee', 'henley', 'polo'], tag: 'Top' },
  { match: ['short-sleeve', 'ss '], tag: 'Short Sleeve' },
  { match: ['long-sleeve', 'ls-', 'ls '], tag: 'Long Sleeve' },
  { match: ['jacket', 'coat', 'parka', 'blazer'], tag: 'Outerwear' },
  { match: ['hat', 'cap', 'beanie'], tag: 'Hat' },
  { match: ['sweater', 'hoodie', 'pullover'], tag: 'Sweater' },
  { match: ['boxer', 'brief', 'underwear'], tag: 'Underwear' },
  { match: ['camera'], tag: 'Camera' },
];

function deriveTags(name: string, brand: string): string[] {
  const lower = (name || '').toLowerCase();
  const tags = new Set<string>();

  // Type tag
  for (const { match, tag } of TYPE_WORDS) {
    if (match.some(m => lower.includes(m))) {
      tags.add(tag);
    }
  }

  // Color tag
  const colors = COLOR_WORDS.filter(c => new RegExp(`\\b${c}\\b`, 'i').test(lower));

  // Material tag
  const materials = MATERIAL_WORDS.filter(m => lower.includes(m));

  // Combined color + type (e.g. "white hat", "black dress")
  const typeTag = Array.from(tags)[0];
  if (typeTag && colors.length > 0) {
    tags.add(`${colors[0].charAt(0).toUpperCase()}${colors[0].slice(1)} ${typeTag}`);
  }

  // Individual color tags
  colors.forEach(c => tags.add(c.charAt(0).toUpperCase() + c.slice(1)));

  // Material tags
  materials.forEach(m => tags.add(m.charAt(0).toUpperCase() + m.slice(1)));

  // Brand
  if (brand) tags.add(brand);

  return Array.from(tags);
}

interface AffiliateProvider {
  network: string;
  rate: string;
  rateNumeric: number;
  signupUrl: string;
  note?: string;
  /** When present, this is the REAL outbound URL for THIS product (not
   *  a generic sign-up). Renders as "Open ↗" instead of "Sign up ↗". */
  outboundUrl?: string;
  /** Marks the provider as already wired up (no sign-up CTA needed). */
  connected?: boolean;
  /** Sub-label (e.g. merchant name) shown under the network name. */
  merchantName?: string;
}

const BRAND_AFFILIATES: Record<string, AffiliateProvider[]> = {
  'Nike': [
    { network: 'FlexOffers', rate: '11%', rateNumeric: 11, signupUrl: 'https://www.flexoffers.com/', note: 'Top published rate' },
    { network: 'Impact', rate: '8%', rateNumeric: 8, signupUrl: 'https://impact.com/' },
    { network: 'Rakuten Advertising', rate: '5–8%', rateNumeric: 6.5, signupUrl: 'https://rakutenadvertising.com/' },
  ],
  'Zara': [
    { network: 'Skimlinks (auto)', rate: '~5%', rateNumeric: 5, signupUrl: 'https://skimlinks.com/', note: 'No official program' },
    { network: 'Sovrn //Commerce', rate: '~4%', rateNumeric: 4, signupUrl: 'https://www.sovrn.com/commerce/' },
  ],
  'Gucci': [
    { network: 'Rakuten Advertising', rate: '7%', rateNumeric: 7, signupUrl: 'https://rakutenadvertising.com/' },
    { network: 'Awin', rate: '6%', rateNumeric: 6, signupUrl: 'https://www.awin.com/' },
  ],
  'Diesel': [
    { network: 'Awin', rate: '8%', rateNumeric: 8, signupUrl: 'https://www.awin.com/' },
    { network: 'Rakuten Advertising', rate: '6%', rateNumeric: 6, signupUrl: 'https://rakutenadvertising.com/' },
  ],
  'Vince': [
    { network: 'Rakuten Advertising', rate: '10%', rateNumeric: 10, signupUrl: 'https://rakutenadvertising.com/' },
    { network: 'ShareASale', rate: '7%', rateNumeric: 7, signupUrl: 'https://www.shareasale.com/' },
  ],
  'Suitsupply': [
    { network: 'Awin', rate: '9%', rateNumeric: 9, signupUrl: 'https://www.awin.com/' },
    { network: 'Impact', rate: '6%', rateNumeric: 6, signupUrl: 'https://impact.com/' },
  ],
  'Pavoi': [
    { network: 'Amazon Associates', rate: '4%', rateNumeric: 4, signupUrl: 'https://affiliate-program.amazon.com/', note: 'Jewelry tier' },
  ],
  'Windsor': [
    { network: 'ShareASale', rate: '6%', rateNumeric: 6, signupUrl: 'https://www.shareasale.com/' },
  ],
  'Fujifilm': [
    { network: 'Impact', rate: '5%', rateNumeric: 5, signupUrl: 'https://impact.com/' },
    { network: 'Amazon Associates', rate: '2%', rateNumeric: 2, signupUrl: 'https://affiliate-program.amazon.com/', note: 'Electronics tier' },
  ],
  'LUXXFORM': [
    { network: 'Shopify Collabs', rate: '15%', rateNumeric: 15, signupUrl: 'https://www.shopify.com/collabs', note: 'DTC brand' },
  ],
  'Wolf\'s Collections': [
    { network: 'Shopify Collabs', rate: '12%', rateNumeric: 12, signupUrl: 'https://www.shopify.com/collabs', note: 'DTC brand' },
  ],
};

const DEFAULT_AFFILIATES: AffiliateProvider[] = [
  { network: 'Amazon Associates', rate: '3–10%', rateNumeric: 6.5, signupUrl: 'https://affiliate-program.amazon.com/', note: 'Rate varies by category' },
  { network: 'ShareASale', rate: 'Varies', rateNumeric: 5, signupUrl: 'https://www.shareasale.com/', note: 'Brand-negotiated' },
  { network: 'Skimlinks', rate: '~5%', rateNumeric: 5, signupUrl: 'https://skimlinks.com/', note: 'Automatic monetization' },
  { network: 'Impact', rate: 'Varies', rateNumeric: 5, signupUrl: 'https://impact.com/', note: 'Brand-negotiated' },
];

function getAffiliatesFor(brand: string): AffiliateProvider[] {
  const list = BRAND_AFFILIATES[brand] || DEFAULT_AFFILIATES;
  return [...list].sort((a, b) => b.rateNumeric - a.rateNumeric);
}

// Real retailer programs keyed by URL hostname. Used by
// getProductAffiliateProviders to surface ONLY the network that
// actually monetizes the product's destination, instead of dumping a
// hardcoded grid of Amazon/ShareASale/Skimlinks/Impact on every row.
const KNOWN_RETAILERS: Record<string, { name: string; network: string; rate: string; rateNumeric: number; signupUrl: string }> = {
  'amazon.com':    { name: 'Amazon',    network: 'Amazon Associates',     rate: '3–10%', rateNumeric: 6.5, signupUrl: 'https://affiliate-program.amazon.com/' },
  'amazon.co.uk':  { name: 'Amazon UK', network: 'Amazon Associates UK',  rate: '1–10%', rateNumeric: 5,   signupUrl: 'https://affiliate-program.amazon.co.uk/' },
  'walmart.com':   { name: 'Walmart',   network: 'Walmart Affiliates',    rate: '1–4%',  rateNumeric: 2.5, signupUrl: 'https://affiliates.walmart.com/' },
  'target.com':    { name: 'Target',    network: 'Target Partners',       rate: '1–8%',  rateNumeric: 4,   signupUrl: 'https://partners.target.com/' },
  'nordstrom.com': { name: 'Nordstrom', network: 'Rakuten Advertising',   rate: '2–11%', rateNumeric: 6,   signupUrl: 'https://rakutenadvertising.com/' },
  'shopify.com':   { name: 'Shopify',   network: 'Shopify Collabs',       rate: 'Varies', rateNumeric: 10, signupUrl: 'https://www.shopify.com/collabs' },
  'etsy.com':      { name: 'Etsy',      network: 'Awin (Etsy)',           rate: '4–5%',  rateNumeric: 4.5, signupUrl: 'https://www.awin.com/' },
  'ebay.com':      { name: 'eBay',      network: 'eBay Partner Network',  rate: '1–4%',  rateNumeric: 2.5, signupUrl: 'https://partnernetwork.ebay.com/' },
  'theiconic.com.au': { name: 'THE ICONIC', network: 'Partnerize Australia', rate: '4–8%', rateNumeric: 6, signupUrl: 'https://www.partnerize.com/' },
};

function urlHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).hostname.replace(/^www\./i, ''); } catch { return null; }
}

/** Replaces the old getAffiliatesFor(brand) generic fallback. Picks the
 *  affiliate provider(s) that ACTUALLY pertain to this product:
 *    1. source='affiliate.com' rows → the real affiliate.com tracking
 *       link (already monetized), plus the bare merchant URL.
 *    2. product URL hostname matches a known retailer → just that one.
 *    3. brand is in BRAND_AFFILIATES → the curated brand programs.
 *    4. nothing relevant → only the brand site (no fake provider grid). */
function getProductAffiliateProviders(p: { brand: string | null; url: string | null; source?: string | null; raw_data?: Record<string, unknown> | null }): AffiliateProvider[] {
  // (1) affiliate.com source — surface the actual affiliate URL from raw_data.
  const source = (p as unknown as { source?: string | null }).source ?? null;
  if (source === 'affiliate.com') {
    const raw = (p as unknown as { raw_data?: Record<string, unknown> }).raw_data ?? {};
    const merchantObj = (raw.merchant ?? null) as { name?: string; logo_url?: string } | null;
    const networkObj  = (raw.network  ?? null) as { name?: string } | null;
    const urls = (raw.urls ?? null) as Record<string, string> | null;
    const tracked = urls?.affiliate ?? urls?.outclick ?? urls?.shopnomix
      ?? (raw.commission_url as string | undefined) ?? p.url ?? null;
    const direct  = urls?.direct ?? (raw.direct_url as string | undefined) ?? null;
    const out: AffiliateProvider[] = [];
    if (tracked) {
      out.push({
        network: 'affiliate.com',
        rate: 'Tracked',
        rateNumeric: 99,
        signupUrl: 'https://my.affiliate.com',
        outboundUrl: tracked,
        connected: true,
        merchantName: merchantObj?.name ?? networkObj?.name ?? undefined,
        note: networkObj?.name ? `via ${networkObj.name}` : 'monetized clickout',
      });
    }
    if (direct && direct !== tracked) {
      out.push({
        network: merchantObj?.name ?? 'Merchant site',
        rate: 'Direct',
        rateNumeric: 0,
        signupUrl: direct,
        outboundUrl: direct,
        note: 'no commission',
      });
    }
    return out;
  }
  // (2) Known retailer by URL hostname.
  const host = urlHost(p.url);
  if (host) {
    const key = Object.keys(KNOWN_RETAILERS).find(k => host === k || host.endsWith(`.${k}`));
    const r = key ? KNOWN_RETAILERS[key] : null;
    if (r) {
      return [{
        network: r.network,
        rate: r.rate,
        rateNumeric: r.rateNumeric,
        signupUrl: r.signupUrl,
        merchantName: r.name,
        outboundUrl: p.url ?? undefined,
      }];
    }
  }
  // (3) Brand-specific curated list.
  if (p.brand && BRAND_AFFILIATES[p.brand]) {
    return [...BRAND_AFFILIATES[p.brand]].sort((a, b) => b.rateNumeric - a.rateNumeric);
  }
  // (4) Only the brand site if we have a URL — no generic provider noise.
  if (p.url) {
    return [{
      network: p.brand ?? 'Brand site',
      rate: 'Direct',
      rateNumeric: 0,
      signupUrl: p.url,
      outboundUrl: p.url,
      merchantName: host ?? undefined,
      note: 'no affiliate program detected',
    }];
  }
  return [];
}

// Drag-and-drop (or click-to-pick) photo upload tile for the product
// detail Photos panel. Square to match the photo thumbnails; highlights
// green on dragover; shows a spinner while the parent uploads.
function PhotoDropzone({ busy, onFiles }: { busy: boolean; onFiles: (files: File[]) => void }) {
  const [dragOver, setDragOver] = useState(false);
  const inputId = useId();
  return (
    <label
      htmlFor={inputId}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const files = Array.from(e.dataTransfer.files || []);
        if (files.length) onFiles(files);
      }}
      title="Drag images here or click to upload"
      style={{
        aspectRatio: '1 / 1',
        border: `2px dashed ${dragOver ? '#059669' : '#cbd5e1'}`,
        borderRadius: 6,
        background: dragOver ? '#ecfdf5' : '#f8fafc',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 4, cursor: busy ? 'wait' : 'pointer',
        color: dragOver ? '#059669' : '#94a3b8', textAlign: 'center', padding: 4,
        transition: 'all 0.12s',
      }}
    >
      {busy ? (
        <>
          <style>{`@keyframes pdz-spin { to { transform: rotate(360deg); } }`}</style>
          <span style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid #cbd5e1', borderTopColor: '#059669', animation: 'pdz-spin 0.8s linear infinite' }} />
          <span style={{ fontSize: 9 }}>Uploading…</span>
        </>
      ) : (
        <>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span style={{ fontSize: 9, fontWeight: 600, lineHeight: 1.2 }}>Drop / upload</span>
        </>
      )}
      <input
        id={inputId}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        disabled={busy}
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length) onFiles(files);
          e.target.value = '';
        }}
      />
    </label>
  );
}

function AdminToggle({ on, onChange }: { on: boolean; onChange: (val: boolean) => void }) {
  return (
    <button
      className={`admin-toggle-btn ${on ? 'on' : 'off'}`}
      onClick={(e) => { e.stopPropagation(); onChange(!on); }}
      aria-label={on ? 'Toggle off' : 'Toggle on'}
    >
      <span className="admin-toggle-track">
        <span className="admin-toggle-thumb" />
      </span>
    </button>
  );
}

interface LookRow {
  id: number;
  creator: string;
  creatorDisplay: string;
  creatorAvatar: string;
  /** True when the owning creator profile is_ai=true — drives the
   *  Human / AI source filter on the Published tab. */
  creatorIsAi: boolean;
  video: string;
  products: number;
}

type Tab = 'looks' | 'products' | 'musics' | 'places';
type LooksFilter = 'published' | 'unpublished' | 'failed';

interface UnpublishedLook {
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

/** AI vs Human sub-filter for the Looks tab. 'all' shows every row,
 *  'human' filters to looks owned by real profiles, 'ai' filters to
 *  looks owned by AI personas (regardless of who triggered them —
 *  admin impersonations still count as AI looks because the row
 *  attaches to the persona). Persisted in the URL alongside the
 *  existing ?looks=published|unpublished|failed pill. */
type LookSource = 'all' | 'human' | 'ai';

// Defers attaching the <video> until the row scrolls into the
// viewport. Without this, the Unpublished tab stamps ~14 cross-
// origin Supabase video sources into the DOM at once and the
// browser stalls under the concurrent decoder/network load  - 
// which is what was making the thumbnails slow to paint and the
// admin tab feel sluggish.
//
// Once a row's video has been mounted, we never tear it down - the
// observer self-disconnects on first sight, so scrolling away and
// back is instant (no re-fetch). The wrapper also keeps the
// <video> mounted across hidden-tab toggles since the parent
// table is now display:none rather than conditionally rendered.
function LazyThumb({ url, thumbnail }: { url: string; thumbnail?: string | null }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [inView, setInView] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  // Client-side first-frame extraction: when there's no admin-supplied
  // thumbnail, we draw the first decoded frame of the video to a
  // canvas, hold the resulting data URL as the poster, and the
  // browser paints it instantly on every subsequent render. The
  // video element fades in over it once `canplay` fires.
  const [extractedPoster, setExtractedPoster] = useState<string | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const io = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            io.disconnect();
            return;
          }
        }
      },
      { rootMargin: '1200px 0px' },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  // Run the first-frame extraction once `inView` flips. We attach a
  // hidden secondary <video>, seek 50ms in (some codecs render
  // garbage at t=0), and snapshot via canvas. Best-effort — if the
  // server doesn't return CORS headers the snapshot throws and we
  // simply fall back to whatever the browser paints naturally.
  useEffect(() => {
    if (!inView || thumbnail || extractedPoster) return;
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.src = url;
    let cancelled = false;
    const onLoaded = () => {
      if (cancelled) return;
      try { v.currentTime = Math.min(0.05, (v.duration || 1) / 2); } catch { /* */ }
    };
    const onSeeked = () => {
      if (cancelled) return;
      try {
        const c = document.createElement('canvas');
        c.width = v.videoWidth || 360;
        c.height = v.videoHeight || 480;
        const ctx = c.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(v, 0, 0, c.width, c.height);
        setExtractedPoster(c.toDataURL('image/jpeg', 0.6));
      } catch { /* CORS or cross-origin canvas taint — silent fallback */ }
    };
    v.addEventListener('loadeddata', onLoaded);
    v.addEventListener('seeked', onSeeked);
    return () => {
      cancelled = true;
      v.removeEventListener('loadeddata', onLoaded);
      v.removeEventListener('seeked', onSeeked);
      v.src = '';
    };
  }, [inView, url, thumbnail, extractedPoster]);

  const posterSrc = thumbnail || extractedPoster;

  return (
    <div ref={ref} style={{ width: '100%', height: '100%', position: 'relative', background: '#111' }}>
      {posterSrc && (
        <img
          src={posterSrc}
          alt=""
          loading="lazy"
          decoding="async"
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            objectFit: 'cover', display: 'block',
            opacity: videoReady ? 0 : 1,
            transition: 'opacity 200ms ease',
          }}
        />
      )}
      {inView && (
        <>
          <video
            ref={videoRef}
            src={url}
            poster={posterSrc || undefined}
            autoPlay muted loop playsInline preload="auto"
            onCanPlay={() => setVideoReady(true)}
            style={{
              position: 'relative', zIndex: 1,
              opacity: videoReady ? 1 : 0,
              transition: 'opacity 200ms ease',
            }}
          />
          <div className="admin-look-preview">
            <video src={url} poster={posterSrc || undefined} autoPlay muted loop playsInline />
          </div>
        </>
      )}
    </div>
  );
}

// Renders the per-row "Model" expansion in the Unpublished table  - 
// shows the pipeline as a simple node diagram + the prompt + the
// parameters that were sent to the model. Read-only; admins use it to
// debug a generation without leaving the page.
function ModelDetailsPanel({ gen }: { gen: UnpublishedLook }) {
  const modelLabel = gen.model
    ? gen.model === 'pro' ? 'Pro (Seedance Pro)' : 'Fast (Seedance Lite)'
    : ' - ';
  const modelTier = gen.veo_model || (gen.model === 'pro' ? 'bytedance/seedance/v1/pro' : gen.model === 'fast' ? 'bytedance/seedance/v1/lite' : null);

  type NodeStatus = 'done' | 'active' | 'pending' | 'failed';
  const status = gen.status;
  const statusOf = (i: number): NodeStatus => {
    // 0 photo, 1 products, 2 prompt, 3 model call, 4 video, 5 status
    if (status === 'failed') {
      // Mark the call (index 3) as failed; everything before it is done,
      // everything after stays pending so the failure point is obvious.
      if (i < 3) return 'done';
      if (i === 3) return 'failed';
      return 'pending';
    }
    if (status === 'done') return 'done';
    // pending / generating: photo + products + prompt are done by the time
    // the row exists; the call is in flight, video + status are pending.
    if (i <= 2) return 'done';
    if (i === 3) return 'active';
    return 'pending';
  };

  const nodes = [
    {
      label: 'Face photo',
      sub: 'user_uploads',
      detail: 'Reference photo uploaded via /generate',
    },
    {
      label: 'Products',
      sub: `${gen.product_count} item${gen.product_count === 1 ? '' : 's'}`,
      detail: 'user_generation_products - role-tagged for prompt slotting',
    },
    {
      label: 'Prompt',
      sub: gen.style,
      detail: gen.prompt ? `${gen.prompt.length} chars` : 'Assembled from style preset + role tags',
    },
    {
      label: 'Model call',
      sub: modelLabel,
      detail: gen.fal_request_id ? `fal_id ${gen.fal_request_id.slice(0, 10)}…` : 'Fal queue submission',
    },
    {
      label: 'Video',
      sub: gen.video_url ? 'Stored' : 'Pending',
      detail: gen.storage_path || (gen.video_url ? 'Hosted on Fal CDN' : ' - '),
    },
    {
      label: 'Status',
      sub: status,
      detail: gen.completed_at ? new Date(gen.completed_at).toLocaleString() : ' - ',
    },
  ];

  return (
    <div className="admin-model-panel">
      <div className="admin-model-panel-head">
        <h3 className="admin-products-title" style={{ margin: 0 }}>Pipeline</h3>
        <span className="admin-model-panel-meta">
          gen <code>{gen.id.slice(0, 8)}…</code> · created {new Date(gen.created_at).toLocaleString()}
        </span>
      </div>

      <div className="admin-model-flow">
        {nodes.map((n, i) => (
          <div key={n.label} className="admin-model-flow-step">
            <div className={`admin-model-node admin-model-node--${statusOf(i)}`}>
              <div className="admin-model-node-num">{i + 1}</div>
              <div className="admin-model-node-body">
                <div className="admin-model-node-label">{n.label}</div>
                <div className="admin-model-node-sub">{n.sub}</div>
                <div className="admin-model-node-detail">{n.detail}</div>
              </div>
            </div>
            {i < nodes.length - 1 && (
              <svg className="admin-model-arrow" width="22" height="14" viewBox="0 0 22 14" fill="none">
                <path d="M1 7H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M14 1L20 7L14 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
        ))}
      </div>

      <div className="admin-model-grid">
        <div className="admin-model-card">
          <div className="admin-model-card-label">Model</div>
          <div className="admin-model-card-value">{modelLabel}</div>
          {modelTier && <div className="admin-model-card-sub">{modelTier}</div>}
        </div>
        <div className="admin-model-card">
          <div className="admin-model-card-label">Style preset</div>
          <div className="admin-model-card-value" style={{ textTransform: 'capitalize' }}>{gen.style}</div>
        </div>
        <div className="admin-model-card">
          <div className="admin-model-card-label">Height</div>
          <div className="admin-model-card-value">
            {gen.height_label || (gen.height_cm ? `${gen.height_cm} cm` : ' - ')}
          </div>
        </div>
        <div className="admin-model-card">
          <div className="admin-model-card-label">Age band</div>
          <div className="admin-model-card-value">{gen.age_label || ' - '}</div>
        </div>
        <div className="admin-model-card">
          <div className="admin-model-card-label">Fal request id</div>
          <div className="admin-model-card-value admin-model-mono">
            {gen.fal_request_id || ' - '}
          </div>
        </div>
        <div className="admin-model-card">
          <div className="admin-model-card-label">Completed at</div>
          <div className="admin-model-card-value">
            {gen.completed_at ? new Date(gen.completed_at).toLocaleString() : ' - '}
          </div>
        </div>
      </div>

      <div className="admin-model-prompt">
        <div className="admin-model-card-label">Prompt sent to {modelLabel}</div>
        <pre className="admin-model-prompt-body">
          {gen.prompt || ' -  no prompt recorded  - '}
        </pre>
      </div>

      {gen.video_url && (
        <div className="admin-model-output">
          <div className="admin-model-card-label">Output</div>
          <a
            href={gen.video_url}
            target="_blank"
            rel="noopener noreferrer"
            className="admin-model-mono admin-model-link"
          >
            {gen.video_url}
          </a>
          {gen.storage_path && (
            <div className="admin-model-card-sub admin-model-mono">{gen.storage_path}</div>
          )}
        </div>
      )}

      {gen.error && (
        <div className="admin-model-error">
          <div className="admin-model-card-label">Error</div>
          <pre className="admin-model-prompt-body admin-model-error-body">{gen.error}</pre>
        </div>
      )}
    </div>
  );
}

// ── Add Products Modal ────────────────────────────────────────────────────────
// Extracted into its own component so typing in the query input only re-renders
// this small component, not the massive AdminContent component.
interface AddProductsModalProps {
  onClose: () => void;
  onIngested: (rows: CrawledProduct[]) => void;
  showToast: (msg: string) => void;
  onPending?: (urls: string[], source: 'google' | 'amazon') => void;
}

function AddProductsModal({ onClose, onIngested, showToast, onPending }: AddProductsModalProps) {
  const [researchQuery, setResearchQuery] = useState('');
  const [researchGender, setResearchGender] = useState<ProductGender | 'all'>('all');
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchResults, setResearchResults] = useState<ResearchedProduct[]>([]);
  const [researchSelected, setResearchSelected] = useState<Set<number>>(new Set());
  const [researchLiveOnly, setResearchLiveOnly] = useState(true);
  const [researchSource, setResearchSource] = useState<'live' | 'seed' | null>(null);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [ingesting, setIngesting] = useState(false);

  const runResearch = useCallback(async () => {
    if (!researchQuery.trim()) return;
    setResearchLoading(true);
    setResearchSelected(new Set());
    setResearchError(null);
    const { products, source, error } = await researchProducts(researchQuery, { liveOnly: researchLiveOnly });
    setResearchResults(products);
    setResearchSource(source);
    setResearchError(error);
    setResearchLoading(false);
  }, [researchQuery, researchLiveOnly]);

  const ingestSelectedProducts = useCallback(async () => {
    if (!supabase || researchSelected.size === 0) return;
    setIngesting(true);
    const nowIso = new Date().toISOString();
    const selectedItems = Array.from(researchSelected).map(i => researchResults[i]);
    // Include all selected products — even those with only a Google Shopping URL.
    // The product scraper resolves the real merchant URL from any google.com/shopping
    // link, so we don't need a direct PDP URL at ingest time.
    const rows = selectedItems.map(p => ({
      name: p.name,
      brand: p.brand,
      price: p.price,
      url: p.url || null,
      image_url: p.image_url,
      images: p.image_urls || [p.image_url].filter(Boolean),
      // Set to pending so the product scraper resolves the Google Shopping URL
      // to a direct merchant PDP and scrapes any missing product data.
      scrape_status: 'pending',
      scraped_at: null,
      type: inferProductType(p.name, p.brand),
      gender: inferProductGenderFromName(p.name),
      source: 'google_shopping',
    }));
    if (rows.length === 0) {
      setIngesting(false);
      showToast('Nothing selected');
      return;
    }
    // Push ghost rows immediately so the admin sees scraping
    // progress as soon as they click Ingest — the INSERT round-trip
    // can take a beat, and the post-insert scrape resolves the Google
    // Shopping URL into a real merchant URL asynchronously.
    const pendingUrls = rows.map(r => r.url).filter((u): u is string => !!u);
    if (pendingUrls.length > 0) onPending?.(pendingUrls, 'google');
    const { data: inserted, error } = await supabase
      .from('products')
      .insert(rows)
      .select('id, name, brand, price, url, image_url, images, primary_image_url, primary_image_polished, primary_image_pre_polish_url, primary_video_url, primary_video_status, primary_video_request_id, scraped_at, scrape_status, is_active, is_elite, is_platform, type, gender, created_at, source, size_fit, materials_care');
    setIngesting(false);
    if (!error) {
      showToast(`Ingested ${rows.length} product${rows.length === 1 ? '' : 's'}`);
      onClose();
      const newRows = (inserted || []).map(p => ({
        ...p,
        is_crawled: p.scrape_status === 'done' || p.scraped_at !== null,
      })) as CrawledProduct[];
      onIngested(newRows);
      // Immediately trigger the scraper for Google Shopping URLs so it resolves
      // the URL to a direct merchant PDP without waiting for the daily cron.
      for (const p of (inserted || [])) {
        if (p.url && p.url.includes('google.com')) {
          triggerScrape(p.id, p.url);
        }
      }
    } else {
      showToast(`Ingest failed: ${error.message}`);
    }
  }, [researchSelected, researchResults, onClose, onIngested, showToast]);

  const visibleResearchResults = researchResults.filter(
    p => researchGender === 'all' || p.gender === researchGender || p.gender === 'unisex'
  );

  return (
    <div className="admin-modal-overlay" onClick={() => !ingesting && onClose()}>
      <div
        className="admin-modal"
        style={{ width: 720, maxWidth: '92vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '20px 24px 12px' }}>
          <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>Add Products</h2>
          <p style={{ margin: '0 0 14px', fontSize: 13, color: '#888' }}>
            Describe what you want to add - Claude will research popular matching products.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              autoFocus
              placeholder='e.g. "white shoes", "black dresses", "sunglasses"'
              value={researchQuery}
              onChange={e => setResearchQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') runResearch(); }}
              style={{ flex: 1, padding: '8px 12px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 }}
            />
            <button
              className="admin-btn admin-btn-primary"
              onClick={runResearch}
              disabled={researchLoading || !researchQuery.trim()}
            >
              {researchLoading ? 'Researching…' : 'Research'}
            </button>
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 12, color: '#475569', cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={researchLiveOnly}
              onChange={e => setResearchLiveOnly(e.target.checked)}
              style={{ margin: 0, cursor: 'pointer' }}
            />
            Only search Google Shopping API
          </label>
          {researchError && (
            <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12 }}>
              <strong>Live search failed:</strong> {researchError}
            </div>
          )}
          {researchResults.length > 0 && researchSource && (
            <div style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px', borderRadius: 999, background: researchSource === 'live' ? '#ecfdf5' : '#fffbeb', border: '1px solid', borderColor: researchSource === 'live' ? '#a7f3d0' : '#fde68a', fontSize: 11, fontWeight: 600, color: researchSource === 'live' ? '#047857' : '#b45309', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: researchSource === 'live' ? '#10b981' : '#f59e0b' }} />
              {researchSource === 'live' ? 'Live Google Shopping' : 'Seed (offline)'}
            </div>
          )}
          {researchResults.length > 0 && (
            <div style={{ display: 'flex', gap: 12, marginTop: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>{researchResults.length}</span>
                  <span style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Products</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#3b82f6' }}>
                    {researchResults.reduce((sum, p) => sum + (p.image_urls?.length || 1), 0)}
                  </span>
                  <span style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Thumbnails pulled</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>For</span>
                {(['all', 'men', 'women', 'unisex'] as const).map(g => (
                  <button
                    key={g}
                    onClick={() => setResearchGender(g)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 999,
                      border: '1px solid',
                      borderColor: researchGender === g ? '#111' : '#e2e8f0',
                      background: researchGender === g ? '#111' : '#fff',
                      color: researchGender === g ? '#fff' : '#111',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      textTransform: 'capitalize',
                    }}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '0 24px' }}>
          {researchLoading ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: '#999', fontSize: 13 }}>
              Researching popular products…
            </div>
          ) : researchResults.length === 0 ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: '#999', fontSize: 13 }}>
              Type a query and press Research.
            </div>
          ) : visibleResearchResults.length === 0 ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: '#999', fontSize: 13 }}>
              No results for that gender.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {visibleResearchResults.map(p => {
                const idx = researchResults.indexOf(p);
                const isSelected = researchSelected.has(idx);
                const hasDirect = isLikelyProductUrl(p.url);
                const scoreColor = p.thumbnailScore >= 85 ? '#16a34a' : p.thumbnailScore >= 70 ? '#ca8a04' : '#dc2626';
                const scoreLabel = p.thumbnailScore >= 90 ? 'Excellent' : p.thumbnailScore >= 75 ? 'Good' : p.thumbnailScore >= 60 ? 'Fair' : 'Poor';
                return (
                  <div
                    key={`${p.brand}-${p.name}-${idx}`}
                    onClick={() => {
                      setResearchSelected(prev => {
                        const next = new Set(prev);
                        if (next.has(idx)) next.delete(idx); else next.add(idx);
                        return next;
                      });
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                      borderRadius: 8, cursor: 'pointer',
                      background: isSelected ? '#f0f7ff' : 'transparent',
                      border: `1px solid ${isSelected ? '#3b82f6' : '#eee'}`,
                    }}
                  >
                    <div style={{
                      width: 20, height: 20, borderRadius: 4,
                      border: `2px solid ${isSelected ? '#3b82f6' : '#ccc'}`,
                      background: isSelected ? '#3b82f6' : '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      {isSelected && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 3, flexShrink: 0, position: 'relative' }}>
                      {(p.image_urls || [p.image_url]).slice(0, 4).map((u, ui) => (
                        <img
                          key={ui}
                          src={u}
                          alt=""
                          onError={e => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
                          style={{
                            width: ui === 0 ? 48 : 28,
                            height: 48,
                            borderRadius: 6,
                            objectFit: 'cover',
                            background: '#f5f5f5',
                            border: '1px solid #e5e7eb',
                          }}
                        />
                      ))}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: '#888' }}>
                        {p.brand} · {p.price} · <span style={{ textTransform: 'capitalize' }}>{p.gender}</span>
                      </div>
                      {!hasDirect ? (
                        <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 2, fontWeight: 600 }}>
                          Scraper will resolve URL
                        </div>
                      ) : (
                        <div style={{ fontSize: 10, color: '#3b82f6', marginTop: 2, fontWeight: 600 }}>
                          {(p.image_urls || [p.image_url]).length} thumbnail{((p.image_urls || [p.image_url]).length === 1) ? '' : 's'} pulled
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 11, color: '#888' }}>Thumbnail</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: scoreColor }}>{p.thumbnailScore}</span>
                        <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: `${scoreColor}18`, color: scoreColor, fontWeight: 600 }}>{scoreLabel}</span>
                      </div>
                      <div style={{ fontSize: 10, color: '#999' }}>{p.reason}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ padding: '14px 24px', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#888' }}>
            {researchSelected.size > 0 ? `${researchSelected.size} selected` : ''}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="admin-btn admin-btn-secondary" onClick={() => !ingesting && onClose()} disabled={ingesting}>
              Cancel
            </button>
            <button
              className="admin-btn admin-btn-primary"
              onClick={ingestSelectedProducts}
              disabled={ingesting || researchSelected.size === 0}
            >
              {ingesting ? 'Ingesting…' : `Ingest ${researchSelected.size || ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminData() {
  // Subtab state is mirrored onto the URL query (?tab=products) so each view
  // is deep-linkable and the browser back button works like users expect.
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = (searchParams.get('tab') as Tab | null) || 'looks';
  const activeTab: Tab = (['looks', 'products', 'musics', 'places'].includes(urlTab) ? urlTab : 'looks') as Tab;
  const setActiveTab = useCallback((next: Tab) => {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      if (next === 'looks') p.delete('tab');
      else p.set('tab', next);
      // Clear brand filter when switching tabs.
      p.delete('brand');
      return p;
    }, { replace: false });
  }, [setSearchParams]);

  // Brand drill-down from Analytics → Brands "View products" button.
  const brandFilter = searchParams.get('brand') || null;
  const clearBrandFilter = useCallback(() => {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      p.delete('brand');
      return p;
    }, { replace: true });
  }, [setSearchParams]);

  // Looks sub-filter: Published = curated catalog, Unpublished = looks that
  // shoppers / creators generated themselves via the /generate flow.
  const urlLooks = (searchParams.get('looks') as LooksFilter | null) || 'published';
  const looksFilter: LooksFilter = (['published', 'unpublished', 'failed'].includes(urlLooks) ? urlLooks : 'published') as LooksFilter;
  const setLooksFilter = useCallback((next: LooksFilter) => {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      if (next === 'published') p.delete('looks');
      else p.set('looks', next);
      return p;
    }, { replace: false });
  }, [setSearchParams]);

  // AI vs Human source filter — second axis on the Looks tab. Persisted
  // in the URL so reloads stay on the same view and links shared with
  // other admins land them on the same filter.
  const urlSource = (searchParams.get('source') as LookSource | null) || 'all';
  const lookSource: LookSource = (['all', 'human', 'ai'].includes(urlSource) ? urlSource : 'all') as LookSource;
  const setLookSource = useCallback((next: LookSource) => {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      if (next === 'all') p.delete('source');
      else p.set('source', next);
      return p;
    }, { replace: false });
  }, [setSearchParams]);
  const [productFilter, setProductFilter] = useState<'all' | 'no-creative' | 'active' | 'inactive' | 'untagged' | 'soft-deleted'>('all');
  const [toast, setToast] = useState<string | null>(null);
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const [generatePicker, setGeneratePicker] = useState<{ productId: string; productName: string } | null>(null);
  // Batch variant: fires handleGenerateCreative for every item in the list
  // when the user picks a style.
  const [batchPicker, setBatchPicker] = useState<{ items: { id: string; name: string }[] } | null>(null);

  // Looks + creators are loaded from Supabase so the admin view reflects the
  // live DB instead of the hardcoded seed in app/data/looks.ts. Fall back to
  // the static module only if the Supabase fetch returns nothing (e.g.
  // offline or first-boot before seed has been applied).
  // Deleted-look + deleted-product state — declared HERE (above
  // publishedSourceCounts and other consumers) so deps arrays don't
  // TDZ in production. Was the cause of the "Cannot access 'Zt'
  // before initialization" 500 on /admin/data.
  const [deletedLookIds, setDeletedLookIds] = useState<Set<number>>(() => readLocalSet<number>(LOCAL_LOOKS_KEY));
  const [deletedProductKeys, setDeletedProductKeys] = useState<Set<string>>(() => readLocalSet<string>(LOCAL_PRODUCTS_KEY));

  const [looks, setLooks] = useState<Look[]>(staticLooks);
  const [creators, setCreators] = useState<Record<string, Creator>>(staticCreators);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [fetchedLooks, fetchedCreators] = await Promise.all([
          getLooks(),
          getCreators(),
        ]);
        if (cancelled) return;
        if (fetchedLooks.length > 0) setLooks(fetchedLooks);
        if (Object.keys(fetchedCreators).length > 0) setCreators(fetchedCreators);
      } catch (err) {
        console.warn('[AdminData] live looks fetch failed, keeping static seed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // User-generated looks (the Unpublished sub-tab). Loaded once on mount so
  // the badge count is accurate even on the Published view. Admin RLS on
  // user_generations was added in migration 044 - without that this query
  // returns zero rows for non-owner sessions.
  const [unpublished, setUnpublished] = useState<UnpublishedLook[]>([]);
  const [unpublishedLoading, setUnpublishedLoading] = useState(true);
  useEffect(() => {
    if (!supabase) { setUnpublishedLoading(false); return; }
    let cancelled = false;
    (async () => {
      const { data: gens, error } = await supabase
        .from('user_generations')
        .select('id, user_id, status, style, height_label, age_label, height_cm, model, veo_model, prompt, fal_request_id, completed_at, storage_path, video_url, error, created_at, user_generation_products(count)')
        .order('created_at', { ascending: false });
      if (error) {
        console.warn('[AdminData] unpublished looks fetch failed:', error);
        if (!cancelled) setUnpublishedLoading(false);
        return;
      }
      const userIds = Array.from(new Set((gens || []).map((g: { user_id: string }) => g.user_id)));
      const profilesById = new Map<string, { full_name: string | null; avatar_url: string | null; email: string | null; is_ai: boolean }>();
      if (userIds.length > 0) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, full_name, avatar_url, email, is_ai')
          .in('id', userIds);
        (profs || []).forEach((p: { id: string; full_name: string | null; avatar_url: string | null; email: string | null; is_ai: boolean | null }) => {
          profilesById.set(p.id, {
            full_name: p.full_name,
            avatar_url: p.avatar_url,
            email: p.email,
            is_ai: p.is_ai === true,
          });
        });
      }
      if (cancelled) return;
      const rows: UnpublishedLook[] = (gens || []).map((g: {
        id: string; user_id: string;
        status: 'pending' | 'generating' | 'done' | 'failed';
        style: string; height_label: string | null; age_label: string | null;
        height_cm: number | null;
        model: 'fast' | 'pro' | null; veo_model: string | null;
        prompt: string | null; fal_request_id: string | null;
        completed_at: string | null; storage_path: string | null;
        video_url: string | null; error: string | null; created_at: string;
        user_generation_products: { count: number }[] | null;
      }) => {
        const prof = profilesById.get(g.user_id);
        return {
          id: g.id,
          user_id: g.user_id,
          status: g.status,
          style: g.style,
          height_label: g.height_label,
          age_label: g.age_label,
          height_cm: g.height_cm,
          model: g.model,
          veo_model: g.veo_model,
          prompt: g.prompt,
          fal_request_id: g.fal_request_id,
          completed_at: g.completed_at,
          storage_path: g.storage_path,
          video_url: g.video_url,
          error: g.error,
          created_at: g.created_at,
          product_count: g.user_generation_products?.[0]?.count ?? 0,
          creator_name: prof?.full_name ?? null,
          creator_avatar: prof?.avatar_url ?? null,
          creator_email: prof?.email ?? null,
          creator_is_ai: prof?.is_ai === true,
        };
      });
      setUnpublished(rows);
      setUnpublishedLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Split user_generations into pending/done (Unpublished tab) and failed
  // (Failed tab) so admins can triage without scrolling past dead rows.
  // The source filter (All / Human / AI) layers on top of the
  // published/unpublished/failed pill so admins can answer "show me
  // every AI-persona look still pending" or "every human-generated
  // failure" without combining queries by hand.
  const sourceMatch = useCallback((g: UnpublishedLook) => {
    if (lookSource === 'all') return true;
    return lookSource === 'ai' ? g.creator_is_ai : !g.creator_is_ai;
  }, [lookSource]);
  const unpublishedActive = useMemo(
    () => unpublished.filter(g => g.status !== 'failed' && sourceMatch(g)),
    [unpublished, sourceMatch],
  );
  const failedLooks = useMemo(
    () => unpublished.filter(g => g.status === 'failed' && sourceMatch(g)),
    [unpublished, sourceMatch],
  );
  // Source-filter counts, unscoped by the published/unpublished pill —
  // shown next to the All / Human / AI buttons so the admin sees the
  // distribution at a glance.
  const sourceCounts = useMemo(() => ({
    all:   unpublished.length,
    human: unpublished.filter(g => !g.creator_is_ai).length,
    ai:    unpublished.filter(g =>  g.creator_is_ai).length,
  }), [unpublished]);

  // Mirror of sourceCounts for the Published tab — Published looks
  // come from the seed/Supabase Look[] not the user_generations table,
  // so they need their own count keyed off look.creatorIsAi.
  const publishedSourceCounts = useMemo(() => {
    const live = looks.filter(l => !deletedLookIds.has(l.id));
    return {
      all:   live.length,
      human: live.filter(l => !l.creatorIsAi).length,
      ai:    live.filter(l =>  l.creatorIsAi).length,
    };
  }, [looks, deletedLookIds]);

  // Bottom-center publish toast. Stays up ~3.2s and fades. The
  // unpublished-row Publish button drives this - single-shot so we
  // don't need a queue.
  const [publishMsg, setPublishMsg] = useState<string | null>(null);
  const [publishingIds, setPublishingIds] = useState<Set<string>>(new Set());
  const publishTimerRef = useRef<number | null>(null);

  const flashPublishMsg = useCallback((msg: string) => {
    setPublishMsg(msg);
    if (publishTimerRef.current != null) window.clearTimeout(publishTimerRef.current);
    publishTimerRef.current = window.setTimeout(() => setPublishMsg(null), 3200);
  }, []);

  // Expanded-row state for the Unpublished looks table - fetches the
  // generation's products on demand so the initial list query stays
  // cheap. Cached after the first fetch so re-expanding is instant.
  interface UnpublishedProduct {
    id: string;
    name: string;
    brand: string;
    price: string | null;
    image_url: string | null;
    role_tag: string | null;
  }
  const [expandedUnpublishedId, setExpandedUnpublishedId] = useState<string | null>(null);
  // Separate expansion state for the Model column. Mutually exclusive
  // with the products expansion: clicking Model collapses Products and
  // vice versa, so the table never has two expanded panels per row.
  const [expandedModelId, setExpandedModelId] = useState<string | null>(null);
  const toggleModelExpand = useCallback((id: string) => {
    setExpandedModelId(prev => (prev === id ? null : id));
    setExpandedUnpublishedId(null);
  }, []);
  const [unpublishedProducts, setUnpublishedProducts] = useState<Map<string, UnpublishedProduct[]>>(new Map());
  const [unpublishedProductsLoading, setUnpublishedProductsLoading] = useState<Set<string>>(new Set());

  const toggleUnpublishedExpand = useCallback(async (genId: string) => {
    setExpandedUnpublishedId(prev => (prev === genId ? null : genId));
    setExpandedModelId(null);
    if (unpublishedProducts.has(genId) || unpublishedProductsLoading.has(genId)) return;
    if (!supabase) return;
    setUnpublishedProductsLoading(prev => {
      const next = new Set(prev);
      next.add(genId);
      return next;
    });
    const { data, error } = await supabase
      .from('user_generation_products')
      .select('product_id, role_tag, sort_order, products(id, name, brand, price, image_url)')
      .eq('generation_id', genId)
      .order('sort_order');
    if (!error && data) {
      const rows: UnpublishedProduct[] = (data as unknown as Array<{
        product_id: string;
        role_tag: string | null;
        sort_order: number;
        products: { id: string; name: string | null; brand: string | null; price: string | null; image_url: string | null } | null;
      }>)
        .filter(r => !!r.products)
        .map(r => ({
          id: r.products!.id,
          name: r.products!.name || ' - ',
          brand: r.products!.brand || ' - ',
          price: r.products!.price,
          image_url: r.products!.image_url,
          role_tag: r.role_tag,
        }));
      setUnpublishedProducts(prev => {
        const next = new Map(prev);
        next.set(genId, rows);
        return next;
      });
    }
    setUnpublishedProductsLoading(prev => {
      const next = new Set(prev);
      next.delete(genId);
      return next;
    });
  }, [unpublishedProducts, unpublishedProductsLoading]);

  const publishUnpublishedInline = useCallback(async (g: UnpublishedLook) => {
    if (publishingIds.has(g.id)) return;
    if (g.status !== 'done') return;
    setPublishingIds(prev => {
      const next = new Set(prev);
      next.add(g.id);
      return next;
    });
    // Optimistic UX: drop the row from the unpublished list and
    // flash the bottom-center toast IMMEDIATELY. The Supabase
    // round-trip then runs in the background; on failure we put
    // the row back and replace the toast with the error.
    setUnpublished(prev => prev.filter(u => u.id !== g.id));
    flashPublishMsg('This look is published');

    try {
      // Need the linked products to attach after the look is created.
      let products = unpublishedProducts.get(g.id);
      if (!products && supabase) {
        const { data: prodRows } = await supabase
          .from('user_generation_products')
          .select('product_id, role_tag, sort_order, products(id, name, brand, price, image_url)')
          .eq('generation_id', g.id)
          .order('sort_order');
        products = ((prodRows || []) as unknown as Array<{
          product_id: string;
          role_tag: string | null;
          sort_order: number;
          products: { id: string; name: string | null; brand: string | null; price: string | null; image_url: string | null } | null;
        }>)
          .filter(r => !!r.products)
          .map(r => ({
            id: r.products!.id,
            name: r.products!.name || ' - ',
            brand: r.products!.brand || ' - ',
            price: r.products!.price,
            image_url: r.products!.image_url,
            role_tag: r.role_tag,
          }));
      }
      const creatorLabel = g.creator_name || g.creator_email || g.user_id.slice(0, 8);
      const { data: look } = await createLook({
        title: `${creatorLabel}’s ${g.style} look`,
        description: `Promoted from generation ${g.id}`,
        gender: 'unisex',
      });
      // Don't block the toast / list refresh on per-product attaches.
      // Each one round-trips the manage-looks edge function and a
      // failed product shouldn't fail the whole publish.
      void Promise.all((products || []).map(p =>
        addProductToLook(look.id, { product_id: p.id }).catch(err => {
          console.warn('[publish-inline] addProductToLook failed:', err);
        })
      ));
      // Same two follow-ups as the dedicated screen - without these
      // the new row never appears in the Published list.
      const followUps: Promise<unknown>[] = [];
      if (supabase && g.video_url) {
        followUps.push(Promise.resolve(supabase
          .from('looks_creative')
          .insert({ look_id: look.id, video_url: g.video_url, is_primary: true })
          .select('id')
          .single()
          .then(({ data: creativeData, error }: { data: { id: string } | null; error: { message: string } | null }) => {
            if (error) console.warn('[publish-inline] looks_creative insert failed:', error.message);
            if (creativeData?.id) {
              void generateAndStorePoster(look.id, creativeData.id, g.video_url!);
            }
          })));
      }
      if (supabase) {
        // Overwrite user_id with the source generation's creator so
        // the consumer + admin Looks list attribute the look to the
        // person who *made* it, not the admin who clicked Publish.
        // manage-looks writes user_id = auth.uid() (the admin), and
        // fetchLooksFromSupabase keys the profile lookup off user_id.
        // creator_handle is also synced by the DB trigger
        // looks_sync_creator_handle, but we set it explicitly when we
        // have it to avoid the round-trip to creators.
        const updates: Record<string, unknown> = { status: 'live' };
        if (g.user_id) {
          updates.user_id = g.user_id;
          updates.creator_handle = null; // let trigger backfill from creators
        }
        followUps.push(Promise.resolve(supabase
          .from('looks')
          .update(updates)
          .eq('id', look.id)
          .then(({ error }: { error: { message: string } | null }) => {
            if (error) console.warn('[publish-inline] status update failed:', error.message);
          })));
        // Also record the admin who actually ran the publish so the
        // audit trail survives the user_id move.
        followUps.push((async () => {
          const { data: { user: authUser } } = await supabase.auth.getUser();
          if (!authUser?.id) return;
          const { error } = await supabase
            .from('looks')
            .update({ created_by: authUser.id })
            .eq('id', look.id);
          if (error) console.warn('[publish-inline] created_by update failed:', error.message);
        })());
      }
      await Promise.all(followUps);
      invalidateLooksCache();
      // Refresh the Published tab in the background so the new row
      // shows up. This may take a moment but the UI already moved on.
      const fresh = await getLooks();
      setLooks(fresh);
    } catch (err) {
      console.error('[publish-inline] failed:', err);
      // Put the row back and replace the optimistic toast with an
      // error so the admin knows it didn't actually go through.
      setUnpublished(prev => prev.some(u => u.id === g.id) ? prev : [g, ...prev]);
      flashPublishMsg(err instanceof Error ? `Publish failed: ${err.message}` : 'Publish failed');
    } finally {
      setPublishingIds(prev => {
        const next = new Set(prev);
        next.delete(g.id);
        return next;
      });
    }
  }, [publishingIds, unpublishedProducts, flashPublishMsg]);

  const [genModel, setGenModel] = useState<string>(DEFAULT_VIDEO_MODEL);
  // Split mode: generate one ad per model so you can A/B (e.g. Veo vs Seedance).
  const [genSplit, setGenSplit] = useState<boolean>(false);
  const [genModel2, setGenModel2] = useState<string>('seedance-2');
  const [hoverPreview, setHoverPreview] = useState<{ url: string; x: number; y: number } | null>(null);

  // Multi-row selection on the Products table. Keyed by `${brand}-${name}` to
  // match deletedProductKeys. Shift-click extends the range from the last
  // explicit toggle; plain click toggles a single row.
  const [selectedProductKeys, setSelectedProductKeys] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);

  // In-flight generation jobs per product - tracks individual ad rows so we
  // can show an accurate progress bar bound to the ad statuses in Supabase.
  interface GenJob {
    adIds: string[];
    total: number;
    done: number;
    failed: number;
    generating: number; // currently in the 'generating' status
    startedAt: number;
  }
  const [genJobs, setGenJobs] = useState<Map<string, GenJob>>(new Map());
  // Which row's inline Links/affiliates dropdown is open.
  const [openLinksRow, setOpenLinksRow] = useState<string | null>(null);

  // Which row's inline Tags dropdown is open (keyed by `${brand}-${name}`).
  const [openTagsRow, setOpenTagsRow] = useState<string | null>(null);
  // Which row's inline Creative+Photos dropdown is open.
  const [openDetailRow, setOpenCreativeRow] = useState<string | null>(null);
  useEffect(() => {
    if (!openDetailRow) return;
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenCreativeRow(null); };
    document.addEventListener('keydown', keyHandler);
    return () => document.removeEventListener('keydown', keyHandler);
  }, [openDetailRow]);

  // Tags is now an inline expanded row like Links - close only via the button
  // or Escape.
  useEffect(() => {
    if (!openTagsRow) return;
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenTagsRow(null); };
    document.addEventListener('keydown', keyHandler);
    return () => document.removeEventListener('keydown', keyHandler);
  }, [openTagsRow]);

  // Links is now an inline expanded row (not a floating popup) so the only
  // way to close it is to click View again or press Escape.
  useEffect(() => {
    if (!openLinksRow) return;
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenLinksRow(null); };
    document.addEventListener('keydown', keyHandler);
    return () => document.removeEventListener('keydown', keyHandler);
  }, [openLinksRow]);

  // Amazon (Rainforest) lookup modal
  const [showAmazonLookup, setShowAmazonLookup] = useState(false);

  // Add Products research modal
  const [showAddProducts, setShowAddProducts] = useState(false);

  // Add Products dropdown - opens a menu with three sources (Google
  // Shopping → existing research modal, Amazon → Rainforest lookup,
  // Brand Website → URL paste).
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [showPromptSettings, setShowPromptSettings] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!addMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setAddMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [addMenuOpen]);

  // Add via Brand Website - modal with URL input(s) that hit the
  // shared scrape-product service. Supports a single URL or a
  // paste-list (newline / comma / whitespace separated).
  const [showBrandUrl, setShowBrandUrl] = useState(false);
  const [brandUrlInput, setBrandUrlInput] = useState('');
  const [brandUrlBusy, setBrandUrlBusy] = useState(false);
  const [brandUrlError, setBrandUrlError] = useState<string | null>(null);
  const [brandBatchProgress, setBrandBatchProgress] = useState<{ done: number; total: number; failed: number } | null>(null);
  // Pending product ghost rows — added optimistically when an admin
  // submits an "Add via …" URL. Each row sits at the top of the
  // Products table with an indeterminate progress bar until the real
  // product row materializes in the products list (matched by URL)
  // or 90s elapses (timeout safety net).
  interface PendingProduct { id: string; url: string; source: 'brand' | 'google' | 'amazon'; startedAt: number }
  const [pendingProducts, setPendingProducts] = useState<PendingProduct[]>([]);
  // Prune pending rows once the underlying product appears in the
  // real list (by URL match) or 90 seconds elapse — whichever first.
  // `allProducts` is declared further down; we read it via a ref so
  // this effect can run regardless of declaration order and not TDZ.
  const allProductsRef = useRef<{ url: string }[]>([]);
  useEffect(() => {
    if (pendingProducts.length === 0) return;
    const interval = window.setInterval(() => {
      setPendingProducts(prev => {
        if (prev.length === 0) return prev;
        const now = Date.now();
        const realUrls = new Set(allProductsRef.current.map(p => p.url));
        const next = prev.filter(pp => !realUrls.has(pp.url) && now - pp.startedAt < 90_000);
        return next.length === prev.length ? prev : next;
      });
    }, 1500);
    return () => window.clearInterval(interval);
  }, [pendingProducts.length]);
  // Stale product refresh
  const [refreshing, setRefreshing] = useState(false);
  const [auditingTypes, setAuditingTypes] = useState(false);
  const [auditingGenders, setAuditingGenders] = useState(false);
  const [ingestingSpecs, setIngestingSpecs] = useState(false);
  const [refreshProgress, setRefreshProgress] = useState<{ done: number; total: number } | null>(null);

  // AI copywriter
  const [copywriting, setCopywriting] = useState(false);
  const [copywriteProgress, setCopywriteProgress] = useState<{ done: number; total: number } | null>(null);

  // Primary-image picker — Claude Haiku vision scores every product
  // image; the highest "solo product" shot becomes products.primary_image_url.
  const [pickingPrimary, setPickingPrimary] = useState(false);
  const [primaryProgress, setPrimaryProgress] = useState<{ done: number; total: number; failed: number } | null>(null);
  // Bulk Polish / Generate primary video — separate counters from the
  // per-tile progress so the bulk-bar can show its own batch state
  // while individual rows keep their inline spinners. The global
  // Generation Queue panel handles per-product progress bars; these
  // counters just drive the bulk-pill label text.
  const [bulkPolishing, setBulkPolishing] = useState(false);
  const [bulkPolishProgress, setBulkPolishProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkVideoGenerating, setBulkVideoGenerating] = useState(false);
  const [bulkVideoProgress, setBulkVideoProgress] = useState<{ done: number; total: number } | null>(null);
  // In-flight primary-video jobs keyed by product_id. The job stays in
  // the Generation Queue (i.e. queueJob.finish() is NOT called on
  // submit) until the background poll below detects status='done' or
  // 'failed' on the products row. pendingVideoTick is bumped after each
  // new submit so the poll re-binds and picks the new product up.
  const pendingVideoJobsRef = useRef<Map<string, { job: { id: string; finish: (ms?: number, msg?: string) => void; fail: (msg?: string) => void }; startedAt: number }>>(new Map());
  const [pendingVideoTick, setPendingVideoTick] = useState(0);

  // runPickPrimaryImages is defined further down — after showToast — to
  // avoid the TDZ on the useCallback deps array. The button binds to
  // the resolved callback below.
  const runPickPrimaryImagesRef = useRef<() => Promise<void>>(async () => {});
  const runPickPrimaryImages = useCallback(() => runPickPrimaryImagesRef.current(), []);

  const runCopywriter = useCallback(async () => {
    if (!supabase) return;
    // Rewrite products that don't have a display_name yet. Cap at 100 per run.
    const { data: toRewrite } = await supabase
      .from('products')
      .select('id, name, brand, price')
      .is('display_name', null)
      .limit(100);
    if (!toRewrite || toRewrite.length === 0) {
      showToast('All products already have Claude-written copy.');
      return;
    }
    setCopywriting(true);
    setCopywriteProgress({ done: 0, total: toRewrite.length });
    try {
      const BATCH = 30;
      let totalDone = 0;
      for (let i = 0; i < toRewrite.length; i += BATCH) {
        const batch = toRewrite.slice(i, i + BATCH);
        const { data, error } = await supabase.functions.invoke('product-copywriter', {
          body: { products: batch.map(p => ({ id: p.id, name: p.name || '', brand: p.brand || '', price: p.price })) },
        });
        if (!error && data?.success && data.results) {
          const nowIso = new Date().toISOString();
          await Promise.all(
            Object.entries(data.results as Record<string, { display_name: string; hook_copy: string }>)
              .map(([id, r]) =>
                supabase!.from('products').update({
                  display_name: r.display_name,
                  hook_copy: r.hook_copy,
                  rewritten_at: nowIso,
                }).eq('id', id)
              )
          );
        }
        totalDone += batch.length;
        setCopywriteProgress({ done: totalDone, total: toRewrite.length });
      }
      showToast(`Rewrote ${totalDone} product name${totalDone === 1 ? '' : 's'}`);
    } finally {
      setCopywriting(false);
      setCopywriteProgress(null);
    }
  }, []);

  const refreshStaleProducts = useCallback(async () => {
    if (!supabase) return;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    // Products not refreshed in 7+ days (or never refreshed)
    const { data: stale } = await supabase
      .from('products')
      .select('id, name, brand, url, price')
      .or(`last_refreshed_at.is.null,last_refreshed_at.lt.${sevenDaysAgo}`)
      .limit(50);
    if (!stale || stale.length === 0) {
      showToast('No stale products - everything checked in the last 7 days');
      return;
    }
    setRefreshing(true);
    setRefreshProgress({ done: 0, total: stale.length });
    try {
      const BATCH = 10;
      let priceChanges = 0;
      let oos = 0;
      for (let i = 0; i < stale.length; i += BATCH) {
        const batch = stale.slice(i, i + BATCH);
        const { data, error } = await supabase.functions.invoke('product-refresh', {
          body: {
            products: batch.map(p => ({
              id: p.id,
              name: p.name || '',
              brand: p.brand || '',
              url: p.url,
              current_price: p.price,
            })),
          },
        });
        if (error || !data?.success) {
          console.error('Refresh batch failed:', error || data?.error);
          setRefreshProgress({ done: i + batch.length, total: stale.length });
          continue;
        }
        const nowIso = new Date().toISOString();
        await Promise.all((data.results as Array<{ id: string; price?: string; availability: string; priceChanged?: boolean; oldPrice?: string }>).map(async r => {
          const update: Record<string, unknown> = {
            availability: r.availability,
            last_refreshed_at: nowIso,
          };
          if (r.price) update.price = r.price;
          if (r.priceChanged && r.oldPrice) {
            update.previous_price = r.oldPrice;
            priceChanges++;
          }
          if (r.availability === 'out_of_stock') oos++;
          await supabase!.from('products').update(update).eq('id', r.id);
        }));
        setRefreshProgress({ done: i + batch.length, total: stale.length });
      }
      showToast(`Refreshed ${stale.length} - ${priceChanges} price changes, ${oos} out of stock`);
      // Reload products in the table
      const { data: reloaded } = await supabase
        .from('products')
        .select('id, name, brand, price, url, image_url, images, primary_image_url, primary_image_polished, primary_image_pre_polish_url, primary_video_url, primary_video_status, primary_video_request_id, scraped_at, scrape_status, is_active, is_elite, is_platform, type, gender, created_at, source, size_fit, materials_care')
        .order('scraped_at', { ascending: false });
      if (reloaded) {
        setCrawledProducts((reloaded || []).map(p => ({
          ...p,
          is_crawled: p.scrape_status === 'done' || p.scraped_at !== null,
        })) as CrawledProduct[]);
      }
    } finally {
      setRefreshing(false);
      setRefreshProgress(null);
    }
  }, []);

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

  // Create Look modal state
  const [showCreateLook, setShowCreateLook] = useState(false);
  const [createLookSelectedProducts, setCreateLookSelectedProducts] = useState<Set<string>>(new Set());
  const [createLookProductSearch, setCreateLookProductSearch] = useState('');
  const [createLookCreator, setCreateLookCreator] = useState('');
  const [createLookLocation, setCreateLookLocation] = useState('');
  const [createLookStyle, setCreateLookStyle] = useState('Street Style');

  const openCreateLookModal = useCallback(() => {
    setCreateLookSelectedProducts(new Set());
    setCreateLookProductSearch('');
    setCreateLookCreator('');
    setCreateLookLocation('');
    setCreateLookStyle('Street Style');
    setShowCreateLook(true);
  }, []);

  const toggleCreateLookProduct = useCallback((id: string) => {
    setCreateLookSelectedProducts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const [creatingLook, setCreatingLook] = useState(false);

  const creatorOptions = useMemo(() =>
    Object.entries(creators).map(([key, c]) => ({ key, displayName: c.displayName, avatar: c.avatar })),
  []);

  // Toggle states per look: { [lookId]: { platform, featured, splash } }
  const [toggles, setToggles] = useState<Record<number, { platform: boolean; featured: boolean; splash: boolean }>>({});

  // Merge Supabase hidden sets on top of the local fallback. If the remote
  // table is missing or errors, the local set still wins - deletions stick.
  useEffect(() => {
    if (!supabase) return;
    (async () => {
      const [looksRes, prodsRes] = await Promise.all([
        supabase.from('admin_hidden_looks').select('look_id'),
        supabase.from('admin_hidden_products').select('brand, name'),
      ]);
      if (looksRes.data) {
        setDeletedLookIds(prev => {
          const merged = new Set(prev);
          for (const r of looksRes.data as { look_id: number }[]) merged.add(r.look_id);
          writeLocalSet(LOCAL_LOOKS_KEY, merged);
          return merged;
        });
      }
      if (prodsRes.data) {
        setDeletedProductKeys(prev => {
          const merged = new Set(prev);
          for (const r of prodsRes.data as { brand: string; name: string }[]) merged.add(`${r.brand}-${r.name}`);
          writeLocalSet(LOCAL_PRODUCTS_KEY, merged);
          return merged;
        });
      }
    })();
  }, []);
  const [lookOrder, setLookOrder] = useState<number[] | null>(null);
  const [dragLookId, setDragLookId] = useState<number | null>(null);

  const deleteLook = useCallback(async (id: number) => {
    if (!window.confirm('Delete this look? This cannot be undone.')) return;
    // Optimistic + durable local persist so refresh keeps the deletion.
    setDeletedLookIds(prev => {
      const next = new Set(prev);
      next.add(id);
      writeLocalSet(LOCAL_LOOKS_KEY, next);
      return next;
    });
    if (!supabase) return;
    const { error } = await supabase
      .from('admin_hidden_looks')
      .upsert({ look_id: id }, { onConflict: 'look_id' });
    if (error) {
      // Missing table = migration not applied yet. Local state already
      // persisted via localStorage, so the deletion still survives refresh.
      const tableMissing =
        error.code === 'PGRST205' ||
        /schema cache|does not exist|admin_hidden_looks/i.test(error.message);
      if (tableMissing) return;
      // Rollback on real error - keep user's data in sync with the server.
      setDeletedLookIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        writeLocalSet(LOCAL_LOOKS_KEY, next);
        return next;
      });
      window.alert(`Delete failed: ${error.message}`);
    }
  }, []);

  const moveLook = useCallback((id: number, direction: -1 | 1) => {
    setLookOrder(prev => {
      const base = prev || looks.map(l => l.id);
      const idx = base.indexOf(id);
      if (idx < 0) return prev;
      const swapIdx = idx + direction;
      if (swapIdx < 0 || swapIdx >= base.length) return prev;
      const next = [...base];
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return next;
    });
  }, []);

  const onDropLook = useCallback((targetId: number) => {
    if (dragLookId === null || dragLookId === targetId) return;
    setLookOrder(prev => {
      const base = prev || looks.map(l => l.id);
      const from = base.indexOf(dragLookId);
      const to = base.indexOf(targetId);
      if (from < 0 || to < 0) return prev;
      const next = [...base];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setDragLookId(null);
  }, [dragLookId]);

  const getToggles = useCallback((id: number) => toggles[id] || { platform: true, featured: true, splash: true }, [toggles]);

  const setToggle = useCallback((id: number, field: 'platform' | 'featured' | 'splash', value: boolean) => {
    setToggles(prev => ({
      ...prev,
      [id]: { ...prev[id] || { platform: true, featured: true, splash: true }, [field]: value },
    }));
  }, []);

  const adminQuery = useAdminSearch();

  const lookRows: LookRow[] = useMemo(() => {
    let filtered = looks.filter(l => !deletedLookIds.has(l.id));
    if (lookSource !== 'all') {
      filtered = filtered.filter(l =>
        lookSource === 'ai' ? l.creatorIsAi : !l.creatorIsAi);
    }
    if (adminQuery) {
      filtered = filtered.filter(l => {
        const c = creators[l.creator];
        const hay = `${l.creator} ${c?.displayName || ''} ${l.title || ''} ${l.products.map(p => `${p.brand} ${p.name}`).join(' ')}`.toLowerCase();
        return hay.includes(adminQuery);
      });
    }
    const ordered = lookOrder
      ? [...filtered].sort((a, b) => {
          const ai = lookOrder.indexOf(a.id);
          const bi = lookOrder.indexOf(b.id);
          return (ai === -1 ? 1e9 : ai) - (bi === -1 ? 1e9 : bi);
        })
      : filtered;
    return ordered.map(look => {
      const c = creators[look.creator];
      // Fallback chain: seed-creator map → profile data emitted by
      // fetchLooksFromSupabase for user-published looks → ' - '.
      const display = c?.displayName || look.creatorDisplayName || (look.creator?.startsWith('user:') ? '' : look.creator) || ' - ';
      const avatar = c?.avatar || look.creatorAvatar || '';
      return {
        id: look.id,
        creator: look.creator,
        creatorDisplay: display,
        creatorAvatar: avatar,
        creatorIsAi: !!look.creatorIsAi,
        video: look.video,
        thumbnail: look.thumbnail_url || null,
        products: look.products.length,
      };
    });
    // looks + creators must be in deps - without them the memoized
    // rows array goes stale after a publish (cache is invalidated and
    // looks state refetches, but the table keeps rendering the
    // previous snapshot).
  }, [looks, creators, deletedLookIds, lookOrder, adminQuery, lookSource]);

  // Brand-to-domain mapping for Brandfetch logos
  const brandDomains: Record<string, string> = useMemo(() => ({
    'Zara': 'zara.com',
    'Windsor': 'windsorstore.com',
    'Diesel': 'diesel.com',
    'Pavoi': 'pavoi.com',
    'Vince': 'vince.com',
    'Suitsupply': 'suitsupply.com',
    'Dior': 'dior.com',
    'Fujifilm': 'fujifilm.com',
  }), []);

  const getBrandLogo = useCallback((brand: string) => {
    const domain = brandDomains[brand];
    if (!domain) return null;
    return `https://cdn.brandfetch.io/${domain}/w/80/h/80/fallback/lettermark?c=1id3n10pdBTarCHI0db`;
  }, [brandDomains]);

  const [crawledProducts, setCrawledProducts] = useState<CrawledProduct[]>([]);
  // Tracks whether the initial Supabase products fetch is still in
  // flight. Used by the Products tab to render a loading skeleton
  // instead of the bundled-in-app/data/looks.ts seed fallback, which
  // surfaces 8 stale demo rows (Zara/Windsor/Diesel/etc.) before the
  // real DB data lands. The seed merge still drives the Looks tab and
  // creator counts; we just don't paint it as if it were the catalog.
  const [productsLoading, setProductsLoading] = useState(true);
  // Stats column group on the Products table - In Looks, Creators,
  // Impressions, Saves, Clicks, Date Added all hide behind a single
  // "Stats" header by default. Click the chevron to expand and see
  // every column. Persisted so admins don't have to re-expand on
  // every page load.
  const [statsExpanded, setStatsExpanded] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try { return window.localStorage.getItem('admin:products-stats-expanded') === '1'; }
    catch { return false; }
  });
  useEffect(() => {
    try { window.localStorage.setItem('admin:products-stats-expanded', statsExpanded ? '1' : '0'); }
    catch { /* quota */ }
  }, [statsExpanded]);
  const [adProductIds, setAdProductIds] = useState<Set<string>>(new Set());
  const [adVideoMap, setAdVideoMap] = useState<Map<string, string[]>>(new Map());
  // Model + prompt metadata keyed by video_url so each rendered thumb can
  // label the model used and surface the prompt on hover.
  const [adMetaByUrl, setAdMetaByUrl] = useState<Map<string, {
    id: string;
    model: string | null;
    prompt: string | null;
    prompt_extra: string | null;
    style: string | null;
    duration_seconds: number | null;
    aspect_ratio: string | null;
  }>>(new Map());
  // Node-graph hover popover. Anchored to the small node icon on each
  // video tile; surfaces the inputs (reference photos) + model/style +
  // prompt that produced the creative.
  const [nodeHover, setNodeHover] = useState<{
    x: number;
    y: number;
    photos: string[];
    productName: string;
    meta: { model: string | null; prompt: string | null; prompt_extra: string | null; style: string | null; duration_seconds: number | null; aspect_ratio: string | null } | null;
  } | null>(null);
  const [adImpressionsMap, setAdImpressionsMap] = useState<Map<string, number>>(new Map());
  const [adClicksMap, setAdClicksMap] = useState<Map<string, number>>(new Map());

  const filteredCreateLookProducts = useMemo(() => {
    if (!createLookProductSearch.trim()) return crawledProducts;
    const q = createLookProductSearch.toLowerCase();
    return crawledProducts.filter(p =>
      (p.name?.toLowerCase().includes(q)) ||
      (p.brand?.toLowerCase().includes(q))
    );
  }, [crawledProducts, createLookProductSearch]);

  // Generate Look commits the in-memory selection to a new `looks` row and
  // attaches each picked product via look_products. Selections accumulate in
  // createLookSelectedProducts - the "query" the admin is building - and
  // nothing hits the DB until this fires.
  const handleGenerateLook = useCallback(async () => {
    if (createLookSelectedProducts.size === 0 || creatingLook) return;
    const selectedIds = Array.from(createLookSelectedProducts);
    const firstPicked = crawledProducts.find(cp => selectedIds.includes(cp.id));
    const title = [createLookStyle, firstPicked?.name].filter(Boolean).join(' · ') || 'Untitled look';
    setCreatingLook(true);
    try {
      const { data: look } = await createLook({ title });
      for (const productId of selectedIds) {
        await addProductToLook(look.id, { product_id: productId });
      }
      setShowCreateLook(false);
      setCreateLookSelectedProducts(new Set());
      setCreateLookProductSearch('');
      setCreateLookCreator('');
      setCreateLookLocation('');
      setCreateLookStyle('Street Style');
    } catch (err) {
      console.error('[createLook] failed:', err);
      alert(`Could not create look: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setCreatingLook(false);
    }
  }, [createLookSelectedProducts, creatingLook, crawledProducts, createLookStyle]);

  const loadAdProductIds = useCallback(async () => {
    if (!supabase) return;
    // ORDER BY sort_order so the per-product video tile ordering admins
    // set via drag-and-drop survives reload. created_at is the
    // tie-breaker for rows that haven't been reordered yet.
    const { data } = await supabase
      .from('product_creative')
      .select('id, product_id, video_url, status, impressions, clicks, model, prompt, prompt_extra, style, duration_seconds, aspect_ratio, sort_order')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (data) {
      setAdProductIds(new Set(data.map(r => r.product_id)));
      const videoMap = new Map<string, string[]>();
      const impMap = new Map<string, number>();
      const clkMap = new Map<string, number>();
      const metaMap = new Map<string, {
        id: string;
        model: string | null;
        prompt: string | null;
        prompt_extra: string | null;
        style: string | null;
        duration_seconds: number | null;
        aspect_ratio: string | null;
      }>();
      data.forEach(r => {
        if (r.video_url) {
          const existing = videoMap.get(r.product_id) || [];
          existing.push(r.video_url);
          videoMap.set(r.product_id, existing);
          metaMap.set(r.video_url, {
            id: (r as { id: string }).id,
            model: (r as any).model ?? null,
            prompt: (r as any).prompt ?? null,
            prompt_extra: (r as any).prompt_extra ?? null,
            style: (r as any).style ?? null,
            duration_seconds: (r as any).duration_seconds ?? null,
            aspect_ratio: (r as any).aspect_ratio ?? null,
          });
        }
        impMap.set(r.product_id, (impMap.get(r.product_id) || 0) + (r.impressions || 0));
        clkMap.set(r.product_id, (clkMap.get(r.product_id) || 0) + (r.clicks || 0));
      });
      setAdVideoMap(videoMap);
      setAdImpressionsMap(impMap);
      setAdClicksMap(clkMap);
      setAdMetaByUrl(metaMap);
    }
  }, []);

  useEffect(() => {
    const loadCrawled = async () => {
      if (!supabase) { setProductsLoading(false); return; }
      const { data, error } = await supabase
        .from('products')
        .select('id, name, brand, price, url, image_url, images, primary_image_url, primary_image_polished, primary_image_pre_polish_url, primary_video_url, primary_video_status, primary_video_request_id, scraped_at, scrape_status, is_active, is_elite, is_platform, type, gender, created_at, source, size_fit, materials_care')
        .order('scraped_at', { ascending: false });
      if (error) {
        console.error('Failed to load crawled products:', error);
        setProductsLoading(false);
        return;
      }
      const rows = (data || []).map((p) => ({
        ...p,
        is_crawled: p.scrape_status === 'done' || p.scraped_at !== null,
      })) as CrawledProduct[];
      setCrawledProducts(rows);
      setProductsLoading(false);
    };
    loadCrawled();
    loadAdProductIds();

    // Realtime subscription on the products table so newly-scraped
    // rows (or status flips like pending → done) surface in the
    // Products tab without a manual refresh. Was the cause of
    // "Tracksmith Eliot Runner doesn't show up after Add Products"
    // — the initial load fired before the scrape finished.
    if (!supabase) return;
    const channel = supabase
      .channel('admin-data-products-stream')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'products' }, (payload) => {
        const p = payload.new as CrawledProduct;
        setCrawledProducts(prev => {
          if (prev.some(x => x.id === p.id)) return prev;
          return [{ ...p, is_crawled: p.scrape_status === 'done' || p.scraped_at !== null } as CrawledProduct, ...prev];
        });
        // Re-add resurfacing: a fresh INSERT means the admin added
        // this product again. If its brand+name is in the soft-
        // delete set, drop it — they explicitly re-added.
        if (p.brand && p.name) {
          const key = `${p.brand}-${p.name}`;
          setDeletedProductKeys(prev => {
            if (!prev.has(key)) return prev;
            const next = new Set(prev);
            next.delete(key);
            writeLocalSet(LOCAL_PRODUCTS_KEY, next);
            return next;
          });
          if (supabase) {
            void supabase.from('admin_hidden_products')
              .delete()
              .eq('brand', p.brand)
              .eq('name', p.name);
          }
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'products' }, (payload) => {
        const p = payload.new as CrawledProduct;
        setCrawledProducts(prev => {
          const idx = prev.findIndex(x => x.id === p.id);
          if (idx === -1) return prev;
          const prevRow = prev[idx];
          const merged = { ...prevRow, ...p, is_crawled: p.scrape_status === 'done' || p.scraped_at !== null } as CrawledProduct;
          // When a scrape just finished (pending → done) OR a primary
          // video just landed, surface the product at the TOP of the
          // list so the admin sees the freshly-resolved row immediately
          // (it also gets a fresh created_at from the scrape, so the
          // default Date-Added sort keeps it on top). Plain in-place
          // update for every other field change.
          const justScraped = p.scrape_status === 'done' && prevRow.scrape_status !== 'done';
          const gotPrimaryVideo = !!p.primary_video_url && !prevRow.primary_video_url;
          if (justScraped || gotPrimaryVideo) {
            const without = prev.filter(x => x.id !== p.id);
            return [merged, ...without];
          }
          const copy = prev.slice();
          copy[idx] = merged;
          return copy;
        });
      })
      .subscribe();
    return () => { void supabase!.removeChannel(channel); };
  }, [loadAdProductIds]);

  // Poll active generation jobs - refresh statuses every 3s, remove finished
  // jobs, and reload adVideoMap when any job completes so the new videos
  // appear in the Creative column.
  useEffect(() => {
    if (genJobs.size === 0 || !supabase) return;
    let cancelled = false;
    const interval = setInterval(async () => {
      const allIds = Array.from(genJobs.values()).flatMap(j => j.adIds);
      if (allIds.length === 0) return;
      const { data } = await supabase
        .from('product_creative')
        .select('id, status')
        .in('id', allIds);
      if (cancelled || !data) return;
      const statusById = new Map(data.map((r: { id: string; status: string }) => [r.id, r.status]));
      let anyFinished = false;
      setGenJobs(prev => {
        const next = new Map(prev);
        for (const [productId, job] of next.entries()) {
          let done = 0, failed = 0, generating = 0;
          for (const adId of job.adIds) {
            const s = statusById.get(adId);
            if (s === 'done' || s === 'live') done++;
            else if (s === 'failed') failed++;
            else if (s === 'generating') generating++;
          }
          next.set(productId, { ...job, done, failed, generating });
          if (done + failed >= job.total) {
            next.delete(productId);
            anyFinished = true;
          }
        }
        return next;
      });
      if (anyFinished) void loadAdProductIds();
      // Drain the queue: whenever a job finishes, promote queued rows
      // into 'pending' up to the concurrency limit.
      void promoteQueuedAds();
    }, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [genJobs, loadAdProductIds]);

  const allProducts = useMemo(() => {
    const productMap = new Map<string, { id?: string; brand: string; name: string; price: string; url: string; image_url?: string | null; images?: string[]; primary_image_url?: string | null; primary_image_polished?: boolean | null; primary_video_url?: string | null; video_urls: string[]; looks: Set<string>; creators: Set<string>; saves: number; clicks: number; impressions: number; connection: 'Look' | 'Crawl' | 'Ad'; is_active?: boolean; is_elite?: boolean; is_platform?: boolean; type?: string | null; gender?: 'male' | 'female' | 'unisex' | null; created_at?: string | null; source?: string | null; size_fit?: string | null; materials_care?: string | null }>();
    looks.forEach(look => {
      const c = creators[look.creator];
      look.products.forEach(p => {
        const key = `${p.brand}-${p.name}`;
        if (!productMap.has(key)) {
          productMap.set(key, { brand: p.brand, name: p.name, price: p.price, url: p.url, image_url: (p as any).image, video_urls: [], looks: new Set(), creators: new Set(), saves: 0, clicks: 0, impressions: 0, connection: 'Look', is_elite: false });
        }
        const entry = productMap.get(key)!;
        entry.looks.add(look.title);
        entry.creators.add(c?.displayName || look.creator);
      });
    });

    crawledProducts.forEach((cp) => {
      const brand = cp.brand || 'Unknown';
      const name = cp.name || 'Untitled';
      const key = `${brand}-${name}`;
      const images = Array.isArray(cp.images) ? cp.images.filter((u): u is string => typeof u === 'string') : [];
      const active = cp.is_active !== false; // default true for legacy rows
      const primaryUrl = (cp as { primary_image_url?: string | null }).primary_image_url ?? null;
      const polishedFlag = (cp as { primary_image_polished?: boolean | null }).primary_image_polished ?? false;
      const primaryVideoUrl = (cp as { primary_video_url?: string | null }).primary_video_url ?? null;
      if (productMap.has(key)) {
        const entry = productMap.get(key)!;
        entry.id = cp.id;
        entry.image_url = cp.image_url;
        entry.images = images;
        entry.primary_image_url = primaryUrl;
        entry.primary_image_polished = polishedFlag;
        entry.primary_video_url = primaryVideoUrl;
        entry.video_urls = adVideoMap.get(cp.id) || [];
        entry.impressions = adImpressionsMap.get(cp.id) || 0;
        entry.clicks = adClicksMap.get(cp.id) || 0;
        entry.is_active = active;
        entry.is_elite = !!cp.is_elite;
        entry.is_platform = cp.is_platform !== false; // default true on legacy rows
        entry.type = cp.type ?? null;
        entry.gender = cp.gender ?? null;
        entry.created_at = cp.created_at ?? null;
        entry.source = cp.source ?? null;
        entry.size_fit = cp.size_fit ?? null;
        entry.materials_care = cp.materials_care ?? null;
        if (adProductIds.has(cp.id)) {
          entry.connection = 'Ad';
        } else if (cp.is_crawled) {
          entry.connection = 'Crawl';
        }
      } else {
        let connection: 'Look' | 'Crawl' | 'Ad' = cp.is_crawled ? 'Crawl' : 'Look';
        if (adProductIds.has(cp.id)) connection = 'Ad';
        productMap.set(key, {
          id: cp.id,
          brand,
          name,
          price: cp.price || ' - ',
          url: cp.url || '',
          image_url: cp.image_url,
          images,
          primary_image_url: primaryUrl,
          primary_image_polished: polishedFlag,
          primary_video_url: primaryVideoUrl,
          video_urls: adVideoMap.get(cp.id) || [],
          looks: new Set(),
          creators: new Set(),
          saves: 0,
          clicks: adClicksMap.get(cp.id) || 0,
          impressions: adImpressionsMap.get(cp.id) || 0,
          connection,
          is_active: active,
          is_elite: !!cp.is_elite,
          is_platform: cp.is_platform !== false,
          type: cp.type ?? null,
          gender: cp.gender ?? null,
          created_at: cp.created_at ?? null,
          source: cp.source ?? null,
          size_fit: cp.size_fit ?? null,
          materials_care: cp.materials_care ?? null,
        });
      }
    });

    return Array.from(productMap.values()).map(p => {
      const hasCreative = p.video_urls.length > 0;
      return {
        ...p,
        hasCreative,
        lookCount: p.looks.size,
        creatorCount: p.creators.size,
      };
    });
  }, [crawledProducts, adProductIds, adVideoMap, adImpressionsMap, adClicksMap]);

  // "Active" toggle controls whether this product is actually on the feed.
  //   ON  → set products.is_active = true AND promote the newest `done` or
  //         `paused` ad for this product to `live` so it starts serving.
  //   OFF → set products.is_active = false AND pause every live ad for the
  //         product so it falls off the feed immediately.
  const toggleProductActive = useCallback(async (productId: string, active: boolean) => {
    setCrawledProducts(prev =>
      prev.map(r => (r.id === productId ? { ...r, is_active: active } : r))
    );
    if (!supabase) return;
    const { error: updateErr } = await supabase
      .from('products')
      .update({ is_active: active })
      .eq('id', productId);
    if (updateErr) {
      setCrawledProducts(prev =>
        prev.map(r => (r.id === productId ? { ...r, is_active: !active } : r))
      );
      console.error('toggleProductActive failed:', updateErr.message);
      return;
    }
    if (active) {
      // Auto-approve: find the newest ad with a finished video and flip it
      // to live. If every ad is already live or still generating, this is a
      // no-op - no harm done.
      const { data: candidate } = await supabase
        .from('product_creative')
        .select('id')
        .eq('product_id', productId)
        .in('status', ['done', 'paused'])
        .not('video_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1);
      if (candidate && candidate.length > 0) {
        await supabase
          .from('product_creative')
          .update({ status: 'live', enabled: true })
          .eq('id', (candidate[0] as { id: string }).id);
      }
    } else {
      // Pause anything currently live for this product so it falls off feed.
      await supabase
        .from('product_creative')
        .update({ status: 'paused', enabled: false })
        .eq('product_id', productId)
        .eq('status', 'live');
    }
  }, []);

  const lookTable = useSortableTable(lookRows);

  // Keep the ref in sync each render so the pending-row pruner sees
  // the latest product URL set without re-running the interval.
  allProductsRef.current = allProducts;

  const filteredProductsList = useMemo(
    () => allProducts.filter(p => {
      const key = `${p.brand}-${p.name}`;
      // Soft-delete view: ONLY products in the soft-delete set.
      // Other filters off (admins want to see every soft-deleted
      // row regardless of active/creative/tag state).
      if (productFilter === 'soft-deleted') {
        if (!deletedProductKeys.has(key)) return false;
        if (brandFilter && (p.brand || '').toLowerCase() !== brandFilter.toLowerCase()) return false;
        if (adminQuery) {
          const hay = `${p.brand} ${p.name}`.toLowerCase();
          if (!hay.includes(adminQuery)) return false;
        }
        return true;
      }
      if (productFilter === 'no-creative' && p.hasCreative) return false;
      if (productFilter === 'active' && (p as any).is_active === false) return false;
      if (productFilter === 'inactive' && (p as any).is_active !== false) return false;
      if (productFilter === 'untagged' && p.gender != null) return false;
      // Hide soft-deleted from every other view.
      if (deletedProductKeys.has(key)) return false;
      if (brandFilter && (p.brand || '').toLowerCase() !== brandFilter.toLowerCase()) return false;
      if (adminQuery) {
        const hay = `${p.brand} ${p.name}`.toLowerCase();
        if (!hay.includes(adminQuery)) return false;
      }
      return true;
    }),
    [allProducts, productFilter, deletedProductKeys, adminQuery, brandFilter]
  );
  // sharedTableId opts this table into the cross-admin sort state in
  // app_settings — when one admin clicks a column header, every other
  // admin viewing the page picks up the same sort via realtime. Local
  // useState is the source of truth; the hook reconciles in both
  // directions.
  const productTable = useSortableTable(filteredProductsList, {
    defaultSort: { key: 'created_at', direction: 'desc' },
    sharedTableId: 'admin_products',
  });

  // ── Windowed pagination ──────────────────────────────────────────────
  // The table is the most expensive surface in the admin: ~17 cells per
  // row, mostly with inline closures + image tags. Rendering the full
  // 800-row dataset puts ~13K cells in the DOM and grinds every
  // interaction (selection, filter, scroll) under heavy layout work.
  //
  // Render only the first PAGE_SIZE rows, then grow visibleCount when
  // an IntersectionObserver sentinel near the bottom of the rendered
  // window enters viewport. Net effect: first paint is ~80 rows
  // (~1.3K cells), then the user gets near-bottom and another batch
  // appears below the fold before they've scrolled to it.
  const PAGE_SIZE = 80;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLTableRowElement>(null);
  const visibleRows = useMemo(
    () => productTable.sortedData.slice(0, visibleCount),
    [productTable.sortedData, visibleCount],
  );
  const hasMore = visibleCount < productTable.sortedData.length;

  // Reset the window whenever the filter / sort / search changes - the
  // user wants to see "the start" of the new view, not whatever scroll
  // position they were at. productTable.sort can be null (the third
  // click on a column header cycles back to "no sort"), so guard the
  // dep with optional chaining + a stable fallback string.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [productFilter, productTable.sort?.key ?? null, productTable.sort?.direction ?? null, adminQuery]);

  // IntersectionObserver to grow the window when the sentinel enters
  // viewport. rootMargin keeps things smooth - we expand before the
  // user actually reaches the bottom so the next batch is already
  // rendered by the time it scrolls into view.
  useEffect(() => {
    if (!hasMore) return;
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          setVisibleCount(c => Math.min(c + PAGE_SIZE, productTable.sortedData.length));
        }
      },
      { rootMargin: '600px 0px' },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [hasMore, productTable.sortedData.length, visibleCount]);

  const toggleExpand = (id: number) => {
    setExpandedId(prev => prev === id ? null : id);
  };

  const navigate = useNavigate();

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }, []);

  // Real implementation behind runPickPrimaryImages — stashed in a ref
  // above so the trigger is callable from the toolbar before showToast
  // is declared. See the note at the runPickPrimaryImagesRef
  // declaration for the TDZ workaround motivation.
  runPickPrimaryImagesRef.current = async () => {
    if (!supabase) return;
    const { data: candidates } = await supabase
      .from('products')
      .select('id, name, brand, image_url, images')
      .is('primary_image_picked_at', null)
      .limit(200);
    if (!candidates || candidates.length === 0) {
      showToast('Every product already has a primary image picked.');
      return;
    }
    type Row = { id: string; name: string | null; brand: string | null; image_url: string | null; images: string[] | null };
    setPickingPrimary(true);
    setPrimaryProgress({ done: 0, total: candidates.length, failed: 0 });
    let done = 0;
    let failed = 0;
    for (const row of candidates as Row[]) {
      const urls: string[] = [];
      if (Array.isArray(row.images)) {
        for (const u of row.images) if (typeof u === 'string' && u) urls.push(u);
      }
      if (row.image_url && !urls.includes(row.image_url)) urls.push(row.image_url);
      if (urls.length === 0) { done += 1; failed += 1; setPrimaryProgress({ done, total: candidates.length, failed }); continue; }
      try {
        const { data, error } = await supabase.functions.invoke('pick-primary-image', {
          body: { product_id: row.id, name: row.name || '', brand: row.brand || '', image_urls: urls },
        });
        if (error || !data?.success) failed += 1;
      } catch {
        failed += 1;
      }
      done += 1;
      setPrimaryProgress({ done, total: candidates.length, failed });
    }
    setPickingPrimary(false);
    setPrimaryProgress(null);
    if (failed > 0) showToast(`Primary images picked for ${done - failed}/${done} — ${failed} failed`);
    else            showToast(`Primary images picked for ${done} product${done === 1 ? '' : 's'}`);
  };

  // In-flight polish-primary-image calls, keyed by product id. Drives
  // the spinner overlay on the polish-wand affordance.
  const [polishingIds, setPolishingIds] = useState<Set<string>>(new Set());
  // In-flight generate-primary-video calls, keyed by product id. Drives
  // the spinner overlay on the Generate CTA in the detail row.
  const [generatingPrimaryVideoIds, setGeneratingPrimaryVideoIds] = useState<Set<string>>(new Set());
  // Start timestamps (ms-since-epoch) for each in-flight generation —
  // drives the progress bar's elapsed time. Cleared on completion.
  const [primaryVideoStartedAt, setPrimaryVideoStartedAt] = useState<Map<string, number>>(new Map());
  // Re-renders 250ms while any generation is in flight so the progress
  // bar fills smoothly without each row owning its own interval.
  const [primaryVideoTick, setPrimaryVideoTick] = useState(0);
  // Learned ETA: rolling average of past primary_video_duration_ms.
  // Fetched once on mount via the avg_primary_video_duration_ms RPC;
  // falls back to 30s before any data has accumulated.
  const [avgPrimaryVideoDurationMs, setAvgPrimaryVideoDurationMs] = useState<number>(30_000);
  // Product whose primary-VIDEO node-graph modal is currently open.
  const [primaryVideoGraphProductId, setPrimaryVideoGraphProductId] = useState<string | null>(null);
  // Product whose primary-IMAGE polish node-graph modal is currently open.
  const [primaryImageGraphProductId, setPrimaryImageGraphProductId] = useState<string | null>(null);
  // Product whose primary-video modal popup is currently open (click-to-zoom).
  const [primaryVideoModalProductId, setPrimaryVideoModalProductId] = useState<string | null>(null);

  const polishPrimaryImage = useCallback(async (productId: string) => {
    if (!supabase) return;
    if (!productId) return;
    setPolishingIds(prev => {
      const next = new Set(prev);
      next.add(productId);
      return next;
    });
    // Publish to the global Generation Queue so the floating panel
    // shows the progress bar regardless of which page is on screen.
    const product = crawledProducts.find(pp => pp.id === productId);
    const label = product?.name ? `Polish · ${product.name.slice(0, 40)}` : 'Polish primary image';
    const ctxStr = [product?.brand, product?.type].filter(Boolean).join(' · ') || undefined;
    const queueJob = startGenerationJob({
      kind: 'polish',
      label,
      context: ctxStr,
      model: 'gemini-2.5-flash-image',
      thumbnailUrl: product?.primary_image_url || product?.image_url || null,
    });
    try {
      const { data, error } = await supabase.functions.invoke('polish-primary-image', {
        body: { product_id: productId },
      });
      if (error || !data?.success) {
        const msg = data?.error || error?.message || 'unknown';
        queueJob.fail(msg);
        showToast(`Polish failed: ${msg}`);
        return;
      }
      // Reflect the new primary URL + polished flag locally so the UI
      // updates without a full refetch.
      const polishedUrl = data.polished_url as string | undefined;
      if (polishedUrl) {
        setCrawledProducts(prev => prev.map(pp =>
          pp.id === productId
            ? ({
                ...pp,
                primary_image_url: polishedUrl,
                primary_image_polished: true,
              } as CrawledProduct)
            : pp,
        ));
      }
      queueJob.finish((data as { duration_ms?: number })?.duration_ms, 'Polished');
      showToast('Primary image polished');
    } catch (err) {
      const msg = (err as Error).message || 'unknown';
      queueJob.fail(msg);
      showToast(`Polish failed: ${msg}`);
    } finally {
      setPolishingIds(prev => {
        const next = new Set(prev);
        next.delete(productId);
        return next;
      });
    }
  }, [showToast, crawledProducts]);

  const generatePrimaryVideo = useCallback(async (productId: string) => {
    if (!supabase) return;
    if (!productId) return;
    setGeneratingPrimaryVideoIds(prev => {
      const next = new Set(prev);
      next.add(productId);
      return next;
    });
    setPrimaryVideoStartedAt(prev => {
      const next = new Map(prev);
      next.set(productId, Date.now());
      return next;
    });
    const product = crawledProducts.find(pp => pp.id === productId);
    const label = product?.name ? `Primary video · ${product.name.slice(0, 40)}` : 'Generate primary video';
    const ctxStr = [product?.brand, product?.type].filter(Boolean).join(' · ') || undefined;
    const queueJob = startGenerationJob({
      kind: 'primary-video',
      label,
      context: ctxStr,
      model: 'seedance-2.0',
      thumbnailUrl: product?.primary_image_url || product?.image_url || null,
    });
    try {
      const { data, error } = await supabase.functions.invoke('generate-primary-video', {
        body: { product_id: productId },
      });
      if (error || !data?.success) {
        const msg = data?.error || error?.message || 'unknown';
        queueJob.fail(msg);
        showToast(`Primary video generation failed: ${msg}`);
        return;
      }
      // Async pipeline. The edge fn returns in <2s with status='pending'
      // and a request_id. The clip renders on fal's queue (60–120s) and
      // the fal-webhook writes primary_video_url back when it lands.
      // DO NOT finish() the queue job yet — keep it visible with its
      // rolling-avg ETA so the admin sees real progress. A background
      // poll (see pendingVideoJobsRef + useEffect below) watches the
      // products row and finishes the job only when status flips.
      const requestId = (data as { request_id?: string })?.request_id;
      setCrawledProducts(prev => prev.map(pp =>
        pp.id === productId
          ? ({
              ...pp,
              primary_video_status: 'pending',
              primary_video_request_id: requestId ?? null,
            } as CrawledProduct)
          : pp,
      ));
      pendingVideoJobsRef.current.set(productId, { job: queueJob, startedAt: Date.now() });
      // Wake the poll so it picks this product up on the next tick.
      setPendingVideoTick(t => t + 1);
    } catch (err) {
      const msg = (err as Error).message || 'unknown';
      queueJob.fail(msg);
      showToast(`Primary video generation failed: ${msg}`);
    } finally {
      setGeneratingPrimaryVideoIds(prev => {
        const next = new Set(prev);
        next.delete(productId);
        return next;
      });
      setPrimaryVideoStartedAt(prev => {
        const next = new Map(prev);
        next.delete(productId);
        return next;
      });
    }
  }, [showToast, crawledProducts]);

  // Fetch the rolling-average ETA once. Empty pool → keep the 30s
  // default; a single past run is already meaningful so n=1 is fine.
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.rpc('avg_primary_video_duration_ms');
      if (cancelled) return;
      const row = Array.isArray(data) ? data[0] : data;
      const avgMs = Number(row?.avg_ms ?? 0);
      if (avgMs > 0) setAvgPrimaryVideoDurationMs(Math.round(avgMs));
    })();
    return () => { cancelled = true; };
  }, []);

  // Tick the progress bar at 250ms while any generation is running.
  // Single setInterval at the parent — cells read elapsed time off
  // primaryVideoStartedAt + Date.now() on every render.
  useEffect(() => {
    if (generatingPrimaryVideoIds.size === 0) return;
    const handle = window.setInterval(() => setPrimaryVideoTick(t => t + 1), 250);
    return () => window.clearInterval(handle);
  }, [generatingPrimaryVideoIds]);
  // Reference the tick so the hook isn't flagged unused — its job is
  // purely to trigger re-renders, the value itself is meaningless.
  void primaryVideoTick;

  // ── Pending primary-video poll ──────────────────────────────────────
  // While any submitted-but-not-yet-completed primary-video job is in
  // flight, poll the products table every 4s for status flips. When a
  // row's primary_video_status flips to 'done' or 'failed', complete
  // the matching queue job and update the local row. Stops itself
  // when there's nothing pending.
  useEffect(() => {
    if (!supabase) return;
    if (pendingVideoJobsRef.current.size === 0) return;
    let cancelled = false;
    const sb = supabase;
    const tick = async () => {
      if (cancelled) return;
      const ids = Array.from(pendingVideoJobsRef.current.keys());
      if (ids.length === 0) return;
      const { data } = await sb
        .from('products')
        .select('id, primary_video_status, primary_video_url')
        .in('id', ids);
      if (cancelled) return;
      for (const row of (data || []) as Array<{ id: string; primary_video_status: string | null; primary_video_url: string | null }>) {
        const entry = pendingVideoJobsRef.current.get(row.id);
        if (!entry) continue;
        if (row.primary_video_status === 'done') {
          const observed = Date.now() - entry.startedAt;
          entry.job.finish(observed, 'Generated');
          pendingVideoJobsRef.current.delete(row.id);
          setCrawledProducts(prev => prev.map(pp =>
            pp.id === row.id
              ? ({ ...pp, primary_video_url: row.primary_video_url, primary_video_status: 'done' } as CrawledProduct)
              : pp,
          ));
        } else if (row.primary_video_status === 'failed') {
          entry.job.fail('Generation failed');
          pendingVideoJobsRef.current.delete(row.id);
          setCrawledProducts(prev => prev.map(pp =>
            pp.id === row.id
              ? ({ ...pp, primary_video_status: 'failed' } as CrawledProduct)
              : pp,
          ));
        }
      }
      // If anything is still pending, queue the next tick. Otherwise
      // the effect's dep on pendingVideoTick won't re-run, and that's
      // fine — a future new submit bumps the tick and re-arms us.
    };
    void tick();
    const interval = window.setInterval(tick, 4000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [pendingVideoTick]);

  // Delete a single creative (one product_creative row) by id. Used by
  // the X overlay on each video tile in the Products-row expanded view.
  // Optimistic local update so the tile vanishes immediately; on failure
  // we reload the ad map so the UI catches up with reality.
  const deleteCreative = useCallback(async (creativeId: string, videoUrl: string, productId: string | undefined) => {
    if (!supabase) return;
    if (!confirm('Delete this creative? This removes the video from the product everywhere.')) return;
    // Optimistic: drop the URL from adVideoMap + adMetaByUrl so the
    // tile disappears the moment the user confirms. We also nuke the
    // product_creative row server-side; a successful round-trip keeps
    // local state in sync, a failure triggers a reload to roll back.
    setAdVideoMap(prev => {
      if (!productId) return prev;
      const next = new Map(prev);
      const list = (next.get(productId) || []).filter(u => u !== videoUrl);
      if (list.length === 0) next.delete(productId);
      else next.set(productId, list);
      return next;
    });
    setAdMetaByUrl(prev => {
      const next = new Map(prev);
      next.delete(videoUrl);
      return next;
    });
    const { error } = await supabase.from('product_creative').delete().eq('id', creativeId);
    if (error) {
      showToast(`Delete failed: ${error.message}`);
      // Reload so the UI matches reality after a failed delete.
      void loadAdProductIds();
      return;
    }
    showToast('Creative deleted');
  }, [showToast, loadAdProductIds]);

  // Drag-and-drop reorder of the per-product creative tiles. Updates the
  // local adVideoMap optimistically so the UI is instant, then persists
  // the new sort_order on each row in parallel. On error reloads the map
  // so the UI catches up with reality.
  // Drag-and-drop / click upload of product photos into the
  // scraped-products bucket. Appends public URLs to products.images
  // (seeds image_url when empty) and optimistically reconciles local
  // state. Only image/* files are accepted.
  const [uploadingPhotosFor, setUploadingPhotosFor] = useState<string | null>(null);
  const uploadProductPhotos = useCallback(async (productId: string, files: File[]) => {
    if (!supabase || files.length === 0) return;
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) { showToast('Only image files are supported'); return; }
    setUploadingPhotosFor(productId);
    const uploadedUrls: string[] = [];
    try {
      for (const file of imageFiles) {
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
        const path = `uploads/${productId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('scraped-products')
          .upload(path, file, { contentType: file.type, upsert: true });
        if (upErr) { showToast(`Upload failed: ${upErr.message}`); continue; }
        const { data: pub } = supabase.storage.from('scraped-products').getPublicUrl(path);
        if (pub?.publicUrl) uploadedUrls.push(pub.publicUrl);
      }
      if (uploadedUrls.length === 0) return;
      const current = crawledProducts.find(p => p.id === productId);
      const existing = (current?.images && current.images.length > 0)
        ? current.images
        : (current?.image_url ? [current.image_url] : []);
      const nextImages = [...existing, ...uploadedUrls];
      const patch: Record<string, unknown> = { images: nextImages };
      if (!current?.image_url) patch.image_url = uploadedUrls[0];
      const { error: updErr } = await supabase.from('products').update(patch).eq('id', productId);
      if (updErr) { showToast(`Saved files but DB update failed: ${updErr.message}`); return; }
      setCrawledProducts(prev => prev.map(p => p.id === productId
        ? { ...p, images: nextImages, image_url: p.image_url || uploadedUrls[0] } as CrawledProduct
        : p));
      showToast(`Added ${uploadedUrls.length} photo${uploadedUrls.length === 1 ? '' : 's'}`);
    } finally {
      setUploadingPhotosFor(null);
    }
  }, [crawledProducts, showToast]);

  const reorderCreatives = useCallback(async (productId: string, fromIndex: number, toIndex: number) => {
    if (!supabase) return;
    if (fromIndex === toIndex) return;
    const current = adVideoMap.get(productId) || [];
    if (fromIndex < 0 || fromIndex >= current.length) return;
    if (toIndex < 0 || toIndex > current.length) return;
    const next = [...current];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex > fromIndex ? toIndex - 1 : toIndex, 0, moved);
    setAdVideoMap(prev => {
      const m = new Map(prev);
      m.set(productId, next);
      return m;
    });
    // Persist: each row's sort_order = its new array index.
    const updates = next
      .map((url, i) => {
        const meta = adMetaByUrl.get(url);
        return meta ? supabase.from('product_creative').update({ sort_order: i }).eq('id', meta.id) : null;
      })
      .filter((p): p is NonNullable<typeof p> => !!p);
    const results = await Promise.all(updates);
    const errored = results.find(r => r.error);
    if (errored?.error) {
      showToast(`Reorder failed: ${errored.error.message}`);
      void loadAdProductIds();
    }
  }, [adVideoMap, adMetaByUrl, showToast, loadAdProductIds]);

  // Platform visibility toggle. Sister to toggleProductActive (which
  // governs the home grid). When false, the product is excluded from
  // search results + catalog-wide listings but stays in the admin
  // table so an admin can flip it back on.
  const toggleProductPlatform = useCallback(async (productId: string, on: boolean) => {
    setCrawledProducts(prev =>
      prev.map(r => (r.id === productId ? { ...r, is_platform: on } : r))
    );
    if (!supabase) return;
    const { error } = await supabase
      .from('products')
      .update({ is_platform: on })
      .eq('id', productId);
    if (error) {
      setCrawledProducts(prev =>
        prev.map(r => (r.id === productId ? { ...r, is_platform: !on } : r))
      );
      showToast(`Platform toggle failed: ${error.message}`);
    }
  }, [showToast]);

  // Bulk-flip the Home toggle (products.is_active) on every selected
  // product. Lives below showToast because it captures it for error
  // toasts; declaring it earlier would TDZ in the bundled output.
  const bulkSetActive = useCallback(async (active: boolean) => {
    const ids: string[] = [];
    for (const key of selectedProductKeys) {
      const match = allProducts.find(ap => `${ap.brand}-${ap.name}` === key);
      if (match?.id) ids.push(match.id);
    }
    if (ids.length === 0) return;
    // Optimistic UI flip - rolled back below on any chunk failure.
    setCrawledProducts(prev =>
      prev.map(r => (ids.includes(r.id) ? { ...r, is_active: active } : r))
    );
    if (!supabase) return;

    // Chunk the writes. PostgREST passes .in('id', ids) as a query
    // string, and ~800 UUIDs blow past the proxy's URL length limit
    // (~30 KB). Without this loop the request silently fails and a
    // refresh wipes the optimistic UI change. 100 ids per batch keeps
    // the URL well under the limit while staying fast.
    const CHUNK = 100;
    let firstError: string | null = null;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const { error } = await supabase
        .from('products')
        .update({ is_active: active })
        .in('id', slice);
      if (error && !firstError) firstError = error.message;
    }
    if (firstError) {
      // Roll back the optimistic update so the UI matches the DB.
      setCrawledProducts(prev =>
        prev.map(r => (ids.includes(r.id) ? { ...r, is_active: !active } : r))
      );
      showToast(`Home toggle failed: ${firstError}`);
      return;
    }

    if (active) {
      // Promote newest finished creative per product, in parallel.
      await Promise.all(ids.map(async (pid) => {
        const { data: candidate } = await supabase!
          .from('product_creative')
          .select('id')
          .eq('product_id', pid)
          .in('status', ['done', 'paused'])
          .not('video_url', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1);
        if (candidate && candidate.length > 0) {
          await supabase!
            .from('product_creative')
            .update({ status: 'live', enabled: true })
            .eq('id', (candidate[0] as { id: string }).id);
        }
      }));
    } else {
      // Cascade pause - same chunking story.
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        await supabase
          .from('product_creative')
          .update({ status: 'paused', enabled: false })
          .in('product_id', slice)
          .eq('status', 'live');
      }
    }
  }, [selectedProductKeys, allProducts, showToast]);

  // Batch-set the gender column on every selected product. Mirrors
  // bulkSetActive's pattern: optimistic local update, then a single
  // .in('id', ids) UPDATE so the round-trip cost is one request
  // regardless of selection size. Lives below showToast because it
  // captures it for error toasts - declaring it earlier would hit
  // a TDZ in the bundled output.
  const bulkSetGender = useCallback(async (gender: 'male' | 'female' | 'unisex') => {
    const ids: string[] = [];
    for (const key of selectedProductKeys) {
      const match = allProducts.find(ap => `${ap.brand}-${ap.name}` === key);
      if (match?.id) ids.push(match.id);
    }
    if (ids.length === 0) return 0;
    setCrawledProducts(prev =>
      prev.map(r => (ids.includes(r.id) ? { ...r, gender } : r))
    );
    if (!supabase) return ids.length;
    // Chunk the writes - same URL-length story as bulkSetActive. A
    // single .in('id', 800ish-uuids) blows past the proxy's URL cap.
    const CHUNK = 100;
    let firstError: string | null = null;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const { error } = await supabase
        .from('products')
        .update({ gender })
        .in('id', slice);
      if (error && !firstError) firstError = error.message;
    }
    if (firstError) {
      // Roll back the optimistic gender flip so the table matches the DB.
      setCrawledProducts(prev =>
        prev.map(r => {
          if (!ids.includes(r.id)) return r;
          const original = allProducts.find(ap => ap.id === r.id);
          return { ...r, gender: original?.gender ?? null };
        })
      );
      showToast(`Gender update failed: ${firstError}`);
      return 0;
    }
    return ids.length;
  }, [selectedProductKeys, allProducts, showToast]);

  const handleGenerateCreative = useCallback(async (productId: string, productName: string, style: string, model: string | string[]) => {
    if (genJobs.has(productId)) return;
    setGeneratingIds(prev => new Set(prev).add(productId));
    showToast(`Agent started generating creative for "${productName}"`);
    const { data, error } = await createBatchAds([productId], style, 2, model);
    setGeneratingIds(prev => {
      const next = new Set(prev);
      next.delete(productId);
      return next;
    });
    if (error || !data || data.length === 0) {
      showToast(`Agent failed: ${error || 'no ads returned'}`);
      return;
    }
    const adIds = data.map(d => d.id);
    setGenJobs(prev => {
      const next = new Map(prev);
      next.set(productId, { adIds, total: adIds.length, done: 0, failed: 0, generating: 0, startedAt: Date.now() });
      return next;
    });
  }, [genJobs, showToast]);

  return (
    <div className="admin-page">
      {hoverPreview && (
        <div
          style={{
            position: 'fixed',
            left: hoverPreview.x,
            top: hoverPreview.y,
            // True 3:4 portrait — matches the polished primary image's
            // aspect ratio so the floating preview shows the product at
            // the same shape as the generated video, no stretching.
            width: 300,
            height: 400,
            borderRadius: 8,
            overflow: 'hidden',
            background: '#fff',
            boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
            zIndex: 9999,
            pointerEvents: 'none',
            border: '1px solid rgba(0,0,0,0.08)',
          }}
        >
          {/* Product photo preview - hovering a generated-creative tile
              flashes the source product image so admins can compare the
              AI rendition against the canonical product shot at a glance. */}
          <img
            src={hoverPreview.url}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#fff' }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        </div>
      )}
      {nodeHover && (
        // Node-graph popover: surfaces the inputs (reference photos) →
        // model + style + prompt that produced the hovered creative,
        // so admins can audit what went into a given clip without
        // opening the row's edit modal.
        <div
          style={{
            position: 'fixed',
            // Anchor below the icon when going horizontal so the wide
            // popover doesn't get pushed off the right edge of the page.
            // Clamp to the viewport so the right edge always fits.
            left: Math.max(8, Math.min(nodeHover.x - 60, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 660)),
            top: nodeHover.y,
            width: 640,
            maxHeight: '80vh',
            overflow: 'hidden',
            borderRadius: 10,
            background: '#0f172a',
            color: '#e2e8f0',
            boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
            zIndex: 9999,
            pointerEvents: 'none',
            border: '1px solid rgba(255,255,255,0.08)',
            padding: 12,
            fontSize: 12,
            lineHeight: 1.45,
          }}
        >
          <div style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 10 }}>
            Generation graph
          </div>

          {/* Three nodes side-by-side with arrow connectors. Each node
              is a flex column so its body sits beneath the numbered
              header. The Prompt column flexes to consume any extra
              width and scrolls vertically when the prompt is long. */}
          <div style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}>
            {/* Node 1: Inputs (reference photos) */}
            <div style={{ flex: '0 0 180px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 16, height: 16, borderRadius: '50%', background: '#059669', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flex: '0 0 16px' }}>1</span>
                <span style={{ fontWeight: 600 }}>Photos ({nodeHover.photos.length})</span>
              </div>
              {nodeHover.photos.length === 0 ? (
                <div style={{ color: '#64748b', fontStyle: 'italic' }}>none recorded</div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {nodeHover.photos.slice(0, 8).map((src, i) => (
                    <img
                      key={i}
                      src={src}
                      alt=""
                      style={{ width: 38, height: 38, borderRadius: 4, objectFit: 'cover', border: '1px solid rgba(255,255,255,0.08)', background: '#fff' }}
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
                    />
                  ))}
                  {nodeHover.photos.length > 8 && (
                    <span style={{ fontSize: 10, color: '#64748b', alignSelf: 'center' }}>+{nodeHover.photos.length - 8}</span>
                  )}
                </div>
              )}
            </div>

            {/* Connector → */}
            <div style={{ flex: '0 0 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.25)' }}>
              <svg width="16" height="10" viewBox="0 0 16 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="0" y1="5" x2="14" y2="5" />
                <polyline points="10 1 14 5 10 9" />
              </svg>
            </div>

            {/* Node 2: Model + style + duration */}
            <div style={{ flex: '0 0 160px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 16, height: 16, borderRadius: '50%', background: '#7c3aed', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flex: '0 0 16px' }}>2</span>
                <span style={{ fontWeight: 600 }}>Model</span>
              </div>
              <div style={{ color: '#cbd5e1' }}>
                {nodeHover.meta?.model
                  ? (VIDEO_MODELS.find(m => m.value === nodeHover.meta?.model)?.label ?? nodeHover.meta.model)
                  : <span style={{ fontStyle: 'italic', color: '#64748b' }}>unknown</span>}
                {(nodeHover.meta?.style || nodeHover.meta?.duration_seconds || nodeHover.meta?.aspect_ratio) && (
                  <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4 }}>
                    {[
                      nodeHover.meta.style && `style: ${nodeHover.meta.style}`,
                      nodeHover.meta.duration_seconds && `${nodeHover.meta.duration_seconds}s`,
                      nodeHover.meta.aspect_ratio && nodeHover.meta.aspect_ratio,
                    ].filter(Boolean).join(' • ')}
                  </div>
                )}
              </div>
            </div>

            {/* Connector → */}
            <div style={{ flex: '0 0 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.25)' }}>
              <svg width="16" height="10" viewBox="0 0 16 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="0" y1="5" x2="14" y2="5" />
                <polyline points="10 1 14 5 10 9" />
              </svg>
            </div>

            {/* Node 3: Prompt - flex grow + scroll for long text */}
            <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 16, height: 16, borderRadius: '50%', background: '#0ea5e9', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flex: '0 0 16px' }}>3</span>
                <span style={{ fontWeight: 600 }}>Prompt</span>
              </div>
              <div style={{ flex: '1 1 auto', maxHeight: '60vh', overflowY: 'auto', color: '#cbd5e1', whiteSpace: 'pre-wrap', wordBreak: 'break-word', paddingRight: 4 }}>
                {nodeHover.meta?.prompt || <span style={{ fontStyle: 'italic', color: '#64748b' }}>(no prompt recorded)</span>}
                {nodeHover.meta?.prompt_extra && (
                  <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px dashed rgba(255,255,255,0.08)', color: '#94a3b8', fontSize: 11 }}>
                    <span style={{ fontWeight: 600, color: '#cbd5e1' }}>Extra: </span>
                    {nodeHover.meta.prompt_extra}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="admin-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Data</h1>
          <p className="admin-page-subtitle">Manage all platform data</p>
        </div>
        {activeTab === 'looks' && (
          <button className="admin-btn admin-btn-primary" onClick={openCreateLookModal}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Create Look
          </button>
        )}
        {activeTab === 'products' && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="admin-btn admin-btn-secondary"
              onClick={runPickPrimaryImages}
              disabled={pickingPrimary}
              title="Claude vision picks the cleanest solo-product image for every product without one (no human, no other products)."
            >
              {pickingPrimary && primaryProgress ? (
                <>Picking {primaryProgress.done}/{primaryProgress.total}…</>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21 15 16 10 5 21"/>
                  </svg>
                  Pick primary images
                </>
              )}
            </button>
            <button
              className="admin-btn admin-btn-secondary"
              onClick={runCopywriter}
              disabled={copywriting}
              title="Claude rewrites product names and adds a hook - only runs on products without display_name"
            >
              {copywriting && copywriteProgress ? (
                <>Rewriting {copywriteProgress.done}/{copywriteProgress.total}…</>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
                    <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                  Rewrite with Claude
                </>
              )}
            </button>
            <button
              className="admin-btn admin-btn-secondary"
              onClick={refreshStaleProducts}
              disabled={refreshing}
              title="Re-check prices and availability for products not refreshed in 7+ days"
            >
              {refreshing && refreshProgress ? (
                <>Refreshing {refreshProgress.done}/{refreshProgress.total}…</>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
                    <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                  </svg>
                  Refresh stale
                </>
              )}
            </button>
            <button
              className="admin-btn admin-btn-secondary"
              onClick={async () => {
                if (auditingTypes) return;
                setAuditingTypes(true);
                const result = await auditAllProductTypes();
                setAuditingTypes(false);
                showToast(
                  `Audited ${result.scanned} products - updated ${result.updated}, skipped ${result.skipped}${result.errors ? `, ${result.errors} errors` : ''}.`,
                );
                if (result.updated > 0) {
                  // Refetch so the Type column reflects the new values
                  // without a manual page reload.
                  const { data } = await supabase!
                    .from('products')
                    .select('id, name, brand, price, url, image_url, images, primary_image_url, primary_image_polished, primary_image_pre_polish_url, primary_video_url, primary_video_status, primary_video_request_id, scraped_at, scrape_status, is_active, is_elite, is_platform, type, gender, created_at, source, size_fit, materials_care')
                    .order('created_at', { ascending: false });
                  if (data) {
                    setCrawledProducts(data.map((p) => ({
                      ...p,
                      is_crawled: p.scrape_status === 'done' || p.scraped_at !== null,
                    })) as CrawledProduct[]);
                  }
                }
              }}
              disabled={auditingTypes}
              title="Walk every product and infer a type from its name where missing"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
                <path d="M9 11l3 3 8-8" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
              {auditingTypes ? 'Auditing…' : 'Type audit'}
            </button>
            <button
              className="admin-btn admin-btn-secondary"
              onClick={async () => {
                if (auditingGenders) return;
                setAuditingGenders(true);
                const result = await auditAllProductGenders();
                setAuditingGenders(false);
                showToast(
                  `Gender audit - scanned ${result.scanned}, updated ${result.updated}, skipped ${result.skipped}${result.errors ? `, ${result.errors} errors` : ''}.`,
                );
                if (result.updated > 0) {
                  const { data } = await supabase!
                    .from('products')
                    .select('id, name, brand, price, url, image_url, images, primary_image_url, primary_image_polished, primary_image_pre_polish_url, primary_video_url, primary_video_status, primary_video_request_id, scraped_at, scrape_status, is_active, is_elite, is_platform, type, gender, created_at, source, size_fit, materials_care')
                    .order('created_at', { ascending: false });
                  if (data) {
                    setCrawledProducts(data.map((p) => ({
                      ...p,
                      is_crawled: p.scrape_status === 'done' || p.scraped_at !== null,
                    })) as CrawledProduct[]);
                  }
                }
              }}
              disabled={auditingGenders}
              title="Walk every product and infer gender from its name (women's, men's, unisex)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
                <path d="M9 11l3 3 8-8" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
              {auditingGenders ? 'Auditing…' : 'Gender audit'}
            </button>
            {/* Ingest measurements & fabrics — marks every visible product
                (the currently-filtered list) as scrape_status=pending so
                the Modal scraper agent re-extracts size_fit / materials_care
                on its next cron pass. "Everything on here" is interpreted
                as the filtered set the admin is looking at, not the
                whole catalog. */}
            <button
              className="admin-btn admin-btn-secondary"
              disabled={ingestingSpecs}
              title="Queue every visible product for spec re-scrape (size_fit + materials_care)"
              onClick={async () => {
                if (ingestingSpecs) return;
                const ids = filteredProductsList
                  .map(p => p.id)
                  .filter((id): id is string => typeof id === 'string' && id.length > 0);
                if (ids.length === 0) {
                  showToast('No syncable products in view — only crawled rows can be re-queued.');
                  return;
                }
                setIngestingSpecs(true);
                try {
                  if (!supabase) throw new Error('Supabase not configured');
                  // Update + select so we know exactly how many rows
                  // RLS let through. A zero-row response means an admin
                  // gate failed silently (the previous version threw a
                  // bare PostgrestError that lost its message when the
                  // catch tried err instanceof Error).
                  const { data: updated, error } = await supabase
                    .from('products')
                    .update({ scrape_status: 'pending' })
                    .in('id', ids)
                    .select('id');
                  if (error) {
                    // PostgrestError is a plain object — pull the
                    // human-readable bits out so the toast is actionable
                    // ("permission denied for table products" etc.)
                    // instead of "Unknown error".
                    const parts = [error.message, error.details, error.hint, error.code]
                      .filter((p): p is string => typeof p === 'string' && p.length > 0);
                    throw new Error(parts.join(' · ') || 'Postgrest error');
                  }
                  const updatedIds = new Set((updated ?? []).map(r => r.id as string));
                  if (updatedIds.size === 0) {
                    throw new Error(
                      'Update returned 0 rows — RLS likely blocked the write. Sign in as an admin user.',
                    );
                  }
                  setCrawledProducts(prev =>
                    prev.map(r => updatedIds.has(r.id) ? { ...r, scrape_status: 'pending' } : r)
                  );
                  // Fire-and-forget kick to Modal so the first batch
                  // starts now instead of waiting for the daily cron.
                  // Modal's per-call batch cap (10) still applies; the
                  // remaining queue clears on subsequent cron runs.
                  void triggerScrapeFlush();
                  showToast(
                    `Queued ${updatedIds.size} product${updatedIds.size === 1 ? '' : 's'} for spec re-scrape. Modal is processing the first batch now.`,
                  );
                } catch (err) {
                  // Cover both Error instances and bare strings / PostgrestError
                  // objects that escaped the try block, so the toast is never
                  // "Unknown error" — that swallowed too many real diagnostics.
                  const msg = err instanceof Error
                    ? err.message
                    : (typeof err === 'string'
                        ? err
                        : (err && typeof err === 'object' && 'message' in err
                            ? String((err as { message?: unknown }).message ?? 'Unknown error')
                            : 'Unknown error'));
                  showToast(`Ingest failed: ${msg}`);
                } finally {
                  setIngestingSpecs(false);
                }
              }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="2" y="9" width="20" height="6" rx="1"/>
                <line x1="6" y1="9" x2="6" y2="12"/>
                <line x1="10" y1="9" x2="10" y2="13"/>
                <line x1="14" y1="9" x2="14" y2="12"/>
                <line x1="18" y1="9" x2="18" y2="13"/>
              </svg>
              {ingestingSpecs ? 'Queuing…' : 'Ingest measurements & fabrics'}
            </button>
            {/* Global settings — editable AI prompts (Polish Primary,
                Primary Video). Persists to app_settings; edge functions
                read it on their next run. */}
            <button
              className="admin-btn admin-btn-secondary"
              onClick={() => setShowPromptSettings(true)}
              title="Settings — edit the AI prompts used for Polish Primary and Primary Video"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              Settings
            </button>
            <div ref={addMenuRef} style={{ position: 'relative' }}>
              <button
                className="admin-btn admin-btn-primary"
                onClick={() => setAddMenuOpen(o => !o)}
                aria-haspopup="menu"
                aria-expanded={addMenuOpen}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add Products
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 6 }}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {addMenuOpen && (
                <div
                  role="menu"
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    right: 0,
                    minWidth: 240,
                    background: '#fff',
                    border: '1px solid #e5e7eb',
                    borderRadius: 10,
                    boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
                    padding: 4,
                    zIndex: 50,
                  }}
                >
                  {[
                    { label: 'Add via Google Shopping', onClick: () => { setAddMenuOpen(false); setShowAddProducts(true); } },
                    { label: 'Add via Amazon Shopping', onClick: () => { setAddMenuOpen(false); setShowAmazonLookup(true); } },
                    { label: 'Add via Brand Website',   onClick: () => { setAddMenuOpen(false); setBrandUrlInput(''); setBrandUrlError(null); setShowBrandUrl(true); } },
                  ].map(item => (
                    <button
                      key={item.label}
                      type="button"
                      role="menuitem"
                      onClick={item.onClick}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '8px 12px',
                        fontSize: 13,
                        background: 'transparent',
                        border: 'none',
                        borderRadius: 6,
                        cursor: 'pointer',
                        color: '#111',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#f3f4f6')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="admin-tabs">
        <button className={`admin-tab ${activeTab === 'looks' ? 'active' : ''}`} onClick={() => setActiveTab('looks')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polygon points="23 7 16 12 23 17 23 7"/>
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
          </svg>
          Looks
        </button>
        <button className={`admin-tab ${activeTab === 'products' ? 'active' : ''}`} onClick={() => setActiveTab('products')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/>
            <line x1="3" y1="6" x2="21" y2="6"/>
            <path d="M16 10a4 4 0 0 1-8 0"/>
          </svg>
          Products
        </button>
        <button className={`admin-tab ${activeTab === 'musics' ? 'active' : ''}`} onClick={() => setActiveTab('musics')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 18V5l12-2v13"/>
            <circle cx="6" cy="18" r="3"/>
            <circle cx="18" cy="16" r="3"/>
          </svg>
          Musics
        </button>
        <button className={`admin-tab ${activeTab === 'places' ? 'active' : ''}`} onClick={() => setActiveTab('places')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z"/>
            <circle cx="12" cy="10" r="3"/>
          </svg>
          Places
        </button>
      </div>

      {activeTab === 'looks' && (
        <>
        {/* Source split sits ABOVE the status pills — it's the
            primary axis the admin reasons in ("show me AI looks vs
            human looks"), with status as the sub-filter inside that.
            Published uses publishedSourceCounts (keyed off the
            curated looks table joined with creators.is_ai); the
            unpublished/failed pills use sourceCounts (off
            user_generations.creator_is_ai). */}
        {(() => {
          const counts = looksFilter === 'published' ? publishedSourceCounts : sourceCounts;
          return (
            <div className="admin-tabs" style={{ marginBottom: 8 }}>
              <button
                className={`admin-tab ${lookSource === 'all' ? 'active' : ''}`}
                onClick={() => setLookSource('all')}
                title="Show every look in the current pill, regardless of creator type"
              >
                All
                <span className="admin-tab-badge">{counts.all}</span>
              </button>
              <button
                className={`admin-tab ${lookSource === 'human' ? 'active' : ''}`}
                onClick={() => setLookSource('human')}
                title="Looks created by real shoppers / creators (profile.is_ai = false)"
              >
                Human
                <span className="admin-tab-badge">{counts.human}</span>
              </button>
              <button
                className={`admin-tab ${lookSource === 'ai' ? 'active' : ''}`}
                onClick={() => setLookSource('ai')}
                title="Looks owned by AI personas (profile.is_ai = true) — admin impersonations land here"
              >
                AI
                <span className="admin-tab-badge">{counts.ai}</span>
              </button>
            </div>
          );
        })()}
        <div className="admin-tabs" style={{ marginBottom: 12 }}>
          <button
            className={`admin-tab ${looksFilter === 'published' ? 'active' : ''}`}
            onClick={() => setLooksFilter('published')}
            title="Curated looks shown on the public feed"
          >
            Published
            <span className="admin-tab-badge">{lookRows.length}</span>
          </button>
          <button
            className={`admin-tab ${looksFilter === 'unpublished' ? 'active' : ''}`}
            onClick={() => setLooksFilter('unpublished')}
            title="Looks generated by users via the Generate flow"
          >
            Unpublished
            <span className="admin-tab-badge">{unpublishedActive.length}</span>
          </button>
          <button
            className={`admin-tab ${looksFilter === 'failed' ? 'active' : ''}`}
            onClick={() => setLooksFilter('failed')}
            title="Generations that failed - see error message for details"
          >
            Failed
            <span className="admin-tab-badge">{failedLooks.length}</span>
          </button>
        </div>
        </>
      )}

      {activeTab === 'looks' && (
        <div
          className="admin-table-wrap"
          style={{ display: looksFilter === 'published' ? undefined : 'none' }}
        >
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 32 }}></th>
                <th>Creative</th>
                <SortableTh label="Creator" sortKey="creatorDisplay" currentSort={lookTable.sort} onSort={lookTable.handleSort} />
                <th>Created At</th>
                <th>Platform</th>
                <th>Featured</th>
                <th>Weight</th>
                <th>Splash</th>
                <th>Products</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {lookTable.sortedData.map(row => {
                const look = looks.find(l => l.id === row.id)!;
                const isExpanded = expandedId === row.id;
                return (
                  <Fragment key={row.id}>
                    <tr
                      className="admin-look-main-row"
                      onClick={() => toggleExpand(row.id)}
                      style={{ cursor: 'pointer', opacity: dragLookId === row.id ? 0.4 : 1 }}
                      draggable
                      onDragStart={(e) => { e.stopPropagation(); setDragLookId(row.id); e.dataTransfer.effectAllowed = 'move'; }}
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDropLook(row.id); }}
                      onDragEnd={() => setDragLookId(null)}
                    >
                      <td
                        onClick={(e) => e.stopPropagation()}
                        style={{ cursor: 'grab', color: '#bbb', textAlign: 'center', fontSize: 16, userSelect: 'none' }}
                        aria-label="Drag to reorder"
                        title="Drag to reorder"
                      >
                        ⋮⋮
                      </td>
                      <td>
                        <div className="admin-look-thumb">
                          {(() => {
                            const isAbsolute = row.video && /^https?:\/\//i.test(row.video);
                            const src = row.video ? (isAbsolute ? row.video : `${basePath}/${row.video}`) : '';
                            if (!src) return <div style={{ width: '100%', height: '100%', background: '#111' }} />;
                            // Renders the thumbnail image FIRST (cheap),
                            // then the video element underneath which
                            // attaches when the row scrolls into the
                            // 1200px pre-warm zone. Eliminates the
                            // "all gray rectangles" first-paint state
                            // on long admin pages.
                            return <LazyThumb url={src} thumbnail={(row as { thumbnail?: string | null }).thumbnail || null} />;
                          })()}
                        </div>
                      </td>
                      <td>
                        <div className="admin-look-creator">
                          {row.creatorAvatar ? (
                            <img className="admin-look-creator-avatar" src={row.creatorAvatar} alt={row.creator} />
                          ) : (
                            <div className="admin-look-creator-avatar" style={{ background: '#e5e7eb' }} />
                          )}
                          <span>{row.creatorDisplay}</span>
                        </div>
                      </td>
                      <td className="admin-cell-muted">Feb 17, 2026, 12:16 PM</td>
                      <td><AdminToggle on={getToggles(row.id).platform} onChange={v => setToggle(row.id, 'platform', v)} /></td>
                      <td><AdminToggle on={getToggles(row.id).featured} onChange={v => setToggle(row.id, 'featured', v)} /></td>
                      <td><span className="admin-weight-input">5</span></td>
                      <td><AdminToggle on={getToggles(row.id).splash} onChange={v => setToggle(row.id, 'splash', v)} /></td>
                      <td>
                        <button className="admin-products-dropdown" onClick={(e) => { e.stopPropagation(); toggleExpand(row.id); }}>
                          <span>{row.products} Products</span>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
                            <polyline points="6 9 12 15 18 9"/>
                          </svg>
                        </button>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="admin-product-actions">
                          <button
                            type="button"
                            className="admin-btn admin-btn-primary"
                            style={{ fontSize: 11, padding: '4px 10px', marginRight: 6 }}
                            title="Open the publish flow for this look"
                            onClick={() => navigate(`/admin/publish/${row.id}`)}
                          >
                            Publish
                          </button>
                          <button className="admin-icon-btn" aria-label="Move up" onClick={() => moveLook(row.id, -1)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
                          </button>
                          <button className="admin-icon-btn" aria-label="Move down" onClick={() => moveLook(row.id, 1)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
                          </button>
                          <button className="admin-icon-btn danger" aria-label="Delete" onClick={() => deleteLook(row.id)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                    <tr className={`admin-look-expanded-row ${isExpanded ? 'open' : ''}`}>
                      <td colSpan={10} style={{ padding: 0 }}>
                        <div className="admin-expand-animate">
                          <div className="admin-look-products">
                            <h3 className="admin-products-title">Products</h3>
                            <table className="admin-table admin-products-table">
                              <thead>
                                <tr>
                                  <th style={{ textAlign: 'left' }}>Creative</th>
                                  <th style={{ textAlign: 'left' }}>Photos</th>
                                  <th style={{ textAlign: 'left' }}>Product</th>
                                  <th>Price</th>
                                  <th>Connection</th>
                                  <th>Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {look.products.map((product, pi) => {
                                  const key = `${product.brand}-${product.name}`;
                                  const matched = allProducts.find(ap => `${ap.brand}-${ap.name}` === key);
                                  const videoUrls = matched?.id ? (adVideoMap.get(matched.id) || []) : [];
                                  const imageUrl = matched?.image_url || (product as any).image || null;
                                  const connection: 'Look' | 'Crawl' | 'Ad' = matched?.connection || 'Look';
                                  return (
                                    <tr key={pi}>
                                      <td>
                                        {videoUrls.length > 0 ? (
                                          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                            {videoUrls.slice(0, 3).map((v, vi) => (
                                              <div key={vi} className="admin-look-thumb" style={{ width: 36, height: 48 }}>
                                                <video
                                                  src={v}
                                                  autoPlay
                                                  muted
                                                  loop
                                                  playsInline
                                                  preload="metadata"
                                                  style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4 }}
                                                />
                                                <div className="admin-look-preview">
                                                  <video src={v} autoPlay muted loop playsInline />
                                                </div>
                                              </div>
                                            ))}
                                            {videoUrls.length > 3 && (
                                              <span style={{ fontSize: 11, color: '#888', fontWeight: 600 }}>
                                                +{videoUrls.length - 3}
                                              </span>
                                            )}
                                          </div>
                                        ) : (
                                          <span style={{ fontSize: 11, color: '#ccc' }}> - </span>
                                        )}
                                      </td>
                                      <td>
                                        <div className="admin-product-creative">
                                          {imageUrl ? (
                                            <img
                                              src={imageUrl}
                                              alt={product.name}
                                              style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover' }}
                                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                            />
                                          ) : (
                                            <img
                                              src={getBrandLogo(product.brand) || ''}
                                              alt={product.brand}
                                              className="admin-brand-logo"
                                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                            />
                                          )}
                                        </div>
                                      </td>
                                      <td style={{ textAlign: 'left' }}>
                                        <div>
                                          <div style={{ fontWeight: 600, fontSize: 12 }}>{product.name}</div>
                                          <div style={{ fontSize: 10, color: '#999' }}>{product.brand}</div>
                                        </div>
                                      </td>
                                      <td style={{ fontWeight: 600 }}>{product.price}</td>
                                      <td>
                                        <span className={`admin-connection-pill admin-connection-${connection.toLowerCase()}`}>
                                          {connection}
                                        </span>
                                      </td>
                                      <td>
                                        <div className="admin-product-actions">
                                          <button className="admin-icon-btn" aria-label="Move up">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
                                          </button>
                                          <button className="admin-icon-btn" aria-label="Move down">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
                                          </button>
                                          <button className="admin-icon-btn danger" aria-label="Delete">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'looks' && (
        <div
          className="admin-table-wrap"
          style={{ display: looksFilter === 'unpublished' ? undefined : 'none' }}
        >
          <table className="admin-table">
            <thead>
              <tr>
                <th>Creative</th>
                <th>Creator</th>
                <th>Created At</th>
                <th>Style</th>
                <th>Status</th>
                <th>Products</th>
                <th>Model</th>
                <th style={{ width: 110 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {unpublishedLoading && unpublishedActive.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: 24, color: '#888' }}>Loading…</td>
                </tr>
              ) : unpublishedActive.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: 24, color: '#888' }}>No user-generated looks yet</td>
                </tr>
              ) : unpublishedActive.map(g => {
                const creatorLabel = g.creator_name || g.creator_email || g.user_id.slice(0, 8);
                const created = new Date(g.created_at).toLocaleString(undefined, {
                  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
                });
                const isExpanded = expandedUnpublishedId === g.id;
                const productRows = unpublishedProducts.get(g.id);
                const productsLoading = unpublishedProductsLoading.has(g.id);
                return (
                  <Fragment key={g.id}>
                  <tr
                    className="admin-look-main-row"
                    onClick={() => toggleUnpublishedExpand(g.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>
                      <div className="admin-look-thumb">
                        {g.video_url ? (
                          <LazyThumb url={g.video_url} />
                        ) : (
                          <div style={{
                            width: '100%', height: '100%', background: '#111', color: '#aaa',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 10, textAlign: 'center', padding: 4,
                          }}>
                            {g.status === 'failed' ? 'Failed' : 'Processing…'}
                          </div>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="admin-look-creator">
                        {g.creator_avatar ? (
                          <img className="admin-look-creator-avatar" src={g.creator_avatar} alt={creatorLabel} />
                        ) : (
                          <div className="admin-look-creator-avatar" style={{ background: '#e5e7eb' }} />
                        )}
                        <span>{creatorLabel}</span>
                      </div>
                    </td>
                    <td className="admin-cell-muted">{created}</td>
                    <td style={{ textTransform: 'capitalize' }}>{g.style}</td>
                    <td>
                      <span
                        title={g.status === 'failed' && g.error ? g.error : undefined}
                        style={{
                          display: 'inline-block', padding: '2px 8px', borderRadius: 12,
                          fontSize: 11, fontWeight: 600, textTransform: 'capitalize',
                          background:
                            g.status === 'done' ? '#dcfce7'
                            : g.status === 'failed' ? '#fee2e2'
                            : '#fef9c3',
                          color:
                            g.status === 'done' ? '#166534'
                            : g.status === 'failed' ? '#991b1b'
                            : '#854d0e',
                        }}
                      >
                        {g.status}
                      </span>
                    </td>
                    <td onClick={(e) => { e.stopPropagation(); toggleUnpublishedExpand(g.id); }}>
                      <button className="admin-products-dropdown" type="button" onClick={(e) => { e.stopPropagation(); toggleUnpublishedExpand(g.id); }}>
                        <span>{g.product_count} Products</span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
                          <polyline points="6 9 12 15 18 9"/>
                        </svg>
                      </button>
                    </td>
                    <td onClick={(e) => { e.stopPropagation(); toggleModelExpand(g.id); }}>
                      <button
                        className="admin-products-dropdown"
                        type="button"
                        title="Inspect the model + prompt + pipeline for this generation"
                        onClick={(e) => { e.stopPropagation(); toggleModelExpand(g.id); }}
                      >
                        <span style={{ textTransform: 'capitalize' }}>{g.model || ' - '}</span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expandedModelId === g.id ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
                          <polyline points="6 9 12 15 18 9"/>
                        </svg>
                      </button>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {/* Publish: routes to the curated-looks management
                          page with ?publish=<gen_id>. The looks page can
                          pick that param up and open a publish dialog;
                          for now it lands the admin in the right view to
                          take the next step manually. */}
                      <button
                        type="button"
                        className="admin-btn admin-btn-primary"
                        style={{ fontSize: 11, padding: '4px 10px' }}
                        disabled={g.status !== 'done' || publishingIds.has(g.id)}
                        title={g.status === 'done' ? 'Publish this look to the curated catalog' : `Can't publish - status is ${g.status}`}
                        onClick={() => publishUnpublishedInline(g)}
                      >
                        {publishingIds.has(g.id) ? 'Publishing…' : 'Publish'}
                      </button>
                    </td>
                  </tr>
                  <tr className={`admin-look-expanded-row ${isExpanded ? 'open' : ''}`}>
                    <td colSpan={8} style={{ padding: 0 }}>
                      <div className="admin-expand-animate">
                        <div className="admin-look-products">
                          <h3 className="admin-products-title">Products</h3>
                          {productsLoading && !productRows ? (
                            <div style={{ padding: 12, fontSize: 12, color: '#888' }}>Loading products…</div>
                          ) : !productRows || productRows.length === 0 ? (
                            <div style={{ padding: 12, fontSize: 12, color: '#888' }}>No products linked to this generation.</div>
                          ) : (
                            <table className="admin-table admin-products-table">
                              <thead>
                                <tr>
                                  <th style={{ textAlign: 'left' }}>Photo</th>
                                  <th style={{ textAlign: 'left' }}>Product</th>
                                  <th>Role</th>
                                  <th>Price</th>
                                </tr>
                              </thead>
                              <tbody>
                                {productRows.map(p => (
                                  <tr key={p.id}>
                                    <td>
                                      {p.image_url ? (
                                        <img
                                          src={p.image_url}
                                          alt={p.name}
                                          style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover' }}
                                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                        />
                                      ) : (
                                        <div style={{ width: 40, height: 40, borderRadius: 6, background: '#f3f4f6' }} />
                                      )}
                                    </td>
                                    <td style={{ textAlign: 'left' }}>
                                      <div style={{ fontWeight: 600, fontSize: 12 }}>{p.name}</div>
                                      <div style={{ fontSize: 10, color: '#999' }}>{p.brand}</div>
                                    </td>
                                    <td style={{ textTransform: 'capitalize', fontSize: 11, color: '#666' }}>{p.role_tag || ' - '}</td>
                                    <td style={{ fontWeight: 600 }}>{p.price || ' - '}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                  <tr className={`admin-look-expanded-row ${expandedModelId === g.id ? 'open' : ''}`}>
                    <td colSpan={8} style={{ padding: 0 }}>
                      <div className="admin-expand-animate">
                        <ModelDetailsPanel gen={g} />
                      </div>
                    </td>
                  </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'looks' && (
        <div
          className="admin-table-wrap"
          style={{ display: looksFilter === 'failed' ? undefined : 'none' }}
        >
          <table className="admin-table">
            <thead>
              <tr>
                <th>Creative</th>
                <th>Creator</th>
                <th>Created At</th>
                <th>Style</th>
                <th>Model</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {unpublishedLoading && failedLooks.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: 24, color: '#888' }}>Loading…</td>
                </tr>
              ) : failedLooks.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: 24, color: '#888' }}>No failed generations</td>
                </tr>
              ) : failedLooks.map(g => {
                const creatorLabel = g.creator_name || g.creator_email || g.user_id.slice(0, 8);
                const created = new Date(g.created_at).toLocaleString(undefined, {
                  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
                });
                return (
                  <tr key={g.id} className="admin-look-main-row">
                    <td>
                      <div className="admin-look-thumb">
                        <div style={{
                          width: '100%', height: '100%', background: '#111', color: '#aaa',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 10, textAlign: 'center', padding: 4,
                        }}>
                          Failed
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="admin-look-creator">
                        {g.creator_avatar ? (
                          <img className="admin-look-creator-avatar" src={g.creator_avatar} alt={creatorLabel} />
                        ) : (
                          <div className="admin-look-creator-avatar" style={{ background: '#e5e7eb' }} />
                        )}
                        <span>{creatorLabel}</span>
                      </div>
                    </td>
                    <td className="admin-cell-muted">{created}</td>
                    <td style={{ textTransform: 'capitalize' }}>{g.style}</td>
                    <td style={{ textTransform: 'capitalize' }}>{g.model || ' - '}</td>
                    <td>
                      <div
                        title={g.error || 'No error message recorded'}
                        style={{
                          fontSize: 12, color: '#991b1b',
                          background: '#fef2f2', border: '1px solid #fecaca',
                          borderRadius: 6, padding: '6px 10px',
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                          maxWidth: 520, lineHeight: 1.4,
                        }}
                      >
                        {g.error || ' -  no message recorded  - '}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'products' && productsLoading && (
        <div
          role="status"
          aria-live="polite"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 14,
            padding: '80px 16px',
            color: '#64748b',
          }}
        >
          <style>{`
            @keyframes admin-products-spin { to { transform: rotate(360deg); } }
          `}</style>
          <div
            aria-hidden
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              border: '2.5px solid #e5e7eb',
              borderTopColor: '#0f172a',
              animation: 'admin-products-spin 0.9s linear infinite',
            }}
          />
          <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>Loading products…</div>
          <div style={{ fontSize: 12 }}>Pulling the latest from Supabase.</div>
        </div>
      )}
      {activeTab === 'products' && !productsLoading && (
        <>
          {brandFilter && (
            <div className="admin-brand-filter-chip">
              <span>Brand: <strong>{brandFilter}</strong></span>
              <span className="admin-brand-filter-count">{filteredProductsList.length} product{filteredProductsList.length !== 1 ? 's' : ''}</span>
              <button
                className="admin-icon-btn"
                title="Clear brand filter"
                aria-label="Clear brand filter"
                onClick={clearBrandFilter}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          )}
          <div className="admin-tabs" style={{ marginBottom: 12 }}>
            <button
              className={`admin-tab ${productFilter === 'all' ? 'active' : ''}`}
              onClick={() => setProductFilter('all')}
            >
              Show all
              <span className="admin-tab-badge">{allProducts.length}</span>
            </button>
            <button
              className={`admin-tab ${productFilter === 'active' ? 'active' : ''}`}
              onClick={() => setProductFilter('active')}
              title="Products currently shown on the feed"
            >
              Showing
              <span className="admin-tab-badge">{allProducts.filter(p => (p as any).is_active !== false).length}</span>
            </button>
            <button
              className={`admin-tab ${productFilter === 'inactive' ? 'active' : ''}`}
              onClick={() => setProductFilter('inactive')}
              title="Products hidden from the feed - often missing a URL, price, or creative"
            >
              Hidden
              <span className="admin-tab-badge">{allProducts.filter(p => (p as any).is_active === false).length}</span>
            </button>
            <button
              className={`admin-tab ${productFilter === 'no-creative' ? 'active' : ''}`}
              onClick={() => setProductFilter('no-creative')}
            >
              Show without creative
              <span className="admin-tab-badge">{allProducts.filter(p => !p.hasCreative).length}</span>
            </button>
            <button
              className={`admin-tab ${productFilter === 'untagged' ? 'active' : ''}`}
              onClick={() => setProductFilter('untagged')}
              title="Products missing a gender tag - leak into every shopper's feed because untagged products bypass the gender filter"
            >
              Untagged
              <span className="admin-tab-badge">{allProducts.filter(p => p.gender == null).length}</span>
            </button>
            <button
              className={`admin-tab ${productFilter === 'soft-deleted' ? 'active' : ''}`}
              onClick={() => setProductFilter('soft-deleted')}
              title="Products you removed from the feed via the trash icon — still in the DB. Click a row's Hard delete to remove permanently."
              style={productFilter === 'soft-deleted' ? { color: '#b91c1c' } : undefined}
            >
              Soft delete
              <span className="admin-tab-badge">
                {allProducts.filter(p => deletedProductKeys.has(`${p.brand}-${p.name}`)).length}
              </span>
            </button>
          </div>
        {selectedProductKeys.size > 0 && (
          <div className="admin-bulk-bar" style={{
            position: 'fixed',
            left: '50%',
            bottom: 24,
            transform: 'translateX(-50%)',
            zIndex: 9999,
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '10px 16px',
            background: 'rgba(18, 18, 20, 0.97)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            color: '#fff',
            border: '1px solid rgba(255, 255, 255, 0.10)',
            borderRadius: 999,
            boxShadow: '0 18px 50px rgba(0, 0, 0, 0.45), 0 4px 14px rgba(0, 0, 0, 0.25)',
            animation: 'admin-bulk-bar-slide-up 220ms cubic-bezier(0.16, 1, 0.3, 1) both',
            maxWidth: 'calc(100vw - 32px)',
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}>
            <style>{`
              @keyframes admin-bulk-bar-slide-up {
                from { transform: translate(-50%, 24px); opacity: 0; }
                to   { transform: translate(-50%, 0);    opacity: 1; }
              }
              .bulk-pill {
                font-size: 12px; font-weight: 600; line-height: 1;
                padding: 7px 12px; border-radius: 999px; cursor: pointer;
                font-family: inherit;
                background: rgba(255,255,255,0.08);
                color: #fff;
                border: 1px solid transparent;
                transition: background 140ms ease, border-color 140ms ease;
                white-space: nowrap;
              }
              .bulk-pill:hover { background: rgba(255,255,255,0.16); }
              .bulk-pill:focus-visible { outline: none; border-color: rgba(255,255,255,0.55); }
              .bulk-pill--primary { background: #fff; color: #111; }
              .bulk-pill--primary:hover { background: #e5e5e5; }
              .bulk-pill--ghost { background: transparent; color: rgba(255,255,255,0.75); }
              .bulk-pill--ghost:hover { background: rgba(255,255,255,0.10); color: #fff; }
              .bulk-pill--danger { color: #fca5a5; }
              .bulk-pill--danger:hover { background: rgba(220,38,38,0.22); color: #fff; }
              .bulk-pill--on { background: rgba(34,197,94,0.20); color: #86efac; }
              .bulk-pill--on:hover { background: rgba(34,197,94,0.30); color: #fff; }
              .bulk-pill--off { background: rgba(148,163,184,0.18); color: #cbd5e1; }
              .bulk-pill--off:hover { background: rgba(148,163,184,0.30); color: #fff; }
              .bulk-pill--men { background: rgba(59,130,246,0.20); color: #93c5fd; }
              .bulk-pill--men:hover { background: rgba(59,130,246,0.30); color: #fff; }
              .bulk-pill--women { background: rgba(236,72,153,0.20); color: #f9a8d4; }
              .bulk-pill--women:hover { background: rgba(236,72,153,0.30); color: #fff; }
              .bulk-pill--unisex { background: rgba(148,163,184,0.18); color: #cbd5e1; }
              .bulk-pill--unisex:hover { background: rgba(148,163,184,0.30); color: #fff; }
              .bulk-divider { width: 1px; height: 22px; background: rgba(255,255,255,0.12); }
              .bulk-label { font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: rgba(255,255,255,0.50); }
              .bulk-group { display: inline-flex; align-items: center; gap: 6px; }
            `}</style>

            <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>
              {selectedProductKeys.size} selected
            </span>
            <button
              className="bulk-pill bulk-pill--ghost"
              onClick={() => { setSelectedProductKeys(new Set()); setLastSelectedIndex(null); }}
            >
              Clear
            </button>

            <span className="bulk-divider" />

            <button
              className="bulk-pill bulk-pill--primary"
              onClick={() => {
                // Resolve to the subset with real cloud ids - only those can
                // drive the generation pipeline.
                const selectedIds: { id: string; name: string }[] = [];
                for (const k of selectedProductKeys) {
                  const match = allProducts.find(ap => `${ap.brand}-${ap.name}` === k);
                  if (match?.id) selectedIds.push({ id: match.id, name: match.name });
                }
                if (selectedIds.length === 0) {
                  showToast('None of the selected products are saved in the cloud yet.');
                  return;
                }
                setBatchPicker({ items: selectedIds });
              }}
            >
              Generate
            </button>
            <button
              className="bulk-pill"
              title="Run the vision picker on the selected products only — overrides any existing primary."
              onClick={async () => {
                if (!supabase) return;
                // Resolve to the subset with cloud ids + at least one image.
                type Row = { id: string; name: string | null; brand: string | null; image_url: string | null; images: string[] | null };
                const rows: Row[] = [];
                for (const k of selectedProductKeys) {
                  const match = allProducts.find(ap => `${ap.brand}-${ap.name}` === k);
                  if (match?.id) rows.push({
                    id: match.id,
                    name: match.name,
                    brand: match.brand,
                    image_url: (match as { image_url?: string | null }).image_url ?? null,
                    images: (match as { images?: string[] | null }).images ?? null,
                  });
                }
                if (rows.length === 0) {
                  showToast('None of the selected products are saved in the cloud yet.');
                  return;
                }
                setPickingPrimary(true);
                setPrimaryProgress({ done: 0, total: rows.length, failed: 0 });
                let done = 0;
                let failed = 0;
                for (const row of rows) {
                  const urls: string[] = [];
                  if (Array.isArray(row.images)) {
                    for (const u of row.images) if (typeof u === 'string' && u) urls.push(u);
                  }
                  if (row.image_url && !urls.includes(row.image_url)) urls.push(row.image_url);
                  if (urls.length === 0) { done += 1; failed += 1; setPrimaryProgress({ done, total: rows.length, failed }); continue; }
                  try {
                    const { data, error } = await supabase.functions.invoke('pick-primary-image', {
                      body: { product_id: row.id, name: row.name || '', brand: row.brand || '', image_urls: urls },
                    });
                    if (error || !data?.success) failed += 1;
                  } catch { failed += 1; }
                  done += 1;
                  setPrimaryProgress({ done, total: rows.length, failed });
                }
                setPickingPrimary(false);
                setPrimaryProgress(null);
                if (failed > 0) showToast(`Primary images: ${done - failed}/${done} picked — ${failed} failed`);
                else            showToast(`Primary images picked for ${done} product${done === 1 ? '' : 's'}`);
              }}
              disabled={pickingPrimary}
            >
              {pickingPrimary && primaryProgress
                ? `Picking ${primaryProgress.done}/${primaryProgress.total}…`
                : 'Pick primary'}
            </button>
            {/* Bulk Polish — reframes each selected product's primary
                image into a 3:4 packshot via Gemini nano-banana.
                Sequenced 3-at-a-time so we don't burst the API. The
                global Generation Queue (bottom-right panel) shows
                per-product progress with rolling-avg ETAs. */}
            <button
              className="bulk-pill"
              title="Reframe each selected product's primary image into a uniform 3:4 packshot."
              disabled={bulkPolishing}
              onClick={async () => {
                // Polish needs an existing primary_image_url — pick
                // does that step first, so skip any product that
                // hasn't been pick'd yet (or just hasn't loaded).
                const ids: string[] = [];
                for (const k of selectedProductKeys) {
                  const match = crawledProducts.find(cp => `${cp.brand}-${cp.name}` === k);
                  if (match?.id && (match as { primary_image_url?: string | null }).primary_image_url) ids.push(match.id);
                }
                if (ids.length === 0) {
                  showToast('No selected products have a primary image yet — run Pick primary first.');
                  return;
                }
                setBulkPolishing(true);
                let i = 0;
                let done = 0;
                const CONCURRENCY = 3;
                const next = async () => {
                  while (true) {
                    const myIdx = i++;
                    if (myIdx >= ids.length) return;
                    try { await polishPrimaryImage(ids[myIdx]); } catch { /* per-call toast handles it */ }
                    done += 1;
                    setBulkPolishProgress({ done, total: ids.length });
                  }
                };
                setBulkPolishProgress({ done: 0, total: ids.length });
                await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, next));
                setBulkPolishing(false);
                setBulkPolishProgress(null);
                showToast(`Polished ${done}/${ids.length} primary image${ids.length === 1 ? '' : 's'}`);
              }}
            >
              {bulkPolishing && bulkPolishProgress
                ? `Polishing ${bulkPolishProgress.done}/${bulkPolishProgress.total}…`
                : 'Polish primary'}
            </button>
            {/* Bulk Primary Video — Seedance i2v on each selected
                product's polished primary image. 90s/clip × concurrency
                3 = ~8 min for 16 selected. Queue shows per-product
                progress + ETAs. */}
            <button
              className="bulk-pill"
              title="Generate a primary video (Seedance i2v) for each selected product. Requires a primary image."
              disabled={bulkVideoGenerating}
              onClick={async () => {
                const ids: string[] = [];
                for (const k of selectedProductKeys) {
                  const match = crawledProducts.find(cp => `${cp.brand}-${cp.name}` === k);
                  if (match?.id && (match as { primary_image_url?: string | null }).primary_image_url) ids.push(match.id);
                }
                if (ids.length === 0) {
                  showToast('No selected products have a primary image yet — run Pick primary (and Polish primary) first.');
                  return;
                }
                setBulkVideoGenerating(true);
                let i = 0;
                let done = 0;
                const CONCURRENCY = 3;
                const next = async () => {
                  while (true) {
                    const myIdx = i++;
                    if (myIdx >= ids.length) return;
                    try { await generatePrimaryVideo(ids[myIdx]); } catch { /* per-call toast handles it */ }
                    done += 1;
                    setBulkVideoProgress({ done, total: ids.length });
                  }
                };
                setBulkVideoProgress({ done: 0, total: ids.length });
                await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, next));
                setBulkVideoGenerating(false);
                setBulkVideoProgress(null);
                showToast(`Generated ${done}/${ids.length} primary video${ids.length === 1 ? '' : 's'}`);
              }}
            >
              {bulkVideoGenerating && bulkVideoProgress
                ? `Generating ${bulkVideoProgress.done}/${bulkVideoProgress.total}…`
                : 'Generate primary video'}
            </button>
            <button
              className="bulk-pill bulk-pill--danger"
              onClick={async () => {
                if (!window.confirm(`Delete ${selectedProductKeys.size} selected product${selectedProductKeys.size === 1 ? '' : 's'}? This will also remove any generated creatives.`)) return;
                // Resolve IDs for real cloud deletes; anything without an id
                // falls back to the admin_hidden_products table.
                const selected = [...selectedProductKeys];
                const idsToDelete: string[] = [];
                const rowsToHide: { brand: string; name: string }[] = [];
                for (const k of selected) {
                  const match = allProducts.find(ap => `${ap.brand}-${ap.name}` === k);
                  if (match?.id) idsToDelete.push(match.id);
                  else if (match) rowsToHide.push({ brand: match.brand, name: match.name });
                }
                setDeletedProductKeys(prev => {
                  const next = new Set(prev);
                  for (const k of selectedProductKeys) next.add(k);
                  writeLocalSet(LOCAL_PRODUCTS_KEY, next);
                  return next;
                });
                if (supabase) {
                  if (idsToDelete.length > 0) {
                    await supabase.from('product_creative').delete().in('product_id', idsToDelete);
                    const { error } = await supabase.from('products').delete().in('id', idsToDelete);
                    if (error) {
                      showToast(`Delete failed: ${error.message}`);
                      return;
                    }
                    setCrawledProducts(prev => prev.filter(r => !idsToDelete.includes(r.id)));
                  }
                  if (rowsToHide.length > 0) {
                    await supabase.from('admin_hidden_products').upsert(rowsToHide, { onConflict: 'brand,name' });
                  }
                }
                showToast(`Deleted ${selectedProductKeys.size} product${selectedProductKeys.size === 1 ? '' : 's'}`);
                setSelectedProductKeys(new Set());
                setLastSelectedIndex(null);
              }}
            >
              Delete
            </button>

            <span className="bulk-divider" />

            <span className="bulk-group">
              <span className="bulk-label">Home</span>
              <button
                className="bulk-pill bulk-pill--on"
                onClick={async () => {
                  await bulkSetActive(true);
                  showToast(`Home on for ${selectedProductKeys.size} product${selectedProductKeys.size === 1 ? '' : 's'}`);
                }}
              >
                On
              </button>
              <button
                className="bulk-pill bulk-pill--off"
                onClick={async () => {
                  await bulkSetActive(false);
                  showToast(`Home off for ${selectedProductKeys.size} product${selectedProductKeys.size === 1 ? '' : 's'}`);
                }}
              >
                Off
              </button>
            </span>

            <span className="bulk-divider" />

            <span className="bulk-group">
              <span className="bulk-label">Gender</span>
              <button
                className="bulk-pill bulk-pill--men"
                onClick={async () => {
                  const n = await bulkSetGender('male');
                  if (n > 0) showToast(`Set ${n} product${n === 1 ? '' : 's'} to Men's`);
                }}
              >
                Men's
              </button>
              <button
                className="bulk-pill bulk-pill--women"
                onClick={async () => {
                  const n = await bulkSetGender('female');
                  if (n > 0) showToast(`Set ${n} product${n === 1 ? '' : 's'} to Women's`);
                }}
              >
                Women's
              </button>
              <button
                className="bulk-pill bulk-pill--unisex"
                onClick={async () => {
                  const n = await bulkSetGender('unisex');
                  if (n > 0) showToast(`Set ${n} product${n === 1 ? '' : 's'} to Unisex`);
                }}
              >
                Unisex
              </button>
            </span>
          </div>
        )}
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    checked={productTable.sortedData.length > 0 && productTable.sortedData.every(p => selectedProductKeys.has(`${p.brand}-${p.name}`))}
                    ref={el => {
                      if (!el) return;
                      const visible = productTable.sortedData.map(p => `${p.brand}-${p.name}`);
                      const some = visible.some(k => selectedProductKeys.has(k));
                      const all = visible.length > 0 && visible.every(k => selectedProductKeys.has(k));
                      el.indeterminate = some && !all;
                    }}
                    onChange={(e) => {
                      const visible = productTable.sortedData.map(p => `${p.brand}-${p.name}`);
                      setSelectedProductKeys(prev => {
                        const next = new Set(prev);
                        if (e.target.checked) visible.forEach(k => next.add(k));
                        else visible.forEach(k => next.delete(k));
                        return next;
                      });
                      setLastSelectedIndex(null);
                    }}
                  />
                </th>
                <th style={{ textAlign: 'left', minWidth: 56 }} title="Vision-picked solo-product image. Click any photo in the expanded row to override.">Primary</th>
                <th style={{ textAlign: 'left' }}>Primary Video</th>
                <SortableTh label="Brand" sortKey="brand" currentSort={productTable.sort} onSort={productTable.handleSort} />
                <SortableTh label="Type" sortKey="type" currentSort={productTable.sort} onSort={productTable.handleSort} />
                <SortableTh label="Gender" sortKey="gender" currentSort={productTable.sort} onSort={productTable.handleSort} />
                <th style={{ minWidth: 140 }}>Fabric</th>
                <SortableTh label="Product" sortKey="name" currentSort={productTable.sort} onSort={productTable.handleSort} />
                <th style={{ textAlign: 'center' }} title="When on, this product is shown on the home feed">Home</th>
                <th style={{ textAlign: 'center' }} title="When on, this product appears in search results and catalog-wide listings. When off, the product is hidden from the platform but stays in this admin table.">Platform</th>
                <th style={{ textAlign: 'center' }} title="Flagged elite in /admin/creative - curated onto the feed and the deck v1.1 background">Elite</th>
                <SortableTh label="Price" sortKey="price" currentSort={productTable.sort} onSort={productTable.handleSort} />
                {!statsExpanded && (
                  <th
                    className="admin-stats-col"
                    style={{ textAlign: 'center', cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => setStatsExpanded(true)}
                    title="Show In Looks, Creators, Impressions, Saves, Clicks"
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      Stats
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                    </span>
                  </th>
                )}
                {statsExpanded && (
                  <>
                    <th className="admin-stats-col" style={{ textAlign: 'center', cursor: 'pointer', userSelect: 'none', width: 24 }}
                        onClick={() => setStatsExpanded(false)}
                        title="Collapse stats columns">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-label="Collapse stats"><polyline points="15 18 9 12 15 6"/></svg>
                    </th>
                    <SortableTh className="admin-stats-col" label="In Looks" sortKey="lookCount" currentSort={productTable.sort} onSort={productTable.handleSort} />
                    <SortableTh className="admin-stats-col" label="Creators" sortKey="creatorCount" currentSort={productTable.sort} onSort={productTable.handleSort} />
                    <SortableTh className="admin-stats-col" label="Impressions" sortKey="impressions" currentSort={productTable.sort} onSort={productTable.handleSort} />
                    <SortableTh className="admin-stats-col" label="Saves" sortKey="saves" currentSort={productTable.sort} onSort={productTable.handleSort} />
                    <SortableTh className="admin-stats-col" label="Clicks" sortKey="clicks" currentSort={productTable.sort} onSort={productTable.handleSort} />
                  </>
                )}
                {/* Date Added is now its own untinted column, sitting
                    next to Method instead of inside the Stats group -
                    Date is metadata, not engagement, so it shouldn't
                    share the indigo Stats tint. */}
                <SortableTh label="Date Added" sortKey="created_at" currentSort={productTable.sort} onSort={productTable.handleSort} />
                <SortableTh label="Method" sortKey="source" currentSort={productTable.sort} onSort={productTable.handleSort} />
                <th>Tags</th>
                <th>Links</th>
                <th title="Measurements">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Measurements">
                    <rect x="2" y="9" width="20" height="6" rx="1"/>
                    <line x1="6"  y1="9"  x2="6"  y2="12"/>
                    <line x1="10" y1="9"  x2="10" y2="13"/>
                    <line x1="14" y1="9"  x2="14" y2="12"/>
                    <line x1="18" y1="9"  x2="18" y2="13"/>
                  </svg>
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {/* Keyframes for the pending-row shimmer + progress bar
                  sweep. Inlined here so the table is self-contained
                  and the rest of the codebase doesn't need a CSS
                  edit just for this one animation. */}
              {pendingProducts.length > 0 && (
                <tr style={{ height: 0, padding: 0 }}>
                  <td style={{ padding: 0, border: 'none' }}>
                    <style>{`
                      @keyframes pendingShimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
                      @keyframes pendingSweep { 0% { background-position: -60% 0; } 100% { background-position: 160% 0; } }
                    `}</style>
                  </td>
                </tr>
              )}
              {/* Pending-product ghost rows. Indeterminate progress
                  bar runs while the scraper resolves the URL into a
                  real product row. Pruned automatically by the
                  effect once the real row appears below. */}
              {pendingProducts.map(pp => (
                <tr key={pp.id} className="admin-row-pending" style={{ background: '#f8fafc' }}>
                  <td />
                  <td>
                    <div style={{
                      width: 44, height: 44, borderRadius: 6,
                      background: 'linear-gradient(110deg, #e2e8f0 8%, #f1f5f9 18%, #e2e8f0 33%)',
                      backgroundSize: '200% 100%',
                      animation: 'pendingShimmer 1.4s ease-in-out infinite',
                    }} />
                  </td>
                  <td colSpan={20} style={{ padding: '8px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#1d4ed8', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                        Scraping
                      </span>
                      <span style={{ fontSize: 12, color: '#475569', maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={pp.url}>
                        {pp.url}
                      </span>
                      <div style={{ flex: 1, minWidth: 120, height: 4, background: '#e2e8f0', borderRadius: 999, overflow: 'hidden', position: 'relative' }}>
                        <div style={{
                          position: 'absolute', inset: 0,
                          background: 'linear-gradient(90deg, transparent 0%, #2563eb 50%, transparent 100%)',
                          backgroundSize: '40% 100%',
                          backgroundRepeat: 'no-repeat',
                          animation: 'pendingSweep 1.6s linear infinite',
                        }} />
                      </div>
                      <span style={{ fontSize: 11, color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>
                        {Math.round((Date.now() - pp.startedAt) / 1000)}s
                      </span>
                      <button
                        type="button"
                        onClick={() => setPendingProducts(prev => prev.filter(x => x.id !== pp.id))}
                        title="Dismiss"
                        style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 4, fontSize: 14 }}
                      >
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {visibleRows.map((p, i) => {
                const rowKey = `${p.brand}-${p.name}`;
                const isSelected = selectedProductKeys.has(rowKey);
                const toggleRow = (shiftKey: boolean) => {
                  setSelectedProductKeys(prev => {
                    const next = new Set(prev);
                    if (shiftKey && lastSelectedIndex !== null) {
                      // Shift-click: select every row between lastSelectedIndex and i
                      // (inclusive), matching the target row's resulting state so a
                      // shift-click after a deselect clears the range too.
                      const from = Math.min(lastSelectedIndex, i);
                      const to = Math.max(lastSelectedIndex, i);
                      const shouldSelect = !isSelected;
                      for (let j = from; j <= to; j++) {
                        const k = `${productTable.sortedData[j].brand}-${productTable.sortedData[j].name}`;
                        if (shouldSelect) next.add(k); else next.delete(k);
                      }
                    } else {
                      if (isSelected) next.delete(rowKey); else next.add(rowKey);
                    }
                    return next;
                  });
                  setLastSelectedIndex(i);
                };
                const linksOpen = openLinksRow === rowKey;
                const tagsOpen = openTagsRow === rowKey;
                const detailOpen = openDetailRow === rowKey;
                const affiliates = linksOpen ? getProductAffiliateProviders(p) : [];
                const rowTags = tagsOpen ? deriveTags(p.name, p.brand) : [];
                const rowImages: string[] = (p.images && p.images.length > 0)
                  ? p.images
                  : (p.image_url ? [p.image_url] : []);
                return (
                <Fragment key={`${p.brand}-${p.name}-${i}`}>
                <tr
                  onClick={(e) => toggleRow(e.shiftKey)}
                  style={{
                    ...(isSelected ? { background: '#eef2ff' } : undefined),
                    cursor: 'pointer',
                  }}
                >
                  <td
                    onClick={(e) => {
                      // Click anywhere in the checkbox cell toggles the row.
                      // Reads shiftKey for range select from the native event.
                      e.stopPropagation();
                      toggleRow(e.shiftKey);
                    }}
                    style={{ cursor: 'pointer', userSelect: 'none' }}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select ${p.name}`}
                      checked={isSelected}
                      onChange={() => { /* handled by the td onClick */ }}
                      // Prevent the native click from double-toggling - the parent
                      // td already called toggleRow on the way down.
                      onClick={(e) => e.preventDefault()}
                      style={{ pointerEvents: 'none' }}
                    />
                  </td>
                  {/* Primary column — vision-picked solo-product
                      image. Clicking it expands the row so admins can
                      override via the photo gallery's star button.
                      Empty box when the picker hasn't run yet, with
                      a subtle hint to expand. */}
                  <td onClick={(e) => e.stopPropagation()}>
                    {(() => {
                      const primary = (p as { primary_image_url?: string | null }).primary_image_url;
                      const polished = (p as { primary_image_polished?: boolean | null }).primary_image_polished === true;
                      const polishing = p.id ? polishingIds.has(p.id) : false;
                      if (primary) {
                        return (
                          <div style={{ position: 'relative', width: 44, height: 44 }}>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenCreativeRow(detailOpen ? null : rowKey);
                              }}
                              title="Primary image — click to expand the photo gallery and override"
                              style={{
                                width: 44, height: 44, borderRadius: 6, padding: 0,
                                border: '2px solid #16a34a', boxShadow: '0 0 0 1px #16a34a',
                                cursor: 'pointer', background: '#fff', overflow: 'hidden',
                                display: 'block',
                              }}
                            >
                              <img src={primary} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                            </button>
                            {!polished && p.id && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!polishing && p.id) polishPrimaryImage(p.id);
                                }}
                                disabled={polishing}
                                title={polishing ? 'Polishing primary image…' : 'Polish — reframe into uniform 3:4 packshot'}
                                style={{
                                  position: 'absolute',
                                  bottom: -4,
                                  right: -4,
                                  width: 18,
                                  height: 18,
                                  borderRadius: 999,
                                  padding: 0,
                                  border: '1px solid #fff',
                                  background: polishing ? '#94a3b8' : '#7c3aed',
                                  color: '#fff',
                                  cursor: polishing ? 'wait' : 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
                                }}
                              >
                                {polishing ? (
                                  <span style={{
                                    width: 9, height: 9, border: '1.5px solid rgba(255,255,255,0.4)',
                                    borderTopColor: '#fff', borderRadius: '50%',
                                    animation: 'wallet-spin 0.7s linear infinite',
                                  }} />
                                ) : (
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                    <path d="M5 19l6-6" />
                                    <path d="M12 5l1.5 3 3 1.5-3 1.5L12 14l-1.5-3-3-1.5 3-1.5L12 5z" />
                                  </svg>
                                )}
                              </button>
                            )}
                          </div>
                        );
                      }
                      return (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenCreativeRow(detailOpen ? null : rowKey);
                          }}
                          title="No primary picked yet — open the gallery to set one"
                          style={{
                            width: 44, height: 44, borderRadius: 6,
                            border: '1px dashed #cbd5e1', background: '#f8fafc',
                            color: '#94a3b8', fontSize: 18, cursor: 'pointer', padding: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}
                        >
                          ☆
                        </button>
                      );
                    })()}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {(() => {
                      const primaryVideoUrl   = (p as { primary_video_url?: string | null }).primary_video_url ?? null;
                      const primaryImageUrl   = (p as { primary_image_url?: string | null }).primary_image_url ?? null;
                      const primaryStatus     = (p as { primary_video_status?: string | null }).primary_video_status ?? null;
                      const isGenerating      = p.id && genJobs.has(p.id);
                      const isPending         = primaryStatus === 'pending';
                      const hasFailed         = primaryStatus === 'failed';
                      // Active inline progress bar from a bulk job in the
                      // legacy creative pipeline — keep showing it so admins
                      // can track those runs alongside primary-video runs.
                      if (isGenerating) {
                        const job = genJobs.get(p.id!)!;
                        const pct = Math.max(5, Math.round((job.done / job.total) * 100));
                        const label = job.generating > 0
                          ? `Generating ${job.done}/${job.total}`
                          : job.done < job.total ? `Queued ${job.done}/${job.total}` : `Finalizing…`;
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 110 }}>
                            <div style={{ fontSize: 10, fontWeight: 600, color: '#111', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                              {label}
                            </div>
                            <div style={{ position: 'relative', height: 4, borderRadius: 4, background: '#e2e8f0', overflow: 'hidden' }}>
                              <div style={{ position: 'absolute', inset: 0, width: `${pct}%`, background: 'linear-gradient(90deg, #3b82f6, #8b5cf6)', transition: 'width 400ms ease' }} />
                              {job.generating > 0 && (
                                <div className="admin-shimmer" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)', animation: 'admin-shimmer 1.4s infinite' }} />
                              )}
                            </div>
                          </div>
                        );
                      }
                      // No primary, no cloud id → brand logo placeholder.
                      if (!primaryVideoUrl && !primaryImageUrl && !p.id) {
                        return (
                          <img
                            src={getBrandLogo(p.brand) || ''}
                            alt={p.brand}
                            className="admin-brand-logo"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        );
                      }
                      // Status dot — green=done, amber pulse=pending, red=failed,
                      // grey=not started. Pinned bottom-right of the thumb.
                      const statusDot = primaryVideoUrl
                        ? { color: '#22c55e', title: 'Primary video ready', pulse: false }
                        : isPending
                          ? { color: '#f59e0b', title: 'Rendering in background…', pulse: true }
                          : hasFailed
                            ? { color: '#ef4444', title: 'Last generation failed', pulse: false }
                            : { color: '#cbd5e1', title: 'No primary video yet', pulse: false };
                      return (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            // No primary content yet → if we have a cloud id,
                            // act as the Generate entry point. Otherwise open
                            // the detail row.
                            if (!primaryVideoUrl && !primaryImageUrl && p.id) {
                              if (p.id) generatePrimaryVideo(p.id);
                              return;
                            }
                            setOpenCreativeRow(detailOpen ? null : rowKey);
                          }}
                          title={primaryVideoUrl
                            ? 'Primary video — click to expand'
                            : (isPending ? 'Rendering in background — webhook updates this when ready' : (hasFailed ? 'Last generation failed — click to expand and retry' : 'No primary video yet — click to generate'))}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 8,
                            padding: 4, border: `1px solid ${detailOpen ? '#3b82f6' : '#e5e7eb'}`,
                            background: detailOpen ? '#eef4ff' : '#fff',
                            borderRadius: 8, cursor: 'pointer',
                          }}
                        >
                          <div style={{ position: 'relative', width: 30, height: 40, borderRadius: 6, overflow: 'hidden', background: '#f1f5f9', flexShrink: 0 }}>
                            {primaryVideoUrl ? (
                              <video
                                src={primaryVideoUrl}
                                poster={primaryImageUrl || undefined}
                                autoPlay muted loop playsInline preload="metadata"
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              />
                            ) : primaryImageUrl ? (
                              <img
                                src={primaryImageUrl}
                                alt={p.name}
                                style={{ width: '100%', height: '100%', objectFit: 'cover', filter: isPending ? 'saturate(0.7) brightness(0.9)' : undefined }}
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                              />
                            ) : (
                              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#94a3b8', fontWeight: 600 }}>+</div>
                            )}
                            {isPending && (
                              // Shimmering overlay while the webhook is pending.
                              <div style={{
                                position: 'absolute', inset: 0, pointerEvents: 'none',
                                background: 'linear-gradient(90deg, transparent, rgba(245,158,11,0.32), transparent)',
                                animation: 'admin-shimmer 1.4s infinite',
                              }} />
                            )}
                            <span
                              aria-hidden="true"
                              title={statusDot.title}
                              style={{
                                position: 'absolute', right: 2, bottom: 2,
                                width: 8, height: 8, borderRadius: '50%',
                                background: statusDot.color,
                                border: '1.5px solid #fff',
                                boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
                                animation: statusDot.pulse ? 'admin-status-dot-pulse 1.4s ease-in-out infinite' : undefined,
                              }}
                            />
                            <style>{`@keyframes admin-status-dot-pulse {
                              0%, 100% { opacity: 1; transform: scale(1); }
                              50%      { opacity: 0.55; transform: scale(0.85); }
                            }`}</style>
                          </div>
                        </button>
                      );
                    })()}
                  </td>
                  <td style={{ textAlign: 'left', fontSize: 12, color: '#475569' }}>
                    {p.brand ? (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); navigate(`/admin/brand/${encodeURIComponent(p.brand!)}`); }}
                        title={`Open ${p.brand} brand page`}
                        style={{
                          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                          color: '#2563eb', fontSize: 12, fontWeight: 500, textAlign: 'left',
                          textDecoration: 'none',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.textDecoration = 'underline'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.textDecoration = 'none'; }}
                      >
                        {p.brand}
                      </button>
                    ) : (
                      <span style={{ color: '#94a3b8' }}>—</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'left', fontSize: 12 }}>
                    {p.type ? (
                      <span style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: 999,
                        background: '#f1f5f9',
                        color: '#334155',
                        fontWeight: 500,
                        fontSize: 11,
                      }}>{p.type}</span>
                    ) : (
                      <span style={{ color: '#cbd5e1' }}> - </span>
                    )}
                  </td>
                  <td style={{ textAlign: 'left', fontSize: 12 }}>
                    {p.gender === 'male' ? (
                      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, background: '#dbeafe', color: '#1d4ed8', fontWeight: 500, fontSize: 11 }}>Male</span>
                    ) : p.gender === 'female' ? (
                      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, background: '#fce7f3', color: '#be185d', fontWeight: 500, fontSize: 11 }}>Female</span>
                    ) : p.gender === 'unisex' ? (
                      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, background: '#f1f5f9', color: '#475569', fontWeight: 500, fontSize: 11 }}>Unisex</span>
                    ) : (
                      <span style={{ color: '#cbd5e1' }}> - </span>
                    )}
                  </td>
                  {/* Fabric — derived from materials_care for inline display.
                      The full hover panel is still on the measurements icon
                      column further right; this column gives a glanceable
                      composition string. */}
                  <td style={{ fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.materials_care ?? undefined}>
                    {extractFabric(p.materials_care) ?? <span style={{ color: '#cbd5e1' }}>—</span>}
                  </td>
                  <td style={{ textAlign: 'left' }} onClick={(e) => e.stopPropagation()}>
                    {p.url ? (
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`Open ${p.name} on ${p.brand}`}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontWeight: 600,
                          fontSize: 12,
                          color: '#0f172a',
                          textDecoration: 'none',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#3b82f6'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#0f172a'; }}
                      >
                        {p.name}
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.55, flexShrink: 0 }}>
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                      </a>
                    ) : (
                      <div style={{ fontWeight: 600, fontSize: 12 }}>{p.name}</div>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                    {p.id ? (
                      <AdminToggle
                        on={(p as any).is_active !== false}
                        onChange={v => toggleProductActive(p.id!, v)}
                      />
                    ) : (
                      <span style={{ fontSize: 11, color: '#cbd5e1' }}> - </span>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                    {p.id ? (
                      <AdminToggle
                        on={(p as any).is_platform !== false}
                        onChange={v => toggleProductPlatform(p.id!, v)}
                      />
                    ) : (
                      <span style={{ fontSize: 11, color: '#cbd5e1' }}> - </span>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {(p as any).is_elite ? (
                      <span
                        title="Elite - flag the creative in /admin/creative to toggle"
                        style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: 4,
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: '0.5px',
                          textTransform: 'uppercase',
                          background: 'rgba(234,179,8,0.15)',
                          color: '#b88600',
                          border: '1px solid rgba(234,179,8,0.4)',
                        }}
                      >
                        ★ Elite
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, color: '#cbd5e1' }}> - </span>
                    )}
                  </td>
                  <td style={{ fontWeight: 600 }}>{p.price}</td>
                  {!statsExpanded && (
                    <td
                      className="admin-stats-col"
                      style={{ textAlign: 'center', fontSize: 12, cursor: 'pointer' }}
                      onClick={(e) => { e.stopPropagation(); setStatsExpanded(true); }}
                      title="Expand stats"
                    >
                      {/* Tiny inline summary so the cell isn't empty - e.g.
                          "5 looks · 132 imp" - so admins glean signal without
                          expanding when a row has activity. */}
                      {(p.lookCount > 0 || p.impressions > 0)
                        ? `${p.lookCount} look${p.lookCount === 1 ? '' : 's'}${p.impressions > 0 ? ` · ${p.impressions.toLocaleString()} imp` : ''}`
                        : ' - '}
                    </td>
                  )}
                  {statsExpanded && (
                    <>
                      <td className="admin-stats-col" onClick={(e) => { e.stopPropagation(); setStatsExpanded(false); }}
                          style={{ width: 24, cursor: 'pointer' }} />
                      <td className="admin-stats-col">{p.lookCount}</td>
                      <td className="admin-stats-col">{p.creatorCount}</td>
                      <td className="admin-stats-col">{p.impressions > 0 ? p.impressions.toLocaleString() : ' - '}</td>
                      <td className="admin-stats-col">{p.saves}</td>
                      <td className="admin-stats-col">{p.clicks}</td>
                    </>
                  )}
                  <td className="admin-cell-muted" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                    {formatDateAdded(p.created_at)}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {p.source ? (
                      <span style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        fontSize: 11,
                        fontWeight: 600,
                        borderRadius: 12,
                        background: p.source === 'amazon'
                          ? '#fef3c7'
                          : p.source === 'google_shopping'
                          ? '#dbeafe'
                          : '#e9d5ff',
                        color: p.source === 'amazon'
                          ? '#92400e'
                          : p.source === 'google_shopping'
                          ? '#1d4ed8'
                          : '#6b21a8',
                      }}>
                        {SOURCE_LABELS[p.source] || p.source}
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, color: '#94a3b8' }}> - </span>
                    )}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button
                      className="admin-btn admin-btn-secondary"
                      style={{ fontSize: 11, padding: '4px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenTagsRow(tagsOpen ? null : rowKey);
                      }}
                      title={tagsOpen ? 'Close tags' : 'View tags'}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                        <line x1="7" y1="7" x2="7.01" y2="7" />
                      </svg>
                      <span style={{ fontSize: 10, color: '#888' }}>{deriveTags(p.name, p.brand).length}</span>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                        style={{ transform: tagsOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button
                      className="admin-btn admin-btn-secondary"
                      style={{ fontSize: 11, padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenLinksRow(linksOpen ? null : rowKey);
                      }}
                    >
                      View
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                        style={{ transform: linksOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                  </td>
                  <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                    {(() => {
                      const hasFit  = !!(p.size_fit && p.size_fit.trim());
                      const hasCare = !!(p.materials_care && p.materials_care.trim());
                      const hasAny  = hasFit || hasCare;
                      return (
                        <div
                          className={`admin-measurements${hasAny ? ' has-data' : ''}`}
                          aria-label={hasAny ? 'View measurements' : 'No measurements available'}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <rect x="2" y="9" width="20" height="6" rx="1"/>
                            <line x1="6"  y1="9"  x2="6"  y2="12"/>
                            <line x1="10" y1="9"  x2="10" y2="13"/>
                            <line x1="14" y1="9"  x2="14" y2="12"/>
                            <line x1="18" y1="9"  x2="18" y2="13"/>
                          </svg>
                          <div className="admin-measurements-tooltip" role="tooltip">
                            <div className="admin-measurements-row">
                              <div className="admin-measurements-label">Size &amp; fit</div>
                              <div className={`admin-measurements-value${hasFit ? '' : ' is-empty'}`}>
                                {hasFit ? p.size_fit : 'Not available'}
                              </div>
                            </div>
                            <div className="admin-measurements-row">
                              <div className="admin-measurements-label">Materials &amp; care</div>
                              <div className={`admin-measurements-value${hasCare ? '' : ' is-empty'}`}>
                                {hasCare ? p.materials_care : 'Not available'}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </td>
                  <td>
                    {productFilter === 'soft-deleted' ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className="admin-btn admin-btn-secondary"
                          style={{ fontSize: 11, padding: '4px 8px', color: '#0f172a' }}
                          title="Bring this product back to the active list"
                          onClick={async (e) => {
                            e.stopPropagation();
                            const key = `${p.brand}-${p.name}`;
                            setDeletedProductKeys(prev => {
                              const next = new Set(prev);
                              next.delete(key);
                              writeLocalSet(LOCAL_PRODUCTS_KEY, next);
                              return next;
                            });
                            if (supabase) {
                              await supabase.from('admin_hidden_products').delete().eq('brand', p.brand).eq('name', p.name);
                            }
                            showToast('Restored — visible in Show all again.');
                          }}
                        >
                          Restore
                        </button>
                        <button
                          className="admin-btn"
                          style={{
                            fontSize: 11,
                            padding: '4px 8px',
                            color: '#fff',
                            background: '#b91c1c',
                            border: '1px solid #b91c1c',
                          }}
                          title="Permanently delete this product from the database. Cannot be undone."
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!window.confirm(`HARD DELETE "${p.name}" by ${p.brand}? This permanently removes the row from the database and any generated ads. Cannot be undone.`)) return;
                            const key = `${p.brand}-${p.name}`;
                            if (p.id && supabase) {
                              await supabase.from('product_creative').delete().eq('product_id', p.id);
                              const { error } = await supabase.from('products').delete().eq('id', p.id);
                              if (error) { showToast(`Hard delete failed: ${error.message}`); return; }
                              setCrawledProducts(prev => prev.filter(r => r.id !== p.id));
                            }
                            // Also clear the soft-delete record so the row
                            // disappears cleanly from this tab.
                            setDeletedProductKeys(prev => {
                              const next = new Set(prev);
                              next.delete(key);
                              writeLocalSet(LOCAL_PRODUCTS_KEY, next);
                              return next;
                            });
                            if (supabase) {
                              await supabase.from('admin_hidden_products').delete().eq('brand', p.brand).eq('name', p.name);
                            }
                            showToast('Hard deleted.');
                          }}
                        >
                          Hard delete
                        </button>
                      </div>
                    ) : (
                    <button
                      className="admin-btn admin-btn-secondary"
                      style={{ fontSize: 11, padding: '4px 8px', color: '#dc2626' }}
                      title="Soft delete — hides from the feed + this list. Restore from the Soft delete tab. Re-adding the same URL via Add Products resurfaces it automatically."
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (!window.confirm(`Soft delete "${p.name}" by ${p.brand}? You can restore it from the Soft delete tab.`)) return;
                        const key = `${p.brand}-${p.name}`;
                        // SOFT delete only — keeps the row in the DB
                        // so re-adding the same URL resurfaces it
                        // (via the realtime INSERT handler) without
                        // a fresh scrape. Hard delete lives in the
                        // Soft delete tab.
                        setDeletedProductKeys(prev => {
                          const next = new Set(prev);
                          next.add(key);
                          writeLocalSet(LOCAL_PRODUCTS_KEY, next);
                          return next;
                        });
                        if (supabase) {
                          const { error } = await supabase
                            .from('admin_hidden_products')
                            .upsert({ brand: p.brand, name: p.name }, { onConflict: 'brand,name' });
                          if (error) {
                            // Missing table = migration not applied yet. localStorage
                            // is the source of truth in that case, so the hide sticks.
                            const tableMissing =
                              error.code === 'PGRST205' ||
                              /schema cache|does not exist|admin_hidden_products/i.test(error.message);
                            if (!tableMissing) {
                              setDeletedProductKeys(prev => {
                                const next = new Set(prev);
                                next.delete(key);
                                writeLocalSet(LOCAL_PRODUCTS_KEY, next);
                                return next;
                              });
                              showToast(`Hide failed: ${error.message}`);
                              return;
                            }
                          }
                        }
                        showToast(`Soft deleted "${p.name}" — restore from the Soft delete tab.`);
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6" />
                        <path d="M14 11v6" />
                      </svg>
                    </button>
                    )}
                  </td>
                </tr>
                {detailOpen && (
                  <tr className="admin-product-detail-row">
                    <td colSpan={18} style={{ padding: 0, background: '#fafbff' }}>
                      <div style={{ padding: '14px 20px', borderTop: '1px solid #e5e7eb', borderBottom: (tagsOpen || linksOpen) ? undefined : '1px solid #e5e7eb' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 160px) minmax(120px, 160px) 1fr 1fr', gap: 24 }}>
                          {/* Primary preview pinned to the far left so
                              the admin can see the current pick without
                              hunting through the photo grid. Clicking
                              opens the full-size image in a new tab —
                              mirrors the .admin-product-photo behaviour
                              for consistency. */}
                          <div>
                            <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                              Primary
                            </div>
                            {(p as { primary_image_url?: string | null }).primary_image_url ? (
                              <div style={{ position: 'relative' }}>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const url = (p as { primary_image_url?: string | null }).primary_image_url;
                                    if (typeof window !== 'undefined' && url) window.open(url, '_blank', 'noopener,noreferrer');
                                  }}
                                  title="Open primary image full-size"
                                  style={{
                                    width: '100%',
                                    aspectRatio: '3 / 4',
                                    borderRadius: 8,
                                    border: '2px solid #16a34a',
                                    boxShadow: '0 0 0 1px #16a34a, 0 4px 14px rgba(22,163,74,0.18)',
                                    padding: 0,
                                    background: '#fff',
                                    cursor: 'zoom-in',
                                    overflow: 'hidden',
                                    display: 'block',
                                  }}
                                >
                                  <img
                                    src={(p as { primary_image_url?: string | null }).primary_image_url ?? ''}
                                    alt={`${p.brand} ${p.name} primary`}
                                    style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', pointerEvents: 'none' }}
                                  />
                                </button>
                                {/* Polish CTA — only show on un-polished primaries.
                                    The wand kicks off polish-primary-image which
                                    reframes the source into a uniform 3:4 shot. */}
                                {p.id && (() => {
                                  const isPolishing = p.id ? polishingIds.has(p.id) : false;
                                  const polished = (p as { primary_image_polished?: boolean | null }).primary_image_polished === true;
                                  return (
                                    <>
                                      {/* Node-graph icon — visible whether the
                                          primary image has been polished or not.
                                          Opens the polish modal showing the
                                          pre-polish source → nano-banana →
                                          current primary image. */}
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setPrimaryImageGraphProductId(p.id ?? null);
                                        }}
                                        title="View polish node graph"
                                        style={{
                                          position: 'absolute',
                                          top: 8,
                                          left: 8,
                                          width: 28,
                                          height: 28,
                                          borderRadius: 999,
                                          border: '1px solid rgba(255,255,255,0.4)',
                                          background: 'rgba(15,23,42,0.7)',
                                          color: '#fff',
                                          cursor: 'pointer',
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          backdropFilter: 'blur(6px)',
                                        }}
                                      >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                          <circle cx="5" cy="6" r="2.4" />
                                          <circle cx="19" cy="6" r="2.4" />
                                          <circle cx="12" cy="18" r="2.4" />
                                          <line x1="6.5" y1="7.5" x2="11" y2="16" />
                                          <line x1="17.5" y1="7.5" x2="13" y2="16" />
                                        </svg>
                                      </button>
                                      {/* Polish / Re-polish pill in the top-right.
                                          Same button is "Polish" on unpolished
                                          rows and "Re-polish" on polished rows —
                                          callsite is identical, just labelled
                                          differently. */}
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (!isPolishing && p.id) polishPrimaryImage(p.id);
                                        }}
                                        disabled={isPolishing}
                                        title={isPolishing
                                          ? 'Polishing primary image…'
                                          : (polished
                                              ? 'Re-polish — reframe again'
                                              : 'Polish — reframe into uniform 3:4 packshot')}
                                        style={{
                                          position: 'absolute',
                                          top: 8,
                                          right: 8,
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: 6,
                                          padding: '6px 10px',
                                          borderRadius: 999,
                                          border: '1px solid rgba(255,255,255,0.4)',
                                          background: isPolishing
                                            ? 'rgba(124,58,237,0.85)'
                                            : (polished ? 'rgba(15,23,42,0.7)' : '#7c3aed'),
                                          color: '#fff',
                                          fontSize: 10,
                                          fontWeight: 700,
                                          letterSpacing: '0.04em',
                                          textTransform: 'uppercase',
                                          cursor: isPolishing ? 'wait' : 'pointer',
                                          boxShadow: polished ? 'none' : '0 4px 12px rgba(0,0,0,0.25)',
                                          backdropFilter: polished ? 'blur(6px)' : 'none',
                                        }}
                                      >
                                        {isPolishing ? (
                                          <span style={{
                                            width: 11, height: 11,
                                            border: '1.5px solid rgba(255,255,255,0.45)',
                                            borderTopColor: '#fff',
                                            borderRadius: '50%',
                                            animation: 'wallet-spin 0.7s linear infinite',
                                          }} />
                                        ) : (
                                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                            <path d="M5 19l6-6" />
                                            <path d="M12 5l1.5 3 3 1.5-3 1.5L12 14l-1.5-3-3-1.5 3-1.5L12 5z" />
                                          </svg>
                                        )}
                                        <span>{isPolishing ? 'Polishing' : (polished ? 'Re-polish' : 'Polish')}</span>
                                      </button>
                                    </>
                                  );
                                })()}
                              </div>
                            ) : (
                              <div style={{
                                width: '100%',
                                aspectRatio: '3 / 4',
                                borderRadius: 8,
                                border: '1px dashed #cbd5e1',
                                background: '#f8fafc',
                                color: '#94a3b8',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 11,
                                lineHeight: 1.3,
                                textAlign: 'center',
                                padding: 8,
                              }}>
                                No primary picked. Click a photo's star to set one.
                              </div>
                            )}
                          </div>
                          {/* Primary Video column — sits immediately to the
                              right of the Primary Image column so an
                              admin can compare the source still against
                              the generated motion at a glance. Empty
                              rows get a Generate CTA + learned-ETA
                              progress bar; populated rows show the
                              clip with a node-graph icon. */}
                          <div>
                            <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                              Primary Video
                            </div>
                            {(() => {
                              const primaryVideoUrl = (p as { primary_video_url?: string | null }).primary_video_url;
                              const hasPrimaryImage = !!(p as { primary_image_url?: string | null }).primary_image_url;
                              const isGenerating = p.id ? generatingPrimaryVideoIds.has(p.id) : false;
                              if (primaryVideoUrl) {
                                return (
                                  <div style={{ position: 'relative' }}>
                                    <video
                                      src={primaryVideoUrl}
                                      autoPlay
                                      muted
                                      loop
                                      playsInline
                                      preload="metadata"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setPrimaryVideoModalProductId(p.id ?? null);
                                      }}
                                      title="Click to enlarge"
                                      style={{
                                        width: '100%',
                                        aspectRatio: '3 / 4',
                                        borderRadius: 8,
                                        border: '2px solid #7c3aed',
                                        boxShadow: '0 0 0 1px #7c3aed, 0 4px 14px rgba(124,58,237,0.18)',
                                        objectFit: 'contain',
                                        display: 'block',
                                        background: '#0f172a',
                                        cursor: 'zoom-in',
                                      }}
                                    />
                                    {/* Node-graph button — opens a modal that
                                        renders the generation pipeline as a
                                        DAG (input image → model → video). */}
                                    {p.id && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setPrimaryVideoGraphProductId(p.id ?? null);
                                        }}
                                        title="View generation node graph"
                                        style={{
                                          position: 'absolute',
                                          top: 8,
                                          left: 8,
                                          width: 28,
                                          height: 28,
                                          borderRadius: 999,
                                          border: '1px solid rgba(255,255,255,0.4)',
                                          background: 'rgba(15,23,42,0.7)',
                                          color: '#fff',
                                          cursor: 'pointer',
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          backdropFilter: 'blur(6px)',
                                        }}
                                      >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                          <circle cx="5" cy="6" r="2.4" />
                                          <circle cx="19" cy="6" r="2.4" />
                                          <circle cx="12" cy="18" r="2.4" />
                                          <line x1="6.5" y1="7.5" x2="11" y2="16" />
                                          <line x1="17.5" y1="7.5" x2="13" y2="16" />
                                        </svg>
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (!isGenerating && p.id) generatePrimaryVideo(p.id);
                                      }}
                                      disabled={isGenerating}
                                      title={isGenerating ? 'Regenerating primary video…' : 'Regenerate primary video'}
                                      style={{
                                        position: 'absolute',
                                        top: 8,
                                        right: 8,
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 6,
                                        padding: '5px 9px',
                                        borderRadius: 999,
                                        border: '1px solid rgba(255,255,255,0.4)',
                                        background: isGenerating ? 'rgba(124,58,237,0.85)' : 'rgba(15,23,42,0.7)',
                                        color: '#fff',
                                        fontSize: 10,
                                        fontWeight: 700,
                                        letterSpacing: '0.04em',
                                        textTransform: 'uppercase',
                                        cursor: isGenerating ? 'wait' : 'pointer',
                                        backdropFilter: 'blur(6px)',
                                      }}
                                    >
                                      {isGenerating ? 'Generating' : 'Regen'}
                                    </button>
                                  </div>
                                );
                              }
                              // Empty card. While generating we swap the
                              // text + button for a progress bar that
                              // fills against the learned ETA — bar
                              // stays at 95% if the real run runs long.
                              const startedAt = p.id ? primaryVideoStartedAt.get(p.id) : undefined;
                              const elapsedMs = startedAt ? Math.max(0, Date.now() - startedAt) : 0;
                              const eta = avgPrimaryVideoDurationMs;
                              const pct = isGenerating && eta > 0
                                ? Math.min(95, (elapsedMs / eta) * 100)
                                : 0;
                              return (
                                <div style={{
                                  position: 'relative',
                                  width: '100%',
                                  aspectRatio: '3 / 4',
                                  borderRadius: 8,
                                  border: '1px dashed #cbd5e1',
                                  background: '#f8fafc',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: 10,
                                  padding: 12,
                                }}>
                                  {isGenerating ? (
                                    <>
                                      <div style={{ fontSize: 10, color: '#7c3aed', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                                        Generating
                                      </div>
                                      <div style={{
                                        width: '88%',
                                        height: 6,
                                        background: '#e2e8f0',
                                        borderRadius: 999,
                                        overflow: 'hidden',
                                        position: 'relative',
                                      }}>
                                        <div style={{
                                          width: `${pct}%`,
                                          height: '100%',
                                          background: 'linear-gradient(90deg, #7c3aed, #a78bfa)',
                                          transition: 'width 240ms linear',
                                        }} />
                                      </div>
                                      <div style={{
                                        fontSize: 10,
                                        color: '#64748b',
                                        fontVariantNumeric: 'tabular-nums',
                                      }}>
                                        {`${Math.round(elapsedMs / 1000)}s / ~${Math.round(eta / 1000)}s`}
                                      </div>
                                    </>
                                  ) : (p as { primary_video_status?: string | null }).primary_video_status === 'pending' ? (
                                    <>
                                      {/* Async-submitted to fal queue; webhook
                                          will write primary_video_url here when
                                          Seedance finishes (~60-120s). The row
                                          stays in this state until then. */}
                                      <div style={{ fontSize: 10, color: '#7c3aed', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                                        Rendering · background
                                      </div>
                                      <div style={{
                                        width: '88%', height: 6,
                                        background: '#e2e8f0',
                                        borderRadius: 999,
                                        overflow: 'hidden',
                                        position: 'relative',
                                      }}>
                                        <div style={{
                                          position: 'absolute', inset: 0,
                                          background: 'linear-gradient(90deg, transparent, #a78bfa, transparent)',
                                          animation: 'admin-primary-video-shimmer 1.6s linear infinite',
                                        }} />
                                      </div>
                                      <style>{`@keyframes admin-primary-video-shimmer {
                                        0% { transform: translateX(-100%); }
                                        100% { transform: translateX(100%); }
                                      }`}</style>
                                      <div style={{ fontSize: 10, color: '#64748b', textAlign: 'center', lineHeight: 1.35 }}>
                                        Submitted to Seedance.<br />Webhook updates this tile when ready.
                                      </div>
                                    </>
                                  ) : (p as { primary_video_status?: string | null }).primary_video_status === 'failed' ? (
                                    <>
                                      <div style={{ fontSize: 11, color: '#dc2626', textAlign: 'center', lineHeight: 1.3, fontWeight: 600 }}>
                                        Last generation failed
                                      </div>
                                      {hasPrimaryImage && p.id && (
                                        <button
                                          type="button"
                                          onClick={(e) => { e.stopPropagation(); if (p.id) generatePrimaryVideo(p.id); }}
                                          style={{
                                            display: 'inline-flex', alignItems: 'center', gap: 6,
                                            padding: '7px 14px', borderRadius: 999, border: 'none',
                                            background: '#7c3aed', color: '#fff', fontSize: 11,
                                            fontWeight: 700, cursor: 'pointer',
                                          }}
                                        >
                                          Retry
                                        </button>
                                      )}
                                    </>
                                  ) : (
                                    <>
                                      <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', lineHeight: 1.3 }}>
                                        {hasPrimaryImage
                                          ? 'No primary video yet.'
                                          : 'Pick a primary image first.'}
                                      </div>
                                      {hasPrimaryImage && p.id && (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (p.id) generatePrimaryVideo(p.id);
                                          }}
                                          title="Generate primary video from primary image"
                                          style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 6,
                                            padding: '7px 14px',
                                            borderRadius: 999,
                                            border: 'none',
                                            background: '#7c3aed',
                                            color: '#fff',
                                            fontSize: 11,
                                            fontWeight: 700,
                                            letterSpacing: '0.04em',
                                            textTransform: 'uppercase',
                                            cursor: 'pointer',
                                            boxShadow: '0 4px 12px rgba(124,58,237,0.25)',
                                          }}
                                        >
                                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                            <polygon points="6 4 20 12 6 20 6 4" />
                                          </svg>
                                          <span>Generate</span>
                                        </button>
                                      )}
                                    </>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                          <div>
                            <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                              Creatives <span style={{ color: '#7c3aed', fontWeight: 700 }}>{p.video_urls.length}</span>
                            </div>
                            {p.video_urls.length === 0 ? (
                              <div style={{ fontSize: 12, color: '#999', fontStyle: 'italic' }}>No videos generated yet.</div>
                            ) : (
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 8 }}>
                                {p.video_urls.map((v, vi) => {
                                  const meta = adMetaByUrl.get(v);
                                  const modelLabel = meta?.model
                                    ? (VIDEO_MODELS.find(m => m.value === meta.model)?.label ?? meta.model)
                                    : null;
                                  const hoverTitle = meta?.prompt
                                    ? `${modelLabel ?? 'Unknown model'}\n\nPrompt:\n${meta.prompt}`
                                    : (modelLabel ?? 'Model unknown');
                                  return (
                                    <div
                                      key={vi}
                                      style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
                                      // HTML5 drag-and-drop wires up the per-tile reorder.
                                      // dataTransfer carries the source product id + index;
                                      // drops on a tile from the same product land at that
                                      // tile's index. Drops across products are rejected.
                                      draggable={!!p.id && !!meta?.id}
                                      onDragStart={(e) => {
                                        if (!p.id) return;
                                        e.dataTransfer.setData('text/plain', JSON.stringify({ pid: p.id, from: vi }));
                                        e.dataTransfer.effectAllowed = 'move';
                                      }}
                                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                                      onDrop={(e) => {
                                        e.preventDefault();
                                        try {
                                          const payload = JSON.parse(e.dataTransfer.getData('text/plain') || '{}') as { pid?: string; from?: number };
                                          if (!p.id || payload.pid !== p.id || typeof payload.from !== 'number') return;
                                          reorderCreatives(p.id, payload.from, vi);
                                        } catch { /* malformed payload - ignore */ }
                                      }}
                                    >
                                      <div
                                        style={{ position: 'relative', aspectRatio: '9 / 16', borderRadius: 6, overflow: 'hidden', background: '#000', cursor: meta?.id ? 'grab' : 'help' }}
                                        title={hoverTitle}
                                        onMouseEnter={(ev) => {
                                          // Hover preview shows the product photo (not
                                          // the video itself) - admins can flash between
                                          // the AI render and the canonical product
                                          // image to spot styling drift at a glance.
                                          const photo = rowImages[0];
                                          if (!photo) return;
                                          const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
                                          setHoverPreview({ url: photo, x: r.right + 8, y: r.top });
                                        }}
                                        onMouseLeave={() => setHoverPreview(null)}
                                      >
                                        <video src={v} autoPlay muted loop playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        {/* Node icon - hover shows the
                                            graph that produced this clip:
                                            reference photos → model →
                                            video. Stops propagation on
                                            mouseenter so it overrides
                                            the parent's image-flash
                                            preview while the user is
                                            inspecting the graph. */}
                                        <button
                                          type="button"
                                          aria-label="Show generation graph"
                                          onMouseEnter={(ev) => {
                                            ev.stopPropagation();
                                            setHoverPreview(null);
                                            const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
                                            setNodeHover({
                                              x: r.right + 8,
                                              y: r.top,
                                              photos: rowImages,
                                              productName: p.name,
                                              meta: meta ? {
                                                model: meta.model,
                                                prompt: meta.prompt,
                                                prompt_extra: meta.prompt_extra,
                                                style: meta.style,
                                                duration_seconds: meta.duration_seconds,
                                                aspect_ratio: meta.aspect_ratio,
                                              } : null,
                                            });
                                          }}
                                          onMouseLeave={() => setNodeHover(null)}
                                          onClick={(e) => e.stopPropagation()}
                                          style={{
                                            position: 'absolute', top: 4, left: 4,
                                            width: 22, height: 22, borderRadius: 11,
                                            background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.25)',
                                            color: '#fff', display: 'inline-flex',
                                            alignItems: 'center', justifyContent: 'center',
                                            padding: 0, cursor: 'help', backdropFilter: 'blur(4px)',
                                          }}
                                        >
                                          {/* Three-node graph glyph */}
                                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                            <circle cx="5" cy="6" r="2" />
                                            <circle cx="19" cy="6" r="2" />
                                            <circle cx="12" cy="19" r="2" />
                                            <line x1="6.7" y1="7.4" x2="11" y2="17.5" />
                                            <line x1="17.3" y1="7.4" x2="13" y2="17.5" />
                                            <line x1="7" y1="6" x2="17" y2="6" />
                                          </svg>
                                        </button>
                                        {meta?.id && (
                                          <button
                                            type="button"
                                            aria-label="Delete this creative"
                                            title="Delete this creative"
                                            onClick={(e) => { e.stopPropagation(); deleteCreative(meta.id, v, p.id); }}
                                            style={{
                                              position: 'absolute', top: 4, right: 4,
                                              width: 22, height: 22, borderRadius: 11,
                                              background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.25)',
                                              color: '#fff', display: 'inline-flex',
                                              alignItems: 'center', justifyContent: 'center',
                                              padding: 0, cursor: 'pointer', backdropFilter: 'blur(4px)',
                                            }}
                                          >
                                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                              <line x1="18" y1="6" x2="6" y2="18" />
                                              <line x1="6" y1="6" x2="18" y2="18" />
                                            </svg>
                                          </button>
                                        )}
                                      </div>
                                      <div
                                        title={hoverTitle}
                                        style={{
                                          fontSize: 9, fontWeight: 600, color: '#475569',
                                          textTransform: 'uppercase', letterSpacing: '0.3px',
                                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                          cursor: 'help',
                                        }}
                                      >
                                        {modelLabel ?? ' - '}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                            {p.id && (
                              <div style={{ marginTop: 12 }}>
                                <button
                                  className="admin-btn admin-btn-primary"
                                  style={{ fontSize: 11, padding: '5px 12px' }}
                                  onClick={(e) => { e.stopPropagation(); setGeneratePicker({ productId: p.id!, productName: p.name }); }}
                                >
                                  + Generate
                                </button>
                              </div>
                            )}
                          </div>
                          <div>
                            <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                              Photos <span style={{ color: '#059669', fontWeight: 700 }}>{rowImages.length}</span>
                            </div>
                            {rowImages.length === 0 ? (
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(70px, 1fr))', gap: 8 }}>
                                {p.id && <PhotoDropzone busy={uploadingPhotosFor === p.id} onFiles={(files) => uploadProductPhotos(p.id!, files)} />}
                              </div>
                            ) : (
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(70px, 1fr))', gap: 8 }}>
                                {p.id && <PhotoDropzone busy={uploadingPhotosFor === p.id} onFiles={(files) => uploadProductPhotos(p.id!, files)} />}
                                {rowImages.map((src, ii) => {
                                  const isPrimary = (p as { primary_image_url?: string | null }).primary_image_url === src;
                                  const setAsPrimary = async () => {
                                    if (!supabase || !p.id || isPrimary) return;
                                    // Optimistic: flip locally so the
                                    // green border + Primary column
                                    // update instantly.
                                    setCrawledProducts(prev => prev.map(pp =>
                                      pp.id === p.id ? { ...pp, primary_image_url: src } as CrawledProduct : pp
                                    ));
                                    const { error } = await supabase
                                      .from('products')
                                      .update({
                                        primary_image_url: src,
                                        primary_image_index: ii,
                                        primary_image_score: null,
                                        primary_image_picked_at: new Date().toISOString(),
                                        primary_image_picked_by: 'admin',
                                        // Clear the pre-polish anchor when the admin
                                        // picks a new primary. polish-primary-image
                                        // re-polishes from pre_polish_url when set,
                                        // so a stale value would otherwise override
                                        // the freshly-picked image on the next polish.
                                        primary_image_pre_polish_url: null,
                                        primary_image_polished: false,
                                      })
                                      .eq('id', p.id);
                                    if (error) showToast(`Failed: ${error.message}`);
                                    else        showToast('Primary image updated');
                                  };
                                  return (
                                    <div
                                      key={ii}
                                      className="admin-product-photo"
                                      style={{ position: 'relative', cursor: 'zoom-in' }}
                                      title="Click to open full size · star icon to set as primary"
                                      onMouseEnter={(ev) => {
                                        const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
                                        setHoverPreview({ url: src, x: r.right + 8, y: r.top });
                                      }}
                                      onMouseLeave={() => setHoverPreview(null)}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        // Open the full-resolution image in a new tab. Tile
                                        // primary-pick now lives on the star icon only — the
                                        // image itself is a "view at full size" affordance.
                                        if (typeof window !== 'undefined') {
                                          window.open(src, '_blank', 'noopener,noreferrer');
                                        }
                                      }}
                                    >
                                      <img
                                        src={src}
                                        alt={p.name}
                                        style={{
                                          width: '100%',
                                          aspectRatio: '1 / 1',
                                          borderRadius: 6,
                                          objectFit: 'cover',
                                          border: isPrimary ? '2px solid #16a34a' : '1px solid #e5e7eb',
                                          boxShadow: isPrimary ? '0 0 0 1px #16a34a' : undefined,
                                          display: 'block',
                                          pointerEvents: 'none',
                                        }}
                                        onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
                                      />
                                      <button
                                        type="button"
                                        className="admin-product-photo-primary-btn"
                                        data-active={isPrimary ? 'true' : 'false'}
                                        title={isPrimary ? 'Current primary image' : 'Set as primary image'}
                                        aria-pressed={isPrimary}
                                        onClick={(e) => { e.stopPropagation(); void setAsPrimary(); }}
                                      >
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill={isPrimary ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                                        </svg>
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                {tagsOpen && (
                  <tr className="admin-product-tags-row">
                    <td colSpan={18} style={{ padding: 0, background: '#fafbff' }}>
                      <div style={{ padding: '12px 20px', borderTop: '1px solid #e5e7eb', borderBottom: linksOpen ? undefined : '1px solid #e5e7eb' }}>
                        <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                          Tags
                        </div>
                        {rowTags.length === 0 ? (
                          <div style={{ fontSize: 12, color: '#999', fontStyle: 'italic' }}>No tags derived yet</div>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {rowTags.map(t => (
                              <span
                                key={t}
                                style={{ padding: '4px 10px', borderRadius: 999, background: '#f1f5f9', color: '#0f172a', fontSize: 12, fontWeight: 500, border: '1px solid #e2e8f0' }}
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                {linksOpen && (
                  <tr className="admin-product-links-row">
                    <td colSpan={18} style={{ padding: 0, background: '#fafbff' }}>
                      <div style={{ padding: '14px 20px', borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                          <div>
                            <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                              Product URL
                            </div>
                            {p.url ? (() => {
                              // Shorten the URL: show just the host so the row
                              // stays tidy. Hover or click still takes you to
                              // the full link.
                              let host = '';
                              try { host = new URL(p.url).hostname.replace(/^www\./, ''); }
                              catch { host = p.url; }
                              return (
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                                  <a
                                    href={p.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title={p.url}
                                    style={{
                                      display: 'inline-flex', alignItems: 'center', gap: 6,
                                      fontSize: 12, color: '#0f172a', textDecoration: 'none',
                                      padding: '6px 10px', background: '#eef2ff', borderRadius: 6,
                                      border: '1px solid #c7d2fe', fontWeight: 600,
                                    }}
                                  >
                                    <span>{host}</span>
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}>
                                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                      <polyline points="15 3 21 3 21 9" />
                                      <line x1="10" y1="14" x2="21" y2="3" />
                                    </svg>
                                  </a>
                                  <button
                                    className="admin-btn admin-btn-secondary"
                                    style={{ fontSize: 11, padding: '6px 10px' }}
                                    onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(p.url!); showToast('Copied URL to clipboard'); }}
                                  >
                                    Copy
                                  </button>

                                  <button
                                    className="admin-btn admin-btn-primary"
                                    style={{ fontSize: 11, padding: '6px 10px' }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      // Kick a Google search scoped to the product - the admin can
                                      // then pick a direct retailer URL or an affiliate-friendly one.
                                      const q = encodeURIComponent(`${p.brand} ${p.name}`.trim());
                                      window.open(`https://www.google.com/search?q=${q}&tbm=shop`, '_blank', 'noopener');
                                    }}
                                  >
                                    Locate more URLs ↗
                                  </button>
                                </div>
                              );
                            })() : (
                              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                <div style={{ fontSize: 12, color: '#999', fontStyle: 'italic' }}>No URL recorded</div>
                                <button
                                  className="admin-btn admin-btn-primary"
                                  style={{ fontSize: 11, padding: '6px 10px' }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const q = encodeURIComponent(`${p.brand} ${p.name}`.trim());
                                    window.open(`https://www.google.com/search?q=${q}&tbm=shop`, '_blank', 'noopener');
                                  }}
                                >
                                  Locate more URLs ↗
                                </button>
                              </div>
                            )}
                          </div>
                          <div>
                            <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                              Affiliate providers
                            </div>
                            {affiliates.length === 0 && (
                              <div style={{ fontSize: 11, color: '#94a3b8', padding: '6px 10px', border: '1px dashed #e5e7eb', borderRadius: 6 }}>
                                No URL on file — add a destination link to enable monetization.
                              </div>
                            )}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {affiliates.map((a, ai) => {
                                const isMonetized = a.connected || (a.outboundUrl && a.rateNumeric > 0);
                                return (
                                <div
                                  key={`${a.network}-${ai}`}
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    padding: '6px 10px',
                                    background: isMonetized ? '#f0f9f3' : '#fff',
                                    border: `1px solid ${isMonetized ? '#c6efd6' : '#eee'}`,
                                    borderRadius: 6,
                                  }}
                                >
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                      <span style={{ fontSize: 12, fontWeight: 600, color: '#111' }}>{a.network}</span>
                                      {a.connected && (
                                        <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: '#16a34a', color: '#fff', fontWeight: 700, letterSpacing: '0.4px' }}>
                                          CONNECTED
                                        </span>
                                      )}
                                    </div>
                                    {a.merchantName && (
                                      <div style={{ fontSize: 10, color: '#475569', marginTop: 1, fontWeight: 500 }}>{a.merchantName}</div>
                                    )}
                                    {a.note && (
                                      <div style={{ fontSize: 10, color: '#888', marginTop: 1 }}>{a.note}</div>
                                    )}
                                  </div>
                                  <div style={{ fontSize: 12, fontWeight: 700, color: isMonetized ? '#16a34a' : '#475569' }}>
                                    {a.rate}
                                  </div>
                                  <a
                                    href={a.outboundUrl ?? a.signupUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="admin-btn admin-btn-secondary"
                                    style={{ fontSize: 10, padding: '3px 8px', textDecoration: 'none' }}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {a.outboundUrl ? 'Open ↗' : 'Sign up ↗'}
                                  </a>
                                </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
                );
              })}
              {hasMore && (
                <tr ref={sentinelRef}>
                  <td colSpan={20} style={{ padding: '16px 12px' }}>
                    <div
                      role="status"
                      aria-live="polite"
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: '#94a3b8', fontSize: 12 }}
                    >
                      <style>{`@keyframes admin-products-spin { to { transform: rotate(360deg); } }`}</style>
                      <span
                        aria-hidden
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: '50%',
                          border: '2px solid #e5e7eb',
                          borderTopColor: '#0f172a',
                          animation: 'admin-products-spin 0.9s linear infinite',
                        }}
                      />
                      Loading more products… ({visibleCount} of {productTable.sortedData.length})
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </>
      )}

      {activeTab === 'musics' && (
        <div className="admin-empty">No music data yet</div>
      )}

      {activeTab === 'places' && (
        <div className="admin-empty">No places data yet</div>
      )}

      {/* Create Look Modal */}
      {showCreateLook && (
        <div className="admin-modal-overlay" onClick={() => setShowCreateLook(false)}>
          <div className="admin-modal admin-modal-wide" onClick={e => e.stopPropagation()} style={{ maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
            <div className="admin-modal-header">
              <div>
                <h3>Create Look</h3>
                <p style={{ fontSize: 12, color: '#888', margin: '4px 0 0' }}>
                  Select products and configure your new look video
                </p>
              </div>
              <button className="admin-modal-close" onClick={() => setShowCreateLook(false)}>&times;</button>
            </div>

            <div className="admin-modal-body" style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Options row: Creator, Location, Style */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div className="admin-form-group" style={{ marginBottom: 0 }}>
                  <label>Creator (optional)</label>
                  <select
                    value={createLookCreator}
                    onChange={e => setCreateLookCreator(e.target.value)}
                    style={{
                      width: '100%', padding: '8px 10px', border: '1px solid #ddd',
                      borderRadius: 6, fontSize: 13, outline: 'none', background: '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    <option value="">None</option>
                    {creatorOptions.map(c => (
                      <option key={c.key} value={c.key}>{c.displayName}</option>
                    ))}
                  </select>
                </div>

                <div className="admin-form-group" style={{ marginBottom: 0 }}>
                  <label>Location (optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. New York, Paris"
                    value={createLookLocation}
                    onChange={e => setCreateLookLocation(e.target.value)}
                  />
                </div>

                <div className="admin-form-group" style={{ marginBottom: 0 }}>
                  <label>Style</label>
                  <select
                    value={createLookStyle}
                    onChange={e => setCreateLookStyle(e.target.value)}
                    style={{
                      width: '100%', padding: '8px 10px', border: '1px solid #ddd',
                      borderRadius: 6, fontSize: 13, outline: 'none', background: '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    <option value="Street Style">Street Style</option>
                    <option value="Editorial">Editorial</option>
                    <option value="Lifestyle">Lifestyle</option>
                    <option value="Studio">Studio</option>
                  </select>
                </div>
              </div>

              {/* Selected creator preview */}
              {createLookCreator && (() => {
                const c = creators[createLookCreator];
                return c ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#f8f8f8', borderRadius: 8 }}>
                    <img src={c.avatar} alt="" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{c.displayName}</div>
                      <div style={{ fontSize: 11, color: '#888' }}>@{createLookCreator}</div>
                    </div>
                  </div>
                ) : null;
              })()}

              {/* Product search */}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 5 }}>
                  Products
                </label>
                <input
                  type="text"
                  placeholder="Search products by name or brand..."
                  value={createLookProductSearch}
                  onChange={e => setCreateLookProductSearch(e.target.value)}
                  style={{
                    width: '100%', padding: '8px 10px', border: '1px solid #ddd',
                    borderRadius: 6, fontSize: 13, outline: 'none', boxSizing: 'border-box',
                  }}
                />
                {createLookSelectedProducts.size > 0 && (
                  <div style={{ fontSize: 12, color: '#888', marginTop: 6 }}>
                    {createLookSelectedProducts.size} product{createLookSelectedProducts.size > 1 ? 's' : ''} selected
                  </div>
                )}
              </div>

              {/* Product list */}
              <div style={{ flex: 1, overflow: 'auto', minHeight: 0, maxHeight: 320 }}>
                {filteredCreateLookProducts.length === 0 ? (
                  <div style={{ padding: '40px 0', textAlign: 'center', color: '#999', fontSize: 13 }}>
                    {crawledProducts.length === 0 ? 'No products available.' : 'No products match your search.'}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {filteredCreateLookProducts.map(p => {
                      const isSelected = createLookSelectedProducts.has(p.id);
                      return (
                        <div
                          key={p.id}
                          onClick={() => toggleCreateLookProduct(p.id)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px',
                            borderRadius: 8, cursor: 'pointer',
                            background: isSelected ? '#f0f7ff' : 'transparent',
                            border: `1px solid ${isSelected ? '#3b82f6' : 'transparent'}`,
                            transition: 'all 0.15s',
                          }}
                        >
                          {/* Checkbox */}
                          <div style={{
                            width: 20, height: 20, borderRadius: 4,
                            border: `2px solid ${isSelected ? '#3b82f6' : '#ccc'}`,
                            background: isSelected ? '#3b82f6' : '#fff',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0, transition: 'all 0.15s',
                          }}>
                            {isSelected && (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )}
                          </div>

                          {/* Product image */}
                          {p.image_url ? (
                            <img
                              src={p.image_url}
                              alt=""
                              style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }}
                            />
                          ) : (
                            <div style={{
                              width: 40, height: 40, borderRadius: 6, background: '#f0f0f0',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 10, color: '#999', flexShrink: 0,
                            }}>
                              No img
                            </div>
                          )}

                          {/* Product info */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {p.name || 'Unnamed product'}
                            </div>
                            <div style={{ fontSize: 11, color: '#888' }}>
                              {p.brand || 'Unknown brand'}{p.price ? ` · ${p.price}` : ''}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="admin-modal-footer">
              <button className="admin-btn admin-btn-secondary" onClick={() => setShowCreateLook(false)}>
                Cancel
              </button>
              <button
                className="admin-btn admin-btn-primary"
                disabled={createLookSelectedProducts.size === 0 || creatingLook}
                onClick={handleGenerateLook}
              >
                {creatingLook
                  ? 'Generating…'
                  : `Generate Look (${createLookSelectedProducts.size} product${createLookSelectedProducts.size !== 1 ? 's' : ''})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {primaryImageGraphProductId && (() => {
        const product = crawledProducts.find(c => c.id === primaryImageGraphProductId);
        if (!product) return null;
        const prePolishUrl = (product as { primary_image_pre_polish_url?: string | null }).primary_image_pre_polish_url || null;
        const currentUrl   = (product as { primary_image_url?: string | null }).primary_image_url || null;
        const wasPolished  = (product as { primary_image_polished?: boolean | null }).primary_image_polished === true;
        return (
          <div className="admin-modal-overlay" onClick={() => setPrimaryImageGraphProductId(null)}>
            <div className="admin-modal" style={{ width: 880, maxWidth: '94vw', padding: 28 }} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
                  Polish graph — <span style={{ color: '#7c3aed' }}>{product.brand} {product.name}</span>
                </h2>
                <button type="button" onClick={() => setPrimaryImageGraphProductId(null)} className="admin-btn admin-btn-secondary" style={{ padding: '6px 12px', fontSize: 12 }}>Close</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr auto 1fr', gap: 12, alignItems: 'center' }}>
                <button type="button" onClick={() => prePolishUrl && window.open(prePolishUrl, '_blank', 'noopener,noreferrer')} disabled={!prePolishUrl}
                  style={{ border: '1px solid #cbd5e1', borderRadius: 12, padding: 12, background: '#fff', cursor: prePolishUrl ? 'zoom-in' : 'default', display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left' }}>
                  <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
                    Input · {wasPolished ? 'Pre-polish image' : 'Current image (unpolished)'}
                  </div>
                  {(prePolishUrl || currentUrl) ? (
                    <img src={(prePolishUrl || currentUrl) ?? ''} alt="Pre-polish source" style={{ width: '100%', aspectRatio: '3 / 4', objectFit: 'contain', background: '#f1f5f9', borderRadius: 8 }} />
                  ) : (
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>(no source image)</div>
                  )}
                </button>
                <div style={{ fontSize: 28, color: '#cbd5e1', textAlign: 'center', lineHeight: 1 }}>→</div>
                <div style={{ border: '1px solid #ddd6fe', borderRadius: 12, padding: 12, background: '#faf5ff', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 10, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
                    Model · Polish (Image → Image)
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                    gemini-2.5-flash-image (nano-banana)
                  </div>
                  <div style={{ fontSize: 11, color: '#475569', lineHeight: 1.45, padding: 8, background: '#fff', borderRadius: 6, border: '1px solid #ede9fe' }}>
                    Reframe this product image into a standardized 3:4 (portrait) e-commerce shot. Keep the background and product details exactly as-is; centre the product with ~15% padding on all four sides.
                  </div>
                  <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#64748b' }}>
                    <span>output: 3:4</span>
                    <span>preserves: background</span>
                  </div>
                </div>
                <div style={{ fontSize: 28, color: '#cbd5e1', textAlign: 'center', lineHeight: 1 }}>→</div>
                <button type="button" onClick={() => currentUrl && window.open(currentUrl, '_blank', 'noopener,noreferrer')} disabled={!currentUrl}
                  style={{ border: '1px solid #cbd5e1', borderRadius: 12, padding: 12, background: '#fff', cursor: currentUrl ? 'zoom-in' : 'default', display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left' }}>
                  <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
                    Output · {wasPolished ? 'Polished image' : 'Awaiting polish'}
                  </div>
                  {wasPolished && currentUrl ? (
                    <img src={currentUrl} alt="Polished" style={{ width: '100%', aspectRatio: '3 / 4', objectFit: 'contain', background: '#f1f5f9', borderRadius: 8 }} />
                  ) : (
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>(no polished image yet)</div>
                  )}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {primaryVideoModalProductId && (() => {
        const product = crawledProducts.find(c => c.id === primaryVideoModalProductId);
        const videoUrl = (product as { primary_video_url?: string | null } | undefined)?.primary_video_url || null;
        if (!product || !videoUrl) return null;
        return (
          <div className="admin-modal-overlay" onClick={() => setPrimaryVideoModalProductId(null)}>
            <div className="admin-modal" style={{ padding: 0, background: '#0f172a', maxWidth: '92vw', maxHeight: '92vh', borderRadius: 16, overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
              <video src={videoUrl} autoPlay controls loop playsInline style={{ display: 'block', maxWidth: '92vw', maxHeight: '92vh', objectFit: 'contain', background: '#0f172a' }} />
            </div>
          </div>
        );
      })()}

      {primaryVideoGraphProductId && (() => {
        const product = crawledProducts.find(c => c.id === primaryVideoGraphProductId);
        if (!product) return null;
        // Three-node DAG: source image → seedance i2v model → output
        // video. Each node is clickable; image/video open in a new
        // tab, the model node copies the slug. Edges are pure CSS
        // arrows so we don't pull in a graph library for one screen.
        const sourceUrl = (product as { primary_video_source_image_url?: string | null }).primary_video_source_image_url
          || (product as { primary_image_url?: string | null }).primary_image_url
          || null;
        const videoUrl = (product as { primary_video_url?: string | null }).primary_video_url || null;
        return (
          <div
            className="admin-modal-overlay"
            onClick={() => setPrimaryVideoGraphProductId(null)}
          >
            <div
              className="admin-modal"
              style={{ width: 880, maxWidth: '94vw', padding: 28 }}
              onClick={e => e.stopPropagation()}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
                  Generation graph — <span style={{ color: '#7c3aed' }}>{product.brand} {product.name}</span>
                </h2>
                <button
                  type="button"
                  onClick={() => setPrimaryVideoGraphProductId(null)}
                  className="admin-btn admin-btn-secondary"
                  style={{ padding: '6px 12px', fontSize: 12 }}
                >
                  Close
                </button>
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto 1fr auto 1fr',
                gap: 12,
                alignItems: 'center',
              }}>
                {/* Input node */}
                <button
                  type="button"
                  onClick={() => sourceUrl && window.open(sourceUrl, '_blank', 'noopener,noreferrer')}
                  disabled={!sourceUrl}
                  style={{
                    border: '1px solid #cbd5e1', borderRadius: 12, padding: 12,
                    background: '#fff', cursor: sourceUrl ? 'zoom-in' : 'default',
                    display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left',
                  }}
                >
                  <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
                    Input · Primary Image
                  </div>
                  {sourceUrl ? (
                    <img
                      src={sourceUrl}
                      alt="Source"
                      style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'contain', background: '#f1f5f9', borderRadius: 8 }}
                    />
                  ) : (
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>(no source image)</div>
                  )}
                </button>
                {/* arrow */}
                <div style={{ fontSize: 28, color: '#cbd5e1', textAlign: 'center', lineHeight: 1 }}>→</div>
                {/* Model node */}
                <div style={{
                  border: '1px solid #ddd6fe', borderRadius: 12, padding: 12,
                  background: '#faf5ff', display: 'flex', flexDirection: 'column', gap: 8,
                }}>
                  <div style={{ fontSize: 10, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
                    Model · Image → Video
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                    bytedance/seedance-2.0/image-to-video
                  </div>
                  <div style={{ fontSize: 11, color: '#475569', lineHeight: 1.45, padding: 8, background: '#fff', borderRadius: 6, border: '1px solid #ede9fe' }}>
                    Use this exact image as the first frame. Static shot, show subtle cinematic motion of the product. If a person is in frame, keep their mouth fully closed — they must not speak, mouth words, or move their lips. Portrait composition.
                  </div>
                  <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#64748b' }}>
                    <span>aspect: 3:4</span>
                    <span>res: 720p</span>
                    <span>dur: 5s</span>
                    <span>audio: off</span>
                  </div>
                </div>
                {/* arrow */}
                <div style={{ fontSize: 28, color: '#cbd5e1', textAlign: 'center', lineHeight: 1 }}>→</div>
                {/* Output node */}
                <button
                  type="button"
                  onClick={() => videoUrl && window.open(videoUrl, '_blank', 'noopener,noreferrer')}
                  disabled={!videoUrl}
                  style={{
                    border: '1px solid #cbd5e1', borderRadius: 12, padding: 12,
                    background: '#fff', cursor: videoUrl ? 'zoom-in' : 'default',
                    display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left',
                  }}
                >
                  <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
                    Output · Primary Video
                  </div>
                  {videoUrl ? (
                    <video
                      src={videoUrl}
                      autoPlay muted loop playsInline preload="metadata"
                      style={{ width: '100%', aspectRatio: '3 / 4', objectFit: 'contain', background: '#0f172a', borderRadius: 8 }}
                    />
                  ) : (
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>(no video yet)</div>
                  )}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {generatePicker && (
        <div
          className="admin-modal-overlay"
          onClick={() => setGeneratePicker(null)}
        >
          <div
            className="admin-modal"
            style={{ width: 520, maxWidth: '90vw', padding: 24 }}
            onClick={e => e.stopPropagation()}
          >
            <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>Choose a prompt</h2>
            <p style={{ margin: '0 0 18px', fontSize: 13, color: '#888' }}>
              Pick the style for <strong style={{ color: '#111' }}>{generatePicker.productName}</strong>
            </p>
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <label style={{ fontSize: 12, fontWeight: 600 }}>
                  {genSplit ? 'Ad 1 model' : 'Video Model'}
                </label>
                <label style={{ fontSize: 11, color: '#555', display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={genSplit}
                    onChange={e => setGenSplit(e.target.checked)}
                    style={{ margin: 0 }}
                  />
                  Split (A/B two models)
                </label>
              </div>
              <select
                value={genModel}
                onChange={e => setGenModel(e.target.value)}
                style={{
                  width: '100%', padding: '8px 12px', borderRadius: 6,
                  border: '1px solid #ddd', fontSize: 13, background: '#fff',
                }}
              >
                {Array.from(new Set(VIDEO_MODELS.map(m => m.group))).map(group => (
                  <optgroup key={group} label={group}>
                    {VIDEO_MODELS.filter(m => m.group === group).map(m => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {genModel.includes('reference-to-video') && (
                <div style={{
                  marginTop: 6, padding: '6px 10px', borderRadius: 6,
                  background: '#ecfdf5', border: '1px solid #a7f3d0',
                  fontSize: 11, color: '#047857',
                }}>
                  <strong>Multi-image mode:</strong> Vidu will receive up to 3 product photos as references (fal.ai limit) for consistent on-model output.
                </div>
              )}
              {genSplit && (
                <>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', margin: '10px 0 4px' }}>Ad 2 model</label>
                  <select
                    value={genModel2}
                    onChange={e => setGenModel2(e.target.value)}
                    style={{
                      width: '100%', padding: '8px 12px', borderRadius: 6,
                      border: '1px solid #ddd', fontSize: 13, background: '#fff',
                    }}
                  >
                    {Array.from(new Set(VIDEO_MODELS.map(m => m.group))).map(group => (
                      <optgroup key={group} label={group}>
                        {VIDEO_MODELS.filter(m => m.group === group).map(m => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  {genModel2.includes('reference-to-video') && (
                    <div style={{
                      marginTop: 6, padding: '6px 10px', borderRadius: 6,
                      background: '#ecfdf5', border: '1px solid #a7f3d0',
                      fontSize: 11, color: '#047857',
                    }}>
                      <strong>Multi-image mode:</strong> Vidu will receive up to 3 product photos as references (fal.ai limit).
                    </div>
                  )}
                  <p style={{ fontSize: 11, color: '#888', margin: '6px 0 0' }}>
                    One ad generated per model so you can compare side-by-side.
                  </p>
                </>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                { value: 'studio_clean', label: 'Studio Clean', desc: 'Minimal white-cyc studio. Clean product focus.' },
                { value: 'editorial_runway', label: 'Editorial Runway', desc: 'High-fashion magazine look, dramatic lighting.' },
                { value: 'street_style', label: 'Street Style', desc: 'Urban, candid, real-world environments.' },
                { value: 'lifestyle_context', label: 'Lifestyle', desc: 'Product in everyday use, warm ambient tone.' },
              ].map(s => (
                <button
                  key={s.value}
                  onClick={() => {
                    const picker = generatePicker;
                    setGeneratePicker(null);
                    const models = genSplit ? [genModel, genModel2] : genModel;
                    handleGenerateCreative(picker.productId, picker.productName, s.value, models);
                  }}
                  style={{
                    textAlign: 'left',
                    padding: '12px 14px',
                    borderRadius: 8,
                    border: '1px solid #e5e5e5',
                    background: '#fff',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = '#3b82f6';
                    (e.currentTarget as HTMLElement).style.background = '#f8faff';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = '#e5e5e5';
                    (e.currentTarget as HTMLElement).style.background = '#fff';
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#111', marginBottom: 2 }}>{s.label}</div>
                  <div style={{ fontSize: 11, color: '#666', lineHeight: 1.4 }}>{s.desc}</div>
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
              <button className="admin-btn admin-btn-secondary" onClick={() => setGeneratePicker(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {batchPicker && (
        <div
          className="admin-modal-overlay"
          onClick={() => setBatchPicker(null)}
        >
          <div
            className="admin-modal"
            style={{ width: 520, maxWidth: '90vw', padding: 24 }}
            onClick={e => e.stopPropagation()}
          >
            <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>Batch generate</h2>
            <p style={{ margin: '0 0 18px', fontSize: 13, color: '#888' }}>
              Generating for <strong style={{ color: '#111' }}>{batchPicker.items.length}</strong> product{batchPicker.items.length === 1 ? '' : 's'}.
              Each product gets {genSplit ? '1 ad per model (A/B)' : '2 ads'}.
            </p>
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <label style={{ fontSize: 12, fontWeight: 600 }}>
                  {genSplit ? 'Ad 1 model' : 'Video Model'}
                </label>
                <label style={{ fontSize: 11, color: '#555', display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={genSplit} onChange={e => setGenSplit(e.target.checked)} style={{ margin: 0 }} />
                  Split (A/B two models)
                </label>
              </div>
              <select
                value={genModel}
                onChange={e => setGenModel(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13, background: '#fff' }}
              >
                {Array.from(new Set(VIDEO_MODELS.map(m => m.group))).map(group => (
                  <optgroup key={group} label={group}>
                    {VIDEO_MODELS.filter(m => m.group === group).map(m => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {genSplit && (
                <>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', margin: '10px 0 4px' }}>Ad 2 model</label>
                  <select
                    value={genModel2}
                    onChange={e => setGenModel2(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13, background: '#fff' }}
                  >
                    {Array.from(new Set(VIDEO_MODELS.map(m => m.group))).map(group => (
                      <optgroup key={group} label={group}>
                        {VIDEO_MODELS.filter(m => m.group === group).map(m => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                { value: 'studio_clean', label: 'Studio Clean', desc: 'Minimal white-cyc studio. Clean product focus.' },
                { value: 'editorial_runway', label: 'Editorial Runway', desc: 'High-fashion magazine look, dramatic lighting.' },
                { value: 'street_style', label: 'Street Style', desc: 'Urban, candid, real-world environments.' },
                { value: 'lifestyle_context', label: 'Lifestyle', desc: 'Product in everyday use, warm ambient tone.' },
              ].map(s => (
                <button
                  key={s.value}
                  onClick={() => {
                    const picker = batchPicker;
                    setBatchPicker(null);
                    const models = genSplit ? [genModel, genModel2] : genModel;
                    showToast(`Queued ${picker.items.length} product${picker.items.length === 1 ? '' : 's'} for generation`);
                    // Fire-and-forget per product so the UI stays responsive.
                    picker.items.forEach(it => {
                      handleGenerateCreative(it.id, it.name, s.value, models);
                    });
                    setSelectedProductKeys(new Set());
                    setLastSelectedIndex(null);
                  }}
                  style={{
                    textAlign: 'left', padding: '12px 14px', borderRadius: 8,
                    border: '1px solid #e5e5e5', background: '#fff', cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = '#3b82f6';
                    (e.currentTarget as HTMLElement).style.background = '#f8faff';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = '#e5e5e5';
                    (e.currentTarget as HTMLElement).style.background = '#fff';
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#111', marginBottom: 2 }}>{s.label}</div>
                  <div style={{ fontSize: 11, color: '#666', lineHeight: 1.4 }}>{s.desc}</div>
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
              <button className="admin-btn admin-btn-secondary" onClick={() => setBatchPicker(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <PromptSettingsModal
        open={showPromptSettings}
        onClose={() => setShowPromptSettings(false)}
        onSaved={showToast}
      />
      {showAmazonLookup && (
        <AmazonLookupModal
          onClose={() => setShowAmazonLookup(false)}
          onPending={(urls) => {
            setPendingProducts(prev => [
              ...urls.map(url => ({ id: `pending-${Date.now()}-${Math.random()}`, url, source: 'amazon' as const, startedAt: Date.now() })),
              ...prev,
            ]);
          }}
          onIngested={(count) => {
            setShowAmazonLookup(false);
            showToast(`Added ${count} Amazon product${count === 1 ? '' : 's'} - scraping…`);
          }}
        />
      )}

      {showBrandUrl && (
        <div
          className="admin-modal-overlay"
          onClick={() => !brandUrlBusy && setShowBrandUrl(false)}
        >
          <div
            className="admin-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 560 }}
          >
            <div style={{ padding: 20 }}>
              <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>Add via Brand Website</h2>
              <p style={{ margin: '0 0 16px', fontSize: 13, color: '#666' }}>
                Paste one or many product URLs from any brand site (one
                per line, comma-separated, or whitespace-separated).
                We'll scrape each page and ingest the products.
              </p>
              <textarea
                autoFocus
                value={brandUrlInput}
                onChange={(e) => { setBrandUrlInput(e.target.value); setBrandUrlError(null); }}
                placeholder={'https://brand-a.com/products/foo\nhttps://brand-b.com/products/bar\nhttps://brand-c.com/p/baz'}
                disabled={brandUrlBusy}
                rows={6}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: `1px solid ${brandUrlError ? '#dc2626' : '#e5e7eb'}`,
                  fontSize: 13,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  lineHeight: 1.5,
                  resize: 'vertical',
                  marginBottom: brandUrlError ? 6 : 12,
                  boxSizing: 'border-box',
                }}
              />
              {(() => {
                const urls = extractUrls(brandUrlInput);
                if (urls.length > 1) {
                  return (
                    <div style={{ fontSize: 11, color: '#666', marginBottom: 12 }}>
                      <strong>{urls.length}</strong> URLs detected — all will be queued.
                    </div>
                  );
                }
                return null;
              })()}
              {brandUrlError && (
                <div style={{ fontSize: 12, color: '#dc2626', marginBottom: 16 }}>{brandUrlError}</div>
              )}
              {brandUrlBusy && brandBatchProgress && brandBatchProgress.total > 1 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, color: '#666', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                    <span>Queueing — {brandBatchProgress.done} / {brandBatchProgress.total}</span>
                    <span style={{ color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>
                      {brandBatchProgress.failed > 0 ? `${brandBatchProgress.failed} failed` : ''}
                    </span>
                  </div>
                  <div style={{ height: 4, background: '#e2e8f0', borderRadius: 999, overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.round((brandBatchProgress.done / brandBatchProgress.total) * 100)}%`,
                        background: '#2563eb',
                        transition: 'width 220ms ease',
                      }}
                    />
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  className="admin-btn admin-btn-secondary"
                  onClick={() => setShowBrandUrl(false)}
                  disabled={brandUrlBusy}
                >
                  Cancel
                </button>
                <button
                  className="admin-btn admin-btn-primary"
                  disabled={brandUrlBusy || extractUrls(brandUrlInput).length === 0}
                  onClick={async () => {
                    const urls = extractUrls(brandUrlInput);
                    if (urls.length === 0) return;
                    setBrandUrlBusy(true);
                    setBrandUrlError(null);
                    setBrandBatchProgress({ done: 0, total: urls.length, failed: 0 });
                    // Push ghost rows upfront so the admin sees the
                    // batch entering scraping state immediately, even
                    // before each INSERT round-trip completes.
                    setPendingProducts(prev => [
                      ...urls.map(url => ({ id: `pending-${Date.now()}-${Math.random()}`, url, source: 'brand' as const, startedAt: Date.now() })),
                      ...prev,
                    ]);
                    let failed = 0;
                    const firstErrors: string[] = [];
                    for (let i = 0; i < urls.length; i++) {
                      const url = urls[i];
                      try {
                        await addProductUrl(url);
                      } catch (err) {
                        failed += 1;
                        if (firstErrors.length < 3) {
                          firstErrors.push(`${url} — ${err instanceof Error ? err.message : 'failed'}`);
                        }
                        // Prune ghost row for the URL that failed so
                        // admin sees the failure reflected.
                        setPendingProducts(prev => prev.filter(pp => pp.url !== url));
                      }
                      setBrandBatchProgress({ done: i + 1, total: urls.length, failed });
                    }
                    setBrandUrlBusy(false);
                    setBrandBatchProgress(null);
                    if (urls.length === 1 && failed === 1) {
                      setBrandUrlError(firstErrors[0] || 'Failed to queue scrape');
                      return;
                    }
                    setShowBrandUrl(false);
                    setBrandUrlInput('');
                    if (failed > 0) {
                      showToast(`${urls.length - failed}/${urls.length} queued — ${failed} failed`);
                    } else if (urls.length === 1) {
                      showToast('Scraping — watch the top of the table.');
                    } else {
                      showToast(`${urls.length} URLs scraping — watch the top of the table.`);
                    }
                  }}
                >
                  {brandUrlBusy
                    ? (extractUrls(brandUrlInput).length > 1 ? 'Queueing…' : 'Adding…')
                    : (extractUrls(brandUrlInput).length > 1 ? `Add ${extractUrls(brandUrlInput).length} URLs` : 'Add')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAddProducts && (
        <AddProductsModal
          onClose={() => setShowAddProducts(false)}
          onPending={(urls, source) => {
            setPendingProducts(prev => [
              ...urls.map(url => ({ id: `pending-${Date.now()}-${Math.random()}`, url, source, startedAt: Date.now() })),
              ...prev,
            ]);
          }}
          onIngested={(newRows) => {
            setCrawledProducts(prev => [
              ...newRows,
              ...prev.filter(r => !newRows.some(n => n.id === r.id)),
            ]);
            const ingestedUrls = new Set(newRows.map(r => r.url).filter((u): u is string => !!u));
            if (ingestedUrls.size > 0) {
              setPendingProducts(prev => prev.filter(pp => !ingestedUrls.has(pp.url)));
            }
          }}
          showToast={showToast}
        />
      )}

      {toast && (
        <div
          onClick={() => navigate('/admin/agents?tab=video-gen&sub=product-ads')}
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#111',
            color: '#fff',
            padding: '12px 20px',
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 500,
            boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            cursor: 'pointer',
            animation: 'toastSlideUp 0.2s ease-out',
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 0 4px rgba(34,197,94,0.2)' }} />
          {toast}
        </div>
      )}

      {/* Bottom-center publish notification - fades after ~3.2s. */}
      {publishMsg && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            bottom: 28,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 11000,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 18px',
            borderRadius: 999,
            background: 'rgba(15, 23, 42, 0.92)',
            color: '#fff',
            fontSize: 13,
            fontWeight: 500,
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.32)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            pointerEvents: 'none',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {publishMsg}
        </div>
      )}
    </div>
  );
}

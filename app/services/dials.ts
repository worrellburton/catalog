import { supabase } from '~/utils/supabase';

// ── Dial cache + batch prefetch ──────────────────────────────────────
// Every dial is one row in app_settings. Read à la carte, the boot path
// fires a separate round-trip per key (video_still_ratio, products_image_only,
// show_brand_logos, comments_enabled, …). readDial() memoises each value and
// prefetchDials() warms them all in a single `.in('key', …)` query, so a warm
// boot resolves every dial from cache with zero extra requests.
const dialCache = new Map<string, string | null>();
let dialPrefetch: Promise<void> | null = null;

async function readDial(key: string): Promise<string | null> {
  if (dialCache.has(key)) return dialCache.get(key) ?? null;
  // A batch prefetch in flight will populate this key — await it instead of
  // racing a duplicate per-key query.
  if (dialPrefetch) {
    try { await dialPrefetch; } catch { /* fall through to a direct read */ }
    if (dialCache.has(key)) return dialCache.get(key) ?? null;
  }
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('app_settings').select('value').eq('key', key).maybeSingle();
  if (error) {
    console.warn('[dials] read failed:', key, error.message);
    return null;
  }
  const value = (data?.value as string | undefined) ?? null;
  dialCache.set(key, value);
  return value;
}

/**
 * Global tuning dials backed by app_settings (text key/value).
 * Phase 2 of the /admin/dials buildout — adds the read/write API
 * for the Video → Still image ratio. Realtime channel ships in
 * Phase 3 so changes propagate to every connected client without
 * a refresh.
 *
 * Ratio semantics: an integer 0..100 where
 *   100 = every grid card autoplays video (current behaviour)
 *     0 = every grid card renders as a still image
 *   N  = roughly N% of cards play video, the rest show stills,
 *        split deterministically per-card so a refresh keeps the
 *        same cards on the same side.
 */

export const VIDEO_STILL_RATIO_KEY = 'video_still_ratio';
export const DEFAULT_VIDEO_STILL_RATIO = 100;

function parseRatio(raw: string | null | undefined): number {
  if (raw == null) return DEFAULT_VIDEO_STILL_RATIO;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_VIDEO_STILL_RATIO;
  return Math.max(0, Math.min(100, n));
}

/** One-shot read. Returns the default when Supabase isn't configured
 *  or the row doesn't exist yet — never throws to the caller. */
export async function getVideoStillRatio(): Promise<number> {
  return parseRatio(await readDial(VIDEO_STILL_RATIO_KEY));
}

/** Persist a new ratio. Clamps to 0..100 before the round-trip.
 *  Throws on failure so the admin slider can surface an error toast. */
export async function setVideoStillRatio(value: number): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: VIDEO_STILL_RATIO_KEY, value: String(clamped) }, { onConflict: 'key' });
  if (error) throw error;
}

/**
 * Listen for ratio changes pushed by other clients (admin moving the
 * slider on /admin/dials, another tab updating the value, etc.).
 * Returns the unsubscribe fn. The callback fires with the freshly
 * parsed value any time the app_settings row for this key is
 * INSERTed or UPDATEd. Filtering happens server-side so unrelated
 * settings changes don't wake the consumer feed.
 */
export function subscribeVideoStillRatio(
  onChange: (value: number) => void,
): () => void {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`dials:${VIDEO_STILL_RATIO_KEY}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'app_settings',
        filter: `key=eq.${VIDEO_STILL_RATIO_KEY}`,
      },
      (payload) => {
        const next = (payload.new as { value?: string } | null)?.value;
        onChange(parseRatio(next ?? null));
      },
    )
    .subscribe();
  return () => { void supabase!.removeChannel(channel); };
}

// ────────────────────────────────────────────────────────────────────
// "Products image-only" toggle. When ON, the consumer feed renders
// any tile backed by a product (no look attached) as just the
// product's image — no autoplay video. Looks (look_id present)
// continue to play video as normal.
//
// Default: false (current behaviour — products and looks both play
// video). Boolean value persisted as 'true' / 'false' string in
// app_settings to keep the same simple text column the ratio uses.
// ────────────────────────────────────────────────────────────────────

export const PRODUCTS_IMAGE_ONLY_KEY = 'products_image_only';
export const DEFAULT_PRODUCTS_IMAGE_ONLY = false;

export const SHOW_BRAND_LOGOS_KEY = 'show_brand_logos';
export const DEFAULT_SHOW_BRAND_LOGOS = false;

export const COMMENTS_ENABLED_KEY = 'comments_enabled';
export const DEFAULT_COMMENTS_ENABLED = true;

/**
 * Warm every boot-time dial in a single round-trip. Call once early in the
 * app boot (in parallel with the feed fetch). After it resolves, the dial
 * getters above — and the singleton hydrate hooks that wrap them — resolve
 * from cache instead of firing one app_settings query per key.
 */
export function prefetchDials(): Promise<void> {
  if (dialPrefetch) return dialPrefetch;
  dialPrefetch = (async () => {
    if (!supabase) return;
    const keys = [
      VIDEO_STILL_RATIO_KEY,
      PRODUCTS_IMAGE_ONLY_KEY,
      SHOW_BRAND_LOGOS_KEY,
      COMMENTS_ENABLED_KEY,
      AUTO_EDITOR_ENABLED_KEY,
      WAITLIST_MODE_KEY,
    ];
    const { data, error } = await supabase
      .from('app_settings').select('key, value').in('key', keys);
    if (error) {
      // Leave the cache cold so readDial() falls back to per-key reads.
      dialPrefetch = null;
      return;
    }
    const byKey = new Map(
      ((data as { key: string; value: string | null }[]) || []).map(r => [r.key, r.value ?? null]),
    );
    // Seed every requested key — a missing row caches as null (→ default)
    // so we never re-query it.
    for (const k of keys) dialCache.set(k, byKey.get(k) ?? null);
  })();
  return dialPrefetch;
}

function parseBool(raw: string | null | undefined, fallback: boolean): boolean {
  if (raw == null) return fallback;
  return raw.trim().toLowerCase() === 'true';
}

export async function getProductsImageOnly(): Promise<boolean> {
  return parseBool(await readDial(PRODUCTS_IMAGE_ONLY_KEY), DEFAULT_PRODUCTS_IMAGE_ONLY);
}

export async function setProductsImageOnly(value: boolean): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: PRODUCTS_IMAGE_ONLY_KEY, value: String(value) }, { onConflict: 'key' });
  if (error) throw error;
}

export function subscribeProductsImageOnly(
  onChange: (value: boolean) => void,
): () => void {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`dials:${PRODUCTS_IMAGE_ONLY_KEY}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'app_settings',
        filter: `key=eq.${PRODUCTS_IMAGE_ONLY_KEY}`,
      },
      (payload) => {
        const next = (payload.new as { value?: string } | null)?.value;
        onChange(parseBool(next ?? null, DEFAULT_PRODUCTS_IMAGE_ONLY));
      },
    )
    .subscribe();
  return () => { void supabase!.removeChannel(channel); };
}

// ────────────────────────────────────────────────────────────────────
// "Show brand logos" toggle. When ON, the consumer feed swaps the
// brand text label on each tile for the brand's logo image (fetched
// from public.brand_logos). Default OFF.
// ────────────────────────────────────────────────────────────────────

export async function getShowBrandLogos(): Promise<boolean> {
  return parseBool(await readDial(SHOW_BRAND_LOGOS_KEY), DEFAULT_SHOW_BRAND_LOGOS);
}

export async function setShowBrandLogos(value: boolean): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: SHOW_BRAND_LOGOS_KEY, value: String(value) }, { onConflict: 'key' });
  if (error) throw error;
}

export function subscribeShowBrandLogos(onChange: (value: boolean) => void): () => void {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`dials:${SHOW_BRAND_LOGOS_KEY}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'app_settings', filter: `key=eq.${SHOW_BRAND_LOGOS_KEY}` },
      (payload) => {
        const next = (payload.new as { value?: string } | null)?.value;
        onChange(parseBool(next ?? null, DEFAULT_SHOW_BRAND_LOGOS));
      },
    )
    .subscribe();
  return () => { void supabase!.removeChannel(channel); };
}

// ────────────────────────────────────────────────────────────────────
// "Comments" feature flag. When ON, products and looks show a Comment
// button that opens the comment thread page; when OFF the button and the
// thread page are hidden platform-wide. Default ON.
// ────────────────────────────────────────────────────────────────────

export async function getCommentsEnabled(): Promise<boolean> {
  return parseBool(await readDial(COMMENTS_ENABLED_KEY), DEFAULT_COMMENTS_ENABLED);
}

export async function setCommentsEnabled(value: boolean): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: COMMENTS_ENABLED_KEY, value: String(value) }, { onConflict: 'key' });
  if (error) throw error;
}

export function subscribeCommentsEnabled(onChange: (value: boolean) => void): () => void {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`dials:${COMMENTS_ENABLED_KEY}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'app_settings', filter: `key=eq.${COMMENTS_ENABLED_KEY}` },
      (payload) => {
        const next = (payload.new as { value?: string } | null)?.value;
        onChange(parseBool(next ?? null, DEFAULT_COMMENTS_ENABLED));
      },
    )
    .subscribe();
  return () => { void supabase!.removeChannel(channel); };
}

// ────────────────────────────────────────────────────────────────────
// Waitlist mode — the launch master switch.
//   ON  (default) → the app behaves the way it always did: sign-in-only,
//                   guests bounce to the marketing landing, new accounts
//                   land on the waitlist until approved.
//   OFF           → the open flow: guests browse the feed + products,
//                   looks/creator catalogs gate behind signup, signing up
//                   grants access immediately.
// Default ON so promoting to production changes nothing until an admin
// deliberately flips it OFF to open the app.
// ────────────────────────────────────────────────────────────────────

export const WAITLIST_MODE_KEY = 'waitlist_mode';
export const DEFAULT_WAITLIST_MODE = true;

export async function getWaitlistMode(): Promise<boolean> {
  return parseBool(await readDial(WAITLIST_MODE_KEY), DEFAULT_WAITLIST_MODE);
}

export async function setWaitlistMode(value: boolean): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: WAITLIST_MODE_KEY, value: String(value) }, { onConflict: 'key' });
  if (error) throw error;
}

export function subscribeWaitlistMode(onChange: (value: boolean) => void): () => void {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`dials:${WAITLIST_MODE_KEY}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'app_settings', filter: `key=eq.${WAITLIST_MODE_KEY}` },
      (payload) => {
        const next = (payload.new as { value?: string } | null)?.value;
        onChange(parseBool(next ?? null, DEFAULT_WAITLIST_MODE));
      },
    )
    .subscribe();
  return () => { void supabase!.removeChannel(channel); };
}

// ────────────────────────────────────────────────────────────────────
// Product similarity threshold (0–100).
// Tightness of the product-page "Similar" rail, applied RELATIVE to each
// product's nearest match (cosine distance on products.embedding). The
// cutoff = nearest_distance ÷ (threshold / 100):
//   0 (default) = no filter — show all K nearest neighbours (never empty).
//   60          = keep items within ~1.67× the nearest distance (wider band).
//   100         = keep items within 1× the nearest distance (tightest — only
//                 the closest matches; sparse → the Popular rail fills).
// Higher = stricter. See getSimilarProductsByEmbedding in product-creative.ts.
// ────────────────────────────────────────────────────────────────────

// Shared parser for 0-default dials (similarity thresholds).
// parseRatio() can't be reused here — its fallback is 100 (video ratio default).
function parseSimilarity(raw: string | null | undefined): number {
  if (raw == null) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

export const PRODUCT_SIMILARITY_KEY = 'product_similarity_threshold';
export const DEFAULT_PRODUCT_SIMILARITY = 0;

export async function getProductSimilarityThreshold(): Promise<number> {
  if (!supabase) return DEFAULT_PRODUCT_SIMILARITY;
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', PRODUCT_SIMILARITY_KEY)
    .maybeSingle();
  if (error) {
    console.warn('[dials] product_similarity_threshold read failed:', error.message);
    return DEFAULT_PRODUCT_SIMILARITY;
  }
  return parseSimilarity((data?.value as string | undefined) ?? null);
}

export async function setProductSimilarityThreshold(value: number): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: PRODUCT_SIMILARITY_KEY, value: String(clamped) }, { onConflict: 'key' });
  if (error) throw error;
}

export function subscribeProductSimilarityThreshold(onChange: (value: number) => void): () => void {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`dials:${PRODUCT_SIMILARITY_KEY}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'app_settings', filter: `key=eq.${PRODUCT_SIMILARITY_KEY}` },
      (payload) => {
        const next = (payload.new as { value?: string } | null)?.value;
        onChange(parseSimilarity(next ?? null));
      },
    )
    .subscribe();
  return () => { void supabase!.removeChannel(channel); };
}

// ────────────────────────────────────────────────────────────────────
// Look similarity threshold (0–100).
// Controls the minimum fraction of the seed look's products that a
// candidate look must share to appear in "More like this".
// 0 (default) = any 1 shared product name qualifies (current behaviour).
// 60 = ceil(seedCount × 0.60) products must match.
// 100 = every seed product must appear in the candidate.
// ────────────────────────────────────────────────────────────────────

export const LOOK_SIMILARITY_KEY = 'look_similarity_threshold';
export const DEFAULT_LOOK_SIMILARITY = 0;

export async function getLookSimilarityThreshold(): Promise<number> {
  if (!supabase) return DEFAULT_LOOK_SIMILARITY;
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', LOOK_SIMILARITY_KEY)
    .maybeSingle();
  if (error) {
    console.warn('[dials] look_similarity_threshold read failed:', error.message);
    return DEFAULT_LOOK_SIMILARITY;
  }
  return parseSimilarity((data?.value as string | undefined) ?? null);
}

export async function setLookSimilarityThreshold(value: number): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: LOOK_SIMILARITY_KEY, value: String(clamped) }, { onConflict: 'key' });
  if (error) throw error;
}

export function subscribeLookSimilarityThreshold(onChange: (value: number) => void): () => void {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`dials:${LOOK_SIMILARITY_KEY}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'app_settings', filter: `key=eq.${LOOK_SIMILARITY_KEY}` },
      (payload) => {
        const next = (payload.new as { value?: string } | null)?.value;
        onChange(parseSimilarity(next ?? null));
      },
    )
    .subscribe();
  return () => { void supabase!.removeChannel(channel); };
}

// ────────────────────────────────────────────────────────────────────
// Automatic Editor — daily personalized feed config.
// Master on/off + tuning, all in app_settings (migration
// 20260607000000_personalized_feeds). The consumer feed reads
// enabled/frequency; the personalize-feed edge function reads
// holdout/recency/min-signal.
// ────────────────────────────────────────────────────────────────────
export const AUTO_EDITOR_ENABLED_KEY      = 'auto_editor_enabled';
export const AUTO_EDITOR_FREQUENCY_KEY    = 'auto_editor_frequency';
export const AUTO_EDITOR_HOLDOUT_PCT_KEY  = 'auto_editor_holdout_pct';
export const AUTO_EDITOR_RECENCY_DAYS_KEY = 'auto_editor_recency_days';
export const AUTO_EDITOR_MIN_SIGNAL_KEY   = 'auto_editor_min_signal';
export const AUTO_EDITOR_REFRESH_HOUR_KEY = 'auto_editor_refresh_hour';

export type AutoEditorFrequency = 'daily' | 'every_signin';

export interface AutoEditorConfig {
  enabled: boolean;
  frequency: AutoEditorFrequency;
  holdoutPct: number;  // 0..100 — % of eligible shoppers held on the global feed
  recencyDays: number; // 1..365 — history lookback for signals
  minSignal: number;   // 0..1000 — min user_events before personalizing
  refreshHour: number; // 0..23 — UTC hour the daily feed rolls over to a new day
}

export const DEFAULT_AUTO_EDITOR_CONFIG: AutoEditorConfig = {
  enabled: false,
  frequency: 'daily',
  holdoutPct: 10,
  recencyDays: 30,
  minSignal: 3,
  refreshHour: 0,
};

function parseIntClamped(raw: string | null | undefined, fallback: number, min: number, max: number): number {
  if (raw == null) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/** Read the full Automatic Editor config in one round-trip. Never throws —
 *  returns defaults when Supabase is unconfigured or a row is missing. */
export async function getAutoEditorConfig(): Promise<AutoEditorConfig> {
  if (!supabase) return { ...DEFAULT_AUTO_EDITOR_CONFIG };
  const keys = [
    AUTO_EDITOR_ENABLED_KEY, AUTO_EDITOR_FREQUENCY_KEY, AUTO_EDITOR_HOLDOUT_PCT_KEY,
    AUTO_EDITOR_RECENCY_DAYS_KEY, AUTO_EDITOR_MIN_SIGNAL_KEY, AUTO_EDITOR_REFRESH_HOUR_KEY,
  ];
  const { data, error } = await supabase.from('app_settings').select('key, value').in('key', keys);
  if (error) {
    console.warn('[dials] auto_editor config read failed:', error.message);
    return { ...DEFAULT_AUTO_EDITOR_CONFIG };
  }
  const byKey = new Map(((data as { key: string; value: string | null }[]) || []).map(r => [r.key, r.value ?? null]));
  const freqRaw = (byKey.get(AUTO_EDITOR_FREQUENCY_KEY) || '').trim().toLowerCase();
  return {
    enabled: (byKey.get(AUTO_EDITOR_ENABLED_KEY) || '').trim().toLowerCase() === 'true',
    frequency: freqRaw === 'every_signin' ? 'every_signin' : 'daily',
    holdoutPct: parseIntClamped(byKey.get(AUTO_EDITOR_HOLDOUT_PCT_KEY), DEFAULT_AUTO_EDITOR_CONFIG.holdoutPct, 0, 100),
    recencyDays: parseIntClamped(byKey.get(AUTO_EDITOR_RECENCY_DAYS_KEY), DEFAULT_AUTO_EDITOR_CONFIG.recencyDays, 1, 365),
    minSignal: parseIntClamped(byKey.get(AUTO_EDITOR_MIN_SIGNAL_KEY), DEFAULT_AUTO_EDITOR_CONFIG.minSignal, 0, 1000),
    refreshHour: parseIntClamped(byKey.get(AUTO_EDITOR_REFRESH_HOUR_KEY), DEFAULT_AUTO_EDITOR_CONFIG.refreshHour, 0, 23),
  };
}

/** Persist a partial config change (only the provided fields are written).
 *  Clamps numeric fields before the round-trip. Throws on failure so the
 *  admin UI can surface an error. */
export async function setAutoEditorConfig(partial: Partial<AutoEditorConfig>): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const rows: { key: string; value: string }[] = [];
  if (partial.enabled !== undefined)     rows.push({ key: AUTO_EDITOR_ENABLED_KEY, value: partial.enabled ? 'true' : 'false' });
  if (partial.frequency !== undefined)   rows.push({ key: AUTO_EDITOR_FREQUENCY_KEY, value: partial.frequency });
  if (partial.holdoutPct !== undefined)  rows.push({ key: AUTO_EDITOR_HOLDOUT_PCT_KEY, value: String(Math.max(0, Math.min(100, Math.round(partial.holdoutPct)))) });
  if (partial.recencyDays !== undefined) rows.push({ key: AUTO_EDITOR_RECENCY_DAYS_KEY, value: String(Math.max(1, Math.min(365, Math.round(partial.recencyDays)))) });
  if (partial.minSignal !== undefined)   rows.push({ key: AUTO_EDITOR_MIN_SIGNAL_KEY, value: String(Math.max(0, Math.min(1000, Math.round(partial.minSignal)))) });
  if (partial.refreshHour !== undefined) rows.push({ key: AUTO_EDITOR_REFRESH_HOUR_KEY, value: String(Math.max(0, Math.min(23, Math.round(partial.refreshHour)))) });
  if (rows.length === 0) return;
  const { error } = await supabase.from('app_settings').upsert(rows, { onConflict: 'key' });
  if (error) throw error;
}

/** Live-update the consumer feed when an admin flips the master toggle. */
export function subscribeAutoEditorEnabled(onChange: (enabled: boolean) => void): () => void {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`dials:${AUTO_EDITOR_ENABLED_KEY}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'app_settings', filter: `key=eq.${AUTO_EDITOR_ENABLED_KEY}` },
      (payload) => {
        onChange(((payload.new as { value?: string } | null)?.value || '').trim().toLowerCase() === 'true');
      },
    )
    .subscribe();
  return () => { void supabase!.removeChannel(channel); };
}

// ── Daily feed rules ──────────────────────────────────────────────────
// Ten tunable rules for the personalized daily feed, edited from the
// Automatic Editor modal on /admin/catalogs and consumed by the
// personalize-feed edge function (server-side rules) and the home feed
// composer (savedBrands — the only client-side rule, since bookmarks
// live in localStorage). Stored as ONE app_settings row (JSON) under
// FEED_RULES_KEY so the edge function reads the whole rulebook in a
// single key.

export const FEED_RULES_KEY = 'feed_rules';

export interface FeedRule { enabled: boolean; weight: number }

export interface FeedRules {
  /** Boost products with the highest clickout conversion (products.conversion_score). */
  convertingBoost: FeedRule;
  /** Resurface specific products this user clicked before. */
  clickedProducts: FeedRule;
  /** Lean toward brands this user engages with (clicks/clickouts). */
  engagedBrands: FeedRule;
  /** Lean toward product categories this user engages with. */
  engagedTypes: FeedRule;
  /** Boost brands from the user's saved items (client-side; bookmarks). */
  savedBrands: FeedRule;
  /** Push the newest arrivals up the feed. */
  freshnessBoost: FeedRule;
  /** Down-rank items the user has already seen (weight = penalty strength). */
  seenDecay: FeedRule;
  /** Max items per brand in the top 20 (weight = the cap, 1–5). */
  diversityGuard: FeedRule;
  /** Only show products matching the user's gender (+ unisex). */
  genderStrict: FeedRule;
  /** Boost what's trending platform-wide this week (clickout velocity). */
  trendingBoost: FeedRule;
  /** Reserve N of the top-20 slots for items the user has never been
   *  shown — the "new feed every morning" mechanic. */
  freshSlots: FeedRule;
  /** Reshuffle the top N items each day (date+user seeded) so the visible
   *  head of the feed changes daily even for stable-taste shoppers. */
  dailyShuffle: FeedRule;
}

/** Defaults mirror today's live behavior — engaged brands/types and the
 *  seen penalty are what personalize-feed already does; everything else
 *  starts OFF so flipping a dial is always an explicit founder decision. */
export const DEFAULT_FEED_RULES: FeedRules = {
  convertingBoost: { enabled: false, weight: 5 },
  clickedProducts: { enabled: false, weight: 3 },
  engagedBrands:   { enabled: true,  weight: 5 },
  engagedTypes:    { enabled: true,  weight: 5 },
  savedBrands:     { enabled: false, weight: 4 },
  freshnessBoost:  { enabled: false, weight: 3 },
  seenDecay:       { enabled: true,  weight: 5 },
  diversityGuard:  { enabled: false, weight: 3 },
  genderStrict:    { enabled: true,  weight: 0 },
  trendingBoost:   { enabled: false, weight: 4 },
  freshSlots:      { enabled: true,  weight: 6 },
  dailyShuffle:    { enabled: true,  weight: 8 },
};

function sanitizeFeedRules(raw: unknown): FeedRules {
  const out: FeedRules = JSON.parse(JSON.stringify(DEFAULT_FEED_RULES));
  if (!raw || typeof raw !== 'object') return out;
  for (const key of Object.keys(out) as (keyof FeedRules)[]) {
    const r = (raw as Record<string, unknown>)[key];
    if (r && typeof r === 'object') {
      const rule = r as { enabled?: unknown; weight?: unknown };
      if (typeof rule.enabled === 'boolean') out[key].enabled = rule.enabled;
      const w = Number(rule.weight);
      if (Number.isFinite(w)) out[key].weight = Math.max(0, Math.min(10, w));
    }
  }
  return out;
}

export async function getFeedRules(): Promise<FeedRules> {
  if (!supabase) return sanitizeFeedRules(null);
  const { data, error } = await supabase
    .from('app_settings').select('value').eq('key', FEED_RULES_KEY).maybeSingle();
  if (error || !data?.value) return sanitizeFeedRules(null);
  try { return sanitizeFeedRules(JSON.parse(data.value)); } catch { return sanitizeFeedRules(null); }
}

export async function setFeedRules(rules: FeedRules): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: FEED_RULES_KEY, value: JSON.stringify(sanitizeFeedRules(rules)) }, { onConflict: 'key' });
  if (error) throw error;
}

/** The daily-feed rules in founder-priority order — shared by the
 *  Automatic Editor modal and the daily-feed lens. */
// Rules listed in founder-priority order. `weight: false`
// renders switch-only (the rule is binary).
export const FEED_RULE_META: {
  key: keyof FeedRules; label: string; hint: string; weight: boolean; min?: number; max?: number;
}[] = [
  { key: 'convertingBoost', label: 'Show the highest-converting products', hint: 'Boost products with the best clickout rate platform-wide', weight: true },
  { key: 'clickedProducts', label: 'Resurface products they clicked before', hint: 'Their own click history pulls those exact items back up', weight: true },
  { key: 'engagedBrands', label: 'Lean into brands they engage with', hint: 'Brands they click and buy from rank higher', weight: true },
  { key: 'engagedTypes', label: 'Lean into categories they engage with', hint: 'Their most-tapped product types rank higher', weight: true },
  { key: 'savedBrands', label: 'Boost brands they saved', hint: 'Brands from their saved items float up (applies on-device)', weight: true },
  { key: 'freshnessBoost', label: 'Push the newest arrivals up', hint: 'Recently added products get a freshness lift', weight: true },
  { key: 'seenDecay', label: 'Rest things they already saw', hint: 'Already-seen items sink so the feed feels new daily', weight: true },
  { key: 'diversityGuard', label: 'Brand diversity guard', hint: 'Max items per brand in the top 20 (weight = the cap)', weight: true, min: 1, max: 5 },
  { key: 'genderStrict', label: 'Strict gender matching', hint: 'Only their gender + unisex products appear', weight: false },
  { key: 'trendingBoost', label: 'Show what is trending this week', hint: 'Platform-wide clickout velocity (last 7 days)', weight: true },
  { key: 'freshSlots', label: 'Fresh finds up top, every day', hint: 'Reserve N of the top 20 slots for items they have never been shown', weight: true, min: 0, max: 20 },
  { key: 'dailyShuffle', label: 'Reshuffle the top every day', hint: 'Re-order the top N items each day so the feed visibly changes (weight = how many top slots)', weight: true, min: 0, max: 10 },
];

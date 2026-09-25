// Product health for the admin Data → Products table: is a product fully
// ready to sell? Four checks — media, identity (name + brand), price and the
// retailer link — each ok / warn / fail. Pure so it's unit-tested and shared.

// types
export type HealthLevel = 'ok' | 'warn' | 'fail';

/** What the link checker (check-product-links edge fn) last saw. */
export type LinkState =
  | 'live'         // 2xx (or 416 to our Range probe)
  | 'dead'         // 404 / 410 / other 4xx-5xx
  | 'redirected'   // -3: a deep product URL redirected to the homepage / search (soft 404)
  | 'blocked'      // 403 / 429: the retailer refuses server requests (usually fine in a browser)
  | 'unreachable'  // -2: timed out / DNS / redirect loop
  | 'policy'       // -1: not https or a private host, never fetched
  | 'unchecked'    // never checked yet
  | 'missing';     // no URL at all

export interface HealthInput {
  name: string | null | undefined;
  brand: string | null | undefined;
  price: string | null | undefined;
  url: string | null | undefined;
  primaryImageUrl: string | null | undefined;
  primaryImagePolished: boolean | null | undefined;
  posterUrl: string | null | undefined;
  videoUrl: string | null | undefined;
  urlStatus: number | null | undefined;
}

export interface MediaCompletion {
  polished: boolean;
  poster: boolean;
  video: boolean;
  done: number; // 0..3
  level: HealthLevel;
}

export interface HealthCheck {
  key: 'media' | 'identity' | 'price' | 'link';
  label: string;
  level: HealthLevel;
  detail: string;
}

export interface ProductHealth {
  level: HealthLevel;
  checks: HealthCheck[];
  media: MediaCompletion;
  link: LinkState;
  /** 0..100 — sort key (all four ok = 100). */
  score: number;
}

// constants
const PLACEHOLDER_NAMES = new Set(['', 'untitled', 'unknown', '-', '—']);
const LEVEL_POINTS: Record<HealthLevel, number> = { ok: 2, warn: 1, fail: 0 };

export const LINK_STATE_LABEL: Record<LinkState, string> = {
  live: 'Link works',
  dead: 'Link is broken',
  redirected: 'Redirects away — product likely gone',
  blocked: 'Retailer blocks our checker',
  unreachable: 'Retailer did not respond',
  policy: 'Not a checkable https link',
  unchecked: 'Not checked yet',
  missing: 'No link',
};

// helpers
function present(v: string | null | undefined): boolean {
  return !PLACEHOLDER_NAMES.has((v ?? '').trim().toLowerCase());
}

function worst(levels: HealthLevel[]): HealthLevel {
  if (levels.includes('fail')) return 'fail';
  if (levels.includes('warn')) return 'warn';
  return 'ok';
}

// main logic
export function linkStateFor(url: string | null | undefined, status: number | null | undefined): LinkState {
  if (!url || !url.trim()) return 'missing';
  if (status == null) return 'unchecked';
  if ((status >= 200 && status < 300) || status === 416) return 'live';
  if (status === -3) return 'redirected';
  if (status === 403 || status === 429) return 'blocked';
  if (status === -2) return 'unreachable';
  if (status === -1) return 'policy';
  return 'dead';
}

export function linkLevel(state: LinkState): HealthLevel {
  if (state === 'live') return 'ok';
  if (state === 'dead' || state === 'redirected' || state === 'missing') return 'fail';
  return 'warn';
}

/** Media is complete when the primary image is polished AND the video and
 *  its poster both exist. */
export function mediaCompletion(i: Pick<HealthInput, 'primaryImageUrl' | 'primaryImagePolished' | 'posterUrl' | 'videoUrl'>): MediaCompletion {
  const polished = !!i.primaryImageUrl && i.primaryImagePolished === true;
  const poster = !!i.posterUrl;
  const video = !!i.videoUrl;
  const done = [polished, poster, video].filter(Boolean).length;
  return { polished, poster, video, done, level: done === 3 ? 'ok' : done === 0 ? 'fail' : 'warn' };
}

export function productHealth(i: HealthInput): ProductHealth {
  const media = mediaCompletion(i);
  const missingMedia = [!media.polished && 'polished image', !media.poster && 'poster', !media.video && 'video'].filter(Boolean);
  const nameOk = present(i.name);
  const brandOk = present(i.brand);
  const priceOk = /\d/.test(i.price ?? '');
  const link = linkStateFor(i.url, i.urlStatus);
  const checks: HealthCheck[] = [
    {
      key: 'media',
      label: 'Media',
      level: media.level,
      detail: media.done === 3 ? 'Polished image, poster and video' : `${media.done}/3 — missing ${missingMedia.join(', ')}`,
    },
    {
      key: 'identity',
      label: 'Name & brand',
      level: nameOk && brandOk ? 'ok' : 'fail',
      detail: nameOk && brandOk ? 'Both set' : !nameOk && !brandOk ? 'Missing name and brand' : !nameOk ? 'Missing name' : 'Missing brand',
    },
    {
      key: 'price',
      label: 'Price',
      level: priceOk ? 'ok' : 'fail',
      detail: priceOk ? (i.price ?? '').trim() : 'No price',
    },
    {
      key: 'link',
      label: 'Link',
      level: linkLevel(link),
      detail: LINK_STATE_LABEL[link],
    },
  ];
  const points = checks.reduce((n, c) => n + LEVEL_POINTS[c.level], 0);
  return {
    level: worst(checks.map(c => c.level)),
    checks,
    media,
    link,
    score: Math.round((points / (checks.length * 2)) * 100),
  };
}

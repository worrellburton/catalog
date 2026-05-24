// Edge function — returns the SPA index.html shell with Open Graph
// meta tags injected for one specific look / creator / product /
// brand URL. Wired through vercel.json so only known crawler /
// link-unfurler user-agents (iMessage's facebookexternalhit + Applebot,
// Slack's Slackbot, Twitter, Discord, WhatsApp, Telegram, LinkedIn)
// hit this path; real browsers continue to receive the static
// index.html via the existing /(.*) rewrite.
//
// Why edge vs serverless: link preview crawlers expect a fast TTFB
// (~3 s ceiling on most platforms) and small payloads. Edge keeps
// the round trip below 500 ms in practice; the Supabase REST hop is
// the only network call we do per request.
//
// Slug formats matched (see app/utils/slug.ts):
//   /l/<creator?>-<title?>-<lookId>           → look
//   /p/<brand?>-<name?>-<8-char-uuid>         → product
//   /b/<brand-kebab>                          → brand
//   /c/<creator-kebab>                        → creator catalog
//   /?q=<query>                               → search-filtered catalog
//
// Anything else falls through to the generic shell with default
// catalog.shop OG tags.

export const config = { runtime: 'edge' };

const SUPABASE_URL = (globalThis as { process?: { env?: Record<string, string> } })
  .process?.env?.VITE_SUPABASE_URL ?? 'https://vtarjrnqvcqbhoclvcur.supabase.co';
const SUPABASE_ANON_KEY = (globalThis as { process?: { env?: Record<string, string> } })
  .process?.env?.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY ?? '';

// Universal image fallback. When a look/product/brand/search resolves
// without a specific hero image, the iMessage card would otherwise
// render image-less (which Apple downgrades to the bare compass icon).
// Pointing every miss at og-default.svg guarantees a real card every
// time. The SVG is shipped from /public so it's edge-cached for free.
const DEFAULT_OG_IMAGE = 'https://catalog.shop/og-default.svg';

interface OgMeta {
  title: string;
  description: string;
  image: string | null;
  url: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function metaTags(m: OgMeta): string {
  // Always emit an og:image — fall back to the branded default so
  // iMessage never shows the "compass icon" bare-link state.
  const finalImage = m.image || DEFAULT_OG_IMAGE;
  return [
    `<meta property="og:type" content="website"/>`,
    `<meta property="og:site_name" content="catalog"/>`,
    `<meta property="og:title" content="${escapeHtml(m.title)}"/>`,
    `<meta property="og:description" content="${escapeHtml(m.description)}"/>`,
    `<meta property="og:url" content="${escapeHtml(m.url)}"/>`,
    `<meta property="og:image" content="${escapeHtml(finalImage)}"/>`,
    `<meta property="og:image:alt" content="${escapeHtml(m.title)}"/>`,
    `<meta name="twitter:card" content="summary_large_image"/>`,
    `<meta name="twitter:title" content="${escapeHtml(m.title)}"/>`,
    `<meta name="twitter:description" content="${escapeHtml(m.description)}"/>`,
    `<meta name="twitter:image" content="${escapeHtml(finalImage)}"/>`,
    `<meta name="description" content="${escapeHtml(m.description)}"/>`,
  ].join('');
}

async function supaGet(path: string): Promise<unknown> {
  if (!SUPABASE_ANON_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// Slug suffix patterns mirror app/utils/slug.ts. Look slugs end in
// either a numeric legacy_id (/l/quiet-luxury-1) or an 8-char uuid
// prefix; product slugs always end in the 8-char uuid prefix.
function extractTrailingNumber(slug: string): number | null {
  const m = slug.match(/(?:^|-)(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}
function extractTrailingHexPrefix(slug: string): string | null {
  const m = slug.match(/(?:^|-)([0-9a-f]{8})$/i);
  return m ? m[1].toLowerCase() : null;
}

// Convert an 8-char UUID prefix into a [gte, lt) UUID range so the
// lookup can use the primary-key b-tree index instead of a LIKE
// substring scan. PostgREST takes `id=gte.X&id=lt.Y` to mean
// `WHERE id >= X AND id < Y`. ~50-100× faster than `id=like.X*` once
// the table grows past a few thousand rows.
function uuidPrefixRange(prefix: string): { gte: string; lt: string } | null {
  if (!/^[0-9a-f]{8}$/.test(prefix)) return null;
  const hex = parseInt(prefix, 16);
  if (!Number.isFinite(hex)) return null;
  const upperHex = ((hex + 1) >>> 0).toString(16).padStart(8, '0');
  return {
    gte: `${prefix}-0000-0000-0000-000000000000`,
    lt:  `${upperHex}-0000-0000-0000-000000000000`,
  };
}

async function lookMeta(slug: string, fullUrl: string): Promise<OgMeta> {
  const fallback: OgMeta = {
    title: 'Shop this look on catalog',
    description: 'Discover the look and shop every product on catalog.shop.',
    image: null,
    url: fullUrl,
  };
  const legacyId = extractTrailingNumber(slug);
  const uuidPrefix = extractTrailingHexPrefix(slug);
  let lookRow: { id: string; title: string | null; description: string | null; user_id: string | null; creator_handle: string | null } | null = null;

  if (legacyId !== null) {
    const rows = await supaGet(`looks?legacy_id=eq.${legacyId}&select=id,title,description,user_id,creator_handle&limit=1`) as Array<typeof lookRow>;
    if (Array.isArray(rows) && rows[0]) lookRow = rows[0]!;
  }
  if (!lookRow && uuidPrefix) {
    const range = uuidPrefixRange(uuidPrefix);
    if (range) {
      const rows = await supaGet(`looks?id=gte.${range.gte}&id=lt.${range.lt}&select=id,title,description,user_id,creator_handle&limit=1`) as Array<typeof lookRow>;
      if (Array.isArray(rows) && rows[0]) lookRow = rows[0]!;
    }
  }
  if (!lookRow) return fallback;

  // Hero image: the look's primary creative thumbnail. One round trip.
  const creativeRows = await supaGet(`looks_creative?look_id=eq.${lookRow.id}&is_primary=eq.true&select=thumbnail_url&limit=1`) as Array<{ thumbnail_url: string | null }>;
  const image = Array.isArray(creativeRows) ? (creativeRows[0]?.thumbnail_url ?? null) : null;

  // Resolve the creator's display name. Two sources: the static
  // creators table (curated personas) or the publisher's profile.
  let creatorName: string | null = null;
  if (lookRow.creator_handle) {
    const c = await supaGet(`creators?handle=eq.${encodeURIComponent(lookRow.creator_handle)}&select=display_name&limit=1`) as Array<{ display_name: string | null }>;
    creatorName = Array.isArray(c) ? (c[0]?.display_name ?? null) : null;
  }
  if (!creatorName && lookRow.user_id) {
    const p = await supaGet(`profiles?id=eq.${lookRow.user_id}&select=full_name&limit=1`) as Array<{ full_name: string | null }>;
    creatorName = Array.isArray(p) ? (p[0]?.full_name ?? null) : null;
  }

  const title = creatorName
    ? `Shop ${creatorName}'s look on catalog`
    : (lookRow.title ? `Shop ${lookRow.title} on catalog` : 'Shop this look on catalog');
  const description = creatorName
    ? `Every product in ${creatorName}'s look — tap to shop on catalog.shop.`
    : 'Tap to see every product in this look on catalog.shop.';
  return { title, description, image, url: fullUrl };
}

async function creatorMeta(slug: string, fullUrl: string): Promise<OgMeta> {
  const fallback: OgMeta = {
    title: 'Shop this catalog on catalog',
    description: 'Looks and products curated on catalog.shop.',
    image: null,
    url: fullUrl,
  };
  // Two routes overlap here: kebab(display_name) directly, or
  // @handle in the creators table. Try both with one query each.
  const handle = `@${slug}`;
  const byHandle = await supaGet(`creators?handle=eq.${encodeURIComponent(handle)}&select=display_name,avatar_url&limit=1`) as Array<{ display_name: string; avatar_url: string | null }>;
  let display: string | null = null;
  let avatar: string | null = null;
  if (Array.isArray(byHandle) && byHandle[0]) {
    display = byHandle[0].display_name;
    avatar = byHandle[0].avatar_url;
  }
  // Fallback: profiles full_name fuzzy match. URL slug is kebab so
  // "robert-burton" → "Robert Burton" via ilike on a flattened
  // hyphen-to-space form.
  if (!display) {
    const flat = slug.replace(/-/g, ' ');
    const rows = await supaGet(`profiles?full_name=ilike.${encodeURIComponent(flat)}&select=full_name,avatar_url&limit=1`) as Array<{ full_name: string; avatar_url: string | null }>;
    if (Array.isArray(rows) && rows[0]) {
      display = rows[0].full_name;
      avatar = rows[0].avatar_url;
    }
  }
  if (!display) return fallback;
  return {
    title: `Shop ${display}'s catalog on catalog`,
    description: `Every look and product ${display} curated — tap to shop on catalog.shop.`,
    image: avatar,
    url: fullUrl,
  };
}

async function productMeta(slug: string, fullUrl: string): Promise<OgMeta> {
  const fallback: OgMeta = {
    title: 'Shop this product on catalog',
    description: 'Find this product and the look it lives in on catalog.shop.',
    image: null,
    url: fullUrl,
  };
  const prefix = extractTrailingHexPrefix(slug);
  if (!prefix) return fallback;
  const range = uuidPrefixRange(prefix);
  if (!range) return fallback;
  const rows = await supaGet(`products?id=gte.${range.gte}&id=lt.${range.lt}&select=name,brand,image_url&limit=1`) as Array<{ name: string | null; brand: string | null; image_url: string | null }>;
  const p = Array.isArray(rows) ? rows[0] : null;
  if (!p) return fallback;
  const title = [p.brand, p.name].filter(Boolean).join(' — ') || 'Shop this product on catalog';
  return {
    title: `${title} on catalog`,
    description: 'Tap to shop and see the look this product is featured in.',
    image: p.image_url,
    url: fullUrl,
  };
}

function brandMeta(slug: string, fullUrl: string): OgMeta {
  const pretty = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    title: `Shop ${pretty} on catalog`,
    description: `Discover ${pretty} pieces and the looks they appear in on catalog.shop.`,
    image: null,
    url: fullUrl,
  };
}

// Rotate the title verb so the same query shared twice doesn't unfurl
// identically — keeps social feeds from looking spammy when the same
// catalog link rolls through multiple threads.
const SEARCH_VERBS = ['Shop', 'Get into', 'Browse', 'Find', 'Discover', 'Steal'];
const SEARCH_TAILS = [
  'looks on catalog',
  'on catalog.shop',
  '— shop the look',
  'curated on catalog',
  'fits on catalog',
];
function pickFrom<T>(arr: readonly T[], seed: string): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return arr[h % arr.length];
}

async function searchMeta(query: string, fullUrl: string): Promise<OgMeta> {
  const clean = query.trim();
  const pretty = clean
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const fallback: OgMeta = {
    title: pretty
      ? `${pickFrom(SEARCH_VERBS, clean)} ${pretty} ${pickFrom(SEARCH_TAILS, clean)}`
      : 'Shop the catalog on catalog',
    description: pretty
      ? `Every ${pretty.toLowerCase()} piece and the looks they live in — tap to shop on catalog.shop.`
      : 'Discover products through curated looks on catalog.shop.',
    image: null,
    url: fullUrl,
  };
  if (!clean) return fallback;

  // Hero image: first product with an image whose name or brand
  // matches the search query. One Supabase round trip; falls back
  // to no image when nothing hits.
  const orClause = `name.ilike.%${clean}%,brand.ilike.%${clean}%`;
  const rows = await supaGet(
    `products?or=(${encodeURIComponent(orClause)})&image_url=not.is.null&select=image_url,brand,name&limit=1`,
  ) as Array<{ image_url: string | null; brand: string | null; name: string | null }>;
  const hit = Array.isArray(rows) ? rows[0] : null;
  if (!hit) return fallback;
  return { ...fallback, image: hit.image_url ?? null };
}

// Root-URL defaults are admin-editable via /admin/sharing. Reading
// them here lets the admin update the iMessage card without a
// redeploy — the edge function picks up new values on the next
// crawler hit.
async function rootMeta(fullUrl: string): Promise<OgMeta> {
  const fallback: OgMeta = {
    title: 'catalog — shop the look',
    description: 'A creator-powered shopping platform where every look is shoppable. Tap in.',
    image: null,
    url: fullUrl,
  };
  const rows = await supaGet(
    `app_settings?key=in.(share.title,share.description,share.image_url)&select=key,value`,
  ) as Array<{ key: string; value: string | null }> | null;
  if (!Array.isArray(rows)) return fallback;
  const map = new Map(rows.map(r => [r.key, r.value ?? '']));
  return {
    title: map.get('share.title') || fallback.title,
    description: map.get('share.description') || fallback.description,
    image: map.get('share.image_url') || null,
    url: fullUrl,
  };
}

async function resolveMeta(pathname: string, fullUrl: string, query: string | null): Promise<OgMeta> {
  const m = pathname.match(/^\/(l|p|b|c)\/(.+?)\/?$/);
  if (m) {
    const [, type, slug] = m;
    const safeSlug = decodeURIComponent(slug);
    if (type === 'l') return lookMeta(safeSlug, fullUrl);
    if (type === 'p') return productMeta(safeSlug, fullUrl);
    if (type === 'c') return creatorMeta(safeSlug, fullUrl);
    if (type === 'b') return brandMeta(safeSlug, fullUrl);
  }
  // Root path with a search query — the user shared a filtered
  // catalog like catalog.shop/?q=jeans. Unfurl as that filter.
  if ((pathname === '/' || pathname === '') && query && query.trim()) {
    return searchMeta(query, fullUrl);
  }
  // Generic catalog landing — admin-editable via /admin/sharing.
  return rootMeta(fullUrl);
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const target = url.searchParams.get('path') || url.pathname;
  // For search-filter unfurls we route /?q=<query> through vercel.json
  // and the rewrite carries the q value over as a query param. Read
  // it back here so the unfurled card reflects the filter.
  const query = url.searchParams.get('q');
  const queryString = query ? `?q=${encodeURIComponent(query)}` : '';
  const fullUrl = `https://catalog.shop${target}${queryString}`;
  const meta = await resolveMeta(target, fullUrl, query);

  // Fetch the static SPA shell so the same JS/CSS hashes ship through
  // — link unfurlers only read the head, but real bot fallbacks
  // (e.g. Apple's deep-preview) still expect a renderable shell.
  let shell = '';
  try {
    const res = await fetch(new URL('/index.html', `https://${url.host}`).toString());
    shell = await res.text();
  } catch {
    // If the shell fetch fails (rare), return a minimal HTML so the
    // crawler still gets meta tags.
    shell = `<!DOCTYPE html><html><head><title>catalog</title></head><body></body></html>`;
  }

  // Inject our meta tags right after <head>. Replace any existing
  // <title> + generic <meta name="description"> so the unfurled
  // preview reflects this slug.
  const headInjection = `<title>${escapeHtml(meta.title)}</title>${metaTags(meta)}`;
  shell = shell
    .replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace(/<meta\s+name="description"[^>]*>/i, '')
    .replace(/<head>/i, `<head>${headInjection}`);

  return new Response(shell, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Aggressive edge cache — link unfurls are deterministic for the
      // same URL until the underlying content (creator name, product
      // image, share.* admin settings) actually changes. s-maxage on
      // Vercel's edge keeps the function cold for an hour; SWR lets a
      // stale response serve while we refresh in the background. The
      // browser cache (max-age) stays short so the iMessage / Slack
      // crawler doesn't re-pull a stale title.
      'Cache-Control': 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}

/* Slug helpers for shareable product / look / brand URLs.
 *
 * URL shape:
 *   /p/<kebab-of-brand-and-name>-<8-char-uuid-prefix>
 *   /l/<kebab-of-creator-and-title>-<8-char-uuid-prefix>
 *   /b/<kebab-of-brand>
 *
 * The kebab portion is purely for humans — the lookup happens via
 * the trailing 8-char UUID prefix (which is unique enough at our
 * scale). For brands, the slug *is* the brand (no UUID needed; brand
 * is already a unique string column).
 */

const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'for']);

/** Lowercase, ASCII-fold, kebab-case, drop punctuation + stopwords,
 *  cap at ~80 chars so the path doesn't blow up. */
export function kebab(input: string): string {
  if (!input) return '';
  return input
    .normalize('NFKD')
    // Strip combining marks (accents) so "café" → "cafe".
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // Replace anything that isn't a letter/digit/space/hyphen with space.
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean)
    .filter(word => !STOPWORDS.has(word))
    .join('-')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

/** First 8 chars of a UUID. Enough uniqueness for our catalog scale
 *  (collision probability is ~1 in 4 billion per pair). */
export function uuidPrefix(id: string): string {
  if (!id) return '';
  return id.replace(/-/g, '').slice(0, 8);
}

export interface ProductLike {
  id?: string | null;
  brand?: string | null;
  name?: string | null;
}

export function productSlug(p: ProductLike): string {
  const human = kebab([p.brand, p.name].filter(Boolean).join(' '));
  const suffix = p.id ? uuidPrefix(p.id) : '';
  if (!human && !suffix) return '';
  if (!suffix) return human;
  return human ? `${human}-${suffix}` : suffix;
}

export interface LookLike {
  id?: string | number | null;
  creator?: string | null;
  title?: string | null;
}

export function lookSlug(l: LookLike): string {
  const human = kebab([l.creator, l.title].filter(Boolean).join(' '));
  // Look IDs in the seed data are simple numbers; pass them through
  // verbatim so the URL ends with /quiet-luxury-1 etc. UUID looks
  // (if/when looks move to the DB) get the same 8-char prefix
  // treatment products use.
  const idStr = l.id == null ? '' : String(l.id);
  const suffix = /^\d+$/.test(idStr) ? idStr : uuidPrefix(idStr);
  if (!human && !suffix) return '';
  if (!suffix) return human;
  return human ? `${human}-${suffix}` : suffix;
}

/** Brand slug is just kebab(brand). Brand is a unique string column,
 *  no UUID needed. */
export function brandSlug(brand: string): string {
  return kebab(brand);
}

/** Pull the trailing 8-char UUID prefix off a product slug.
 *  Returns null when the slug doesn't end in a hex octet. */
export function extractIdPrefix(slug: string): string | null {
  if (!slug) return null;
  const m = slug.match(/(?:^|-)([0-9a-f]{8})$/i);
  return m ? m[1].toLowerCase() : null;
}

/** Pull the trailing ID off a look slug. Look IDs are numeric in
 *  the seed data, so accept any trailing number. */
export function extractLookId(slug: string): number | null {
  if (!slug) return null;
  const m = slug.match(/(?:^|-)(\d+)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

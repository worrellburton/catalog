/**
 * Cheap heuristic that decides whether a URL looks like a single
 * product detail page (PDP) — vs. a search results page, category
 * listing, homepage, or other non-product page.
 *
 * Used to reject URLs at insert time so the scraper agent never
 * burns a Claude call on something that can never succeed.
 *
 * Returns null when the URL passes; otherwise a short reason string.
 */
export function nonProductUrlReason(rawUrl: string): string | null {
  if (!rawUrl) return 'empty URL';
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return 'invalid URL';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return 'unsupported protocol';
  }

  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const path = u.pathname.toLowerCase();

  // Search engines: never product pages.
  if (host === 'google.com' || host.endsWith('.google.com')) {
    if (path.startsWith('/search') || path.startsWith('/shopping')) {
      return 'Google search results page';
    }
  }
  if (host === 'bing.com' || host === 'duckduckgo.com') return 'search engine page';

  // Bare/root paths are almost always homepages.
  if (path === '' || path === '/') return 'site homepage';

  // Common non-product path prefixes — explicit list of "this is a
  // listing/help page" markers we can detect from the URL alone.
  const badPrefixes = [
    '/search',
    '/s/',           // amazon search
    '/help',
    '/support',
    '/blog',
    '/news',
    '/about',
    '/contact',
    '/cart',
    '/checkout',
    '/login',
    '/signin',
    '/account',
    '/customer/',
  ];
  for (const p of badPrefixes) {
    if (path === p || path.startsWith(p + '/') || path.startsWith(p)) {
      // /s and /search match even without trailing slash
      if (p === '/search' || p === '/s/' || path === p) return `non-product path "${p}"`;
    }
  }

  // Amazon: real product pages contain /dp/ or /gp/product/.
  if (host === 'amazon.com' || host.endsWith('.amazon.com')) {
    if (!path.includes('/dp/') && !path.includes('/gp/product/')) {
      return 'Amazon non-product page (no /dp/ in URL)';
    }
  }

  return null;
}

export function isLikelyProductUrl(url: string): boolean {
  return nonProductUrlReason(url) === null;
}

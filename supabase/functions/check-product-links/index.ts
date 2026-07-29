// check-product-links
//
// Rotating link-health probe. Each run checks the 50 least-recently-checked
// active products and records the outbound URL's HTTP status. Never fetches
// the page body beyond a small Range slice - we only need the status code.
//
// 403 is recorded AS 403 and read as "bot_blocked" (reachable, anti-bot) by
// link_health_summary() - NOT lumped in with dead links. Baseline measured
// 2026-07-28 over 341 active URLs: 268 live, 58 x 403, 15 genuinely dead; a
// 403'd lululemon PDP rendered fine in a real browser with a matching price.
//
// SAFETY:
//   - SSRF: only https:// URLs whose resolved host is public are fetched;
//     a URL that fails validation is recorded url_status=0 and never fetched.
//     Redirects are followed manually (redirect:'manual') so each hop's
//     target is re-validated against the same rules, capped at 5 hops.
//   - Every per-product check is individually try/caught - one bad URL
//     (timeout, DNS failure, malformed response) records status 0 and the
//     run continues to the next product.
//
// Triggered by cron 'pipeline-link-health' (see migration
// 20260729000006_link_health.sql) via a service-role bearer token.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const BATCH_SIZE = 50;
const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 15_000;

// SSRF guard: block private/loopback/link-local hosts. Same ranges as the
// sibling verify-product-image function.
// ponytail: does NOT defend DNS-rebinding (a public host resolving to a
// private IP) - Deno has no resolve-then-pin hook; acceptable since these
// URLs come from our own crawled/scraped catalog, not arbitrary input.
function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.internal') || h.endsWith('.local')) return true;
  // IPv6 rules apply ONLY to IPv6 literals. Testing these prefixes against
  // bare hostnames blocks real domains: fcuk.com (French Connection UK, an
  // actual apparel brand in this catalog's space), fdny.org, anything
  // starting fc/fd. An IPv6 literal always contains a colon; a hostname
  // never does.
  if (h.includes(':')) {
    if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
  }
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 169 && b === 254) return true;           // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;  // CGNAT
  }
  return false;
}

function urlAllowed(u: string): URL | null {
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'https:') return null;
    if (isBlockedHost(parsed.hostname)) return null;
    return parsed;
  } catch { return null; }
}

// Returns the HTTP status of the product URL, or 0 if it failed SSRF
// validation, timed out, or could not be reached at all. Follows redirects
// manually so every hop is re-validated; a redirect chain that exceeds
// MAX_REDIRECTS or points at a blocked host also resolves to 0.
async function checkLinkStatus(rawUrl: string, signal: AbortSignal): Promise<number> {
  let target = urlAllowed(rawUrl);
  if (!target) return 0; // non-https or private/loopback host - never fetched

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(target.href, {
      method: 'GET',
      headers: { 'User-Agent': UA, Range: 'bytes=0-2048' },
      redirect: 'manual',
      signal,
    });
    await res.body?.cancel();

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc || hop === MAX_REDIRECTS) return 0; // dead-end / cap exceeded
      const next = urlAllowed(new URL(loc, target.href).href);
      if (!next) return 0; // redirect target failed SSRF check
      target = next;
      continue;
    }
    return res.status;
  }
  return 0;
}

Deno.serve(async () => {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: rows } = await admin
    .from('products')
    .select('id, url')
    .eq('is_active', true)
    .not('url', 'is', null)
    .order('url_checked_at', { ascending: true, nullsFirst: true })
    .limit(BATCH_SIZE);

  let checked = 0;
  for (const r of rows ?? []) {
    let status = 0;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      try {
        status = await checkLinkStatus(r.url as string, ctrl.signal);
      } finally {
        clearTimeout(t);
      }
    } catch {
      status = 0; // connection failure / timeout / abort - never let one URL kill the run
    }
    await admin.from('products')
      .update({ url_status: status, url_checked_at: new Date().toISOString() })
      .eq('id', r.id);
    checked++;
  }

  return new Response(JSON.stringify({ checked }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

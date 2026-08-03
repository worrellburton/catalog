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
//     a URL that fails validation is recorded url_status=-1 (blocked_by_policy)
//     and never fetched. Redirects are followed manually (redirect:'manual')
//     so each hop's target is re-validated against the same rules, capped at
//     5 hops.
//   - Every per-product check is individually try/caught - one bad URL
//     (timeout, DNS failure, malformed response) records url_status=-2
//     (unreachable) and the run continues to the next product.
//   - Sentinel codes (-1, -2) are distinct from real HTTP statuses so
//     link_health_summary() can tell "we didn't fetch it" apart from a
//     genuine 404 — see migration 20260729000010_link_health_sentinels.sql.
//     0 is intentionally left unused.
//
// Triggered by cron 'pipeline-link-health' (see migration
// 20260729000006_link_health.sql) via a service-role bearer token.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { urlAllowed } from '../_shared/ssrf-guard.ts';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/131.0 Safari/537.36';
// Sequential fetching capped coverage at ~50/day, which is ~6 days to sweep a
// 341-product catalog — long enough that the dashboard shows mostly
// 'unchecked'. The work is I/O-bound, so a small concurrency pool lifts the
// batch without lengthening the run. Kept modest: these are other people's
// servers, and a burst reads like a scrape.
const BATCH_SIZE = 150;
const CONCURRENCY = 6;
const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 15_000;

// SSRF guard (isBlockedHost / urlAllowed) lives in ../_shared/ssrf-guard.ts —
// shared with the sibling verify-product-image function so a fix applies to
// both fetchers of untrusted merchant/candidate URLs at once.

// Sentinel status codes — distinct from real HTTP statuses so downstream
// buckets (link_health_summary()) don't conflate "we chose not to fetch this"
// or "the network never answered" with a genuine dead link (404/410/etc).
const STATUS_BLOCKED_BY_POLICY = -1;
const STATUS_UNREACHABLE = -2;

// Returns the HTTP status of the product URL, STATUS_BLOCKED_BY_POLICY if it
// (or a redirect hop) failed SSRF validation, or STATUS_UNREACHABLE if the
// redirect chain dead-ended / exceeded MAX_REDIRECTS. Redirects are followed
// manually so every hop is re-validated.
async function checkLinkStatus(rawUrl: string, signal: AbortSignal): Promise<number> {
  let target = urlAllowed(rawUrl);
  if (!target) return STATUS_BLOCKED_BY_POLICY; // non-https or private/loopback host - never fetched

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
      if (!loc || hop === MAX_REDIRECTS) return STATUS_UNREACHABLE; // dead-end / cap exceeded
      const next = urlAllowed(new URL(loc, target.href).href);
      if (!next) return STATUS_BLOCKED_BY_POLICY; // redirect target failed SSRF check
      target = next;
      continue;
    }
    return res.status;
  }
  return STATUS_UNREACHABLE;
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

  const queue = [...(rows ?? [])];
  let checked = 0;

  async function worker() {
    for (;;) {
      const r = queue.shift();
      if (!r) return;
      let status = STATUS_UNREACHABLE;
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
        try {
          status = await checkLinkStatus(r.url as string, ctrl.signal);
        } finally {
          clearTimeout(t);
        }
      } catch {
        status = STATUS_UNREACHABLE; // timeout / DNS / abort - one bad URL must never kill the run
      }
      await admin.from('products')
        .update({ url_status: status, url_checked_at: new Date().toISOString() })
        .eq('id', r.id);
      checked++;
    }
  }

  // Workers share one queue, so a slow host delays only its own worker rather
  // than the whole batch.
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  return new Response(JSON.stringify({ checked }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

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
//
// ON DEMAND: POST { "ids": ["<product uuid>", …] } (max 100) checks exactly
// those products — the admin Data → Products Health column's "Re-check link"
// and the Tools menu's bulk re-check. The response carries each result so the
// table updates without a reload. No body = the rotating cron batch.
//
// SOFT 404s: a retired product page often 301s to the homepage or a search /
// "not found" page, which then answers 200 and used to read as live. When the
// redirect chain lands on the site root or a search/not-found path while the
// original URL pointed at a deeper page, the product is recorded as -3
// (redirected_away) — link_health_summary() buckets it with 'dead'.

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
const STATUS_REDIRECTED_AWAY = -3;
const MAX_IDS = 100;

// A landing path that means "this product is gone": the site root, or a
// search / not-found / 404 page.
const DEAD_END_PATH = /(^\/?$)|\/(search|s|404|not-?found|page-?not-?found|error)(\/|$|\?)|[?&](q|query|searchterm)=/i;

function isDeepPath(u: URL): boolean {
  return u.pathname.replace(/\/+$/, '').split('/').filter(Boolean).length >= 1;
}

// Returns the HTTP status of the product URL, STATUS_BLOCKED_BY_POLICY if it
// (or a redirect hop) failed SSRF validation, or STATUS_UNREACHABLE if the
// redirect chain dead-ended / exceeded MAX_REDIRECTS. Redirects are followed
// manually so every hop is re-validated.
async function checkLinkStatus(rawUrl: string, signal: AbortSignal): Promise<number> {
  let target = urlAllowed(rawUrl);
  if (!target) return STATUS_BLOCKED_BY_POLICY; // non-https or private/loopback host - never fetched
  const origin = target;
  let redirected = false;

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
      redirected = true;
      continue;
    }
    // Soft 404: a deep product URL that redirected onto the root or a search /
    // not-found page is gone, whatever status the landing page answers with.
    if (redirected && res.status < 400 && isDeepPath(origin)
        && DEAD_END_PATH.test(target.pathname + target.search)
        && !DEAD_END_PATH.test(origin.pathname + origin.search)) {
      return STATUS_REDIRECTED_AWAY;
    }
    return res.status;
  }
  return STATUS_UNREACHABLE;
}

Deno.serve(async (req: Request) => {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // On-demand ids (admin re-check) or the rotating batch (cron / empty body).
  let ids: string[] = [];
  if (req.method === 'POST') {
    try {
      const body = await req.json() as { ids?: unknown };
      if (Array.isArray(body.ids)) {
        ids = body.ids.filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)).slice(0, MAX_IDS);
      }
    } catch { /* no / non-JSON body → rotating batch */ }
  }

  const query = admin.from('products').select('id, url').not('url', 'is', null);
  const { data: rows } = ids.length > 0
    ? await query.in('id', ids)
    : await query
      .eq('is_active', true)
      .order('url_checked_at', { ascending: true, nullsFirst: true })
      .limit(BATCH_SIZE);

  const queue = [...(rows ?? [])];
  let checked = 0;
  const results: Array<{ id: string; url_status: number; url_checked_at: string }> = [];

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
      const checkedAt = new Date().toISOString();
      await admin.from('products')
        .update({ url_status: status, url_checked_at: checkedAt })
        .eq('id', r.id);
      results.push({ id: r.id as string, url_status: status, url_checked_at: checkedAt });
      checked++;
    }
  }

  // Workers share one queue, so a slow host delays only its own worker rather
  // than the whole batch.
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  return new Response(JSON.stringify({ checked, results }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

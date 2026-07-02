// seed-run — the seeding orchestrator. Picks due seed_targets, expands them to
// product queries, fetches via product-search {ingest}, holds the new rows
// inactive (gate decides go-live later), and records yield back on the target.
//
// Hard-gated: no-ops unless app_settings.seeding_enabled='true' AND under the
// monthly SerpAPI cap. Throttled (few targets per tick) to respect the Modal/
// SerpAPI/Anthropic limits. Called by the run_seeding_driver() cron, or POST
// { targetId } / { limit } for a manual single run from the admin page.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Calls sibling edge fns
// catalog-brainstorm + product-search with the service key.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};

const TARGETS_PER_RUN = 3;       // throttle: targets handled per invocation
const QUERIES_PER_SCENARIO = 6;  // brainstorm fan-out for a scenario
const SEED_DETAIL_LIMIT = 10;    // immersive lookups per query (merchant URL + gallery)
const CREDITS_PER_QUERY = 1 + SEED_DETAIL_LIMIT; // 1 search + up to N immersive lookups

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

interface SeedTarget {
  id: string;
  term: string;
  kind: string;
  products_found: number;
  products_published: number;
  run_count: number;
}

type Admin = ReturnType<typeof createClient>;

async function getSetting(admin: Admin, key: string): Promise<string | null> {
  const { data } = await admin.from('app_settings').select('value').eq('key', key).maybeSingle();
  return (data?.value as string) ?? null;
}

// A scenario / conversational query ("i need a dress for a wedding in october")
// fans out via brainstorm; a tight keyword ("white shoes") searches directly.
function isScenario(t: SeedTarget): boolean {
  if (t.kind === 'scenario') return true;
  return t.term.trim().split(/\s+/).length >= 4;
}

async function expandToQueries(admin: Admin, t: SeedTarget, base: string, key: string): Promise<string[]> {
  if (!isScenario(t)) return [t.term];
  try {
    const res = await fetch(`${base}/functions/v1/catalog-brainstorm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, apikey: key },
      body: JSON.stringify({ catalog: t.term, count: QUERIES_PER_SCENARIO }),
    });
    const json = await res.json().catch(() => ({}));
    const queries = Array.isArray(json?.queries) ? json.queries.map(String).filter(Boolean) : [];
    return queries.length ? queries.slice(0, QUERIES_PER_SCENARIO) : [t.term];
  } catch {
    return [t.term];
  }
}

async function ingestQuery(base: string, key: string, query: string): Promise<string[]> {
  const res = await fetch(`${base}/functions/v1/product-search?detailLimit=${SEED_DETAIL_LIMIT}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, apikey: key },
    // Stamp the deletable flag + hold inactive AT INSERT (atomic) — the gate
    // promotes later. So a crash can never leave an untagged seeded product.
    body: JSON.stringify({ query, ingest: true, source: 'seed_serpapi', is_active: false }),
  });
  const json = await res.json().catch(() => ({}));
  return Array.isArray(json?.ingested?.ids) ? json.ingested.ids.map(String) : [];
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  try {
    const base = Deno.env.get('SUPABASE_URL') || '';
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!base || !key) return jsonRes({ success: false, error: 'supabase env missing' }, 500);
    const admin = createClient(base, key);

    const body = await req.json().catch(() => ({}));

    // ── Hard gate ───────────────────────────────────────────────────────────
    if ((await getSetting(admin, 'seeding_enabled')) !== 'true') {
      return jsonRes({ success: true, skipped: 'seeding_disabled' });
    }
    const cap = Number((await getSetting(admin, 'seeding_monthly_serpapi_cap')) || '0');
    let used = Number((await getSetting(admin, 'seeding_serpapi_used_month')) || '0');
    if (cap > 0 && used >= cap) {
      return jsonRes({ success: true, skipped: 'budget_exhausted', used, cap });
    }

    // ── Pick due targets: approved, new-first then weekly re-check ───────────
    let q = admin
      .from('seed_targets')
      .select('id, term, kind, products_found, products_published, run_count')
      .eq('status', 'approved')
      .order('priority', { ascending: false })
      .order('last_run_at', { ascending: true, nullsFirst: true });

    let targets: SeedTarget[];
    if (body.targetId) {
      const { data } = await admin
        .from('seed_targets')
        .select('id, term, kind, products_found, products_published, run_count')
        .eq('id', body.targetId)
        .maybeSingle();
      targets = data ? [data as SeedTarget] : [];
    } else {
      // only re-run targets not touched in the last 7 days
      const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
      const { data } = await q
        .or(`last_run_at.is.null,last_run_at.lt.${weekAgo}`)
        .limit(Number(body.limit) || TARGETS_PER_RUN);
      targets = (data ?? []) as SeedTarget[];
    }

    const results: Array<Record<string, unknown>> = [];

    for (const t of targets) {
      if (cap > 0 && used >= cap) break;
      const queries = await expandToQueries(admin, t, base, key);

      const allIds: string[] = [];
      for (const query of queries) {
        if (cap > 0 && used >= cap) break;
        const ids = await ingestQuery(base, key, query);
        used += CREDITS_PER_QUERY;
        allIds.push(...ids);
      }

      // Flag + hold inactive. product-search stamps these at insert too, but we
      // ALSO enforce here so the deletable flag holds even against an older
      // product-search build. The activation cron promotes once they pass
      // product_ready_for_feed (image + occasion).
      let published = 0;
      if (allIds.length) {
        await admin.from('products').update({ source: 'seed_serpapi', is_active: false, seed_target_id: t.id }).in('id', allIds);
        const { data: ready } = await admin
          .from('products')
          .select('id')
          .in('id', allIds)
          .not('styling_metadata->occasion', 'is', null);
        published = (ready ?? []).length;
      }

      await admin
        .from('seed_targets')
        .update({
          last_run_at: new Date().toISOString(),
          run_count: t.run_count + 1,
          products_found: t.products_found + allIds.length,
          products_published: t.products_published + published,
          last_result: { queries: queries.length, ingested: allIds.length, at: new Date().toISOString() },
        })
        .eq('id', t.id);

      results.push({ target: t.term, kind: t.kind, queries: queries.length, ingested: allIds.length });
    }

    // Persist running budget
    await admin.from('app_settings').upsert({ key: 'seeding_serpapi_used_month', value: String(used) });

    return jsonRes({ success: true, ran: results.length, used, cap, results });
  } catch (err) {
    return jsonRes({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

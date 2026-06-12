// affiliate-sync — pulls Shopnomix commissions and attributes creator
// revenue share.
//
// Daily at 11:00 UTC via pg_cron (public.run_affiliate_sync →
// net.http_post, migration 20260612000000). For each campaign it pages
// GET /api/v2/reporting/conversion (last 30 days by CLICK time — the
// API caps ranges at 31 days; late
// conversions and status flips OPEN→CONFIRMED/REJECTED keep updating
// the same commission_id rows), joins each conversion to our
// affiliate_clicks row by cid, and computes creator_share =
// revenue × affiliate_creator_share_pct when the click carried a
// creator attribution.
//
// Reporting keys come from Vault via the service-only RPC
// get_affiliate_secrets(); auth mirrors kaizen (service key by value or
// by capability probe).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const REPORTING_BASE = 'https://r.v2i8b.com';
const CAMPAIGNS: Array<{ id: string; secretName: string }> = [
  { id: '01KTW95FQHSPFD8SN965HQ60HP', secretName: 'shopnomix_reporting_key_content' },
  { id: '01KTW96CX43WY0NPYVS9H45B1M', secretName: 'shopnomix_reporting_key_answer' },
];
const LOOKBACK_DAYS = 30;
const MAX_PAGES = 40;

interface Conversion {
  click_id?: string | null;
  commission_id?: string | null;
  click_time?: string | null;
  revenue?: number | string | null;
  status?: string | null;
  root_domain?: string | null;
  country?: string | null;
  source?: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  let isService = !!serviceKey && bearer === serviceKey;
  if (!isService && bearer) {
    const probe = await fetch(`${supabaseUrl}/auth/v1/admin/users?per_page=1`, {
      headers: { apikey: bearer, Authorization: `Bearer ${bearer}` },
    });
    isService = probe.ok;
  }
  if (!isService) {
    return new Response(JSON.stringify({ success: false, error: 'service only' }), { status: 403 });
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const { data: secretRows, error: secretErr } = await supabase.rpc('get_affiliate_secrets');
    if (secretErr) throw new Error(`secrets: ${secretErr.message}`);
    const secrets = new Map(((secretRows ?? []) as Array<{ name: string; secret: string }>).map(r => [r.name, r.secret]));

    const { data: pctRow } = await supabase
      .from('app_settings').select('value').eq('key', 'affiliate_creator_share_pct').maybeSingle();
    const sharePct = Math.min(100, Math.max(0, parseFloat(String(pctRow?.value ?? '50')) || 50));

    const end = new Date();
    const start = new Date(end.getTime() - LOOKBACK_DAYS * 86_400_000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    let upserted = 0;
    let attributed = 0;

    for (const campaign of CAMPAIGNS) {
      const token = secrets.get(campaign.secretName);
      if (!token) continue;

      let url: string | null =
        `${REPORTING_BASE}/api/v2/reporting/conversion?campaign_id=${campaign.id}&start_date=${fmt(start)}&end_date=${fmt(end)}`;
      let pages = 0;

      while (url && pages < MAX_PAGES) {
        pages++;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`shopnomix ${res.status} (${campaign.id}): ${body.slice(0, 200)}`);
        }
        const json = await res.json() as { data?: Conversion[]; meta?: { next_page?: string | null } };
        const conversions = json.data ?? [];

        // Resolve creator attribution for this page's click ids in one query.
        const cids = conversions
          .map(c => c.click_id)
          .filter((c): c is string => !!c && /^[0-9a-f-]{36}$/i.test(c));
        const clickRows = cids.length
          ? (await supabase.from('affiliate_clicks').select('id, creator_handle').in('id', cids)).data ?? []
          : [];
        const creatorByClick = new Map(
          (clickRows as Array<{ id: string; creator_handle: string | null }>).map(r => [r.id, r.creator_handle]));

        for (const c of conversions) {
          if (!c.commission_id) continue;
          const revenue = Number(c.revenue) || 0;
          const clickId = c.click_id && /^[0-9a-f-]{36}$/i.test(c.click_id) ? c.click_id : null;
          const creator = clickId ? (creatorByClick.get(clickId) ?? null) : null;
          const { error } = await supabase.from('affiliate_conversions').upsert({
            commission_id: c.commission_id,
            click_id: clickId,
            campaign_id: campaign.id,
            click_time: c.click_time ?? null,
            revenue,
            status: c.status ?? null,
            root_domain: c.root_domain ?? null,
            country: c.country ?? null,
            source: c.source ?? null,
            creator_handle: creator,
            creator_share: creator ? Math.round(revenue * sharePct) / 100 : 0,
            raw: c as Record<string, unknown>,
            synced_at: new Date().toISOString(),
          }, { onConflict: 'commission_id' });
          if (!error) {
            upserted++;
            if (creator) attributed++;
          }
        }
        url = json.meta?.next_page ?? null;
      }
    }

    return new Response(JSON.stringify({ success: true, upserted, attributed, sharePct }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 500 },
    );
  }
});

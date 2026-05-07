// get-external-usage — proxy for external AI platform usage APIs.
// Called by the /admin/ai-usage page. Returns live monthly usage
// data for platforms that expose a REST usage endpoint.
//
// Currently supported:
//   • FAL  — GET https://api.fal.ai/v1/models/usage
//
// Modal, Google Veo, and Google Gemini do not expose a public REST
// usage API — those remain dashboard-only links in the admin UI.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  let startDate: string | undefined;
  let endDate: string | undefined;
  try {
    const body = await req.json();
    startDate = body.startDate;
    endDate = body.endDate;
  } catch { /* no body / not JSON — use defaults */ }

  // Prefer the billing/admin key (FAL_BILLING_KEY) which has usage API access.
  const falKey = Deno.env.get('FAL_BILLING_KEY') ?? Deno.env.get('FAL_KEY');

  // ── FAL usage ─────────────────────────────────────────────────────────────
  let falData: unknown = null;
  let falError: string | null = null;

  if (falKey) {
    try {
      const params = new URLSearchParams({ timezone: 'UTC' });
      if (startDate) params.set('start_date', startDate);
      if (endDate)   params.set('end_date', endDate);
      // Fall back to current billing period if no explicit dates provided
      if (!startDate && !endDate) params.set('bound_to_timeframe', 'true');

      const res = await fetch(
        `https://api.fal.ai/v1/models/usage?${params}`,
        {
          headers: {
            Authorization: `Key ${falKey}`,
            Accept: 'application/json',
          },
        },
      );
      if (res.ok) {
        const raw = await res.json() as {
          time_series?: Array<{
            bucket?: string;
            results?: Array<{
              endpoint_id: string;
              unit: string;
              quantity: number;
              unit_price: number;
              cost: number;
            }>;
          }>;
        };
        // Flatten and aggregate time-series buckets into one row per endpoint.
        const agg: Record<string, { quantity: number; cost: number; unit: string; unit_price: number }> = {};
        for (const bucket of (raw.time_series ?? [])) {
          for (const r of (bucket.results ?? [])) {
            if (!agg[r.endpoint_id]) {
              agg[r.endpoint_id] = { quantity: 0, cost: 0, unit: r.unit, unit_price: r.unit_price };
            }
            agg[r.endpoint_id].quantity += r.quantity;
            agg[r.endpoint_id].cost += r.cost;
          }
        }
        falData = Object.entries(agg)
          .map(([endpoint_id, v]) => ({ endpoint_id, ...v }))
          .sort((a, b) => b.cost - a.cost);
      } else if (res.status === 403) {
        // Inference keys are not permitted to query usage — a billing/admin
        // key is needed. Surface this as a specific code so the UI can show
        // a helpful message instead of a generic error.
        falError = 'BILLING_KEY_REQUIRED';
      } else {
        const text = await res.text().catch(() => res.statusText);
        falError = `FAL API ${res.status}: ${text.slice(0, 200)}`;
      }
    } catch (err) {
      falError = err instanceof Error ? err.message : String(err);
    }
  } else {
    falError = 'FAL_KEY secret not configured';
  }

  return json({
    fal: { data: falData, error: falError },
  });
});

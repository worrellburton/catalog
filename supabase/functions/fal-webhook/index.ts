// Edge function — fal-webhook
//
// Fal posts here when a queued request finishes (we wired the webhook
// query param in generate-look). Body shape:
//   { request_id, gateway_request_id, status: 'OK' | 'ERROR' | ..., payload: {...} }
// For video models the payload looks like { video: { url } } or
// { videos: [{ url }] }. We look up user_generations by fal_request_id
// and write status + video_url back regardless of RLS (service role).
//
// Deployed with verify_jwt=false: Fal does not present a Supabase JWT
// when calling. Authenticity check is "row matches request_id" plus
// status='generating' so a stray POST can't promote a finished row.
//
// Environment:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

interface FalCallback {
  request_id?: string;
  gateway_request_id?: string;
  status?: string;
  payload?: {
    video?: { url?: string };
    videos?: Array<{ url?: string }>;
  };
  error?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonRes({ error: 'Use POST' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return jsonRes({ error: 'Supabase env missing' }, 500);

  let body: FalCallback;
  try { body = await req.json() as FalCallback; }
  catch { return jsonRes({ error: 'Invalid JSON' }, 400); }

  const requestId = body.request_id || body.gateway_request_id;
  if (!requestId) return jsonRes({ error: 'request_id missing' }, 400);

  const admin = createClient(supabaseUrl, serviceKey);

  const { data: gen, error: lookupErr } = await admin
    .from('user_generations')
    .select('id, status')
    .eq('fal_request_id', requestId)
    .maybeSingle();

  if (lookupErr) return jsonRes({ error: lookupErr.message }, 500);
  if (!gen) {
    // Either the row was deleted or we never recorded the request_id.
    // 200 to stop Fal retries — there's nothing for us to do.
    return jsonRes({ acknowledged: true, matched: false });
  }

  // Idempotency: a Fal retry can land after we've already written the
  // result. Refuse to overwrite anything that's already terminal.
  if (gen.status === 'done' || gen.status === 'failed') {
    return jsonRes({ acknowledged: true, already: gen.status });
  }

  const ok = body.status === 'OK';
  const videoUrl = body.payload?.video?.url || body.payload?.videos?.[0]?.url || null;

  const update = ok && videoUrl
    ? { status: 'done', video_url: videoUrl, error: null, completed_at: new Date().toISOString() }
    : { status: 'failed', error: body.error || `Fal status: ${body.status || 'unknown'}`, completed_at: new Date().toISOString() };

  const { error: updateErr } = await admin
    .from('user_generations')
    .update(update)
    .eq('id', gen.id);

  if (updateErr) return jsonRes({ error: updateErr.message }, 500);
  return jsonRes({ acknowledged: true, generation_id: gen.id, status: update.status });
});

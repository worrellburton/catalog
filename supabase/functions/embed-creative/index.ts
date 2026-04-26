// embed-creative — submits a product_creative video to TwelveLabs Marengo 3.0
// for embedding. Two-step API:
//   1. POST /v1.3/assets        — register the video URL as a TwelveLabs asset
//   2. POST /v1.3/embed-v2/tasks — kick off the embedding task
// Then store the returned task_id on the row. The companion `embed-poll`
// function picks it up and writes the resulting vector once TwelveLabs is done.
//
// Request:  { id: <product_creative.id> }
// Response: { ok: true, task_id } | { ok: false, error }
//
// Required Supabase secrets:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   TWELVELABS_API_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TL_BASE = 'https://api.twelvelabs.io/v1.3';
const TL_MODEL = 'marengo3.0';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonRes({ ok: false, error: 'Use POST' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const tlKey       = Deno.env.get('TWELVELABS_API_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return jsonRes({ ok: false, error: 'Supabase env missing' }, 500);
  if (!tlKey) return jsonRes({ ok: false, error: 'TWELVELABS_API_KEY missing' }, 500);

  let body: { id?: string };
  try { body = await req.json(); } catch { return jsonRes({ ok: false, error: 'Invalid JSON' }, 400); }
  const id = body.id;
  if (!id) return jsonRes({ ok: false, error: 'id required' }, 400);

  const admin = createClient(supabaseUrl, serviceKey);

  const { data: row, error: fetchErr } = await admin
    .from('product_creative')
    .select('id, video_url, embedding_task_id, embedding')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr) return jsonRes({ ok: false, error: fetchErr.message }, 500);
  if (!row) return jsonRes({ ok: false, error: 'creative not found' }, 404);
  if (!row.video_url) return jsonRes({ ok: false, error: 'video_url is null' }, 400);
  if (row.embedding) return jsonRes({ ok: true, skipped: 'already embedded' });
  if (row.embedding_task_id) return jsonRes({ ok: true, skipped: 'task in flight', task_id: row.embedding_task_id });

  // 1. Register the video as a TwelveLabs asset (multipart, per their API).
  const assetForm = new FormData();
  assetForm.append('method', 'url');
  assetForm.append('url', row.video_url);
  const assetRes = await fetch(`${TL_BASE}/assets`, {
    method: 'POST',
    headers: { 'x-api-key': tlKey },
    body: assetForm,
  });
  if (!assetRes.ok) {
    const text = await assetRes.text();
    return jsonRes({ ok: false, stage: 'assets', status: assetRes.status, error: text.slice(0, 500) }, 502);
  }
  const assetJson = await assetRes.json() as { id?: string; _id?: string };
  const assetId = assetJson.id ?? assetJson._id;
  if (!assetId) return jsonRes({ ok: false, stage: 'assets', error: 'no asset id', body: assetJson }, 502);

  // 2. Kick off the embedding task.
  const taskRes = await fetch(`${TL_BASE}/embed-v2/tasks`, {
    method: 'POST',
    headers: { 'x-api-key': tlKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input_type: 'video',
      model_name: TL_MODEL,
      video: { media_source: { asset_id: assetId } },
    }),
  });
  if (!taskRes.ok) {
    const text = await taskRes.text();
    return jsonRes({ ok: false, stage: 'tasks', status: taskRes.status, error: text.slice(0, 500) }, 502);
  }
  const taskJson = await taskRes.json() as { task_id?: string; id?: string; _id?: string };
  const taskId = taskJson.task_id ?? taskJson.id ?? taskJson._id;
  if (!taskId) return jsonRes({ ok: false, stage: 'tasks', error: 'no task id', body: taskJson }, 502);

  // 3. Persist the task id so embed-poll can pick it up.
  const { error: updErr } = await admin
    .from('product_creative')
    .update({ embedding_task_id: taskId })
    .eq('id', id);
  if (updErr) return jsonRes({ ok: false, stage: 'update', error: updErr.message }, 500);

  return jsonRes({ ok: true, task_id: taskId, asset_id: assetId });
});

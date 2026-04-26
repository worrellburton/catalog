// embed-poll — sweeps product_creative rows that have an in-flight TwelveLabs
// embedding task and writes the embedding vector into the row when ready.
//
// Marengo 3.0's embed-v2 API doesn't expose a completion webhook, so we poll.
// Designed to be invoked on-demand (admin button, manual cron) or via pg_cron
// once the pipeline is verified.
//
// Request body (all optional):
//   { ids: ["uuid", ...] }   — restrict to these creative ids
//   { limit: 25 }            — cap how many rows to check this run
// Default: sweeps every row with embedding_task_id IS NOT NULL AND embedding IS NULL,
// up to 25 rows.
//
// Response: { ok, swept, ready, still_processing, failed, errors[] }
//
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TWELVELABS_API_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TL_BASE = 'https://api.twelvelabs.io/v1.3';

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

interface EmbedSegment {
  embedding: number[];
  embedding_option?: string;
  embedding_scope?: string;
  start_sec?: number;
  end_sec?: number;
}

// Pick the single best embedding from a TwelveLabs response. Strategy:
//   1. Prefer scope=full + option=visual (one vector for the whole video).
//   2. Fall back to mean-pooling the visual segments.
//   3. Final fallback: first available embedding.
function pickEmbedding(segments: EmbedSegment[]): number[] | null {
  if (!segments?.length) return null;
  const visual = segments.filter(s => s.embedding_option === 'visual' && Array.isArray(s.embedding));
  if (visual.length === 0) return segments[0]?.embedding ?? null;

  const full = visual.find(s => s.embedding_scope === 'full');
  if (full) return full.embedding;

  // mean-pool clip-level visual embeddings
  const dim = visual[0].embedding.length;
  const sum = new Float64Array(dim);
  for (const s of visual) {
    if (s.embedding.length !== dim) continue;
    for (let i = 0; i < dim; i++) sum[i] += s.embedding[i];
  }
  const out = new Array<number>(dim);
  for (let i = 0; i < dim; i++) out[i] = sum[i] / visual.length;
  return out;
}

// pgvector accepts text in the form '[0.1,0.2,...]' on insert/update.
function toPgVectorLiteral(v: number[]): string {
  return '[' + v.join(',') + ']';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonRes({ ok: false, error: 'Use POST' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const tlKey       = Deno.env.get('TWELVELABS_API_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return jsonRes({ ok: false, error: 'Supabase env missing' }, 500);
  if (!tlKey) return jsonRes({ ok: false, error: 'TWELVELABS_API_KEY missing' }, 500);

  let body: { ids?: string[]; limit?: number } = {};
  try {
    if (req.headers.get('content-length') !== '0') body = await req.json();
  } catch { /* tolerate empty body */ }

  const limit = Math.min(Math.max(body.limit ?? 25, 1), 100);
  const admin = createClient(supabaseUrl, serviceKey);

  let query = admin
    .from('product_creative')
    .select('id, embedding_task_id')
    .not('embedding_task_id', 'is', null)
    .is('embedding', null)
    .limit(limit);
  if (body.ids?.length) query = query.in('id', body.ids);

  const { data: rows, error: fetchErr } = await query;
  if (fetchErr) return jsonRes({ ok: false, error: fetchErr.message }, 500);

  let ready = 0;
  let stillProcessing = 0;
  let failed = 0;
  const errors: { id: string; reason: string }[] = [];

  for (const row of rows ?? []) {
    const taskId = row.embedding_task_id as string;
    const taskRes = await fetch(`${TL_BASE}/embed-v2/tasks/${encodeURIComponent(taskId)}`, {
      headers: { 'x-api-key': tlKey },
    });
    if (!taskRes.ok) {
      failed++;
      errors.push({ id: row.id, reason: `GET task ${taskRes.status}` });
      continue;
    }
    const json = await taskRes.json() as { status?: string; data?: EmbedSegment[] };
    const status = (json.status ?? '').toLowerCase();

    if (status === 'ready' || status === 'done' || status === 'succeeded') {
      const vec = pickEmbedding(json.data ?? []);
      if (!vec) {
        failed++;
        errors.push({ id: row.id, reason: 'no embedding in response' });
        await admin.from('product_creative').update({ embedding_task_id: null }).eq('id', row.id);
        continue;
      }
      const { error: updErr } = await admin
        .from('product_creative')
        .update({
          embedding: toPgVectorLiteral(vec),
          embedding_model: 'marengo3.0',
          embedded_at: new Date().toISOString(),
          embedding_task_id: null,
        })
        .eq('id', row.id);
      if (updErr) {
        failed++;
        errors.push({ id: row.id, reason: updErr.message });
      } else {
        ready++;
      }
    } else if (status === 'failed' || status === 'error') {
      failed++;
      errors.push({ id: row.id, reason: `task ${status}` });
      await admin.from('product_creative').update({ embedding_task_id: null }).eq('id', row.id);
    } else {
      stillProcessing++;
    }
  }

  return jsonRes({
    ok: true,
    swept: rows?.length ?? 0,
    ready,
    still_processing: stillProcessing,
    failed,
    errors,
  });
});

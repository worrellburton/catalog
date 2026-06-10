// generate-type-icons — draws (and daily re-draws, better) a minimalist
// SVG line icon for every node in the product_types tree. The governance
// type brain renders these inside each node circle.
//
// Modes (POST body { mode }):
//   "fill"    — only types missing an icon get one (used after new types)
//   "improve" — every icon is regenerated with the current path included
//               as the draft to beat; this is what the 6 a.m. daily cron
//               calls so the set keeps getting refined.
//
// Skips the run if the set was refreshed within the last 20h unless
// { force: true } — keeps repeated invocations from burning API calls.
//
// Required secret: ANTHROPIC_API_KEY.

import { logAiUsage } from '../_shared/ai-usage.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

interface TypeRow { id: string; name: string; icon_path: string | null; icon_updated_at: string | null; }

interface ClaudeResponse {
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Only SVG path-data characters — anything else is rejected so a bad
 *  model response can never smuggle markup into the column. */
const PATH_DATA_RE = /^[MmLlHhVvCcSsQqTtAaZz0-9 ,.\-+eE]+$/;

async function drawIcons(
  rows: TypeRow[],
  improve: boolean,
  apiKey: string,
): Promise<{ paths: Map<string, string>; inputTokens: number | null; outputTokens: number | null }> {
  const list = rows.map(r =>
    improve && r.icon_path
      ? `- id ${r.id}: "${r.name}" (current draft to BEAT: ${r.icon_path})`
      : `- id ${r.id}: "${r.name}"`,
  ).join('\n');

  const prompt = `You are an icon designer drawing a cohesive set of minimalist line icons
for a product-type taxonomy (fashion / electronics / beauty / home).

Rules for every icon:
- ONE svg path ("d" attribute data only) on a 24x24 viewBox.
- Stroke-style silhouette (the renderer applies fill:none, round caps,
  stroke-width 1.8) — draw OUTLINES, not filled shapes.
- Keep 2.5px padding from the edges; center the subject; keep the whole
  set visually consistent in weight and complexity (8–25 commands each).
- Make the object instantly recognizable at 20px: "jeans" reads as jeans,
  "fragrance" as a perfume bottle, "laptops" as a laptop.
${improve ? `- Each type lists its current draft. Improve on it: cleaner geometry,
  better proportions, more recognizable silhouette. Never return the
  draft unchanged.` : ''}

Types:
${list}

Return ONLY a JSON object mapping each id to its path data string:
{"<id>": "M4 7h16...", ...}
No prose, no code fences.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const json = (await res.json()) as ClaudeResponse;
  const text = json.content?.find(c => c.type === 'text')?.text?.trim() ?? '';
  const cleaned = text.replace(/```json\s*|```\s*/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error(`No JSON object in response: ${cleaned.slice(0, 200)}`);
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;

  const paths = new Map<string, string>();
  for (const r of rows) {
    const d = typeof parsed[r.id] === 'string' ? (parsed[r.id] as string).trim() : '';
    if (d && d.length < 2000 && PATH_DATA_RE.test(d)) paths.set(r.id, d);
  }
  return {
    paths,
    inputTokens: json.usage?.input_tokens ?? null,
    outputTokens: json.usage?.output_tokens ?? null,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonRes({ error: 'POST only' }, 405);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return jsonRes({ error: 'ANTHROPIC_API_KEY not configured' }, 500);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const rest = (path: string, init?: RequestInit) =>
    fetch(`${supabaseUrl}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });

  try {
    const body = await req.json().catch(() => ({}));
    const mode = body.mode === 'improve' ? 'improve' : 'fill';
    const force = body.force === true;

    const rowsRes = await rest('product_types?select=id,name,icon_path,icon_updated_at&order=sort');
    if (!rowsRes.ok) return jsonRes({ error: `fetch types: ${rowsRes.status}` }, 500);
    let rows = (await rowsRes.json()) as TypeRow[];

    if (mode === 'fill') rows = rows.filter(r => !r.icon_path);
    if (!rows.length) return jsonRes({ updated: 0, skipped: 'nothing to draw' });

    // Throttle: skip if the newest icon is fresher than 20h (cron retries,
    // double-invocations) unless forced.
    if (!force) {
      const newest = rows.reduce<string | null>(
        (m, r) => (r.icon_updated_at && (!m || r.icon_updated_at > m) ? r.icon_updated_at : m), null);
      if (mode === 'improve' && newest && Date.now() - new Date(newest).getTime() < 20 * 3600_000) {
        return jsonRes({ updated: 0, skipped: 'refreshed within 20h' });
      }
    }

    const t0 = Date.now();
    const { paths, inputTokens, outputTokens } = await drawIcons(rows, mode === 'improve', apiKey);

    let updated = 0;
    const now = new Date().toISOString();
    for (const [id, d] of paths) {
      const up = await rest(`product_types?id=eq.${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ icon_path: d, icon_updated_at: now }),
      });
      if (up.ok) updated++;
    }

    logAiUsage({
      platform: 'anthropic',
      operation: `type-icons-${mode}`,
      model: 'claude-sonnet-4-6',
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      status: 'success',
      metadata: { updated, requested: rows.length, ms: Date.now() - t0 },
    });
    return jsonRes({ updated, requested: rows.length, mode });
  } catch (e) {
    logAiUsage({
      platform: 'anthropic',
      operation: 'type-icons',
      model: 'claude-sonnet-4-6',
      status: 'error',
      error_message: String(e).slice(0, 500),
    });
    return jsonRes({ error: String(e).slice(0, 300) }, 500);
  }
});

// seed-curate — Claude auto-curation of the seeding queue. Classifies PENDING
// seed_targets: a real, coherent shopping search → approved; gibberish / random
// characters / test strings ("fff", "hearh", "tatinajc", "kzjs", "filler-3-x")
// → rejected. Only touches status='pending' rows, so manual decisions are never
// overwritten. No SerpAPI spend (Claude only); no-ops when the queue is clean.
//
// POST { limit?: number }  (default 50). Called by the run_seeding_curate cron
// or the "Auto-curate now" admin button.
//
// Secret: ANTHROPIC_API_KEY. Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};

const MODEL = 'claude-haiku-4-5-20251001';

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

interface Target { id: string; term: string }

function buildPrompt(terms: Target[]): string {
  const list = terms.map((t, i) => `${i}: ${t.term}`).join('\n');
  return `You are curating a shopping app's search-seeding queue. Each item below is a search term a user typed. Classify EACH as:
- "valid": a real, coherent search someone would type to find products — real words, phrases, brand names, product types, occasions or style vibes (any category: clothing, footwear, accessories, beauty, home, lifestyle, etc.).
- "invalid": gibberish, random characters, keyboard-mashing, or test strings that are NOT a real search. Examples of INVALID: "fff", "hearh", "tatinajc", "kzjs", "asdf", "qwerty", "filler-3-x", "xx", a single random letter.

Rules:
- When unsure, choose "valid" (a human can reject later). Only mark "invalid" when it is clearly nonsense / not a real search.
- Do NOT reject a term just for being short or oddly capitalized if it's a real word/brand/product.

Return ONLY a JSON array, one object per input IN ORDER, no prose:
[{"i":0,"verdict":"valid"},{"i":1,"verdict":"invalid"}, ...]

Terms:
${list}`;
}

async function classify(terms: Target[], apiKey: string): Promise<Map<number, 'valid' | 'invalid'>> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 2000, messages: [{ role: 'user', content: buildPrompt(terms) }] }),
  });
  const out = new Map<number, 'valid' | 'invalid'>();
  if (!res.ok) return out;
  const json = await res.json();
  const text: string = json?.content?.find((c: { type: string }) => c.type === 'text')?.text?.trim() ?? '';
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return out;
  try {
    const arr = JSON.parse(match[0]) as Array<{ i: number; verdict: string }>;
    for (const r of arr) {
      if (typeof r.i === 'number') out.set(r.i, r.verdict === 'invalid' ? 'invalid' : 'valid');
    }
  } catch { /* ignore parse error */ }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY') || '';
    if (!apiKey) return jsonRes({ success: false, error: 'ANTHROPIC_API_KEY not configured' }, 500);
    const admin = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '');

    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(100, Number(body.limit) || 50));

    const { data: rows } = await admin
      .from('seed_targets')
      .select('id, term')
      .eq('status', 'pending')
      .order('priority', { ascending: false })
      .limit(limit);

    const targets = (rows ?? []) as Target[];
    if (!targets.length) return jsonRes({ success: true, processed: 0, approved: 0, rejected: 0 });

    const verdicts = await classify(targets, apiKey);

    const approveIds: string[] = [];
    const rejectIds: string[] = [];
    targets.forEach((t, i) => {
      // Default to approve only when Claude explicitly said valid; if the model
      // gave no verdict for a row, leave it pending (safer than guessing).
      const v = verdicts.get(i);
      if (v === 'valid') approveIds.push(t.id);
      else if (v === 'invalid') rejectIds.push(t.id);
    });

    if (approveIds.length) {
      await admin.from('seed_targets').update({ status: 'approved' }).in('id', approveIds);
    }
    if (rejectIds.length) {
      await admin.from('seed_targets').update({ status: 'rejected', notes: 'auto-rejected: invalid term' }).in('id', rejectIds);
    }

    return jsonRes({ success: true, processed: targets.length, approved: approveIds.length, rejected: rejectIds.length });
  } catch (err) {
    return jsonRes({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

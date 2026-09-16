// style-retrace — replay the retrieval for a trace recorded before provenance
// capture existed.
//
// The INPUTS are recovered exactly: occasion, exclude ids and rotate all derive
// from style_up_messages rows the original turn had already seen when it started
// its work, which is the same source and the same algorithm the original turn
// ran. The OUTPUT is not the original pool — the catalog has gained and lost
// products since.
//
// The result is RETURNED AND NEVER STORED. Writing it into payload.retrieval
// would make a reconstruction indistinguishable from a record, and this is an
// audit surface. That is the whole design of this function.
//
// Admin-only: a reconstruction can read another shopper's occasion text (their
// recent messages) and gender, bypassing style_up_traces' owner-or-admin RLS
// (this function runs on the service role). Unlike style-up-chat there is no
// shopper-owner case to allow here.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { retrieveOccasionCandidates } from '../_shared/style-retrieval.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ success: false, error: 'method not allowed' }, 405);
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ success: false, error: 'invalid auth' }, 401);
    const { data: prof } = await admin.from('profiles').select('is_admin, role').eq('id', user.id).maybeSingle();
    const isAdmin = prof?.is_admin === true || prof?.role === 'admin' || prof?.role === 'super_admin';
    if (!isAdmin) return json({ success: false, error: 'forbidden' }, 403);

    const { trace_id } = await req.json();
    if (!trace_id) return json({ success: false, error: 'trace_id required' }, 400);

    const { data: trace } = await admin.from('style_up_traces')
      .select('id, thread_id, stylist_id, source_mode, payload, created_at')
      .eq('id', trace_id).maybeSingle();
    if (!trace) return json({ success: false, error: 'trace not found' }, 404);
    if (trace.source_mode === 'web') {
      return json({ success: false, error: 'web stylists never ran catalog retrieval' }, 400);
    }

    // style-up-chat inserts THIS turn's stylist reply + product picks (and only
    // then the trace row) — all AFTER it already read the thread. At read time,
    // the shopper's triggering message was the newest row. A cutoff at
    // trace.created_at therefore sweeps up the very picks this turn produced:
    // exclude_ids stops being empty on a first turn (changing fetchK and which
    // fallback tier is reachable — style-retrieval.ts), and the picks can never
    // appear in the pool for the UI to star. Cut at the last SHOPPER message
    // before the trace instead — that's the row the original turn actually saw
    // last.
    const { data: lastShopperRows } = await admin.from('style_up_messages')
      .select('created_at')
      .eq('thread_id', trace.thread_id)
      .eq('sender', 'shopper')
      .lt('created_at', trace.created_at)
      .order('created_at', { ascending: false })
      .limit(1);
    const cutoff = lastShopperRows?.[0]?.created_at as string | undefined;

    let priorQuery = admin.from('style_up_messages')
      .select('sender, kind, body, product_ref, created_at')
      .eq('thread_id', trace.thread_id)
      .order('created_at', { ascending: true });
    priorQuery = cutoff ? priorQuery.lte('created_at', cutoff) : priorQuery.lt('created_at', trace.created_at);
    const { data: prior } = await priorQuery;
    const turns = (prior ?? []) as Array<{ sender: string; kind: string; body: string | null; product_ref: { id?: string } | null }>;

    // Same three derivations style-up-chat performs, over the same rows.
    const occasion = turns.filter(t => t.sender === 'shopper' && t.body)
      .slice(-3).map(t => (t.body ?? '').trim()).join(' ').slice(0, 300);
    const excludeIds = [...new Set(turns.filter(t => t.kind === 'product')
      .map(t => t.product_ref?.id).filter((x): x is string => !!x))];
    const rotate = Math.max(0, turns.filter(t => t.sender === 'shopper').length - 1);

    const ctx = (trace.payload?.context ?? {}) as { gender?: string };
    const gender = ctx.gender === 'male' ? 'male' : ctx.gender === 'female' ? 'female' : 'unknown';

    // The stylist's CURRENT specialty — it may have been edited since the turn.
    // Returned in the response so the UI can name that caveat too.
    const { data: stylist } = await admin.from('style_up_stylists')
      .select('specialty').eq('id', trace.stylist_id).maybeSingle();
    const aesthetic = stylist?.specialty ?? '';

    const { cands, slots } = await retrieveOccasionCandidates(admin, {
      occasion, gender, aesthetic, excludeIds, rotate,
    });

    return json({
      success: true,
      reconstructed_at: new Date().toISOString(),
      retrieval: {
        method: 'stylist_engine', occasion, gender, aesthetic,
        exclude_ids: excludeIds, rotate, slots,
        candidates: cands.map(c => ({
          id: c.id, name: c.name, brand: c.brand, slot: c.slot, score: c.score, rank: c.rank,
        })),
      },
    });
  } catch (e) {
    return json({ success: false, error: String(e) }, 500);
  }
});

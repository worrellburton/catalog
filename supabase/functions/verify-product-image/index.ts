// verify-product-image
//
// Superset of pick-primary-image. For one product it:
//   1. LIVENESS  — fetches every candidate image; drops dead / non-image / tiny.
//   2. CORRECTNESS — Claude Haiku vision labels each live image:
//        good = a real photo of THIS product
//        junk = size chart / swatch / packaging / placeholder / UI
//        wrong = a photo of a DIFFERENT product
//        unusable = can't tell
//   3. RE-HOST   — uploads the kept images to the product-images bucket so they
//        can't rot when the merchant/gstatic/serpapi hotlink expires.
//   4. WRITE     — images[] = re-hosted kept photos (good first), image_url /
//        primary_image_url = the best good photo, plus image_verified / score.
//
// SAFETY INVARIANTS:
//   - dry_run:true  → analyse + return, write NOTHING (audit + canary).
//   - PRUNE ONLY junk + dead. 'wrong' / 'unusable' live images are ADVISORY and
//     RETAINED in the gallery (Haiku over-flags real photos as 'wrong'); they are
//     never used to demote a primary and are kept after the good images.
//   - never empty the gallery. If ZERO good images, leave images[]/image_url
//     UNTOUCHED, set image_verified=false + needs_review note, do NOT deactivate.
//   - images_raw is written ONCE (only when null) — original gallery always
//     recoverable.
//   - unchecked live images (unsupported vision format or over the payload
//     budget) are kept conservatively — we never prune what we couldn't verify.
//   - SSRF: only https:// candidates whose host is public are fetched; redirects
//     are followed manually and each hop re-validated.
//
// POST { product_id: string, dry_run?: boolean, max_images?: number }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const BUCKET = 'product-images';
const MAX_IMAGES = 8;
const MIN_BYTES = 1200;             // below this = placeholder / blank tile
const VISION_MAX_BYTES = 4_000_000; // per-image cap for the vision call
const VISION_BUDGET_BYTES = 18_000_000; // aggregate raw cap (~24MB base64, under Anthropic's ~32MB)
const FETCH_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

type Label = 'good' | 'junk' | 'wrong' | 'unusable' | 'unchecked';

interface Fetched {
  url: string;
  ok: boolean;           // live + is an image + big enough
  bytes?: Uint8Array;
  contentType?: string;  // raw (for re-host / storage)
  visionType?: string | null; // normalized for Anthropic, or null if unsupported
  reason?: string;       // why not ok: 'dead' | 'blocked' | 'notimage' | 'tiny' | 'unreachable'
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

// Anthropic accepts jpeg/png/webp/gif only. Everything else → null (skip vision).
function anthropicMediaType(ct: string): string | null {
  const c = ct.split(';')[0].trim().toLowerCase();
  if (['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(c)) return c;
  if (c === 'image/jpg') return 'image/jpeg';
  return null;
}

function extFor(ct?: string): string {
  const c = (ct || '').split(';')[0].trim().toLowerCase();
  if (c === 'image/png') return 'png';
  if (c === 'image/webp') return 'webp';
  if (c === 'image/gif') return 'gif';
  if (c === 'image/avif') return 'avif';
  return 'jpg';
}

// SSRF guard: block obviously-internal hosts. Literal private/link-local/loopback
// IPs + localhost + *.internal/.local. ponytail: does NOT defend DNS-rebinding
// (a public host resolving to a private IP) — Deno has no resolve-then-pin hook;
// acceptable since candidate URLs come from our own crawl, not arbitrary input.
function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.internal') || h.endsWith('.local')) return true;
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 169 && b === 254) return true;            // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;  // CGNAT
  }
  return false;
}

function urlAllowed(u: string): URL | null {
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'https:') return null;
    if (isBlockedHost(parsed.hostname)) return null;
    return parsed;
  } catch { return null; }
}

// Classify an HTTP status into a retire-relevant reason.
//   dead    = the resource is gone (retire / re-source candidate)
//   blocked = server refuses our IP but a browser is usually served (KEEP — the
//             feed still renders it; never retire on this)
function statusReason(code: number): string {
  if (code === 404 || code === 410) return 'dead';
  if (code === 401 || code === 403 || code === 451 || code === 429) return 'blocked';
  return `http_${code}`;
}

async function fetchImage(rawUrl: string): Promise<Fetched> {
  let target = urlAllowed(rawUrl);
  if (!target) return { url: rawUrl, ok: false, reason: 'blocked' }; // non-https / private host
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    // Follow redirects manually so each hop's host is re-validated (SSRF).
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetch(target.href, { headers: { 'User-Agent': UA }, redirect: 'manual', signal: ctrl.signal });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc || hop === MAX_REDIRECTS) return { url: rawUrl, ok: false, reason: 'dead' };
        const next = urlAllowed(new URL(loc, target.href).href);
        if (!next) return { url: rawUrl, ok: false, reason: 'blocked' };
        target = next;
        continue;
      }
      if (!res.ok) return { url: rawUrl, ok: false, reason: statusReason(res.status) };
      const ct = res.headers.get('content-type') || '';
      if (!ct.toLowerCase().startsWith('image/')) return { url: rawUrl, ok: false, reason: 'notimage' };
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length < MIN_BYTES) return { url: rawUrl, ok: false, reason: 'tiny' };
      return { url: rawUrl, ok: true, bytes: buf, contentType: ct, visionType: anthropicMediaType(ct) };
    }
    return { url: rawUrl, ok: false, reason: 'dead' };
  } catch {
    return { url: rawUrl, ok: false, reason: 'unreachable' }; // timeout / DNS / network
  } finally {
    clearTimeout(t);
  }
}

function buildPrompt(desc: string, count: number): string {
  return [
    `You are auditing an e-commerce product gallery. The product is EXACTLY: "${desc}".`,
    'Match the SPECIFIC item — including its COLOR, material, and variant when the name states one',
    '(e.g. "Khakis" → khaki/tan only; "French Blue" → that blue only; "Black" → black only).',
    `For EACH of the ${count} image(s) above (in order, starting at index 0) return two fields:`,
    ' "label": exactly one of',
    '   good     = a CLEAN photo of THIS EXACT product — same item AND the same color/variant the name specifies,',
    '              shown on its own or worn, with NO text captions, feature bullet-points, or infographic layout on it',
    '   junk     = NOT a clean product photo: size chart / measurement guide / fabric swatch / color chip / packaging /',
    '              logo / spec sheet / UI screenshot / blank or solid-color tile, OR an image with feature-callout text,',
    '              bullet captions, or an infographic/marketing layout overlaid — EVEN IF the product also appears in it',
    '   wrong    = a different product, OR the same style in a DIFFERENT COLOR/variant than the name specifies',
    '   unusable = corrupt, watermarked stock, or you cannot tell what it is',
    ' "person": true if a human model/person is visible in the image; false if it is a product-only shot',
    '           (flat-lay, packshot, laid flat, or on an invisible/ghost mannequin — no visible person).',
    'If the name does NOT specify a color, judge the label by item type only (any color is fine).',
    'Return ONLY JSON: {"images":[{"label":"good","person":true}, ...]} — one object per image, in order. No prose.',
  ].join('\n');
}

interface Verdict { label: Label; person: boolean | null }

async function classify(apiKey: string, desc: string, imgs: Fetched[]): Promise<Verdict[]> {
  const content: unknown[] = [];
  imgs.forEach((f, i) => {
    content.push({ type: 'text', text: `Image ${i}:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: f.visionType, data: bytesToBase64(f.bytes!) } });
  });
  content.push({ type: 'text', text: buildPrompt(desc, imgs.length) });

  const resp = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 600, messages: [{ role: 'user', content }] }),
  });
  if (!resp.ok) throw new Error(`Claude ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const body = await resp.json();
  const text = (body?.content?.[0]?.text || '').trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in Claude response: ${text.slice(0, 160)}`);
  const parsed = JSON.parse(match[0]) as { images?: { label?: Label; person?: boolean }[] };
  if (!Array.isArray(parsed.images)) throw new Error('Claude response missing images[]');
  return parsed.images.map(o => ({
    label: (o?.label ?? 'unchecked') as Label,
    person: typeof o?.person === 'boolean' ? o.person : null,
  }));
}

async function rehost(admin: ReturnType<typeof createClient>, productId: string, idx: number, f: Fetched): Promise<string | null> {
  const path = `products/${productId}/${idx}.${extFor(f.contentType)}`;
  const { error } = await admin.storage.from(BUCKET).upload(path, f.bytes!, { contentType: f.contentType, upsert: true });
  if (error) return null;
  const { data } = admin.storage.from(BUCKET).getPublicUrl(path);
  return data?.publicUrl ?? null;
}

const LABEL_ORDER: Record<Label, number> = { good: 0, unchecked: 1, wrong: 2, unusable: 3, junk: 9 };

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ success: false, error: 'POST only' }, 405);

  const supabaseUrl    = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const anthropicKey   = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) return json({ success: false, error: 'edge function misconfigured' });
  if (!anthropicKey) return json({ success: false, error: 'ANTHROPIC_API_KEY not configured' });

  // Auth: service-role JWT (trigger via pg_net) OR admin user JWT (admin button).
  // Same detection as pick-primary-image.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ success: false, error: 'unauthorized' }, 401);
  const token = authHeader.replace('Bearer ', '');
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  let isServiceRole = false;
  try {
    const parts = token.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload?.role === 'service_role') isServiceRole = true;
    }
  } catch { /* fall through */ }
  if (!isServiceRole) {
    const { data: { user: caller } } = await admin.auth.getUser(token);
    if (!caller) return json({ success: false, error: 'unauthorized' }, 401);
    const { data: prof } = await admin.from('profiles').select('is_admin, role').eq('id', caller.id).maybeSingle();
    const isAdmin = prof?.is_admin === true || prof?.role === 'admin' || prof?.role === 'super_admin';
    if (!isAdmin) return json({ success: false, error: 'admin only' }, 403);
  }

  let reqBody: { product_id?: string; dry_run?: boolean; max_images?: number };
  try { reqBody = await req.json(); } catch { return json({ success: false, error: 'JSON body required' }); }
  const productId = reqBody.product_id;
  const dryRun = reqBody.dry_run === true;
  const cap = Math.min(Math.max(reqBody.max_images ?? MAX_IMAGES, 1), MAX_IMAGES);
  if (!productId) return json({ success: false, error: 'product_id required' });

  const { data: prod, error: loadErr } = await admin
    .from('products')
    .select('id, brand, name, type, image_url, images, images_raw')
    .eq('id', productId)
    .maybeSingle();
  if (loadErr) return json({ success: false, error: `load: ${loadErr.message}` });
  if (!prod) return json({ success: false, error: 'product not found' });

  // Candidate source: on a RE-verify, use the ORIGINAL scrape (images_raw) so
  // packshots a prior run wrongly dropped get reconsidered; first-time verify
  // (images_raw still null) uses the live gallery with the current primary first.
  const gallery: string[] = Array.isArray(prod.images) ? prod.images.filter((u: unknown): u is string => typeof u === 'string' && u.length > 0) : [];
  const raw: string[] = Array.isArray(prod.images_raw) ? prod.images_raw.filter((u: unknown): u is string => typeof u === 'string' && u.length > 0) : [];
  const primary = typeof prod.image_url === 'string' && prod.image_url ? prod.image_url : null;
  const source = raw.length > 0 ? raw : [...(primary ? [primary] : []), ...gallery.filter(u => u !== primary)];
  const ordered = source
    .filter((u, i, a) => a.indexOf(u) === i)
    .slice(0, cap);
  if (ordered.length === 0) return json({ success: false, error: 'no candidate images' });

  // 1. Liveness — fetch all in parallel.
  const fetched = await Promise.all(ordered.map(fetchImage));

  // 2. Correctness — classify live + Anthropic-sendable images, within an
  //    aggregate byte budget. Overflow / unsupported-format images are left
  //    'unchecked' (kept conservatively, never pruned).
  const visionInputs: Fetched[] = [];
  let budget = 0;
  for (const f of fetched) {
    if (!f.ok || !f.bytes || !f.visionType) continue;
    if (f.bytes.length > VISION_MAX_BYTES) continue;
    if (budget + f.bytes.length > VISION_BUDGET_BYTES) continue;
    budget += f.bytes.length;
    visionInputs.push(f);
  }
  const desc = [prod.brand, prod.name, prod.type].filter(Boolean).join(' — ') || 'this product';
  const metaByUrl = new Map<string, Verdict>();
  if (visionInputs.length) {
    let results: Verdict[];
    try { results = await classify(anthropicKey, desc, visionInputs); }
    catch (err) { return json({ success: false, error: `vision: ${err instanceof Error ? err.message : String(err)}` }); }
    visionInputs.forEach((f, i) => metaByUrl.set(f.url, results[i] ?? { label: 'unchecked', person: null }));
  }

  // Per-candidate verdict. live-but-unclassified → 'unchecked' (kept, not pruned).
  // person: true/false from vision, null when unknown (unchecked / not live).
  const verdicts = fetched.map(f => {
    const meta = f.ok ? metaByUrl.get(f.url) : undefined;
    return {
      url: f.url,
      live: f.ok,
      label: (f.ok ? (meta?.label ?? 'unchecked') : 'unusable') as Label,
      person: meta ? meta.person : null,
      fetched: f,
    };
  });

  // KEEP policy:
  //   >=2 good  → confident set: keep ONLY good (drops off-color/variant 'wrong',
  //               size-chart junk, dead). The gallery becomes exactly-this-product.
  //   <2 good   → uncertain: keep live & not-junk, good first, retaining wrong/
  //               unusable/unchecked as ADVISORY (Haiku over-flags lone thumbnails;
  //               don't strip the gallery on a shaky single verdict).
  const goodOnly = verdicts.filter(v => v.live && v.label === 'good');
  const goodCount = goodOnly.length;
  let kept = goodCount >= 2
    ? goodOnly
    : verdicts.filter(v => v.live && v.label !== 'junk')
        .sort((a, b) => LABEL_ORDER[a.label] - LABEL_ORDER[b.label]);

  // Guarantee a person-free product shot survives. It's the reference the try-on
  // video model needs (Seedance blocks non-consented human likenesses), and Haiku
  // over-flags flat-lay packshots as 'wrong' on their flatter color — so if the
  // kept set has no person-free shot, add the best person-free non-junk one.
  if (!kept.some(v => v.person === false)) {
    const pf = verdicts
      .filter(v => v.live && v.person === false && v.label !== 'junk' && v.label !== 'unusable')
      .sort((a, b) => LABEL_ORDER[a.label] - LABEL_ORDER[b.label])[0];
    if (pf && !kept.includes(pf)) kept = [...kept, pf];
  }

  // Order the kept set so the PRIMARY (index 0) is render-safe: a person-free
  // product shot leads (also a clean catalog hero), then good on-model, then rest.
  const primaryRank = (v: { label: Label; person: boolean | null }): number => {
    if (v.person === false && (v.label === 'good' || v.label === 'wrong')) return 0;
    if (v.label === 'good') return 1;
    return 2 + LABEL_ORDER[v.label];
  };
  kept = kept.slice().sort((a, b) => primaryRank(a) - primaryRank(b));

  const anyRemoved = kept.length < ordered.length;
  const primaryLabel = kept[0]?.label ?? 'unusable';

  // Note doubles as the reconciler's action signal when zero good images:
  //   needs_review:no_good     — live images but none is a good product photo (curation/quality)
  //   needs_review:blocked     — all images hotlink-blocked to us (render in a browser → KEEP)
  //   needs_review:dead        — 404/gone/unreachable → retire / re-source candidate
  const note = (() => {
    if (goodCount > 0) return anyRemoved ? 'pruned junk/dead images' : 'clean';
    const live = verdicts.filter(v => v.live);
    if (live.length > 0) return 'needs_review:no_good';
    const reasons = verdicts.map(v => v.fetched.reason || 'unreachable');
    if (reasons.every(r => r === 'blocked')) return 'needs_review:blocked';
    if (reasons.some(r => r === 'dead' || r === 'unreachable' || r === 'tiny')) return 'needs_review:dead';
    return 'needs_review:unfetchable';
  })();
  const score = ordered.length ? Number((goodCount / ordered.length).toFixed(3)) : 0;

  const analysis = {
    candidates: ordered.length,
    labels: verdicts.map(v => ({ label: v.label, person: v.person, live: v.live, url: v.url.slice(0, 80) })),
    kept_count: kept.length,
    kept_person_free: kept.filter(v => v.person === false).length,
    good_count: goodCount,
    primary_label: primaryLabel,
    primary_person: kept[0]?.person ?? null,
  };

  if (dryRun) {
    return json({ success: true, product_id: productId, dry_run: true, wrote: false, analysis, note, score });
  }

  // ── WRITE PATH ──────────────────────────────────────────────────────────
  const update: Record<string, unknown> = {
    image_verify_score: score,
    image_verified_at: new Date().toISOString(),
    image_verify_note: note,
  };

  let primaryChanged = false;
  if (goodCount > 0) {
    // Re-host kept images (good first); fall back to original URL on upload failure.
    const rehosted: string[] = [];
    for (let i = 0; i < kept.length; i++) {
      const url = await rehost(admin, productId, i, kept[i].fetched);
      rehosted.push(url ?? kept[i].url);
    }
    if (rehosted.length > 0) {
      const newPrimary = rehosted[0]; // kept[0] is a 'good' image (good sorts first)
      primaryChanged = newPrimary !== primary;
      update.image_verified = true;   // written primary is a confirmed good photo
      update.images = rehosted;
      update.image_url = newPrimary;
      update.primary_image_url = newPrimary;
      update.primary_image_index = 0;
      update.primary_image_score = 1.0;
      update.primary_image_picked_by = 'verify';
      update.primary_image_picked_at = new Date().toISOString();
      if (prod.images_raw == null) update.images_raw = prod.images ?? []; // set-once backup
    } else {
      update.image_verified = false;
    }
  } else {
    // Zero good → do NOT touch images[] / image_url. Flag for review only.
    update.image_verified = false;
  }

  const { error: updErr } = await admin.from('products').update(update).eq('id', productId);
  if (updErr) return json({ success: false, error: `update: ${updErr.message}` });

  return json({
    success: true,
    product_id: productId,
    dry_run: false,
    wrote: true,
    analysis: { ...analysis, primary_changed: primaryChanged },
    note,
    score,
  });
});

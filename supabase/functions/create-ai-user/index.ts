import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * create-ai-user
 *
 * Provisions a new AI persona. profiles.id has a hard FK to
 * auth.users(id), so a "row in profiles with is_ai=true" still
 * requires a real auth row underneath. That requires the service
 * role key, which we never expose to the client — hence this edge
 * function.
 *
 * Flow:
 *   1. Verify the caller is an admin (is_admin=true on their profile,
 *      or role in {admin, super_admin}).
 *   2. Call auth.admin.createUser with a synthetic email so the
 *      handle_auth_user_change trigger materializes a profile row.
 *   3. Patch the new profile with is_ai=true + the supplied
 *      metadata (gender, height, age, full_name).
 *   4. Return { user_id }.
 *
 * Body (JSON):
 *   {
 *     full_name:     string,           // required
 *     gender?:       'men'|'women'|'unisex',
 *     height_cm?:    number,
 *     height_label?: string,
 *     age_label?:    string,
 *   }
 */

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

// All non-CORS failures return 200 with success:false + a useful error
// string. supabase-js's functions.invoke wraps non-2xx responses and
// hides the response body, so any non-200 status loses the diagnostic
// in the admin UI. Status 200 with success:false keeps the message
// reachable.
function errorRes(message: string) {
  console.error('[create-ai-user]', message);
  return jsonRes({ success: false, error: message }, 200);
}

interface CreateBody {
  full_name?: string;
  gender?: string;
  height_cm?: number;
  height_label?: string;
  age_label?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return errorRes('Method not allowed', 405);
  }

  const supabaseUrl    = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) {
    return errorRes('Edge function misconfigured: missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY', 500);
  }

  // ── Caller auth + admin gate ─────────────────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return errorRes('Missing or invalid Authorization header', 401);
  }
  const token = authHeader.replace('Bearer ', '');

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: { user: caller }, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !caller) return errorRes('Unauthorized', 401);

  const { data: callerProfile, error: profErr } = await admin
    .from('profiles')
    .select('is_admin, role')
    .eq('id', caller.id)
    .maybeSingle();
  if (profErr) return errorRes('Failed to load caller profile', 500);
  const isAdmin = callerProfile?.is_admin === true
    || callerProfile?.role === 'admin'
    || callerProfile?.role === 'super_admin';
  if (!isAdmin) return errorRes('Forbidden — admin role required', 403);

  // ── Parse body ──────────────────────────────────────────────────
  let body: CreateBody;
  try { body = await req.json(); }
  catch { return errorRes('Body must be JSON', 400); }

  const fullName = (body.full_name || '').trim();
  if (!fullName) return errorRes('full_name is required', 400);
  if (fullName.length > 200) return errorRes('full_name too long (max 200)', 400);

  const allowedGenders = new Set(['men', 'women', 'unisex', 'male', 'female']);
  const gender = body.gender && allowedGenders.has(body.gender) ? body.gender : null;
  const heightCm = typeof body.height_cm === 'number'
    && Number.isFinite(body.height_cm)
    && body.height_cm > 0 && body.height_cm < 300
    ? Math.round(body.height_cm) : null;
  const heightLabel = body.height_label?.toString().slice(0, 40) || null;
  const ageLabel    = body.age_label?.toString().slice(0, 40) || null;

  // ── Create the underlying auth user ─────────────────────────────
  // Synthetic email so the row is well-formed. The address is never
  // sent — email_confirm=true short-circuits the verification flow.
  const slug = crypto.randomUUID().slice(0, 8);
  const email = `ai-${slug}@catalog.ai`;

  const { data: createdAuth, error: createErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      is_ai: true,
    },
    app_metadata: { provider: 'ai_persona' },
  });
  if (createErr || !createdAuth.user) {
    return errorRes(`Failed to create auth user: ${createErr?.message || 'unknown error'}`, 500);
  }

  const newUserId = createdAuth.user.id;

  // ── Patch the profile (the trigger already created the row) ─────
  const patch: Record<string, unknown> = {
    is_ai: true,
    full_name: fullName,
    role: 'shopper',
  };
  if (gender)      patch.gender       = gender;
  if (heightCm)    patch.height_cm    = heightCm;
  if (heightLabel) patch.height_label = heightLabel;
  if (ageLabel)    patch.age_label    = ageLabel;

  const { error: updateErr } = await admin
    .from('profiles')
    .update(patch)
    .eq('id', newUserId);
  if (updateErr) {
    // The auth user exists but the profile patch failed. Roll back
    // the auth user so the AI Users list doesn't surface a half-
    // initialized row.
    await admin.auth.admin.deleteUser(newUserId).catch(() => { /* best-effort */ });
    return errorRes(`Failed to patch profile: ${updateErr.message}`, 500);
  }

  return jsonRes({ success: true, user_id: newUserId });
});

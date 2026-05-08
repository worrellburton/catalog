import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─── Shared helpers ───────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};

const ENTRY_CODES = {
  DISCOVER: 'DISCOVER',
  REWARD: 'REWARD',
  WITHDRAW: 'WITHDRAW',
  CATALOG_ORDER: 'CATALOG_ORDER',
  ADMIN_CREDIT: 'ADMIN_CREDIT',
};

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function errorRes(message: string, status = 400) {
  return jsonRes({ success: false, error: message }, status);
}

// ─── Dots API client ──────────────────────────────────────────────────────────

async function dotsRequest(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<Response> {
  const baseUrl = Deno.env.get('DOTS_API_URL') ?? 'https://pls.senddotssandbox.com/api/v2';
  const clientId = Deno.env.get('DOTS_CLIENT_ID') ?? '';
  const apiKey = Deno.env.get('DOTS_API_KEY') ?? '';
  const token = btoa(`${clientId}:${apiKey}`);

  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${token}`,
      'Content-Type': 'application/json',
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

// ─── Wallet helpers ───────────────────────────────────────────────────────────

async function getWalletSummary(userId: string, sb: ReturnType<typeof createClient>) {
  const { data } = await sb
    .from('wallet_entries')
    .select('current_balance, total_earning, total_withdraw')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    current_balance: data?.current_balance ?? 0,
    total_earning: data?.total_earning ?? 0,
    total_withdraw: data?.total_withdraw ?? 0,
  };
}

async function addWalletEntry(
  params: {
    userId: string;
    amount: number;
    type: 'credit' | 'debit' | 'on_hold';
    comment?: string;
    entryCode?: string;
  },
  sb: ReturnType<typeof createClient>,
) {
  const summary = await getWalletSummary(params.userId, sb);

  let newBalance = summary.current_balance;
  let newTotalEarning = summary.total_earning;
  let newTotalWithdraw = summary.total_withdraw;

  if (params.type === 'credit') {
    newBalance = parseFloat((newBalance + params.amount).toFixed(2));
    newTotalEarning = parseFloat((newTotalEarning + params.amount).toFixed(2));
  } else if (params.type === 'debit') {
    newBalance = parseFloat((newBalance - params.amount).toFixed(2));
    newTotalWithdraw = parseFloat((newTotalWithdraw + params.amount).toFixed(2));
  }
  // on_hold does not change balance — funds are pending Dots payout

  const { data, error } = await sb.from('wallet_entries').insert({
    user_id: params.userId,
    amount: params.amount,
    type: params.type,
    current_balance: newBalance,
    total_earning: newTotalEarning,
    total_withdraw: newTotalWithdraw,
    comment: params.comment ?? null,
    entry_code: params.entryCode ?? null,
  }).select().single();

  if (error) throw new Error(error.message);
  return data;
}

// ─── Route handlers ───────────────────────────────────────────────────────────

// POST /user — register creator for payouts
async function handleCreateUser(
  body: Record<string, unknown>,
  profile: Record<string, unknown>,
  sb: ReturnType<typeof createClient>,
) {
  if (profile.is_payout_active) {
    return errorRes('Payout account already registered');
  }

  const { first_name, last_name, country_code, phone_number, email } = body as Record<string, string>;
  if (!first_name || !last_name || !country_code || !phone_number || !email) {
    return errorRes('first_name, last_name, country_code, phone_number and email are required');
  }

  const res = await dotsRequest('/users', 'POST', {
    first_name: first_name.trim(),
    last_name: last_name.trim(),
    email: email.trim(),
    country_code: country_code.trim(),
    phone_number: phone_number.trim(),
    metadata: { internal_id: profile.id, internal_email: profile.email },
  });

  if (!res.ok) {
    // Mask Dots credential errors — surface a friendly message instead
    if (res.status === 401 || res.status === 403) {
      return errorRes('Payment service is unavailable. Please try again later.');
    }
    const err = await res.json().catch(() => ({}));
    const msg = (err as { message?: string; error?: string }).message
      ?? (err as { message?: string; error?: string }).error
      ?? 'Failed to create payout account';
    // Detect duplicate phone number error from Dots
    if (msg.toLowerCase().includes('already') || msg.toLowerCase().includes('duplicate') || msg.toLowerCase().includes('exists')) {
      return errorRes('This phone number is already registered with Dots. Use "attach existing" instead.');
    }
    return errorRes(msg);
  }

  const dotsUser = await res.json();
  if (!dotsUser?.id) return errorRes('Failed to create Dots account');

  // Save dots_user_id on profile
  await sb.from('profiles').update({ dots_user_id: dotsUser.id }).eq('id', profile.id as string);

  // Send verification token
  await dotsRequest(`/users/${dotsUser.id}/send-verification-token`, 'POST');

  return jsonRes({ success: true, dots_user_id: dotsUser.id });
}

// POST /user/check-existence — check if phone is already a Dots user
async function handleCheckExistence(body: Record<string, unknown>) {
  const { country_code, phone_number } = body as Record<string, string>;
  if (!country_code || !phone_number) {
    return errorRes('country_code and phone_number are required');
  }

  // Try a targeted GET /users?phone_number= if Dots supports it,
  // otherwise fall back to pagination; either way, swallow auth/rate errors.
  const res = await dotsRequest(
    `/users?phone_number=${encodeURIComponent(phone_number)}&country_code=${encodeURIComponent(country_code)}&limit=1`,
  );
  if (!res.ok) {
    // Can't check — treat as not existing so the create flow can proceed
    return jsonRes({ exists: false, dots_user_id: null });
  }
  const body2 = await res.json().catch(() => ({ data: [] }));
  const users: Array<{ id: string; phone_number?: { country_code: string; phone_number: string } }> =
    body2?.data ?? [];
  const found = users.find(
    u =>
      u.phone_number?.phone_number === phone_number &&
      u.phone_number?.country_code === country_code,
  ) ?? null;
  return jsonRes({ exists: !!found, dots_user_id: found?.id ?? null });
}

// POST /user/verify — verify OTP code
async function handleVerifyUser(
  body: Record<string, unknown>,
  profile: Record<string, unknown>,
  sb: ReturnType<typeof createClient>,
) {
  const dotsUserId = (profile.dots_user_id as string) ?? (body.dots_user_id as string);
  if (!dotsUserId) return errorRes('No Dots account found. Please register first.');

  const { token } = body as { token: string };
  if (!token) return errorRes('Verification token is required');

  const res = await dotsRequest(`/users/${dotsUserId}/verify`, 'POST', {
    token: token.toString(),
  });

  if (!res.ok) {
    return errorRes('Invalid verification code');
  }

  await sb.from('profiles').update({
    is_payout_verified: true,
    is_payout_active: true,
    dots_user_id: dotsUserId,
  }).eq('id', profile.id as string);

  return jsonRes({ success: true });
}

// POST /user/resend — resend OTP
async function handleResendCode(profile: Record<string, unknown>) {
  const dotsUserId = profile.dots_user_id as string;
  if (!dotsUserId) return errorRes('No Dots account found. Please register first.');

  const res = await dotsRequest(`/users/${dotsUserId}/send-verification-token`, 'POST');
  if (!res.ok) return errorRes('Failed to resend verification code');

  return jsonRes({ success: true });
}

// POST /user/attach — attach an existing Dots account
async function handleAttachExisting(
  body: Record<string, unknown>,
  profile: Record<string, unknown>,
  sb: ReturnType<typeof createClient>,
) {
  if (profile.is_payout_verified) return errorRes('Payout account already verified');

  const { country_code, phone_number } = body as Record<string, string>;
  if (!country_code || !phone_number) return errorRes('country_code and phone_number are required');

  const existing = await findDotsUserByPhone(country_code, phone_number);
  if (!existing) return errorRes('No Dots account found with this phone number');

  // Check not already attached to another user
  const { data: conflict } = await sb
    .from('profiles')
    .select('id')
    .eq('dots_user_id', existing.id)
    .neq('id', profile.id as string)
    .maybeSingle();

  if (conflict) return errorRes('This Dots account is already connected to another user');

  await sb.from('profiles').update({ dots_user_id: existing.id }).eq('id', profile.id as string);

  // Resend verification OTP
  await dotsRequest(`/users/${existing.id}/send-verification-token`, 'POST');

  return jsonRes({ success: true, dots_user_id: existing.id });
}

// GET /user/status — get Dots user details
async function handleGetStatus(profile: Record<string, unknown>) {
  const dotsUserId = profile.dots_user_id as string;
  if (!dotsUserId) return jsonRes({ connected: false });

  const res = await dotsRequest(`/users/${dotsUserId}`);
  if (!res.ok) return jsonRes({ connected: false });

  const data = await res.json();
  return jsonRes({ connected: true, ...data });
}

// DELETE /user — remove Dots registration
async function handleDeleteUser(
  profile: Record<string, unknown>,
  sb: ReturnType<typeof createClient>,
) {
  const dotsUserId = profile.dots_user_id as string;

  if (dotsUserId) {
    await dotsRequest(`/users/${dotsUserId}`, 'DELETE');
  }

  await sb.from('profiles').update({
    dots_user_id: null,
    is_payout_verified: false,
    is_payout_active: false,
    payout_withdraw_link: null,
  }).eq('id', profile.id as string);

  return jsonRes({ success: true });
}

// GET /wallet — get wallet summary + history
async function handleGetWallet(
  url: URL,
  profile: Record<string, unknown>,
  sb: ReturnType<typeof createClient>,
) {
  const userId = profile.id as string;
  const limit = Math.min(100, parseInt(url.searchParams.get('limit') ?? '50'));
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1'));
  const offset = (page - 1) * limit;

  const summary = await getWalletSummary(userId, sb);

  const { data: entries } = await sb
    .from('wallet_entries')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  return jsonRes({
    ...summary,
    payout_withdraw_link: profile.payout_withdraw_link ?? null,
    entries: entries ?? [],
  });
}

// POST /withdraw — initiate withdrawal: transfer balance to Dots then return link
async function handleWithdraw(
  profile: Record<string, unknown>,
  sb: ReturnType<typeof createClient>,
) {
  if (!profile.is_payout_active || !profile.dots_user_id) {
    return errorRes('Payout account not connected. Please complete Dots registration first.');
  }

  const userId = profile.id as string;
  const dotsUserId = profile.dots_user_id as string;

  const summary = await getWalletSummary(userId, sb);
  const balance = summary.current_balance;

  if (balance <= 0) return errorRes('No balance available to withdraw');

  // Check if last entry is already on_hold (a pending withdrawal exists)
  const { data: lastEntry } = await sb
    .from('wallet_entries')
    .select('type')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let withdrawLink: string | null = profile.payout_withdraw_link as string ?? null;

  if (lastEntry?.type !== 'on_hold') {
    // Transfer balance to Dots
    const amountInCents = Math.round(balance * 100);

    const transferRes = await dotsRequest('/payouts/send-payout', 'POST', {
      user_id: dotsUserId,
      amount: amountInCents,
    });

    if (!transferRes.ok) {
      const err = await transferRes.json().catch(() => ({}));
      return errorRes((err as { message?: string }).message ?? 'Failed to initiate withdrawal');
    }

    const transfer = await transferRes.json();

    // Save transfer record
    await sb.from('payout_transfers').insert({
      user_id: userId,
      dots_transfer_id: transfer.id ?? null,
      dots_user_id: dotsUserId,
      amount: balance,
      status: transfer.status ?? 'pending',
      raw_response: transfer,
    });

    // Mark wallet as on_hold
    await addWalletEntry({ userId, amount: balance, type: 'on_hold', comment: 'Withdrawal initiated', entryCode: ENTRY_CODES.WITHDRAW }, sb);

    withdrawLink = transfer.link ?? null;

    // If no link from send-payout, create a payout-link
    if (!withdrawLink) {
      const linkRes = await dotsRequest('/payout-links', 'POST', {
        user_id: dotsUserId,
        amount: amountInCents,
      });
      if (linkRes.ok) {
        const linkData = await linkRes.json();
        withdrawLink = linkData.link ?? null;
      }
    }

    if (withdrawLink) {
      await sb.from('profiles').update({ payout_withdraw_link: withdrawLink }).eq('id', userId);
    }
  }

  if (!withdrawLink) return errorRes('Withdrawal initiated but no payout link available yet');

  return jsonRes({ success: true, withdraw_link: withdrawLink });
}

// POST /transfer (admin) — credit a creator's wallet
async function handleAdminTransfer(
  body: Record<string, unknown>,
  sb: ReturnType<typeof createClient>,
) {
  const { user_id, amount, comment } = body as { user_id: string; amount: number; comment?: string };
  if (!user_id || !amount) return errorRes('user_id and amount are required');

  // Verify target exists
  const { data: target } = await sb
    .from('profiles')
    .select('id, dots_user_id, is_payout_active')
    .eq('id', user_id)
    .maybeSingle();

  if (!target) return errorRes('Creator not found');

  // If they have a Dots account, send via Dots
  if (target.dots_user_id && target.is_payout_active) {
    const amountInCents = Math.round(parseFloat(amount.toString()) * 100);
    const res = await dotsRequest('/payouts/send-payout', 'POST', {
      user_id: target.dots_user_id,
      amount: amountInCents,
    });

    if (res.ok) {
      const transfer = await res.json();
      await sb.from('payout_transfers').insert({
        user_id: user_id,
        dots_transfer_id: transfer.id ?? null,
        dots_user_id: target.dots_user_id,
        amount: parseFloat(amount.toString()),
        status: transfer.status ?? 'pending',
        raw_response: transfer,
      });
    }
  }

  // Always add wallet credit
  await addWalletEntry({
    userId: user_id,
    amount: parseFloat(amount.toString()),
    type: 'credit',
    comment: comment ?? 'Admin transfer',
    entryCode: ENTRY_CODES.ADMIN_CREDIT,
  }, sb);

  return jsonRes({ success: true });
}

// GET /settings
async function handleGetSettings(sb: ReturnType<typeof createClient>) {
  const { data } = await sb
    .from('payout_settings')
    .select('*')
    .order('effective_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return jsonRes(data ?? { payout_value: 5, cac: 2, frequency: 'weekly' });
}

// PUT /settings (admin)
async function handleUpdateSettings(
  body: Record<string, unknown>,
  sb: ReturnType<typeof createClient>,
) {
  const { payout_value, cac, frequency } = body as {
    payout_value: number;
    cac: number;
    frequency: string;
  };

  const validFrequencies = ['daily', 'weekly', 'biweekly', 'monthly'];
  if (frequency && !validFrequencies.includes(frequency)) {
    return errorRes('frequency must be one of: daily, weekly, biweekly, monthly');
  }

  const { data, error } = await sb
    .from('payout_settings')
    .insert({
      payout_value: payout_value ?? 5,
      cac: cac ?? 2,
      frequency: frequency ?? 'weekly',
      effective_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return errorRes('Failed to update settings');
  return jsonRes(data);
}

// GET /creators (admin) — creators list with payout status
async function handleGetCreators(
  url: URL,
  sb: ReturnType<typeof createClient>,
) {
  const search = url.searchParams.get('search') ?? '';
  const limit = Math.min(100, parseInt(url.searchParams.get('limit') ?? '50'));
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1'));
  const offset = (page - 1) * limit;

  let query = sb
    .from('profiles')
    .select('id, full_name, email, dots_user_id, is_payout_verified, is_payout_active, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (search) {
    query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);
  }

  const { data, count } = await query;
  return jsonRes({ creators: data ?? [], total: count ?? 0 });
}

// POST /webhook — Dots payout_link.paid_out event
async function handleWebhook(
  req: Request,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  // Basic secret check via custom header (matches old server pattern)
  const authHeader = req.headers.get('X-Authorization');
  const expectedSecret = Deno.env.get('DOTS_WEBHOOK_APP_KEY') ?? '';
  if (authHeader !== expectedSecret) {
    return errorRes('Unauthorized webhook', 401);
  }

  let event: Record<string, unknown>;
  try {
    event = await req.json();
  } catch {
    return errorRes('Invalid JSON payload');
  }

  if (event.type !== 'payout_link.paid_out') {
    return jsonRes({ received: true });
  }

  const dotsUserId = (event.data as Record<string, unknown>)?.user_id as string;
  if (!dotsUserId) return jsonRes({ received: true });

  const sb = createClient(supabaseUrl, serviceRoleKey);

  const { data: profile } = await sb
    .from('profiles')
    .select('id, payout_withdraw_link')
    .eq('dots_user_id', dotsUserId)
    .maybeSingle();

  if (profile) {
    // Get pending on_hold amount
    const { data: holdEntry } = await sb
      .from('wallet_entries')
      .select('amount')
      .eq('user_id', profile.id as string)
      .eq('type', 'on_hold')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const amount = holdEntry?.amount ?? 0;

    if (amount > 0) {
      await addWalletEntry({
        userId: profile.id as string,
        amount,
        type: 'debit',
        comment: 'Payout completed',
        entryCode: ENTRY_CODES.WITHDRAW,
      }, sb);
    }

    await sb.from('profiles').update({ payout_withdraw_link: null }).eq('id', profile.id as string);
  }

  return jsonRes({ received: true });
}

// ─── Utility: paginate Dots users to find by phone ────────────────────────────

async function findDotsUserByPhone(countryCode: string, phoneNumber: string) {
  let hasMore = true;
  let startingAfter: string | null = null;

  while (hasMore) {
    const params = new URLSearchParams({ limit: '100' });
    if (startingAfter) params.set('starting_after', startingAfter);

    const res = await dotsRequest(`/users?${params}`);
    if (!res.ok) return null;

    const body = await res.json();
    const users: Array<{ id: string; phone_number?: { country_code: string; phone_number: string } }> =
      body?.data ?? [];

    const found = users.find(
      u =>
        u.phone_number?.phone_number === phoneNumber &&
        u.phone_number?.country_code === countryCode,
    );
    if (found) return found;

    hasMore = body?.has_more ?? false;
    startingAfter = users.length > 0 ? users[users.length - 1].id : null;
  }

  return null;
}

// ─── Main router ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  const url = new URL(req.url);
  const path = url.pathname.replace(/.*\/dots-payout/, '') || '/';
  const method = req.method;

  // Webhook: no JWT needed, own auth via header
  if (path === '/webhook' && method === 'POST') {
    return handleWebhook(req, supabaseUrl, serviceRoleKey);
  }

  // All other routes require Bearer JWT
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return errorRes('Missing Authorization header', 401);
  }
  const token = authHeader.replace('Bearer ', '');

  const sb = createClient(supabaseUrl, serviceRoleKey);
  const { data: { user }, error: userError } = await sb.auth.getUser(token);
  if (userError || !user) return errorRes('Unauthorized', 401);

  const { data: profile } = await sb
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();
  if (!profile) return errorRes('Profile not found', 404);

  let body: Record<string, unknown> = {};
  if (method !== 'GET' && method !== 'DELETE') {
    try { body = await req.json(); } catch { /* empty body is fine */ }
  }

  // ── Settings ──────────────────────────────────────────────────────────────
  if (path === '/settings' && method === 'GET') return handleGetSettings(sb);
  if (path === '/settings' && method === 'PUT') {
    if (!profile.is_admin) return errorRes('Admin only', 403);
    return handleUpdateSettings(body, sb);
  }

  // ── Admin: creators list ──────────────────────────────────────────────────
  if (path === '/creators' && method === 'GET') {
    if (!profile.is_admin) return errorRes('Admin only', 403);
    return handleGetCreators(url, sb);
  }

  // ── Admin: credit creator wallet ──────────────────────────────────────────
  if (path === '/transfer' && method === 'POST') {
    if (!profile.is_admin) return errorRes('Admin only', 403);
    return handleAdminTransfer(body, sb);
  }

  // ── User registration ─────────────────────────────────────────────────────
  if (path === '/user' && method === 'POST') return handleCreateUser(body, profile, sb);
  if (path === '/user/check-existence' && method === 'POST') return handleCheckExistence(body);
  if (path === '/user/verify' && method === 'POST') return handleVerifyUser(body, profile, sb);
  if (path === '/user/resend' && method === 'POST') return handleResendCode(profile);
  if (path === '/user/attach' && method === 'POST') return handleAttachExisting(body, profile, sb);
  if (path === '/user/status' && method === 'GET') return handleGetStatus(profile);
  if (path === '/user' && method === 'DELETE') return handleDeleteUser(profile, sb);

  // ── Wallet & withdrawal ───────────────────────────────────────────────────
  if (path === '/wallet' && method === 'GET') return handleGetWallet(url, profile, sb);
  if (path === '/withdraw' && method === 'POST') return handleWithdraw(profile, sb);

  return errorRes('Not found', 404);
});

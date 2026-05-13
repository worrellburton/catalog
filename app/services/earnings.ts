import { supabase } from '~/utils/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PayoutFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly';

export interface PayoutSettings {
  id: string;
  payout_value: number;
  cac: number;
  frequency: PayoutFrequency;
  effective_at: string;
  created_at: string;
}

export type WalletEntryType = 'credit' | 'debit' | 'on_hold';

export interface WalletEntry {
  id: string;
  user_id: string;
  amount: number;
  type: WalletEntryType;
  current_balance: number;
  total_earning: number;
  total_withdraw: number;
  comment: string | null;
  entry_code: string | null;
  created_at: string;
}

export interface WalletSummary {
  current_balance: number;
  total_earning: number;
  total_withdraw: number;
  payout_withdraw_link: string | null;
  entries: WalletEntry[];
}

export interface DotsUserStatus {
  connected: boolean;
  id?: string;
  status?: string;
  balance?: { amount: number };
  phone_number?: { country_code: string; phone_number: string };
}

export interface PayoutCreator {
  id: string;
  full_name: string | null;
  email: string | null;
  dots_user_id: string | null;
  is_payout_verified: boolean;
  is_payout_active: boolean;
  created_at: string;
  current_balance: number;
  total_earning: number;
  total_withdraw: number;
}

export interface EarningsSummary {
  total_platform_earnings: number;
  total_outstanding_balance: number;
  total_withdrawn: number;
  creators_with_earnings: number;
}

// ─── Edge function URL ────────────────────────────────────────────────────────

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ?? 'https://vtarjrnqvcqbhoclvcur.supabase.co';

const EDGE_URL = `${SUPABASE_URL}/functions/v1/dots-payout`;

async function edgeCall(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<Response> {
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token ?? '';

  return fetch(`${EDGE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function edgeJson<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await edgeCall(path, method, body);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? 'Request failed');
  return data as T;
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export async function getPayoutSettings(): Promise<PayoutSettings> {
  return edgeJson<PayoutSettings>('/settings');
}

export async function updatePayoutSettings(
  payout_value: number,
  cac: number,
  frequency: PayoutFrequency = 'weekly',
): Promise<PayoutSettings> {
  return edgeJson<PayoutSettings>('/settings', 'PUT', { payout_value, cac, frequency });
}

// ─── Creator payout registration ──────────────────────────────────────────────

export async function createDotsUser(params: {
  first_name: string;
  last_name: string;
  email: string;
  country_code: string;
  phone_number: string;
}): Promise<{ success: boolean; dots_user_id: string }> {
  return edgeJson('/user', 'POST', params);
}

export async function checkDotsExistence(
  country_code: string,
  phone_number: string,
): Promise<{ exists: boolean; dots_user_id: string | null }> {
  return edgeJson('/user/check-existence', 'POST', { country_code, phone_number });
}

export async function verifyDotsUser(
  token: string,
  dots_user_id?: string,
): Promise<{ success: boolean }> {
  return edgeJson('/user/verify', 'POST', { token, ...(dots_user_id ? { dots_user_id } : {}) });
}

export async function resendDotsVerification(): Promise<{ success: boolean }> {
  return edgeJson('/user/resend', 'POST');
}

export async function attachExistingDotsUser(
  country_code: string,
  phone_number: string,
): Promise<{ success: boolean; dots_user_id: string }> {
  return edgeJson('/user/attach', 'POST', { country_code, phone_number });
}

export async function getDotsUserStatus(): Promise<DotsUserStatus> {
  return edgeJson<DotsUserStatus>('/user/status');
}

export async function deleteDotsUser(): Promise<{ success: boolean }> {
  return edgeJson('/user', 'DELETE');
}

// ─── Wallet ───────────────────────────────────────────────────────────────────

export async function getWallet(page = 1, limit = 50): Promise<WalletSummary> {
  return edgeJson<WalletSummary>(`/wallet?page=${page}&limit=${limit}`);
}

/** Lightweight balance-only fetch — used by profile menu chip. */
export async function getWalletBalance(): Promise<number> {
  const session = await import('~/utils/supabase').then(m => m.supabase.auth.getSession());
  if (!session.data.session) return 0;
  const w = await getWallet(1, 1);
  return w.current_balance;
}

export async function initiateWithdrawal(): Promise<{
  success: boolean;
  withdraw_link: string;
}> {
  return edgeJson('/withdraw', 'POST');
}

// ─── Admin ────────────────────────────────────────────────────────────────────

export async function adminCreditCreator(
  user_id: string,
  amount: number,
  comment?: string,
): Promise<{ success: boolean }> {
  return edgeJson('/transfer', 'POST', { user_id, amount, comment });
}

export async function getPayoutCreators(
  search = '',
  page = 1,
  limit = 50,
  sort = 'created_at',
): Promise<{ creators: PayoutCreator[]; total: number }> {
  const params = new URLSearchParams({ page: page.toString(), limit: limit.toString(), sort });
  if (search) params.set('search', search);
  return edgeJson<{ creators: PayoutCreator[]; total: number }>(`/creators?${params}`);
}

export async function getEarningsSummary(): Promise<EarningsSummary> {
  return edgeJson<EarningsSummary>('/earnings-summary');
}

export async function adminGetCreatorWallet(
  userId: string,
  page = 1,
  limit = 100,
): Promise<{ entries: WalletEntry[]; total: number }> {
  const params = new URLSearchParams({ page: page.toString(), limit: limit.toString() });
  return edgeJson<{ entries: WalletEntry[]; total: number }>(`/creator-wallet/${userId}?${params}`);
}

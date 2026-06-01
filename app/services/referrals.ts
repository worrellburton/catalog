// Referral / invite-and-earn. Each creator's invite code is their handle;
// the link is catalog.shop/?ref=<handle>. A user who lands with ?ref=…,
// signs in, and calls redeemStoredRef() is attributed to that creator,
// skips the waitlist, and the creator earns $0.25 (recorded in the
// `referrals` table; see migration 20260601000012).

import { supabase } from '~/utils/supabase';

const REF_KEY = 'catalog:ref';

/** Read ?ref=<handle> from the current URL, persist it to localStorage so
 *  it survives the OAuth round-trip, and strip it from the address bar.
 *  No-op when there's no ref param. Call once on app load. */
export function captureRefFromUrl(): void {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    const ref = url.searchParams.get('ref');
    if (!ref) return;
    localStorage.setItem(REF_KEY, ref.toLowerCase().trim());
    url.searchParams.delete('ref');
    window.history.replaceState({}, '', url.toString());
  } catch { /* malformed URL — ignore */ }
}

/** If a ref code was captured, redeem it for the signed-in user (attribute +
 *  skip waitlist + reward the creator). Clears the stored code on a terminal
 *  outcome (success OR a permanent rejection like self/unknown) so it never
 *  retries forever. Returns true when a referral was actually applied. */
export async function redeemStoredRef(): Promise<boolean> {
  if (!supabase || typeof window === 'undefined') return false;
  const ref = localStorage.getItem(REF_KEY);
  if (!ref) return false;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false; // wait until signed in; keep the code for later
  try {
    const { data, error } = await supabase.rpc('redeem_referral', { ref_code: ref });
    if (error) return false; // transient — keep the code, retry next load
    const result = data as { ok?: boolean; reason?: string } | null;
    // Terminal: clear the code whether it applied or was permanently rejected.
    localStorage.removeItem(REF_KEY);
    return !!result?.ok;
  } catch {
    return false;
  }
}

export interface InviteInfo {
  handle: string | null;
  link: string | null;
  count: number;
  earnedCents: number;
}

/** The signed-in creator's invite link + running stats. handle/link are
 *  null when the user has no creators handle yet (can't be referred-by). */
export async function getMyInviteInfo(): Promise<InviteInfo> {
  const empty: InviteInfo = { handle: null, link: null, count: 0, earnedCents: 0 };
  if (!supabase) return empty;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return empty;

  const [{ data: creator }, { data: stats }] = await Promise.all([
    supabase.from('creators').select('handle').eq('id', user.id).maybeSingle(),
    supabase.rpc('my_referral_stats'),
  ]);

  const handle = (creator as { handle?: string } | null)?.handle ?? null;
  const s = stats as { count?: number; earned_cents?: number } | null;
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://catalog.shop';
  return {
    handle,
    link: handle ? `${origin}/?ref=${handle}` : null,
    count: s?.count ?? 0,
    earnedCents: s?.earned_cents ?? 0,
  };
}

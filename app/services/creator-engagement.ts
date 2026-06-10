import { supabase } from '~/utils/supabase';

/**
 * Creator engagement service.
 *
 * Two pieces:
 *   1. getEngagementSinceLastCheck — called once per session on
 *      login. Reads `profiles.last_creator_check_at`, calls the
 *      creator_engagement_since RPC, and stamps the timestamp
 *      forward so subsequent logins only count new traffic.
 *   2. getEngagementSummary — totals + 7-day slice for the
 *      Analytics section in the earnings page.
 *
 * Both are safe to call when the user has no looks; both return
 * zero counts in that case.
 */

export interface EngagementSince {
  impressions: number;
  clicks:      number;
  clickouts:   number;
  since:       string | null; // ISO timestamp the counts are relative to
}

export interface EngagementSummary {
  total_impressions: number;
  total_clicks:      number;
  total_clickouts:   number;
  week_impressions:  number;
  week_clicks:       number;
  week_clickouts:    number;
}

const ZERO_SINCE: EngagementSince = { impressions: 0, clicks: 0, clickouts: 0, since: null };
const ZERO_SUMMARY: EngagementSummary = {
  total_impressions: 0, total_clicks: 0, total_clickouts: 0,
  week_impressions:  0, week_clicks:  0, week_clickouts:  0,
};

/**
 * Compute counts since the user's last check, then bump the check
 * timestamp forward. Returns ZERO when:
 *   - Supabase isn't configured
 *   - Auth user can't be resolved
 *   - The user has no profile row yet (brand new sign-up)
 */
export async function getEngagementSinceLastCheck(): Promise<EngagementSince> {
  if (!supabase) return ZERO_SINCE;

  const { data: authData } = await supabase.auth.getUser();
  const userId = authData?.user?.id;
  if (!userId) return ZERO_SINCE;

  // Read the previous check timestamp. We capture this BEFORE
  // stamping forward so the count window is well-defined even if
  // two tabs race the same RPC.
  const { data: prof } = await supabase
    .from('profiles')
    .select('last_creator_check_at')
    .eq('id', userId)
    .maybeSingle();
  const since = (prof?.last_creator_check_at as string | null) ?? null;

  const { data: rows, error } = await supabase.rpc('creator_engagement_since', {
    p_user_id: userId,
    p_since:   since,
  });
  if (error) {
    console.warn('[creator-engagement] since RPC failed:', error.message);
    return ZERO_SINCE;
  }
  const row = Array.isArray(rows) ? rows[0] : rows;
  const impressions = Number(row?.impressions ?? 0);
  const clicks      = Number(row?.clicks      ?? 0);
  const clickouts   = Number(row?.clickouts   ?? 0);

  // Stamp the check timestamp forward so the next login measures from
  // here. Fire-and-forget; if it fails, the worst case is the user
  // sees the same numbers again on the next login.
  void supabase
    .from('profiles')
    .update({ last_creator_check_at: new Date().toISOString() })
    .eq('id', userId);

  return { impressions, clicks, clickouts, since };
}

/** Lifetime totals + 7-day slice for the Analytics section. */
export async function getEngagementSummary(): Promise<EngagementSummary> {
  if (!supabase) return ZERO_SUMMARY;

  const { data: authData } = await supabase.auth.getUser();
  const userId = authData?.user?.id;
  if (!userId) return ZERO_SUMMARY;

  const { data: rows, error } = await supabase.rpc('creator_engagement_summary', {
    p_user_id: userId,
  });
  if (error) {
    console.warn('[creator-engagement] summary RPC failed:', error.message);
    return ZERO_SUMMARY;
  }
  const row = Array.isArray(rows) ? rows[0] : rows;
  return {
    total_impressions: Number(row?.total_impressions ?? 0),
    total_clicks:      Number(row?.total_clicks      ?? 0),
    total_clickouts:   Number(row?.total_clickouts   ?? 0),
    week_impressions:  Number(row?.week_impressions  ?? 0),
    week_clicks:       Number(row?.week_clicks       ?? 0),
    week_clickouts:    Number(row?.week_clickouts    ?? 0),
  };
}

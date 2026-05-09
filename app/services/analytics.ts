import { supabase } from '~/utils/supabase';

/**
 * Per-user analytics row returned by the `user_analytics_summary`
 * Postgres RPC. One round trip from /admin/analytics renders the
 * whole users table without N+M+K queries.
 */
export interface UserAnalyticsRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  role: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  sign_in_count: number;
  total_impressions: number;
  total_clicks: number;
  total_clickouts: number;
  total_session_ms: number;
  total_active_ms: number;
  total_idle_ms: number;
  avg_session_ms: number;
}

/**
 * Fetch the per-user analytics rollup. Admin-only via the underlying
 * RLS policies on user_sessions / user_events; the RPC itself runs
 * SECURITY INVOKER so the policies gate the result.
 */
export async function getUserAnalytics(): Promise<UserAnalyticsRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('user_analytics_summary');
  if (error) {
    console.error('[getUserAnalytics]', error.message);
    return [];
  }
  return (data ?? []) as UserAnalyticsRow[];
}

/**
 * Computed click-through rate. Returns null when there are no
 * impressions to avoid the `0/0` artifact rendering as `0%` (which
 * would falsely imply tracking without traffic).
 */
export function clickThroughRate(row: { total_impressions: number; total_clicks: number }): number | null {
  if (!row.total_impressions) return null;
  return row.total_clicks / row.total_impressions;
}

/**
 * Per-product analytics row from the `product_analytics_summary` RPC.
 */
export interface ProductAnalyticsRow {
  product_id: string;
  product_name: string | null;
  brand: string | null;
  total_impressions: number;
  total_clicks: number;
  total_clickouts: number;
}

export async function getProductAnalytics(): Promise<ProductAnalyticsRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('product_analytics_summary');
  if (error) {
    console.error('[getProductAnalytics]', error.message);
    return [];
  }
  return (data ?? []) as ProductAnalyticsRow[];
}

/**
 * Pretty-print millisecond durations as `Hh Mm` / `Mm Ss` / `Ns`.
 * Used in the analytics table so column widths stay tight.
 */
export function formatDurationMs(ms: number): string {
  if (!ms || ms <= 0) return '—';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

import { estimateAdCost } from '~/constants/video-model-pricing';
import { supabase } from '~/utils/supabase';

// Lightweight client-side budget tracker for the Gen-AI panels.
// We don't have a real billing API for Veo / fal.ai, so the admin
// configures a monthly cap in localStorage and we check the running
// total of cost_usd across the AI tables before kicking off bulk
// reruns. The cap is per-installation (admin's browser).

const BUDGET_KEY = 'catalog-ai-budget-usd';
const DEFAULT_BUDGET_USD = 100;

export function getAiBudget(): number {
  if (typeof window === 'undefined') return DEFAULT_BUDGET_USD;
  const raw = localStorage.getItem(BUDGET_KEY);
  if (!raw) return DEFAULT_BUDGET_USD;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_BUDGET_USD;
}

export function setAiBudget(usd: number): void {
  if (typeof window === 'undefined') return;
  if (!Number.isFinite(usd) || usd <= 0) return;
  localStorage.setItem(BUDGET_KEY, String(usd));
}

/**
 * Sum cost_usd across product_creative + generated_videos. We use this
 * as the running spend so the "rerun all stuck" gate can refuse when
 * the projected new spend would push us over budget.
 */
export async function getAiSpentUsd(): Promise<number> {
  if (!supabase) return 0;
  const [adsRes, vidsRes] = await Promise.all([
    supabase.from('product_creative').select('cost_usd'),
    supabase.from('generated_videos').select('cost_usd'),
  ]);
  let spent = 0;
  for (const row of adsRes.data || []) spent += (row as { cost_usd: number | null }).cost_usd || 0;
  for (const row of vidsRes.data || []) spent += (row as { cost_usd: number | null }).cost_usd || 0;
  return spent;
}

export interface BudgetCheck {
  estimatedCostUsd: number;
  spentUsd: number;
  budgetUsd: number;
  remainingUsd: number;
  hasFunds: boolean;
  jobCount: number;
}

/**
 * Estimate cost for a list of jobs (video gen or ads) at their model's
 * list price, then compare against remaining budget.
 */
export async function checkBudgetForRerun(
  jobs: Array<{ model?: string | null; veo_model?: string | null }>,
): Promise<BudgetCheck> {
  const estimatedCostUsd = jobs.reduce(
    (sum, j) => sum + estimateAdCost(j.model ?? j.veo_model ?? null),
    0,
  );
  const spentUsd = await getAiSpentUsd();
  const budgetUsd = getAiBudget();
  const remainingUsd = Math.max(0, budgetUsd - spentUsd);
  return {
    estimatedCostUsd,
    spentUsd,
    budgetUsd,
    remainingUsd,
    hasFunds: estimatedCostUsd <= remainingUsd,
    jobCount: jobs.length,
  };
}

/** True when elapsed since `createdAt` exceeds 2× the estimated wall-clock. */
export function isStuck(createdAt: string, estimatedSeconds: number): boolean {
  const elapsed = (Date.now() - new Date(createdAt).getTime()) / 1000;
  return elapsed > estimatedSeconds * 2;
}

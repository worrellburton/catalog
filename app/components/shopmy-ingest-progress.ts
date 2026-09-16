// Derived view-state for a ShopMy ingest run. Pure — no React, no I/O — so the
// logic the progress UI depends on is unit-testable even though the component
// itself is not (the repo has vitest but no React Testing Library).

import type { CrawlJob } from '~/services/site-crawls';
import { isStuck } from '~/utils/aiBudget';

/**
 * Typical wall-clock for a creator-shop ingest. A 600-product shop takes
 * minutes: ~65 collection fetches, then 24 batches of 25 with a 1.5s pause
 * between them. Used only to decide when a run looks stuck.
 */
export const INGEST_ESTIMATED_SECONDS = 240;

export type IngestPhase = 'queued' | 'active' | 'stuck' | 'done' | 'failed';

export function phaseFor(
  job: CrawlJob,
  estimatedSeconds: number = INGEST_ESTIMATED_SECONDS,
): IngestPhase {
  if (job.status === 'done') return 'done';
  // A cancelled run is terminal and not a success — surface it like a failure.
  if (job.status === 'failed' || job.status === 'cancelled') return 'failed';
  if (job.status === 'crawling') {
    // Measure from when work began; fall back to insert time if it never did.
    return isStuck(job.started_at ?? job.created_at, estimatedSeconds) ? 'stuck' : 'active';
  }
  return 'queued';
}

/** Integer 0-100. Never NaN, never out of range, whatever the counters say. */
export function percentFor(job: CrawlJob): number {
  if (job.status === 'done') return 100;
  const total = Number(job.total_urls) || 0;
  const done = Number(job.scraped_urls) || 0;
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

/** "16 no_brand_or_price, 2 non_product_url" — largest reason first. */
export function summariseSkips(skipped: Record<string, number> | null | undefined): string {
  const entries = Object.entries(skipped ?? {}).filter(([, n]) => Number(n) > 0);
  if (entries.length === 0) return 'none';
  return entries
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => `${n} ${reason}`)
    .join(', ');
}

import { describe, it, expect } from 'vitest';
import {
  phaseFor, percentFor, summariseSkips, INGEST_ESTIMATED_SECONDS,
} from './shopmy-ingest-progress';
import type { CrawlJob } from '~/services/site-crawls';

const job = (over: Partial<CrawlJob>): CrawlJob => ({
  id: 'j1', site_url: 'https://shopmy.us/shop/x', site_name: 'x',
  job_type: 'profile', status: 'pending', total_urls: 0, scraped_urls: 0,
  error: null, started_at: null, completed_at: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  ...over,
});

describe('phaseFor', () => {
  it('maps each status', () => {
    expect(phaseFor(job({ status: 'pending' }))).toBe('queued');
    expect(phaseFor(job({ status: 'crawling' }))).toBe('active');
    expect(phaseFor(job({ status: 'done' }))).toBe('done');
    expect(phaseFor(job({ status: 'failed' }))).toBe('failed');
    expect(phaseFor(job({ status: 'cancelled' }))).toBe('failed');
  });

  it('flags a long-running crawl as stuck, using started_at when present', () => {
    const old = new Date(Date.now() - 3600_000).toISOString();
    expect(phaseFor(job({ status: 'crawling', started_at: old }))).toBe('stuck');
    expect(phaseFor(job({ status: 'crawling', created_at: old, started_at: null }))).toBe('stuck');
  });

  it('does not flag a finished job as stuck however old it is', () => {
    const old = new Date(Date.now() - 86_400_000).toISOString();
    expect(phaseFor(job({ status: 'done', started_at: old }))).toBe('done');
    expect(phaseFor(job({ status: 'failed', started_at: old }))).toBe('failed');
  });
});

describe('percentFor', () => {
  it('is 0 when nothing is known yet', () => {
    expect(percentFor(job({ total_urls: 0, scraped_urls: 0 }))).toBe(0);
  });

  it('never returns NaN or Infinity for a zero denominator', () => {
    const p = percentFor(job({ total_urls: 0, scraped_urls: 5 }));
    expect(Number.isFinite(p)).toBe(true);
    expect(p).toBe(0);
  });

  it('computes a normal fraction', () => {
    expect(percentFor(job({ total_urls: 200, scraped_urls: 50 }))).toBe(25);
  });

  it('clamps above 100 and below 0', () => {
    expect(percentFor(job({ total_urls: 10, scraped_urls: 99 }))).toBe(100);
    expect(percentFor(job({ total_urls: 10, scraped_urls: -5 }))).toBe(0);
  });

  it('reports 100 for a completed job even if the counters disagree', () => {
    expect(percentFor(job({ status: 'done', total_urls: 200, scraped_urls: 0 }))).toBe(100);
  });
});

describe('summariseSkips', () => {
  it('renders none for empty input', () => {
    expect(summariseSkips(null)).toBe('none');
    expect(summariseSkips(undefined)).toBe('none');
    expect(summariseSkips({})).toBe('none');
  });

  it('renders counts, largest first', () => {
    expect(summariseSkips({ non_product_url: 2, no_brand_or_price: 16 }))
      .toBe('16 no_brand_or_price, 2 non_product_url');
  });

  it('exports a positive time estimate', () => {
    expect(INGEST_ESTIMATED_SECONDS).toBeGreaterThan(0);
  });
});

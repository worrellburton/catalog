import { supabase } from '~/utils/supabase';

// ─── Types ───────────────────────────────────────────────────────────

export interface CrawlJob {
  id: string;
  site_url: string;
  site_name: string | null;
  status: 'pending' | 'crawling' | 'done' | 'failed' | 'cancelled';
  total_urls: number;
  scraped_urls: number;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrawlDiscoveredUrl {
  id: string;
  crawl_job_id: string;
  url: string;
  collection_name: string | null;
  page_title: string | null;
  product_id: string | null;
  status: 'pending' | 'queued' | 'scraped' | 'skipped' | 'failed';
  error: string | null;
  created_at: string;
}

// ─── Crawl Jobs ──────────────────────────────────────────────────────

export async function listCrawlJobs(): Promise<CrawlJob[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('crawl_jobs')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getCrawlJob(id: string): Promise<CrawlJob | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('crawl_jobs')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function createCrawlJob(siteUrl: string, siteName?: string): Promise<CrawlJob> {
  if (!supabase) throw new Error('Supabase not configured');
  const domain = new URL(siteUrl).hostname;
  const { data, error } = await supabase
    .from('crawl_jobs')
    .insert({
      site_url: siteUrl,
      site_name: siteName || domain,
      status: 'pending',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteCrawlJob(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from('crawl_jobs')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

export async function cancelCrawlJob(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from('crawl_jobs')
    .update({ status: 'cancelled' })
    .eq('id', id);
  if (error) throw error;
}

export async function retryCrawlJob(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from('crawl_jobs')
    .update({
      status: 'pending',
      error: null,
      started_at: null,
      completed_at: null,
    })
    .eq('id', id);
  if (error) throw error;
}

// ─── Discovered URLs ─────────────────────────────────────────────────

export async function listDiscoveredUrls(
  crawlJobId: string,
  options?: { status?: string; limit?: number; offset?: number }
): Promise<{ data: CrawlDiscoveredUrl[]; count: number }> {
  if (!supabase) return { data: [], count: 0 };

  let query = supabase
    .from('crawl_discovered_urls')
    .select('*', { count: 'exact' })
    .eq('crawl_job_id', crawlJobId)
    .order('created_at', { ascending: true });

  if (options?.status) {
    query = query.eq('status', options.status);
  }
  if (options?.limit) {
    query = query.limit(options.limit);
  }
  if (options?.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 50) - 1);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  return { data: data || [], count: count || 0 };
}

// ─── Trigger crawl via Modal webhook ─────────────────────────────────

const MODAL_CRAWLER_URL = import.meta.env.VITE_MODAL_CRAWLER_URL || '';

export async function triggerCrawl(jobId: string, siteUrl: string, maxPages?: number): Promise<boolean> {
  if (!MODAL_CRAWLER_URL) {
    console.warn('VITE_MODAL_CRAWLER_URL not set — crawl not triggered');
    return false;
  }

  try {
    const res = await fetch(MODAL_CRAWLER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: jobId,
        site_url: siteUrl,
        max_pages: maxPages || 100,
      }),
    });
    return res.ok;
  } catch (e) {
    console.error('Failed to trigger crawl:', e);
    return false;
  }
}

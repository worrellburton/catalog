import { supabase } from '~/utils/supabase';

// ─── Types ───────────────────────────────────────────────────────────

export interface CrawlJob {
  id: string;
  site_url: string;
  site_name: string | null;
  job_type: 'site' | 'collection' | 'profile';
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

export async function listCrawlJobs(
  options?: { jobType?: 'site' | 'collection' | 'profile' }
): Promise<CrawlJob[]> {
  if (!supabase) return [];
  let query = supabase
    .from('crawl_jobs')
    .select('*')
    .order('created_at', { ascending: false });
  if (options?.jobType) {
    query = query.eq('job_type', options.jobType);
  }
  const { data, error } = await query;
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
      job_type: 'site',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function createProfileCrawlJob(
  profileUrl: string,
  profileName?: string,
): Promise<CrawlJob> {
  if (!supabase) throw new Error('Supabase not configured');
  // Default name: last path segment (e.g. 'drconnieyang') or hostname.
  let defaultName: string;
  try {
    const u = new URL(profileUrl);
    const seg = u.pathname.split('/').filter(Boolean).pop();
    defaultName = seg ? `${u.hostname}/${seg}` : u.hostname;
  } catch {
    defaultName = profileUrl;
  }
  const { data, error } = await supabase
    .from('crawl_jobs')
    .insert({
      site_url: profileUrl,
      site_name: profileName || defaultName,
      status: 'pending',
      job_type: 'profile',
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

// Aggregated collection summary for a job. Paginates through every discovered
// URL so groups aren't truncated by a row limit (sites can have thousands).
export async function listCollectionSummariesForJob(
  crawlJobId: string,
  options?: { pageSize?: number; maxRows?: number }
): Promise<Array<{ collection_name: string; url_count: number; sample_url: string }>> {
  if (!supabase) return [];
  const pageSize = options?.pageSize ?? 1000;
  const maxRows = options?.maxRows ?? 10000;

  const groups: Record<string, { url_count: number; sample_url: string }> = {};
  let offset = 0;

  while (offset < maxRows) {
    const { data, error } = await supabase
      .from('crawl_discovered_urls')
      .select('collection_name, url')
      .eq('crawl_job_id', crawlJobId)
      .order('created_at', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const row of data) {
      const key = (row as { collection_name: string | null }).collection_name || 'Uncategorized';
      const url = (row as { url: string }).url;
      if (!groups[key]) {
        groups[key] = { url_count: 0, sample_url: url };
      }
      groups[key].url_count += 1;
    }

    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return Object.entries(groups).map(([collection_name, g]) => ({
    collection_name,
    url_count: g.url_count,
    sample_url: g.sample_url,
  }));
}

// ─── Trigger crawl via Modal webhook ─────────────────────────────────

const MODAL_CRAWLER_URL = import.meta.env.VITE_MODAL_CRAWLER_URL || '';
const MODAL_PROFILE_CRAWLER_URL = import.meta.env.VITE_MODAL_PROFILE_CRAWLER_URL || '';

export async function triggerCrawl(jobId: string, siteUrl: string): Promise<boolean> {
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
      }),
    });
    return res.ok;
  } catch (e) {
    console.error('Failed to trigger crawl:', e);
    return false;
  }
}

export async function triggerProfileCrawl(
  jobId: string,
  profileUrl: string,
  profileName?: string,
): Promise<boolean> {
  if (!MODAL_PROFILE_CRAWLER_URL) {
    console.warn('VITE_MODAL_PROFILE_CRAWLER_URL not set — profile crawl not triggered');
    return false;
  }

  try {
    const res = await fetch(MODAL_PROFILE_CRAWLER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: jobId,
        profile_url: profileUrl,
        profile_name: profileName,
      }),
    });
    return res.ok;
  } catch (e) {
    console.error('Failed to trigger profile crawl:', e);
    return false;
  }
}

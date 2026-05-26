import { supabase } from '~/utils/supabase';

const BRANDFETCH_CLIENT_ID = '1id3n10pdBTarCHI0db';

interface BackfillProgress {
  total: number;
  scanned: number;
  added: number;
  alreadyHad: number;
  skipped: number;
  currentBrand?: string;
}

export interface BackfillResult {
  total: number;
  added: number;
  alreadyHad: number;
  skipped: number;
}

function brandfetchUrl(domain: string): string {
  return `https://cdn.brandfetch.io/${domain}?c=${BRANDFETCH_CLIENT_ID}`;
}

function domainFromUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.hostname.replace(/^www\./i, '');
  } catch {
    return null;
  }
}

async function brandfetchHasLogo(domain: string): Promise<boolean> {
  try {
    const res = await fetch(brandfetchUrl(domain), { method: 'GET', cache: 'no-store' });
    if (!res.ok) return false;
    const ct = res.headers.get('content-type') || '';
    return ct.startsWith('image/');
  } catch {
    return false;
  }
}

interface BrandRow { brand: string; url: string }

async function gatherBrandsWithDomain(): Promise<Map<string, string>> {
  if (!supabase) return new Map();
  const brandToDomain = new Map<string, string>();
  const seenBrands = new Set<string>();
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('products')
      .select('brand, url')
      .not('brand', 'is', null)
      .not('url', 'is', null)
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const row of data as BrandRow[]) {
      const key = (row.brand || '').toLowerCase().trim();
      if (!key || seenBrands.has(key)) continue;
      const domain = domainFromUrl(row.url);
      if (!domain) continue;
      if (domain.includes('google.com')) continue;
      if (domain.endsWith('.amazon.com') || domain === 'amazon.com') continue;
      brandToDomain.set(key, domain);
      seenBrands.add(key);
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return brandToDomain;
}

export async function backfillBrandLogos(
  onProgress?: (p: BackfillProgress) => void,
): Promise<BackfillResult> {
  if (!supabase) {
    return { total: 0, added: 0, alreadyHad: 0, skipped: 0 };
  }
  const brandToDomain = await gatherBrandsWithDomain();
  const total = brandToDomain.size;
  if (total === 0) return { total: 0, added: 0, alreadyHad: 0, skipped: 0 };

  const { data: existing } = await supabase
    .from('brand_logos')
    .select('brand');
  const existingSet = new Set((existing || []).map(r => (r as { brand: string }).brand));

  let scanned = 0;
  let added = 0;
  let alreadyHad = 0;
  let skipped = 0;

  for (const [brand, domain] of brandToDomain) {
    scanned += 1;
    onProgress?.({ total, scanned, added, alreadyHad, skipped, currentBrand: brand });
    if (existingSet.has(brand)) { alreadyHad += 1; continue; }
    const ok = await brandfetchHasLogo(domain);
    if (!ok) { skipped += 1; continue; }
    const { error } = await supabase
      .from('brand_logos')
      .upsert({ brand, logo_url: brandfetchUrl(domain), display_name: brand }, { onConflict: 'brand' });
    if (error) { skipped += 1; continue; }
    added += 1;
  }

  onProgress?.({ total, scanned, added, alreadyHad, skipped });
  return { total, added, alreadyHad, skipped };
}

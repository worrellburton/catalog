import { useState, Fragment, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from '@remix-run/react';
import { looks, creators } from '~/data/looks';
import { useSortableTable, SortableTh } from '~/components/SortableTable';
import { supabase } from '~/utils/supabase';
import { VIDEO_MODELS, DEFAULT_VIDEO_MODEL } from '~/constants/video-models';
import { createBatchAds, promoteQueuedAds } from '~/services/product-ads';
import { researchProducts, type ResearchedProduct, type ProductGender } from '~/services/product-research';

interface CrawledProduct {
  id: string;
  name: string | null;
  brand: string | null;
  price: string | null;
  url: string | null;
  image_url: string | null;
  images?: string[] | null;
  scraped_at: string | null;
  scrape_status: string;
  is_crawled: boolean;
}

const COLOR_WORDS = ['white', 'black', 'blue', 'navy', 'red', 'green', 'yellow', 'pink', 'purple', 'gray', 'grey', 'brown', 'tan', 'beige', 'cream', 'gold', 'silver', 'orange', 'khaki', 'olive', 'charcoal', 'burgundy', 'ivory'];
const MATERIAL_WORDS = ['leather', 'denim', 'cotton', 'silk', 'satin', 'wool', 'cashmere', 'linen', 'suede', 'velvet', 'knit', 'canvas', 'nylon', 'polyester'];
const TYPE_WORDS = [
  { match: ['shoulder bag', 'tote', 'crossbody', 'handbag', 'clutch', 'purse'], tag: 'Bag' },
  { match: ['sunglasses', 'eyewear', 'shades'], tag: 'Sunglasses' },
  { match: ['sneaker', 'trainer'], tag: 'Sneakers' },
  { match: ['shoe', 'boot', 'heel', 'loafer'], tag: 'Shoes' },
  { match: ['iphone case', 'phone case', 'case for'], tag: 'Phone Case' },
  { match: ['necklace', 'pendant'], tag: 'Necklace' },
  { match: ['ring '], tag: 'Ring' },
  { match: ['earring'], tag: 'Earrings' },
  { match: ['bracelet'], tag: 'Bracelet' },
  { match: ['watch'], tag: 'Watch' },
  { match: ['jean', 'denim'], tag: 'Denim' },
  { match: ['pant', 'trouser', 'chino'], tag: 'Pants' },
  { match: ['dress'], tag: 'Dress' },
  { match: ['skirt'], tag: 'Skirt' },
  { match: ['shirt', 't-shirt', 'tee', 'henley', 'polo'], tag: 'Top' },
  { match: ['short-sleeve', 'ss '], tag: 'Short Sleeve' },
  { match: ['long-sleeve', 'ls-', 'ls '], tag: 'Long Sleeve' },
  { match: ['jacket', 'coat', 'parka', 'blazer'], tag: 'Outerwear' },
  { match: ['hat', 'cap', 'beanie'], tag: 'Hat' },
  { match: ['sweater', 'hoodie', 'pullover'], tag: 'Sweater' },
  { match: ['boxer', 'brief', 'underwear'], tag: 'Underwear' },
  { match: ['camera'], tag: 'Camera' },
];

function deriveTags(name: string, brand: string): string[] {
  const lower = (name || '').toLowerCase();
  const tags = new Set<string>();

  // Type tag
  for (const { match, tag } of TYPE_WORDS) {
    if (match.some(m => lower.includes(m))) {
      tags.add(tag);
    }
  }

  // Color tag
  const colors = COLOR_WORDS.filter(c => new RegExp(`\\b${c}\\b`, 'i').test(lower));

  // Material tag
  const materials = MATERIAL_WORDS.filter(m => lower.includes(m));

  // Combined color + type (e.g. "white hat", "black dress")
  const typeTag = Array.from(tags)[0];
  if (typeTag && colors.length > 0) {
    tags.add(`${colors[0].charAt(0).toUpperCase()}${colors[0].slice(1)} ${typeTag}`);
  }

  // Individual color tags
  colors.forEach(c => tags.add(c.charAt(0).toUpperCase() + c.slice(1)));

  // Material tags
  materials.forEach(m => tags.add(m.charAt(0).toUpperCase() + m.slice(1)));

  // Brand
  if (brand) tags.add(brand);

  return Array.from(tags);
}

interface AffiliateProvider {
  network: string;
  rate: string;
  rateNumeric: number;
  signupUrl: string;
  note?: string;
}

const BRAND_AFFILIATES: Record<string, AffiliateProvider[]> = {
  'Nike': [
    { network: 'FlexOffers', rate: '11%', rateNumeric: 11, signupUrl: 'https://www.flexoffers.com/', note: 'Top published rate' },
    { network: 'Impact', rate: '8%', rateNumeric: 8, signupUrl: 'https://impact.com/' },
    { network: 'Rakuten Advertising', rate: '5–8%', rateNumeric: 6.5, signupUrl: 'https://rakutenadvertising.com/' },
  ],
  'Zara': [
    { network: 'Skimlinks (auto)', rate: '~5%', rateNumeric: 5, signupUrl: 'https://skimlinks.com/', note: 'No official program' },
    { network: 'Sovrn //Commerce', rate: '~4%', rateNumeric: 4, signupUrl: 'https://www.sovrn.com/commerce/' },
  ],
  'Gucci': [
    { network: 'Rakuten Advertising', rate: '7%', rateNumeric: 7, signupUrl: 'https://rakutenadvertising.com/' },
    { network: 'Awin', rate: '6%', rateNumeric: 6, signupUrl: 'https://www.awin.com/' },
  ],
  'Diesel': [
    { network: 'Awin', rate: '8%', rateNumeric: 8, signupUrl: 'https://www.awin.com/' },
    { network: 'Rakuten Advertising', rate: '6%', rateNumeric: 6, signupUrl: 'https://rakutenadvertising.com/' },
  ],
  'Vince': [
    { network: 'Rakuten Advertising', rate: '10%', rateNumeric: 10, signupUrl: 'https://rakutenadvertising.com/' },
    { network: 'ShareASale', rate: '7%', rateNumeric: 7, signupUrl: 'https://www.shareasale.com/' },
  ],
  'Suitsupply': [
    { network: 'Awin', rate: '9%', rateNumeric: 9, signupUrl: 'https://www.awin.com/' },
    { network: 'Impact', rate: '6%', rateNumeric: 6, signupUrl: 'https://impact.com/' },
  ],
  'Pavoi': [
    { network: 'Amazon Associates', rate: '4%', rateNumeric: 4, signupUrl: 'https://affiliate-program.amazon.com/', note: 'Jewelry tier' },
  ],
  'Windsor': [
    { network: 'ShareASale', rate: '6%', rateNumeric: 6, signupUrl: 'https://www.shareasale.com/' },
  ],
  'Fujifilm': [
    { network: 'Impact', rate: '5%', rateNumeric: 5, signupUrl: 'https://impact.com/' },
    { network: 'Amazon Associates', rate: '2%', rateNumeric: 2, signupUrl: 'https://affiliate-program.amazon.com/', note: 'Electronics tier' },
  ],
  'LUXXFORM': [
    { network: 'Shopify Collabs', rate: '15%', rateNumeric: 15, signupUrl: 'https://www.shopify.com/collabs', note: 'DTC brand' },
  ],
  'Wolf\'s Collections': [
    { network: 'Shopify Collabs', rate: '12%', rateNumeric: 12, signupUrl: 'https://www.shopify.com/collabs', note: 'DTC brand' },
  ],
};

const DEFAULT_AFFILIATES: AffiliateProvider[] = [
  { network: 'Amazon Associates', rate: '3–10%', rateNumeric: 6.5, signupUrl: 'https://affiliate-program.amazon.com/', note: 'Rate varies by category' },
  { network: 'ShareASale', rate: 'Varies', rateNumeric: 5, signupUrl: 'https://www.shareasale.com/', note: 'Brand-negotiated' },
  { network: 'Skimlinks', rate: '~5%', rateNumeric: 5, signupUrl: 'https://skimlinks.com/', note: 'Automatic monetization' },
  { network: 'Impact', rate: 'Varies', rateNumeric: 5, signupUrl: 'https://impact.com/', note: 'Brand-negotiated' },
];

function getAffiliatesFor(brand: string): AffiliateProvider[] {
  const list = BRAND_AFFILIATES[brand] || DEFAULT_AFFILIATES;
  return [...list].sort((a, b) => b.rateNumeric - a.rateNumeric);
}

function AdminToggle({ on, onChange }: { on: boolean; onChange: (val: boolean) => void }) {
  return (
    <button
      className={`admin-toggle-btn ${on ? 'on' : 'off'}`}
      onClick={(e) => { e.stopPropagation(); onChange(!on); }}
      aria-label={on ? 'Toggle off' : 'Toggle on'}
    >
      <span className="admin-toggle-track">
        <span className="admin-toggle-thumb" />
      </span>
    </button>
  );
}

interface LookRow {
  id: number;
  creator: string;
  creatorDisplay: string;
  creatorAvatar: string;
  video: string;
  products: number;
}

type Tab = 'looks' | 'products' | 'musics' | 'places';

export default function AdminContent() {
  const [activeTab, setActiveTab] = useState<Tab>('looks');
  const [productFilter, setProductFilter] = useState<'all' | 'no-creative'>('all');
  const [toast, setToast] = useState<string | null>(null);
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const [generatePicker, setGeneratePicker] = useState<{ productId: string; productName: string } | null>(null);
  const [genModel, setGenModel] = useState<string>(DEFAULT_VIDEO_MODEL);

  // In-flight generation jobs per product — tracks individual ad rows so we
  // can show an accurate progress bar bound to the ad statuses in Supabase.
  interface GenJob {
    adIds: string[];
    total: number;
    done: number;
    failed: number;
    generating: number; // currently in the 'generating' status
    startedAt: number;
  }
  const [genJobs, setGenJobs] = useState<Map<string, GenJob>>(new Map());
  const [linkModal, setLinkModal] = useState<{ name: string; brand: string; url: string } | null>(null);
  const [tagsModal, setTagsModal] = useState<{ name: string; brand: string; tags: string[] } | null>(null);

  // Add Products research modal
  const [showAddProducts, setShowAddProducts] = useState(false);
  const [researchQuery, setResearchQuery] = useState('');
  const [researchGender, setResearchGender] = useState<ProductGender | 'all'>('all');
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchResults, setResearchResults] = useState<ResearchedProduct[]>([]);
  const [researchSelected, setResearchSelected] = useState<Set<number>>(new Set());
  const [researchLiveOnly, setResearchLiveOnly] = useState(true);
  const [researchSource, setResearchSource] = useState<'live' | 'seed' | null>(null);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [ingesting, setIngesting] = useState(false);

  // Stale product refresh
  const [refreshing, setRefreshing] = useState(false);
  const [refreshProgress, setRefreshProgress] = useState<{ done: number; total: number } | null>(null);

  // AI copywriter
  const [copywriting, setCopywriting] = useState(false);
  const [copywriteProgress, setCopywriteProgress] = useState<{ done: number; total: number } | null>(null);

  const runCopywriter = useCallback(async () => {
    if (!supabase) return;
    // Rewrite products that don't have a display_name yet. Cap at 100 per run.
    const { data: toRewrite } = await supabase
      .from('products')
      .select('id, name, brand, price')
      .is('display_name', null)
      .limit(100);
    if (!toRewrite || toRewrite.length === 0) {
      showToast('All products already have Claude-written copy.');
      return;
    }
    setCopywriting(true);
    setCopywriteProgress({ done: 0, total: toRewrite.length });
    try {
      const BATCH = 30;
      let totalDone = 0;
      for (let i = 0; i < toRewrite.length; i += BATCH) {
        const batch = toRewrite.slice(i, i + BATCH);
        const { data, error } = await supabase.functions.invoke('product-copywriter', {
          body: { products: batch.map(p => ({ id: p.id, name: p.name || '', brand: p.brand || '', price: p.price })) },
        });
        if (!error && data?.success && data.results) {
          const nowIso = new Date().toISOString();
          await Promise.all(
            Object.entries(data.results as Record<string, { display_name: string; hook_copy: string }>)
              .map(([id, r]) =>
                supabase!.from('products').update({
                  display_name: r.display_name,
                  hook_copy: r.hook_copy,
                  rewritten_at: nowIso,
                }).eq('id', id)
              )
          );
        }
        totalDone += batch.length;
        setCopywriteProgress({ done: totalDone, total: toRewrite.length });
      }
      showToast(`Rewrote ${totalDone} product name${totalDone === 1 ? '' : 's'}`);
    } finally {
      setCopywriting(false);
      setCopywriteProgress(null);
    }
  }, []);

  const refreshStaleProducts = useCallback(async () => {
    if (!supabase) return;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    // Products not refreshed in 7+ days (or never refreshed)
    const { data: stale } = await supabase
      .from('products')
      .select('id, name, brand, url, price')
      .or(`last_refreshed_at.is.null,last_refreshed_at.lt.${sevenDaysAgo}`)
      .limit(50);
    if (!stale || stale.length === 0) {
      showToast('No stale products — everything checked in the last 7 days');
      return;
    }
    setRefreshing(true);
    setRefreshProgress({ done: 0, total: stale.length });
    try {
      const BATCH = 10;
      let priceChanges = 0;
      let oos = 0;
      for (let i = 0; i < stale.length; i += BATCH) {
        const batch = stale.slice(i, i + BATCH);
        const { data, error } = await supabase.functions.invoke('product-refresh', {
          body: {
            products: batch.map(p => ({
              id: p.id,
              name: p.name || '',
              brand: p.brand || '',
              url: p.url,
              current_price: p.price,
            })),
          },
        });
        if (error || !data?.success) {
          console.error('Refresh batch failed:', error || data?.error);
          setRefreshProgress({ done: i + batch.length, total: stale.length });
          continue;
        }
        const nowIso = new Date().toISOString();
        await Promise.all((data.results as Array<{ id: string; price?: string; availability: string; priceChanged?: boolean; oldPrice?: string }>).map(async r => {
          const update: Record<string, unknown> = {
            availability: r.availability,
            last_refreshed_at: nowIso,
          };
          if (r.price) update.price = r.price;
          if (r.priceChanged && r.oldPrice) {
            update.previous_price = r.oldPrice;
            priceChanges++;
          }
          if (r.availability === 'out_of_stock') oos++;
          await supabase!.from('products').update(update).eq('id', r.id);
        }));
        setRefreshProgress({ done: i + batch.length, total: stale.length });
      }
      showToast(`Refreshed ${stale.length} — ${priceChanges} price changes, ${oos} out of stock`);
      // Reload products in the table
      const { data: reloaded } = await supabase
        .from('products')
        .select('id, name, brand, price, url, image_url, images, scraped_at, scrape_status')
        .order('scraped_at', { ascending: false });
      if (reloaded) {
        setCrawledProducts((reloaded || []).map(p => ({
          ...p,
          is_crawled: p.scrape_status === 'done' || p.scraped_at !== null,
        })) as CrawledProduct[]);
      }
    } finally {
      setRefreshing(false);
      setRefreshProgress(null);
    }
  }, []);

  const runResearch = useCallback(async () => {
    if (!researchQuery.trim()) return;
    setResearchLoading(true);
    setResearchSelected(new Set());
    setResearchError(null);
    const { products, source, error } = await researchProducts(researchQuery, { liveOnly: researchLiveOnly });
    setResearchResults(products);
    setResearchSource(source);
    setResearchError(error);
    setResearchLoading(false);
  }, [researchQuery, researchLiveOnly]);

  const ingestSelectedProducts = useCallback(async () => {
    if (!supabase || researchSelected.size === 0) return;
    setIngesting(true);
    const nowIso = new Date().toISOString();
    const rows = Array.from(researchSelected).map(i => {
      const p = researchResults[i];
      return {
        name: p.name,
        brand: p.brand,
        price: p.price,
        url: p.url,
        image_url: p.image_url,
        images: p.image_urls || [p.image_url].filter(Boolean),
        scrape_status: 'done',
        scraped_at: nowIso,
      };
    });
    const { data: inserted, error } = await supabase
      .from('products')
      .insert(rows)
      .select('id, name, brand, price, url, image_url, images, scraped_at, scrape_status');
    setIngesting(false);
    if (!error) {
      showToast(`Ingested ${rows.length} product${rows.length === 1 ? '' : 's'}`);
      setShowAddProducts(false);
      setResearchQuery('');
      setResearchResults([]);
      setResearchSelected(new Set());
      // Prepend the newly ingested rows so they appear at the top of the list
      // immediately, then reconcile with a full reload from the DB.
      const newRows = (inserted || []).map((p) => ({
        ...p,
        is_crawled: p.scrape_status === 'done' || p.scraped_at !== null,
      })) as CrawledProduct[];
      setCrawledProducts(prev => [
        ...newRows,
        ...prev.filter(r => !newRows.some(n => n.id === r.id)),
      ]);
    } else {
      showToast(`Ingest failed: ${error.message}`);
    }
  }, [researchSelected, researchResults]);

  const visibleResearchResults = researchResults.filter(
    p => researchGender === 'all' || p.gender === researchGender || p.gender === 'unisex'
  );
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

  // Create Look modal state
  const [showCreateLook, setShowCreateLook] = useState(false);
  const [createLookSelectedProducts, setCreateLookSelectedProducts] = useState<Set<string>>(new Set());
  const [createLookProductSearch, setCreateLookProductSearch] = useState('');
  const [createLookCreator, setCreateLookCreator] = useState('');
  const [createLookLocation, setCreateLookLocation] = useState('');
  const [createLookStyle, setCreateLookStyle] = useState('Street Style');

  const openCreateLookModal = useCallback(() => {
    setCreateLookSelectedProducts(new Set());
    setCreateLookProductSearch('');
    setCreateLookCreator('');
    setCreateLookLocation('');
    setCreateLookStyle('Street Style');
    setShowCreateLook(true);
  }, []);

  const toggleCreateLookProduct = useCallback((id: string) => {
    setCreateLookSelectedProducts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const creatorOptions = useMemo(() =>
    Object.entries(creators).map(([key, c]) => ({ key, displayName: c.displayName, avatar: c.avatar })),
  []);

  // Toggle states per look: { [lookId]: { platform, featured, splash } }
  const [toggles, setToggles] = useState<Record<number, { platform: boolean; featured: boolean; splash: boolean }>>({});
  const [deletedLookIds, setDeletedLookIds] = useState<Set<number>>(new Set());
  const [deletedProductKeys, setDeletedProductKeys] = useState<Set<string>>(new Set());

  // Load hidden sets from Supabase on mount
  useEffect(() => {
    if (!supabase) return;
    (async () => {
      const [looksRes, prodsRes] = await Promise.all([
        supabase.from('admin_hidden_looks').select('look_id'),
        supabase.from('admin_hidden_products').select('brand, name'),
      ]);
      if (looksRes.data) {
        setDeletedLookIds(new Set(looksRes.data.map((r: { look_id: number }) => r.look_id)));
      }
      if (prodsRes.data) {
        setDeletedProductKeys(new Set(
          prodsRes.data.map((r: { brand: string; name: string }) => `${r.brand}-${r.name}`)
        ));
      }
    })();
  }, []);
  const [lookOrder, setLookOrder] = useState<number[] | null>(null);
  const [dragLookId, setDragLookId] = useState<number | null>(null);

  const deleteLook = useCallback(async (id: number) => {
    if (!window.confirm('Delete this look? This cannot be undone.')) return;
    // Optimistic
    setDeletedLookIds(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    if (!supabase) return;
    const { error } = await supabase
      .from('admin_hidden_looks')
      .upsert({ look_id: id }, { onConflict: 'look_id' });
    if (error) {
      // Rollback
      setDeletedLookIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      window.alert(`Delete failed: ${error.message}`);
    }
  }, []);

  const moveLook = useCallback((id: number, direction: -1 | 1) => {
    setLookOrder(prev => {
      const base = prev || looks.map(l => l.id);
      const idx = base.indexOf(id);
      if (idx < 0) return prev;
      const swapIdx = idx + direction;
      if (swapIdx < 0 || swapIdx >= base.length) return prev;
      const next = [...base];
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return next;
    });
  }, []);

  const onDropLook = useCallback((targetId: number) => {
    if (dragLookId === null || dragLookId === targetId) return;
    setLookOrder(prev => {
      const base = prev || looks.map(l => l.id);
      const from = base.indexOf(dragLookId);
      const to = base.indexOf(targetId);
      if (from < 0 || to < 0) return prev;
      const next = [...base];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setDragLookId(null);
  }, [dragLookId]);

  const getToggles = useCallback((id: number) => toggles[id] || { platform: true, featured: true, splash: true }, [toggles]);

  const setToggle = useCallback((id: number, field: 'platform' | 'featured' | 'splash', value: boolean) => {
    setToggles(prev => ({
      ...prev,
      [id]: { ...prev[id] || { platform: true, featured: true, splash: true }, [field]: value },
    }));
  }, []);

  const lookRows: LookRow[] = useMemo(() => {
    const filtered = looks.filter(l => !deletedLookIds.has(l.id));
    const ordered = lookOrder
      ? [...filtered].sort((a, b) => {
          const ai = lookOrder.indexOf(a.id);
          const bi = lookOrder.indexOf(b.id);
          return (ai === -1 ? 1e9 : ai) - (bi === -1 ? 1e9 : bi);
        })
      : filtered;
    return ordered.map(look => {
      const c = creators[look.creator];
      return {
        id: look.id,
        creator: look.creator,
        creatorDisplay: c?.displayName || look.creator,
        creatorAvatar: c?.avatar || '',
        video: look.video,
        products: look.products.length,
      };
    });
  }, [deletedLookIds, lookOrder]);

  // Brand-to-domain mapping for Brandfetch logos
  const brandDomains: Record<string, string> = useMemo(() => ({
    'Zara': 'zara.com',
    'Windsor': 'windsorstore.com',
    'Diesel': 'diesel.com',
    'Pavoi': 'pavoi.com',
    'Vince': 'vince.com',
    'Suitsupply': 'suitsupply.com',
    'Dior': 'dior.com',
    'Fujifilm': 'fujifilm.com',
  }), []);

  const getBrandLogo = useCallback((brand: string) => {
    const domain = brandDomains[brand];
    if (!domain) return null;
    return `https://cdn.brandfetch.io/${domain}/w/80/h/80/fallback/lettermark?c=1id3n10pdBTarCHI0db`;
  }, [brandDomains]);

  const [crawledProducts, setCrawledProducts] = useState<CrawledProduct[]>([]);
  const [adProductIds, setAdProductIds] = useState<Set<string>>(new Set());
  const [adVideoMap, setAdVideoMap] = useState<Map<string, string[]>>(new Map());
  const [adImpressionsMap, setAdImpressionsMap] = useState<Map<string, number>>(new Map());
  const [adClicksMap, setAdClicksMap] = useState<Map<string, number>>(new Map());

  const filteredCreateLookProducts = useMemo(() => {
    if (!createLookProductSearch.trim()) return crawledProducts;
    const q = createLookProductSearch.toLowerCase();
    return crawledProducts.filter(p =>
      (p.name?.toLowerCase().includes(q)) ||
      (p.brand?.toLowerCase().includes(q))
    );
  }, [crawledProducts, createLookProductSearch]);

  const loadAdProductIds = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase
      .from('product_ads')
      .select('product_id, video_url, status, impressions, clicks');
    if (data) {
      setAdProductIds(new Set(data.map(r => r.product_id)));
      const videoMap = new Map<string, string[]>();
      const impMap = new Map<string, number>();
      const clkMap = new Map<string, number>();
      data.forEach(r => {
        if (r.video_url) {
          const existing = videoMap.get(r.product_id) || [];
          existing.push(r.video_url);
          videoMap.set(r.product_id, existing);
        }
        impMap.set(r.product_id, (impMap.get(r.product_id) || 0) + (r.impressions || 0));
        clkMap.set(r.product_id, (clkMap.get(r.product_id) || 0) + (r.clicks || 0));
      });
      setAdVideoMap(videoMap);
      setAdImpressionsMap(impMap);
      setAdClicksMap(clkMap);
    }
  }, []);

  useEffect(() => {
    const loadCrawled = async () => {
      if (!supabase) return;
      const { data, error } = await supabase
        .from('products')
        .select('id, name, brand, price, url, image_url, images, scraped_at, scrape_status')
        .order('scraped_at', { ascending: false });
      if (error) {
        console.error('Failed to load crawled products:', error);
        return;
      }
      const rows = (data || []).map((p) => ({
        ...p,
        is_crawled: p.scrape_status === 'done' || p.scraped_at !== null,
      })) as CrawledProduct[];
      setCrawledProducts(rows);
    };
    loadCrawled();
    loadAdProductIds();
  }, [loadAdProductIds]);

  // Poll active generation jobs — refresh statuses every 3s, remove finished
  // jobs, and reload adVideoMap when any job completes so the new videos
  // appear in the Creative column.
  useEffect(() => {
    if (genJobs.size === 0 || !supabase) return;
    let cancelled = false;
    const interval = setInterval(async () => {
      const allIds = Array.from(genJobs.values()).flatMap(j => j.adIds);
      if (allIds.length === 0) return;
      const { data } = await supabase
        .from('product_ads')
        .select('id, status')
        .in('id', allIds);
      if (cancelled || !data) return;
      const statusById = new Map(data.map((r: { id: string; status: string }) => [r.id, r.status]));
      let anyFinished = false;
      setGenJobs(prev => {
        const next = new Map(prev);
        for (const [productId, job] of next.entries()) {
          let done = 0, failed = 0, generating = 0;
          for (const adId of job.adIds) {
            const s = statusById.get(adId);
            if (s === 'done' || s === 'live') done++;
            else if (s === 'failed') failed++;
            else if (s === 'generating') generating++;
          }
          next.set(productId, { ...job, done, failed, generating });
          if (done + failed >= job.total) {
            next.delete(productId);
            anyFinished = true;
          }
        }
        return next;
      });
      if (anyFinished) void loadAdProductIds();
      // Drain the queue: whenever a job finishes, promote queued rows
      // into 'pending' up to the concurrency limit.
      void promoteQueuedAds();
    }, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [genJobs, loadAdProductIds]);

  const allProducts = useMemo(() => {
    const productMap = new Map<string, { id?: string; brand: string; name: string; price: string; url: string; image_url?: string | null; images?: string[]; video_urls: string[]; looks: Set<string>; creators: Set<string>; saves: number; clicks: number; impressions: number; connection: 'Look' | 'Crawl' | 'Ad' }>();
    looks.forEach(look => {
      const c = creators[look.creator];
      look.products.forEach(p => {
        const key = `${p.brand}-${p.name}`;
        if (!productMap.has(key)) {
          productMap.set(key, { brand: p.brand, name: p.name, price: p.price, url: p.url, image_url: (p as any).image, video_urls: [], looks: new Set(), creators: new Set(), saves: 0, clicks: 0, impressions: 0, connection: 'Look' });
        }
        const entry = productMap.get(key)!;
        entry.looks.add(look.title);
        entry.creators.add(c?.displayName || look.creator);
      });
    });

    crawledProducts.forEach((cp) => {
      const brand = cp.brand || 'Unknown';
      const name = cp.name || 'Untitled';
      const key = `${brand}-${name}`;
      const images = Array.isArray(cp.images) ? cp.images.filter((u): u is string => typeof u === 'string') : [];
      if (productMap.has(key)) {
        const entry = productMap.get(key)!;
        entry.id = cp.id;
        entry.image_url = cp.image_url;
        entry.images = images;
        entry.video_urls = adVideoMap.get(cp.id) || [];
        entry.impressions = adImpressionsMap.get(cp.id) || 0;
        entry.clicks = adClicksMap.get(cp.id) || 0;
        if (adProductIds.has(cp.id)) {
          entry.connection = 'Ad';
        } else if (cp.is_crawled) {
          entry.connection = 'Crawl';
        }
      } else {
        let connection: 'Look' | 'Crawl' | 'Ad' = cp.is_crawled ? 'Crawl' : 'Look';
        if (adProductIds.has(cp.id)) connection = 'Ad';
        productMap.set(key, {
          id: cp.id,
          brand,
          name,
          price: cp.price || '—',
          url: cp.url || '',
          image_url: cp.image_url,
          images,
          video_urls: adVideoMap.get(cp.id) || [],
          looks: new Set(),
          creators: new Set(),
          saves: 0,
          clicks: adClicksMap.get(cp.id) || 0,
          impressions: adImpressionsMap.get(cp.id) || 0,
          connection,
        });
      }
    });

    return Array.from(productMap.values()).map(p => {
      const hasCreative = p.video_urls.length > 0;
      return {
        ...p,
        hasCreative,
        lookCount: p.looks.size,
        creatorCount: p.creators.size,
      };
    });
  }, [crawledProducts, adProductIds, adVideoMap, adImpressionsMap, adClicksMap]);

  const lookTable = useSortableTable(lookRows);

  const filteredProductsList = useMemo(
    () => allProducts.filter(p => {
      if (productFilter === 'no-creative' && p.hasCreative) return false;
      const key = `${p.brand}-${p.name}`;
      if (deletedProductKeys.has(key)) return false;
      return true;
    }),
    [allProducts, productFilter, deletedProductKeys]
  );
  const productTable = useSortableTable(filteredProductsList);

  const toggleExpand = (id: number) => {
    setExpandedId(prev => prev === id ? null : id);
  };

  const navigate = useNavigate();

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }, []);

  const handleGenerateCreative = useCallback(async (productId: string, productName: string, style: string, model: string) => {
    if (genJobs.has(productId)) return;
    setGeneratingIds(prev => new Set(prev).add(productId));
    showToast(`Agent started generating creative for "${productName}"`);
    const { data, error } = await createBatchAds([productId], style, 2, model);
    setGeneratingIds(prev => {
      const next = new Set(prev);
      next.delete(productId);
      return next;
    });
    if (error || !data || data.length === 0) {
      showToast(`Agent failed: ${error || 'no ads returned'}`);
      return;
    }
    const adIds = data.map(d => d.id);
    setGenJobs(prev => {
      const next = new Map(prev);
      next.set(productId, { adIds, total: adIds.length, done: 0, failed: 0, generating: 0, startedAt: Date.now() });
      return next;
    });
  }, [genJobs, showToast]);

  return (
    <div className="admin-page">
      <div className="admin-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Content</h1>
          <p className="admin-page-subtitle">Manage all platform content</p>
        </div>
        {activeTab === 'looks' && (
          <button className="admin-btn admin-btn-primary" onClick={openCreateLookModal}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Create Look
          </button>
        )}
        {activeTab === 'products' && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="admin-btn admin-btn-secondary"
              onClick={runCopywriter}
              disabled={copywriting}
              title="Claude rewrites product names and adds a hook — only runs on products without display_name"
            >
              {copywriting && copywriteProgress ? (
                <>Rewriting {copywriteProgress.done}/{copywriteProgress.total}…</>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
                    <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                  Rewrite with Claude
                </>
              )}
            </button>
            <button
              className="admin-btn admin-btn-secondary"
              onClick={refreshStaleProducts}
              disabled={refreshing}
              title="Re-check prices and availability for products not refreshed in 7+ days"
            >
              {refreshing && refreshProgress ? (
                <>Refreshing {refreshProgress.done}/{refreshProgress.total}…</>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
                    <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                  </svg>
                  Refresh stale
                </>
              )}
            </button>
            <button className="admin-btn admin-btn-primary" onClick={() => setShowAddProducts(true)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add Products
            </button>
          </div>
        )}
      </div>
      <div className="admin-tabs">
        <button className={`admin-tab ${activeTab === 'looks' ? 'active' : ''}`} onClick={() => setActiveTab('looks')}>Looks</button>
        <button className={`admin-tab ${activeTab === 'products' ? 'active' : ''}`} onClick={() => setActiveTab('products')}>Products</button>
        <button className={`admin-tab ${activeTab === 'musics' ? 'active' : ''}`} onClick={() => setActiveTab('musics')}>Musics</button>
        <button className={`admin-tab ${activeTab === 'places' ? 'active' : ''}`} onClick={() => setActiveTab('places')}>Places</button>
      </div>

      {activeTab === 'looks' && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 32 }}></th>
                <th>Creative</th>
                <SortableTh label="Creator" sortKey="creatorDisplay" currentSort={lookTable.sort} onSort={lookTable.handleSort} />
                <th>Created At</th>
                <th>Platform</th>
                <th>Featured</th>
                <th>Weight</th>
                <th>Splash</th>
                <th>Products</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {lookTable.sortedData.map(row => {
                const look = looks.find(l => l.id === row.id)!;
                const isExpanded = expandedId === row.id;
                return (
                  <Fragment key={row.id}>
                    <tr
                      className="admin-look-main-row"
                      onClick={() => toggleExpand(row.id)}
                      style={{ cursor: 'pointer', opacity: dragLookId === row.id ? 0.4 : 1 }}
                      draggable
                      onDragStart={(e) => { e.stopPropagation(); setDragLookId(row.id); e.dataTransfer.effectAllowed = 'move'; }}
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDropLook(row.id); }}
                      onDragEnd={() => setDragLookId(null)}
                    >
                      <td
                        onClick={(e) => e.stopPropagation()}
                        style={{ cursor: 'grab', color: '#bbb', textAlign: 'center', fontSize: 16, userSelect: 'none' }}
                        aria-label="Drag to reorder"
                        title="Drag to reorder"
                      >
                        ⋮⋮
                      </td>
                      <td>
                        <div className="admin-look-thumb">
                          <video src={`${basePath}/${row.video}`} muted loop playsInline preload="metadata" />
                          <div className="admin-look-preview">
                            <video src={`${basePath}/${row.video}`} autoPlay muted loop playsInline />
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="admin-look-creator">
                          <img className="admin-look-creator-avatar" src={row.creatorAvatar} alt={row.creator} />
                          <span>{row.creatorDisplay}</span>
                        </div>
                      </td>
                      <td className="admin-cell-muted">Feb 17, 2026, 12:16 PM</td>
                      <td><AdminToggle on={getToggles(row.id).platform} onChange={v => setToggle(row.id, 'platform', v)} /></td>
                      <td><AdminToggle on={getToggles(row.id).featured} onChange={v => setToggle(row.id, 'featured', v)} /></td>
                      <td><span className="admin-weight-input">5</span></td>
                      <td><AdminToggle on={getToggles(row.id).splash} onChange={v => setToggle(row.id, 'splash', v)} /></td>
                      <td>
                        <button className="admin-products-dropdown" onClick={(e) => { e.stopPropagation(); toggleExpand(row.id); }}>
                          <span>{row.products} Products</span>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
                            <polyline points="6 9 12 15 18 9"/>
                          </svg>
                        </button>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="admin-product-actions">
                          <button className="admin-icon-btn" aria-label="Move up" onClick={() => moveLook(row.id, -1)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
                          </button>
                          <button className="admin-icon-btn" aria-label="Move down" onClick={() => moveLook(row.id, 1)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
                          </button>
                          <button className="admin-icon-btn danger" aria-label="Delete" onClick={() => deleteLook(row.id)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                    <tr className={`admin-look-expanded-row ${isExpanded ? 'open' : ''}`}>
                      <td colSpan={10} style={{ padding: 0 }}>
                        <div className="admin-expand-animate">
                          <div className="admin-look-products">
                            <h3 className="admin-products-title">Products</h3>
                            <table className="admin-table admin-products-table">
                              <thead>
                                <tr>
                                  <th style={{ textAlign: 'left' }}>Creative</th>
                                  <th style={{ textAlign: 'left' }}>Photos</th>
                                  <th style={{ textAlign: 'left' }}>Product</th>
                                  <th>Price</th>
                                  <th>Connection</th>
                                  <th>Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {look.products.map((product, pi) => {
                                  const key = `${product.brand}-${product.name}`;
                                  const matched = allProducts.find(ap => `${ap.brand}-${ap.name}` === key);
                                  const videoUrls = matched?.id ? (adVideoMap.get(matched.id) || []) : [];
                                  const imageUrl = matched?.image_url || (product as any).image || null;
                                  const connection: 'Look' | 'Crawl' | 'Ad' = matched?.connection || 'Look';
                                  return (
                                    <tr key={pi}>
                                      <td>
                                        {videoUrls.length > 0 ? (
                                          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                            {videoUrls.slice(0, 3).map((v, vi) => (
                                              <div key={vi} className="admin-look-thumb" style={{ width: 36, height: 48 }}>
                                                <video
                                                  src={v}
                                                  autoPlay
                                                  muted
                                                  loop
                                                  playsInline
                                                  preload="metadata"
                                                  style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4 }}
                                                />
                                                <div className="admin-look-preview">
                                                  <video src={v} autoPlay muted loop playsInline />
                                                </div>
                                              </div>
                                            ))}
                                            {videoUrls.length > 3 && (
                                              <span style={{ fontSize: 11, color: '#888', fontWeight: 600 }}>
                                                +{videoUrls.length - 3}
                                              </span>
                                            )}
                                          </div>
                                        ) : (
                                          <span style={{ fontSize: 11, color: '#ccc' }}>—</span>
                                        )}
                                      </td>
                                      <td>
                                        <div className="admin-product-creative">
                                          {imageUrl ? (
                                            <img
                                              src={imageUrl}
                                              alt={product.name}
                                              style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover' }}
                                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                            />
                                          ) : (
                                            <img
                                              src={getBrandLogo(product.brand) || ''}
                                              alt={product.brand}
                                              className="admin-brand-logo"
                                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                            />
                                          )}
                                        </div>
                                      </td>
                                      <td style={{ textAlign: 'left' }}>
                                        <div>
                                          <div style={{ fontWeight: 600, fontSize: 12 }}>{product.name}</div>
                                          <div style={{ fontSize: 10, color: '#999' }}>{product.brand}</div>
                                        </div>
                                      </td>
                                      <td style={{ fontWeight: 600 }}>{product.price}</td>
                                      <td>
                                        <span className={`admin-connection-pill admin-connection-${connection.toLowerCase()}`}>
                                          {connection}
                                        </span>
                                      </td>
                                      <td>
                                        <div className="admin-product-actions">
                                          <button className="admin-icon-btn" aria-label="Move up">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
                                          </button>
                                          <button className="admin-icon-btn" aria-label="Move down">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
                                          </button>
                                          <button className="admin-icon-btn danger" aria-label="Delete">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'products' && (
        <>
          <div className="admin-tabs" style={{ marginBottom: 12 }}>
            <button
              className={`admin-tab ${productFilter === 'all' ? 'active' : ''}`}
              onClick={() => setProductFilter('all')}
            >
              Show all
              <span className="admin-tab-badge">{allProducts.length}</span>
            </button>
            <button
              className={`admin-tab ${productFilter === 'no-creative' ? 'active' : ''}`}
              onClick={() => setProductFilter('no-creative')}
            >
              Show without creative
              <span className="admin-tab-badge">{allProducts.filter(p => !p.hasCreative).length}</span>
            </button>
          </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Creative</th>
                <th style={{ textAlign: 'left' }}>Photos</th>
                <SortableTh label="Product" sortKey="name" currentSort={productTable.sort} onSort={productTable.handleSort} />
                <SortableTh label="Price" sortKey="price" currentSort={productTable.sort} onSort={productTable.handleSort} />
                <SortableTh label="In Looks" sortKey="lookCount" currentSort={productTable.sort} onSort={productTable.handleSort} />
                <SortableTh label="Creators" sortKey="creatorCount" currentSort={productTable.sort} onSort={productTable.handleSort} />
                <SortableTh label="Impressions" sortKey="impressions" currentSort={productTable.sort} onSort={productTable.handleSort} />
                <SortableTh label="Saves" sortKey="saves" currentSort={productTable.sort} onSort={productTable.handleSort} />
                <SortableTh label="Clicks" sortKey="clicks" currentSort={productTable.sort} onSort={productTable.handleSort} />
                <th>Tags</th>
                <th>Links</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {productTable.sortedData.map((p, i) => (
                <tr key={`${p.brand}-${p.name}-${i}`}>
                  <td>
                    {p.hasCreative ? (
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        {p.video_urls.slice(0, 3).map((v, vi) => (
                          <div key={vi} className="admin-look-thumb" style={{ width: 36, height: 48 }}>
                            <video
                              src={v}
                              autoPlay
                              muted
                              loop
                              playsInline
                              preload="metadata"
                              style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4 }}
                            />
                            <div className="admin-look-preview">
                              <video src={v} autoPlay muted loop playsInline />
                            </div>
                          </div>
                        ))}
                        {p.video_urls.length > 3 && (
                          <span style={{ fontSize: 11, color: '#888', fontWeight: 600 }}>
                            +{p.video_urls.length - 3}
                          </span>
                        )}
                      </div>
                    ) : p.id && genJobs.has(p.id) ? (
                      (() => {
                        const job = genJobs.get(p.id)!;
                        const pct = Math.max(5, Math.round((job.done / job.total) * 100));
                        const label = job.generating > 0
                          ? `Generating ${job.done}/${job.total}`
                          : job.done < job.total ? `Queued ${job.done}/${job.total}` : `Finalizing…`;
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 110 }}>
                            <div style={{ fontSize: 10, fontWeight: 600, color: '#111', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                              {label}
                            </div>
                            <div style={{ position: 'relative', height: 4, borderRadius: 4, background: '#e2e8f0', overflow: 'hidden' }}>
                              <div
                                style={{
                                  position: 'absolute',
                                  inset: 0,
                                  width: `${pct}%`,
                                  background: 'linear-gradient(90deg, #3b82f6, #8b5cf6)',
                                  transition: 'width 400ms ease',
                                }}
                              />
                              {job.generating > 0 && (
                                <div
                                  className="admin-shimmer"
                                  style={{
                                    position: 'absolute',
                                    inset: 0,
                                    background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)',
                                    animation: 'admin-shimmer 1.4s infinite',
                                  }}
                                />
                              )}
                            </div>
                          </div>
                        );
                      })()
                    ) : p.id ? (
                      <button
                        className="admin-btn admin-btn-primary"
                        style={{ fontSize: 11, padding: '4px 10px' }}
                        disabled={generatingIds.has(p.id)}
                        onClick={() => p.id && setGeneratePicker({ productId: p.id, productName: p.name })}
                      >
                        {generatingIds.has(p.id) ? 'Starting…' : 'Generate'}
                      </button>
                    ) : (
                      <span style={{ fontSize: 11, color: '#ccc' }}>—</span>
                    )}
                  </td>
                  <td>
                    <div className="admin-product-creative" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {(() => {
                        const allImages: string[] = (p.images && p.images.length > 0)
                          ? p.images
                          : (p.image_url ? [p.image_url] : []);
                        if (allImages.length === 0) {
                          return (
                            <img
                              src={getBrandLogo(p.brand) || ''}
                              alt={p.brand}
                              className="admin-brand-logo"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                          );
                        }
                        const shown = allImages.slice(0, 3);
                        const extra = allImages.length - shown.length;
                        return (
                          <>
                            {shown.map((src, ii) => (
                              <img
                                key={ii}
                                src={src}
                                alt={p.name}
                                style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover', border: '1px solid #eee' }}
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                              />
                            ))}
                            {extra > 0 && (
                              <span style={{ fontSize: 11, fontWeight: 600, color: '#475569', background: '#f1f5f9', borderRadius: 6, padding: '0 6px', height: 40, display: 'inline-flex', alignItems: 'center' }}>
                                +{extra}
                              </span>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </td>
                  <td style={{ textAlign: 'left' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 12 }}>{p.name}</div>
                      <div style={{ fontSize: 10, color: '#999' }}>{p.brand}</div>
                    </div>
                  </td>
                  <td style={{ fontWeight: 600 }}>{p.price}</td>
                  <td>{p.lookCount}</td>
                  <td>{p.creatorCount}</td>
                  <td>{p.impressions > 0 ? p.impressions.toLocaleString() : '—'}</td>
                  <td>{p.saves}</td>
                  <td>{p.clicks}</td>
                  <td>
                    <button
                      className="admin-btn admin-btn-secondary"
                      style={{ fontSize: 11, padding: '4px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                      onClick={() => setTagsModal({ name: p.name, brand: p.brand, tags: deriveTags(p.name, p.brand) })}
                      title="View tags"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                        <line x1="7" y1="7" x2="7.01" y2="7" />
                      </svg>
                    </button>
                  </td>
                  <td>
                    <button
                      className="admin-btn admin-btn-secondary"
                      style={{ fontSize: 11, padding: '4px 10px' }}
                      onClick={() => setLinkModal({ name: p.name, brand: p.brand, url: p.url || '' })}
                    >
                      View
                    </button>
                  </td>
                  <td>
                    <button
                      className="admin-btn admin-btn-secondary"
                      style={{ fontSize: 11, padding: '4px 8px', color: '#dc2626' }}
                      title={p.id ? 'Delete product' : 'Hide from list'}
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (!window.confirm(`Delete "${p.name}" by ${p.brand}?${p.id ? ' This will also remove any generated ads.' : ''}`)) return;
                        const key = `${p.brand}-${p.name}`;
                        if (p.id) {
                          if (!supabase) return;
                          await supabase.from('product_ads').delete().eq('product_id', p.id);
                          const { error } = await supabase.from('products').delete().eq('id', p.id);
                          if (error) {
                            showToast(`Delete failed: ${error.message}`);
                            return;
                          }
                          setCrawledProducts(prev => prev.filter(r => r.id !== p.id));
                        }
                        // Optimistic hide
                        setDeletedProductKeys(prev => {
                          const next = new Set(prev);
                          next.add(key);
                          return next;
                        });
                        if (supabase) {
                          const { error } = await supabase
                            .from('admin_hidden_products')
                            .upsert({ brand: p.brand, name: p.name }, { onConflict: 'brand,name' });
                          if (error) {
                            setDeletedProductKeys(prev => {
                              const next = new Set(prev);
                              next.delete(key);
                              return next;
                            });
                            showToast(`Hide failed: ${error.message}`);
                            return;
                          }
                        }
                        showToast(`Deleted ${p.name}`);
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6" />
                        <path d="M14 11v6" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      {activeTab === 'musics' && (
        <div className="admin-empty">No music data yet</div>
      )}

      {activeTab === 'places' && (
        <div className="admin-empty">No places data yet</div>
      )}

      {/* Create Look Modal */}
      {showCreateLook && (
        <div className="admin-modal-overlay" onClick={() => setShowCreateLook(false)}>
          <div className="admin-modal admin-modal-wide" onClick={e => e.stopPropagation()} style={{ maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
            <div className="admin-modal-header">
              <div>
                <h3>Create Look</h3>
                <p style={{ fontSize: 12, color: '#888', margin: '4px 0 0' }}>
                  Select products and configure your new look video
                </p>
              </div>
              <button className="admin-modal-close" onClick={() => setShowCreateLook(false)}>&times;</button>
            </div>

            <div className="admin-modal-body" style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Options row: Creator, Location, Style */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div className="admin-form-group" style={{ marginBottom: 0 }}>
                  <label>Creator (optional)</label>
                  <select
                    value={createLookCreator}
                    onChange={e => setCreateLookCreator(e.target.value)}
                    style={{
                      width: '100%', padding: '8px 10px', border: '1px solid #ddd',
                      borderRadius: 6, fontSize: 13, outline: 'none', background: '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    <option value="">None</option>
                    {creatorOptions.map(c => (
                      <option key={c.key} value={c.key}>{c.displayName}</option>
                    ))}
                  </select>
                </div>

                <div className="admin-form-group" style={{ marginBottom: 0 }}>
                  <label>Location (optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. New York, Paris"
                    value={createLookLocation}
                    onChange={e => setCreateLookLocation(e.target.value)}
                  />
                </div>

                <div className="admin-form-group" style={{ marginBottom: 0 }}>
                  <label>Style</label>
                  <select
                    value={createLookStyle}
                    onChange={e => setCreateLookStyle(e.target.value)}
                    style={{
                      width: '100%', padding: '8px 10px', border: '1px solid #ddd',
                      borderRadius: 6, fontSize: 13, outline: 'none', background: '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    <option value="Street Style">Street Style</option>
                    <option value="Editorial">Editorial</option>
                    <option value="Lifestyle">Lifestyle</option>
                    <option value="Studio">Studio</option>
                  </select>
                </div>
              </div>

              {/* Selected creator preview */}
              {createLookCreator && (() => {
                const c = creators[createLookCreator];
                return c ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#f8f8f8', borderRadius: 8 }}>
                    <img src={c.avatar} alt="" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{c.displayName}</div>
                      <div style={{ fontSize: 11, color: '#888' }}>@{createLookCreator}</div>
                    </div>
                  </div>
                ) : null;
              })()}

              {/* Product search */}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 5 }}>
                  Products
                </label>
                <input
                  type="text"
                  placeholder="Search products by name or brand..."
                  value={createLookProductSearch}
                  onChange={e => setCreateLookProductSearch(e.target.value)}
                  style={{
                    width: '100%', padding: '8px 10px', border: '1px solid #ddd',
                    borderRadius: 6, fontSize: 13, outline: 'none', boxSizing: 'border-box',
                  }}
                />
                {createLookSelectedProducts.size > 0 && (
                  <div style={{ fontSize: 12, color: '#888', marginTop: 6 }}>
                    {createLookSelectedProducts.size} product{createLookSelectedProducts.size > 1 ? 's' : ''} selected
                  </div>
                )}
              </div>

              {/* Product list */}
              <div style={{ flex: 1, overflow: 'auto', minHeight: 0, maxHeight: 320 }}>
                {filteredCreateLookProducts.length === 0 ? (
                  <div style={{ padding: '40px 0', textAlign: 'center', color: '#999', fontSize: 13 }}>
                    {crawledProducts.length === 0 ? 'No products available.' : 'No products match your search.'}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {filteredCreateLookProducts.map(p => {
                      const isSelected = createLookSelectedProducts.has(p.id);
                      return (
                        <div
                          key={p.id}
                          onClick={() => toggleCreateLookProduct(p.id)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px',
                            borderRadius: 8, cursor: 'pointer',
                            background: isSelected ? '#f0f7ff' : 'transparent',
                            border: `1px solid ${isSelected ? '#3b82f6' : 'transparent'}`,
                            transition: 'all 0.15s',
                          }}
                        >
                          {/* Checkbox */}
                          <div style={{
                            width: 20, height: 20, borderRadius: 4,
                            border: `2px solid ${isSelected ? '#3b82f6' : '#ccc'}`,
                            background: isSelected ? '#3b82f6' : '#fff',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0, transition: 'all 0.15s',
                          }}>
                            {isSelected && (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )}
                          </div>

                          {/* Product image */}
                          {p.image_url ? (
                            <img
                              src={p.image_url}
                              alt=""
                              style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }}
                            />
                          ) : (
                            <div style={{
                              width: 40, height: 40, borderRadius: 6, background: '#f0f0f0',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 10, color: '#999', flexShrink: 0,
                            }}>
                              No img
                            </div>
                          )}

                          {/* Product info */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {p.name || 'Unnamed product'}
                            </div>
                            <div style={{ fontSize: 11, color: '#888' }}>
                              {p.brand || 'Unknown brand'}{p.price ? ` · ${p.price}` : ''}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="admin-modal-footer">
              <button className="admin-btn admin-btn-secondary" onClick={() => setShowCreateLook(false)}>
                Cancel
              </button>
              <button
                className="admin-btn admin-btn-primary"
                disabled={createLookSelectedProducts.size === 0}
              >
                Generate Look ({createLookSelectedProducts.size} product{createLookSelectedProducts.size !== 1 ? 's' : ''})
              </button>
            </div>
          </div>
        </div>
      )}

      {generatePicker && (
        <div
          className="admin-modal-overlay"
          onClick={() => setGeneratePicker(null)}
        >
          <div
            className="admin-modal"
            style={{ width: 520, maxWidth: '90vw', padding: 24 }}
            onClick={e => e.stopPropagation()}
          >
            <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>Choose a prompt</h2>
            <p style={{ margin: '0 0 18px', fontSize: 13, color: '#888' }}>
              Pick the style for <strong style={{ color: '#111' }}>{generatePicker.productName}</strong>
            </p>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Video Model</label>
              <select
                value={genModel}
                onChange={e => setGenModel(e.target.value)}
                style={{
                  width: '100%', padding: '8px 12px', borderRadius: 6,
                  border: '1px solid #ddd', fontSize: 13, background: '#fff',
                }}
              >
                <optgroup label="Veo (Google)">
                  {VIDEO_MODELS.filter(m => m.group === 'Veo (Google)').map(m => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </optgroup>
                <optgroup label="Seedance (fal.ai)">
                  {VIDEO_MODELS.filter(m => m.group === 'Seedance (fal.ai)').map(m => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </optgroup>
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                { value: 'studio_clean', label: 'Studio Clean', desc: 'Minimal white-cyc studio. Clean product focus.' },
                { value: 'editorial_runway', label: 'Editorial Runway', desc: 'High-fashion magazine look, dramatic lighting.' },
                { value: 'street_style', label: 'Street Style', desc: 'Urban, candid, real-world environments.' },
                { value: 'lifestyle_context', label: 'Lifestyle', desc: 'Product in everyday use, warm ambient tone.' },
              ].map(s => (
                <button
                  key={s.value}
                  onClick={() => {
                    const picker = generatePicker;
                    setGeneratePicker(null);
                    handleGenerateCreative(picker.productId, picker.productName, s.value, genModel);
                  }}
                  style={{
                    textAlign: 'left',
                    padding: '12px 14px',
                    borderRadius: 8,
                    border: '1px solid #e5e5e5',
                    background: '#fff',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = '#3b82f6';
                    (e.currentTarget as HTMLElement).style.background = '#f8faff';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = '#e5e5e5';
                    (e.currentTarget as HTMLElement).style.background = '#fff';
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#111', marginBottom: 2 }}>{s.label}</div>
                  <div style={{ fontSize: 11, color: '#666', lineHeight: 1.4 }}>{s.desc}</div>
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
              <button className="admin-btn admin-btn-secondary" onClick={() => setGeneratePicker(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {tagsModal && (
        <div className="admin-modal-overlay" onClick={() => setTagsModal(null)}>
          <div
            className="admin-modal"
            style={{ width: 460, maxWidth: '90vw', padding: 24 }}
            onClick={e => e.stopPropagation()}
          >
            <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>Tags</h2>
            <p style={{ margin: '0 0 18px', fontSize: 13, color: '#888' }}>
              <strong style={{ color: '#111' }}>{tagsModal.name}</strong> · {tagsModal.brand}
            </p>
            {tagsModal.tags.length === 0 ? (
              <div style={{ fontSize: 12, color: '#999', fontStyle: 'italic' }}>No tags derived yet</div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {tagsModal.tags.map(t => (
                  <span
                    key={t}
                    style={{
                      padding: '5px 10px',
                      borderRadius: 999,
                      background: '#f1f5f9',
                      color: '#0f172a',
                      fontSize: 12,
                      fontWeight: 500,
                      border: '1px solid #e2e8f0',
                    }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
              <button className="admin-btn admin-btn-secondary" onClick={() => setTagsModal(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddProducts && (
        <div className="admin-modal-overlay" onClick={() => !ingesting && setShowAddProducts(false)}>
          <div
            className="admin-modal"
            style={{ width: 720, maxWidth: '92vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ padding: '20px 24px 12px' }}>
              <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>Add Products</h2>
              <p style={{ margin: '0 0 14px', fontSize: 13, color: '#888' }}>
                Describe what you want to add — Claude will research popular matching products.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  autoFocus
                  placeholder='e.g. "white shoes", "black dresses", "sunglasses"'
                  value={researchQuery}
                  onChange={e => setResearchQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') runResearch(); }}
                  style={{ flex: 1, padding: '8px 12px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 }}
                />
                <button
                  className="admin-btn admin-btn-primary"
                  onClick={runResearch}
                  disabled={researchLoading || !researchQuery.trim()}
                >
                  {researchLoading ? 'Researching…' : 'Research'}
                </button>
              </div>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 12, color: '#475569', cursor: 'pointer', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={researchLiveOnly}
                  onChange={e => setResearchLiveOnly(e.target.checked)}
                  style={{ margin: 0, cursor: 'pointer' }}
                />
                Only search Google Shopping API
              </label>
              {researchError && (
                <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12 }}>
                  <strong>Live search failed:</strong> {researchError}
                </div>
              )}
              {researchResults.length > 0 && researchSource && (
                <div style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px', borderRadius: 999, background: researchSource === 'live' ? '#ecfdf5' : '#fffbeb', border: '1px solid', borderColor: researchSource === 'live' ? '#a7f3d0' : '#fde68a', fontSize: 11, fontWeight: 600, color: researchSource === 'live' ? '#047857' : '#b45309', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: researchSource === 'live' ? '#10b981' : '#f59e0b' }} />
                  {researchSource === 'live' ? 'Live Google Shopping' : 'Seed (offline)'}
                </div>
              )}
              {researchResults.length > 0 && (
                <div style={{ display: 'flex', gap: 12, marginTop: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>{researchResults.length}</span>
                      <span style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Products</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#3b82f6' }}>
                        {researchResults.reduce((sum, p) => sum + (p.image_urls?.length || 1), 0)}
                      </span>
                      <span style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Thumbnails pulled</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>For</span>
                  {(['all', 'men', 'women', 'unisex'] as const).map(g => (
                    <button
                      key={g}
                      onClick={() => setResearchGender(g)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 999,
                        border: '1px solid',
                        borderColor: researchGender === g ? '#111' : '#e2e8f0',
                        background: researchGender === g ? '#111' : '#fff',
                        color: researchGender === g ? '#fff' : '#111',
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                        textTransform: 'capitalize',
                      }}
                    >
                      {g}
                    </button>
                  ))}
                  </div>
                </div>
              )}
            </div>

            <div style={{ flex: 1, overflow: 'auto', padding: '0 24px' }}>
              {researchLoading ? (
                <div style={{ padding: '40px 0', textAlign: 'center', color: '#999', fontSize: 13 }}>
                  Researching popular products…
                </div>
              ) : researchResults.length === 0 ? (
                <div style={{ padding: '40px 0', textAlign: 'center', color: '#999', fontSize: 13 }}>
                  Type a query and press Research.
                </div>
              ) : visibleResearchResults.length === 0 ? (
                <div style={{ padding: '40px 0', textAlign: 'center', color: '#999', fontSize: 13 }}>
                  No results for that gender.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {visibleResearchResults.map(p => {
                    const idx = researchResults.indexOf(p);
                    const isSelected = researchSelected.has(idx);
                    const scoreColor = p.thumbnailScore >= 85 ? '#16a34a' : p.thumbnailScore >= 70 ? '#ca8a04' : '#dc2626';
                    const scoreLabel = p.thumbnailScore >= 90 ? 'Excellent' : p.thumbnailScore >= 75 ? 'Good' : p.thumbnailScore >= 60 ? 'Fair' : 'Poor';
                    return (
                      <div
                        key={`${p.brand}-${p.name}-${idx}`}
                        onClick={() => {
                          setResearchSelected(prev => {
                            const next = new Set(prev);
                            if (next.has(idx)) next.delete(idx); else next.add(idx);
                            return next;
                          });
                        }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                          borderRadius: 8, cursor: 'pointer',
                          background: isSelected ? '#f0f7ff' : 'transparent',
                          border: `1px solid ${isSelected ? '#3b82f6' : '#eee'}`,
                        }}
                      >
                        <div style={{
                          width: 20, height: 20, borderRadius: 4,
                          border: `2px solid ${isSelected ? '#3b82f6' : '#ccc'}`,
                          background: isSelected ? '#3b82f6' : '#fff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          flexShrink: 0,
                        }}>
                          {isSelected && (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 3, flexShrink: 0, position: 'relative' }}>
                          {(p.image_urls || [p.image_url]).slice(0, 4).map((u, ui) => (
                            <img
                              key={ui}
                              src={u}
                              alt=""
                              onError={e => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
                              style={{
                                width: ui === 0 ? 48 : 28,
                                height: 48,
                                borderRadius: 6,
                                objectFit: 'cover',
                                background: '#f5f5f5',
                                border: '1px solid #e5e7eb',
                              }}
                            />
                          ))}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>{p.name}</div>
                          <div style={{ fontSize: 11, color: '#888' }}>
                            {p.brand} · {p.price} · <span style={{ textTransform: 'capitalize' }}>{p.gender}</span>
                          </div>
                          <div style={{ fontSize: 10, color: '#3b82f6', marginTop: 2, fontWeight: 600 }}>
                            {(p.image_urls || [p.image_url]).length} thumbnail{((p.image_urls || [p.image_url]).length === 1) ? '' : 's'} pulled
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 11, color: '#888' }}>Thumbnail</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: scoreColor }}>{p.thumbnailScore}</span>
                            <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: `${scoreColor}18`, color: scoreColor, fontWeight: 600 }}>{scoreLabel}</span>
                          </div>
                          <div style={{ fontSize: 10, color: '#999' }}>{p.reason}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ padding: '14px 24px', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: '#888' }}>
                {researchSelected.size > 0 ? `${researchSelected.size} selected` : ''}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="admin-btn admin-btn-secondary" onClick={() => !ingesting && setShowAddProducts(false)} disabled={ingesting}>
                  Cancel
                </button>
                <button
                  className="admin-btn admin-btn-primary"
                  onClick={ingestSelectedProducts}
                  disabled={ingesting || researchSelected.size === 0}
                >
                  {ingesting ? 'Ingesting…' : `Ingest ${researchSelected.size || ''}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {linkModal && (
        <div className="admin-modal-overlay" onClick={() => setLinkModal(null)}>
          <div
            className="admin-modal"
            style={{ width: 600, maxWidth: '92vw', padding: 24 }}
            onClick={e => e.stopPropagation()}
          >
            <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>Product links &amp; affiliates</h2>
            <p style={{ margin: '0 0 18px', fontSize: 13, color: '#888' }}>
              <strong style={{ color: '#111' }}>{linkModal.name}</strong> · {linkModal.brand}
            </p>

            <div style={{ marginBottom: 22 }}>
              <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                Product URL
              </div>
              {linkModal.url ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <a
                    href={linkModal.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      flex: 1,
                      fontSize: 12,
                      color: '#3b82f6',
                      textDecoration: 'none',
                      padding: '8px 10px',
                      background: '#f5f7fb',
                      borderRadius: 6,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {linkModal.url}
                  </a>
                  <button
                    className="admin-btn admin-btn-secondary"
                    style={{ fontSize: 11, padding: '6px 10px' }}
                    onClick={() => navigator.clipboard.writeText(linkModal.url)}
                  >
                    Copy
                  </button>
                  <a
                    className="admin-btn admin-btn-primary"
                    href={linkModal.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 11, padding: '6px 10px', textDecoration: 'none' }}
                  >
                    Open ↗
                  </a>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: '#999', fontStyle: 'italic' }}>No URL recorded</div>
              )}
            </div>

            <div>
              <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                Affiliate providers — {linkModal.brand} <span style={{ textTransform: 'none', color: '#bbb', letterSpacing: 0 }}>(sorted by rate)</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {getAffiliatesFor(linkModal.brand).map((a, i) => (
                  <div
                    key={a.network}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 12px',
                      background: i === 0 ? '#f0f9f3' : '#fafafa',
                      border: `1px solid ${i === 0 ? '#c6efd6' : '#eee'}`,
                      borderRadius: 8,
                    }}
                  >
                    {i === 0 && (
                      <span style={{ fontSize: 9, fontWeight: 700, color: '#16a34a', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                        BEST
                      </span>
                    )}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>{a.network}</div>
                      {a.note && (
                        <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>{a.note}</div>
                      )}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: i === 0 ? '#16a34a' : '#111' }}>
                      {a.rate}
                    </div>
                    <a
                      href={a.signupUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="admin-btn admin-btn-secondary"
                      style={{ fontSize: 11, padding: '4px 10px', textDecoration: 'none' }}
                    >
                      Sign up ↗
                    </a>
                  </div>
                ))}
              </div>
              {!BRAND_AFFILIATES[linkModal.brand] && (
                <div style={{ fontSize: 11, color: '#999', marginTop: 8, fontStyle: 'italic' }}>
                  No direct brand program on file. Showing default aggregator networks.
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
              <button className="admin-btn admin-btn-secondary" onClick={() => setLinkModal(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          onClick={() => navigate('/admin/agents?tab=video-gen&sub=product-ads')}
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#111',
            color: '#fff',
            padding: '12px 20px',
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 500,
            boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            cursor: 'pointer',
            animation: 'toastSlideUp 0.2s ease-out',
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 0 4px rgba(34,197,94,0.2)' }} />
          {toast}
        </div>
      )}
    </div>
  );
}

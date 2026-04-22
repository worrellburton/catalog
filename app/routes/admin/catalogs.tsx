import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from '@remix-run/react';
import { searchSuggestions } from '~/data/looks';
import { supabase } from '~/utils/supabase';
import {
  researchProducts,
  brainstormCatalogProducts,
  type ResearchedProduct,
  type BrainstormedProduct,
  type ProductGender,
} from '~/services/product-research';

interface Catalog {
  id: string;
  name: string;
  source: 'featured' | 'custom';
  createdAt: string;
}

const CUSTOM_KEY = 'catalog_admin_custom_catalogs';

function loadCustom(): Catalog[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Catalog[];
  } catch {
    return [];
  }
}

function saveCustom(list: Catalog[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
}

interface ProductRow {
  id: string;
  name: string | null;
  brand: string | null;
  image_url: string | null;
  catalog_tags: string[] | null;
}

interface CatalogLookRow {
  id: string;
  legacyId: number | null;
  title: string;
  videoPath: string | null;
  creatorHandle: string | null;
  productCount: number;
}

interface CatalogCreativeVideo {
  id: string;
  productId: string;
  videoUrl: string;
  thumbnailUrl: string | null;
  title: string | null;
  productName: string | null;
  productBrand: string | null;
  status: string;
}

interface CatalogCreativePayload {
  looks: CatalogLookRow[];
  products: ProductRow[];
  creatives: CatalogCreativeVideo[];
}

const ALL_CATALOG_NAME = 'all';
const ALL_ORDER_KEY = 'catalog_admin_all_order';

type CatalogSection = 'looks' | 'creatives' | 'products';

function isAllCatalog(name: string) {
  return name.trim().toLowerCase() === ALL_CATALOG_NAME;
}

function loadAllOrder(): Record<CatalogSection, string[]> {
  if (typeof window === 'undefined') return { looks: [], creatives: [], products: [] };
  try {
    const raw = localStorage.getItem(ALL_ORDER_KEY);
    if (!raw) return { looks: [], creatives: [], products: [] };
    const parsed = JSON.parse(raw) as Partial<Record<CatalogSection, string[]>>;
    return {
      looks: parsed.looks || [],
      creatives: parsed.creatives || [],
      products: parsed.products || [],
    };
  } catch {
    return { looks: [], creatives: [], products: [] };
  }
}

function saveAllOrder(order: Record<CatalogSection, string[]>) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(ALL_ORDER_KEY, JSON.stringify(order));
}

function applyOrder<T>(items: T[], idKey: (item: T) => string, savedIds: string[]): T[] {
  if (savedIds.length === 0) return items;
  const byId = new Map(items.map(i => [idKey(i), i]));
  const ordered: T[] = [];
  const seen = new Set<string>();
  for (const id of savedIds) {
    const match = byId.get(id);
    if (match && !seen.has(id)) {
      ordered.push(match);
      seen.add(id);
    }
  }
  for (const item of items) {
    const id = idKey(item);
    if (!seen.has(id)) ordered.push(item);
  }
  return ordered;
}

function reorderArray<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return items;
  const next = items.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export default function AdminCatalogs() {
  const [custom, setCustom] = useState<Catalog[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [autoTagging, setAutoTagging] = useState(false);
  const [autoTagProgress, setAutoTagProgress] = useState<{ done: number; total: number } | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => { setCustom(loadCustom()); }, []);

  const loadProducts = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase
      .from('products')
      .select('id, name, brand, image_url, catalog_tags');
    if (data) setProducts(data as ProductRow[]);
  }, []);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  // Expandable creative dropdown per catalog row.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [creativeByCatalog, setCreativeByCatalog] = useState<Record<string, CatalogCreativePayload>>({});
  const [creativeLoading, setCreativeLoading] = useState<Set<string>>(new Set());

  const loadCreative = useCallback(async (catalog: Catalog) => {
    if (!supabase) return;
    setCreativeLoading(prev => new Set(prev).add(catalog.id));
    try {
      const isAll = isAllCatalog(catalog.name);

      // Looks: `all` catalog pulls every live look so admins can browse the
      // entire active set; other catalogs filter by catalog_tags.
      let looksQuery = supabase
        .from('looks')
        .select(`
          id, legacy_id, title, video_path, creator_handle, status, enabled, archived_at,
          look_products ( product_id )
        `)
        .eq('status', 'live')
        .eq('enabled', true)
        .is('archived_at', null)
        .order('created_at', { ascending: false });
      if (!isAll) {
        looksQuery = looksQuery.contains('catalog_tags', [catalog.name]);
      }
      const { data: lookRows } = await looksQuery;

      type LookPayload = {
        id: string;
        legacy_id: number | null;
        title: string;
        video_path: string | null;
        creator_handle: string | null;
        look_products: { product_id: string }[] | null;
      };
      const mappedLooks: CatalogLookRow[] = ((lookRows as LookPayload[] | null) || []).map(r => ({
        id: r.id,
        legacyId: r.legacy_id,
        title: r.title,
        videoPath: r.video_path,
        creatorHandle: r.creator_handle,
        productCount: (r.look_products || []).length,
      }));

      // The `all` catalog is a superset view — if multiple looks share the
      // same video_path they'd render as visual dupes, so collapse to the
      // first occurrence per video. Other catalogs keep every row.
      const looks = isAll
        ? Array.from(new Map(mappedLooks.map(l => [l.videoPath ?? l.id, l])).values())
        : mappedLooks;

      // Products: `all` catalog uses every product currently loaded; others
      // filter by catalog_tags. Both paths dedupe so nothing repeats.
      const catalogProducts = isAll
        ? products
        : products.filter(p => (p.catalog_tags || []).includes(catalog.name));

      // Creative videos (product_ads). `all` pulls every rendered ad so admins
      // see the full library of creative in one place; named catalogs filter
      // to ads whose underlying product is tagged with this catalog.
      const catalogProductIds = new Set(catalogProducts.map(p => p.id));
      let adsQuery = supabase
        .from('product_ads')
        .select('id, product_id, title, video_url, thumbnail_url, status, products!inner(id, name, brand)')
        .not('video_url', 'is', null)
        .in('status', ['done', 'live'])
        .order('created_at', { ascending: false });
      if (!isAll) {
        adsQuery = adsQuery.in(
          'product_id',
          catalogProducts.length > 0 ? catalogProducts.map(p => p.id) : ['00000000-0000-0000-0000-000000000000'],
        );
      }
      const { data: adRows } = await adsQuery;

      type AdPayload = {
        id: string;
        product_id: string;
        title: string | null;
        video_url: string;
        thumbnail_url: string | null;
        status: string;
        products: { id: string; name: string | null; brand: string | null } | null;
      };
      const creatives: CatalogCreativeVideo[] = ((adRows as unknown as AdPayload[] | null) || [])
        .filter(r => isAll || catalogProductIds.has(r.product_id))
        .map(r => ({
          id: r.id,
          productId: r.product_id,
          videoUrl: r.video_url,
          thumbnailUrl: r.thumbnail_url,
          title: r.title,
          productName: r.products?.name ?? null,
          productBrand: r.products?.brand ?? null,
          status: r.status,
        }));

      if (isAll) {
        const order = loadAllOrder();
        const orderedLooks = applyOrder(looks, l => l.id, order.looks);
        const orderedCreatives = applyOrder(creatives, c => c.id, order.creatives);
        const orderedProducts = applyOrder(catalogProducts, p => p.id, order.products);
        setCreativeByCatalog(prev => ({
          ...prev,
          [catalog.id]: { looks: orderedLooks, products: orderedProducts, creatives: orderedCreatives },
        }));
      } else {
        setCreativeByCatalog(prev => ({
          ...prev,
          [catalog.id]: { looks, products: catalogProducts, creatives },
        }));
      }
    } finally {
      setCreativeLoading(prev => {
        const next = new Set(prev);
        next.delete(catalog.id);
        return next;
      });
    }
  }, [products]);

  const reorderAllSection = useCallback((catalogId: string, section: CatalogSection, fromIndex: number, toIndex: number) => {
    setCreativeByCatalog(prev => {
      const current = prev[catalogId];
      if (!current) return prev;
      const next = { ...current };
      if (section === 'looks') next.looks = reorderArray(current.looks, fromIndex, toIndex);
      else if (section === 'creatives') next.creatives = reorderArray(current.creatives, fromIndex, toIndex);
      else next.products = reorderArray(current.products, fromIndex, toIndex);

      saveAllOrder({
        looks: next.looks.map(l => l.id),
        creatives: next.creatives.map(c => c.id),
        products: next.products.map(p => p.id),
      });
      return { ...prev, [catalogId]: next };
    });
  }, []);

  const toggleExpanded = useCallback((catalog: Catalog) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(catalog.id)) {
        next.delete(catalog.id);
      } else {
        next.add(catalog.id);
        if (!creativeByCatalog[catalog.id]) {
          loadCreative(catalog);
        }
      }
      return next;
    });
  }, [creativeByCatalog, loadCreative]);

  const featured: Catalog[] = searchSuggestions.map((name, i) => ({
    id: `featured-${i}`,
    name,
    source: 'featured',
    createdAt: '—',
  }));

  const all = [...custom, ...featured];

  const addCatalog = () => {
    const name = newName.trim();
    if (!name) return;
    const entry: Catalog = {
      id: `custom-${Date.now()}`,
      name,
      source: 'custom',
      createdAt: new Date().toISOString(),
    };
    const next = [entry, ...custom];
    setCustom(next);
    saveCustom(next);
    setNewName('');
    setShowAdd(false);
  };

  const removeCustom = (id: string) => {
    const next = custom.filter(c => c.id !== id);
    setCustom(next);
    saveCustom(next);
  };

  // Assemble Look modal state
  const [assembleCatalog, setAssembleCatalog] = useState<Catalog | null>(null);
  const [assembling, setAssembling] = useState(false);
  const [assembleResult, setAssembleResult] = useState<{
    title: string;
    description: string;
    style: string;
    prompt: string;
    productIds: string[];
  } | null>(null);
  const [savingLook, setSavingLook] = useState(false);
  const [assembleError, setAssembleError] = useState<string | null>(null);

  const openAssemble = useCallback((catalog: Catalog) => {
    setAssembleCatalog(catalog);
    setAssembleResult(null);
    setAssembleError(null);
  }, []);

  const runAssemble = useCallback(async () => {
    if (!assembleCatalog || !supabase) return;
    const tagged = products.filter(p => (p.catalog_tags || []).includes(assembleCatalog.name));
    if (tagged.length < 3) {
      setAssembleError(`Not enough products tagged with "${assembleCatalog.name}" — need at least 3.`);
      return;
    }
    setAssembling(true);
    setAssembleError(null);
    setAssembleResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('catalog-assemble-look', {
        body: {
          catalog: assembleCatalog.name,
          products: tagged.map(p => ({
            id: p.id,
            name: p.name || '',
            brand: p.brand || '',
            image_url: p.image_url,
          })),
          count: 5,
        },
      });
      if (error) {
        setAssembleError(error.message);
      } else if (!data?.success) {
        setAssembleError(data?.error || 'Assembly failed');
      } else {
        setAssembleResult({
          title: data.title,
          description: data.description,
          style: data.style,
          prompt: data.prompt,
          productIds: data.productIds,
        });
      }
    } catch (err) {
      setAssembleError(err instanceof Error ? err.message : String(err));
    } finally {
      setAssembling(false);
    }
  }, [assembleCatalog, products]);

  const saveAssembledLook = useCallback(async () => {
    if (!assembleCatalog || !assembleResult || !supabase) return;
    setSavingLook(true);
    try {
      const { data: lookRow, error: insertErr } = await supabase
        .from('looks')
        .insert({
          title: assembleResult.title,
          description: assembleResult.description,
          catalog_tags: [assembleCatalog.name],
          ai_assembled: true,
          assembly_prompt: assembleResult.prompt,
          status: 'pending',
          enabled: false,
        })
        .select('id')
        .single();
      if (insertErr || !lookRow) {
        setAssembleError(insertErr?.message || 'Failed to save look');
        setSavingLook(false);
        return;
      }
      if (assembleResult.productIds.length > 0) {
        await supabase.from('look_products').insert(
          assembleResult.productIds.map((product_id, sort_order) => ({
            look_id: lookRow.id,
            product_id,
            sort_order,
          }))
        );
      }

      // Kick off Veo video generation — use the hero (first) product as the
      // anchor and feed Claude's assembly_prompt directly so Veo renders the
      // scene Claude imagined.
      const heroProductId = assembleResult.productIds[0];
      if (heroProductId) {
        const styleSlug = assembleResult.style.toLowerCase().replace(/[^a-z0-9]+/g, '_');
        await supabase.from('generated_videos').insert({
          product_id: heroProductId,
          look_id: lookRow.id,
          style: styleSlug || 'lifestyle_context',
          prompt: assembleResult.prompt,
          status: 'pending',
          aspect_ratio: '9:16',
        });
      }

      showToast(`Look "${assembleResult.title}" saved — video queued for generation`);
      setAssembleCatalog(null);
      setAssembleResult(null);
    } catch (err) {
      setAssembleError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingLook(false);
    }
  }, [assembleCatalog, assembleResult, showToast]);

  // Suggest Products modal state
  const [suggestCatalog, setSuggestCatalog] = useState<Catalog | null>(null);
  const [researchQuery, setResearchQuery] = useState('');
  const [researchGender, setResearchGender] = useState<ProductGender | 'all'>('all');
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchResults, setResearchResults] = useState<BrainstormedProduct[]>([]);
  // Hover preview (big thumbnail next to cursor) when scanning research rows.
  const [previewImg, setPreviewImg] = useState<{ url: string; x: number; y: number } | null>(null);
  const [researchSelected, setResearchSelected] = useState<Set<number>>(new Set());
  const [researchLiveOnly, setResearchLiveOnly] = useState(true);
  const [researchSource, setResearchSource] = useState<'live' | 'seed' | null>(null);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [brainstormPhase, setBrainstormPhase] = useState<'idle' | 'brainstorming' | 'searching' | 'done'>('idle');
  const [brainstormQueries, setBrainstormQueries] = useState<string[]>([]);
  const [brainstormProgress, setBrainstormProgress] = useState<{ done: number; total: number } | null>(null);

  const openSuggest = useCallback((catalog: Catalog) => {
    setSuggestCatalog(catalog);
    setResearchQuery(catalog.name);
    setResearchGender('all');
    setResearchResults([]);
    setResearchSelected(new Set());
    setResearchError(null);
    setResearchSource(null);
    setBrainstormQueries([]);
    setBrainstormPhase('idle');
    setBrainstormProgress(null);
  }, []);

  // Add Products modal — pick existing products from the DB and tag them
  // onto a catalog. Persisted by pushing the catalog name into each
  // product's catalog_tags array (same shape the dropdown filter reads).
  const [addProductsCatalog, setAddProductsCatalog] = useState<Catalog | null>(null);
  const [addSearch, setAddSearch] = useState('');
  const [addSelected, setAddSelected] = useState<Set<string>>(new Set());
  const [addBusy, setAddBusy] = useState(false);

  const openAdd = useCallback((catalog: Catalog) => {
    setAddProductsCatalog(catalog);
    setAddSearch('');
    setAddSelected(new Set());
  }, []);

  const closeAdd = useCallback(() => {
    if (addBusy) return;
    setAddProductsCatalog(null);
    setAddSearch('');
    setAddSelected(new Set());
  }, [addBusy]);

  const toggleAddSelected = useCallback((id: string) => {
    setAddSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const commitAdd = useCallback(async () => {
    if (!supabase || !addProductsCatalog || addSelected.size === 0) return;
    setAddBusy(true);
    try {
      const name = addProductsCatalog.name;
      const updates = Array.from(addSelected).map(id => {
        const p = products.find(x => x.id === id);
        const tags = new Set([...(p?.catalog_tags || []), name]);
        return supabase!
          .from('products')
          .update({ catalog_tags: Array.from(tags) })
          .eq('id', id);
      });
      const results = await Promise.all(updates);
      const failed = results.filter(r => r.error).length;
      if (failed > 0) {
        showToast(`Added ${addSelected.size - failed} of ${addSelected.size} products (${failed} failed).`);
      } else {
        showToast(`Added ${addSelected.size} product${addSelected.size === 1 ? '' : 's'} to ${name}.`);
      }
      await loadProducts();
      // Invalidate any cached dropdown creative so the next expand refetches.
      setCreativeByCatalog(prev => {
        const next = { ...prev };
        delete next[addProductsCatalog.id];
        return next;
      });
      setAddProductsCatalog(null);
      setAddSelected(new Set());
      setAddSearch('');
    } finally {
      setAddBusy(false);
    }
  }, [addProductsCatalog, addSelected, products, loadProducts, showToast]);

  const closeSuggest = useCallback(() => {
    if (ingesting) return;
    setSuggestCatalog(null);
    setResearchQuery('');
    setResearchResults([]);
    setResearchSelected(new Set());
    setResearchError(null);
  }, [ingesting]);

  const runResearch = useCallback(async () => {
    if (!researchQuery.trim()) return;
    setResearchLoading(true);
    setResearchSelected(new Set());
    setResearchError(null);
    setResearchResults([]);
    setBrainstormQueries([]);
    setBrainstormPhase('brainstorming');
    setBrainstormProgress(null);

    const { queries, products, error, source } = await brainstormCatalogProducts(researchQuery, {
      count: 8,
      onProgress: (p) => {
        setBrainstormPhase(p.phase);
        if (p.queries) setBrainstormQueries(p.queries);
        if (p.completedQueries !== undefined && p.queries) {
          setBrainstormProgress({ done: p.completedQueries, total: p.queries.length });
        }
        if (p.products) setResearchResults(p.products);
      },
    });

    setBrainstormQueries(queries);
    setResearchResults(products);
    setResearchSource(source);
    setResearchError(error);
    setResearchLoading(false);
    setBrainstormPhase('done');
  }, [researchQuery]);

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
        // Auto-tag with the catalog since these were suggested specifically for it
        catalog_tags: suggestCatalog ? [suggestCatalog.name] : [],
      };
    });
    const { error } = await supabase
      .from('products')
      .insert(rows)
      .select('id');
    setIngesting(false);
    if (!error) {
      showToast(`Added ${rows.length} product${rows.length === 1 ? '' : 's'} from "${suggestCatalog?.name}"`);
      closeSuggest();
      loadProducts();
    } else {
      showToast(`Ingest failed: ${error.message}`);
    }
  }, [researchSelected, researchResults, suggestCatalog, closeSuggest, showToast]);

  const visibleResearchResults = useMemo(() =>
    researchResults.filter(
      p => researchGender === 'all' || p.gender === researchGender || p.gender === 'unisex'
    ),
  [researchResults, researchGender]);

  // Count products tagged with each catalog
  const catalogProductCounts = useMemo(() => {
    const counts = new Map<string, number>();
    products.forEach(p => {
      (p.catalog_tags || []).forEach(tag => {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      });
    });
    return counts;
  }, [products]);

  const runAutoTag = useCallback(async () => {
    if (!supabase || products.length === 0) return;
    const allCatalogs = all.map(c => c.name);
    if (allCatalogs.length === 0) {
      showToast('No catalogs to tag against');
      return;
    }
    setAutoTagging(true);
    setAutoTagProgress({ done: 0, total: products.length });

    try {
      const BATCH = 30;
      let done = 0;
      for (let i = 0; i < products.length; i += BATCH) {
        const batch = products.slice(i, i + BATCH);
        const { data, error } = await supabase.functions.invoke('catalog-auto-tag', {
          body: {
            products: batch.map(p => ({
              id: p.id,
              name: p.name || '',
              brand: p.brand || '',
              image_url: p.image_url,
            })),
            catalogs: allCatalogs,
          },
        });
        if (error) {
          console.error('Auto-tag batch failed:', error);
          break;
        }
        if (data?.success && data.results) {
          // Persist tags in parallel
          const updates = Object.entries(data.results as Record<string, string[]>);
          await Promise.all(
            updates.map(([id, tags]) =>
              supabase!.from('products').update({ catalog_tags: tags }).eq('id', id)
            )
          );
        }
        done += batch.length;
        setAutoTagProgress({ done, total: products.length });
      }
      await loadProducts();
      showToast(`Tagged ${done} product${done === 1 ? '' : 's'}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Auto-tag failed: ${msg}`);
    } finally {
      setAutoTagging(false);
      setAutoTagProgress(null);
    }
  }, [products, all, loadProducts, showToast]);

  return (
    <div className="admin-page">
      <div className="admin-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Catalogs</h1>
          <p className="admin-page-subtitle">Featured catalog ideas that scroll in the suggestor on the main screen</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="admin-btn admin-btn-secondary"
            onClick={runAutoTag}
            disabled={autoTagging || products.length === 0}
            title="Use Claude to tag all products with relevant catalogs"
          >
            {autoTagging && autoTagProgress ? (
              <>Auto-tagging {autoTagProgress.done}/{autoTagProgress.total}…</>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
                  <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                  <line x1="7" y1="7" x2="7.01" y2="7" />
                </svg>
                Auto-tag with Claude
              </>
            )}
          </button>
          <button className="admin-btn admin-btn-primary" onClick={() => setShowAdd(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add new catalog
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 20, padding: '10px 0', marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#111' }}>{all.length}</span>
          <span style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#111' }}>{featured.length}</span>
          <span style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Featured</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#111' }}>{custom.length}</span>
          <span style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Custom</span>
        </div>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Catalog</th>
              <th>Source</th>
              <th>Products</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {all.map(c => {
              const productCount = catalogProductCounts.get(c.name) || 0;
              const isOpen = expanded.has(c.id);
              const creative = creativeByCatalog[c.id];
              const isLoadingCreative = creativeLoading.has(c.id);
              return (
              <React.Fragment key={c.id}>
              <tr>
                <td style={{ textAlign: 'left', fontWeight: 600 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button
                      onClick={() => toggleExpanded(c)}
                      aria-label={isOpen ? 'Collapse creative' : 'Expand creative'}
                      title={isOpen ? 'Hide looks in this catalog' : 'Show looks in this catalog'}
                      style={{
                        width: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        background: 'transparent', border: '1px solid #e5e7eb', borderRadius: 4,
                        color: '#6b7280', cursor: 'pointer', padding: 0,
                        transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                        transition: 'transform 0.12s ease',
                      }}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                    <Link
                      to={`/admin/catalogs/${c.name.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-')}`}
                      style={{ color: '#111', textDecoration: 'none' }}
                      title="Open detail page — view attached looks + product palette, run auto-assign"
                    >
                      {c.name}
                    </Link>
                  </div>
                </td>
                <td>
                  <span style={{
                    padding: '2px 8px',
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    background: c.source === 'custom' ? '#ecfdf5' : '#f1f5f9',
                    color: c.source === 'custom' ? '#047857' : '#475569',
                  }}>
                    {c.source}
                  </span>
                </td>
                <td>
                  {productCount > 0 ? (
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 700,
                      background: '#eff6ff',
                      color: '#1d4ed8',
                    }}>
                      {productCount}
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, color: '#ccc' }}>—</span>
                  )}
                </td>
                <td style={{ fontSize: 12, color: '#888' }}>
                  {c.createdAt === '—' ? '—' : new Date(c.createdAt).toLocaleDateString()}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                    <button
                      className="admin-btn admin-btn-secondary"
                      style={{ fontSize: 11, padding: '4px 10px' }}
                      onClick={() => openAdd(c)}
                      disabled={products.length === 0}
                      title="Pick existing products from the library and tag them to this catalog"
                    >
                      + Add Products
                    </button>
                    <button
                      className="admin-btn admin-btn-primary"
                      style={{ fontSize: 11, padding: '4px 10px' }}
                      onClick={() => openSuggest(c)}
                    >
                      Suggest Products
                    </button>
                    <button
                      className="admin-btn admin-btn-secondary"
                      style={{ fontSize: 11, padding: '4px 10px' }}
                      onClick={() => openAssemble(c)}
                      disabled={productCount < 3}
                      title={productCount < 3 ? 'Tag at least 3 products with this catalog first' : 'Claude assembles a look from tagged products'}
                    >
                      ✨ Assemble Look
                    </button>
                    {c.source === 'custom' && (
                      <button
                        className="admin-btn admin-btn-secondary"
                        style={{ fontSize: 11, padding: '3px 8px', color: '#dc2626' }}
                        onClick={() => removeCustom(c.id)}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </td>
              </tr>
              {isOpen && (
                <tr>
                  <td colSpan={5} style={{ padding: 0, background: '#fafafa', borderTop: 'none' }}>
                    <CatalogCreativeDropdown
                      isAll={isAllCatalog(c.name)}
                      loading={isLoadingCreative}
                      creative={creative}
                      onReorder={(section, from, to) => reorderAllSection(c.id, section, from, to)}
                    />
                  </td>
                </tr>
              )}
              </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <div className="admin-modal-overlay" onClick={() => setShowAdd(false)}>
          <div
            className="admin-modal"
            style={{ width: 440, maxWidth: '90vw', padding: 24 }}
            onClick={e => e.stopPropagation()}
          >
            <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>Add new catalog</h2>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: '#888' }}>
              This will appear in the scrolling catalog suggestor on the main page.
            </p>
            <input
              type="text"
              autoFocus
              placeholder='e.g. "beach day", "quiet luxury"'
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addCatalog(); }}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 6,
                border: '1px solid #ddd',
                fontSize: 13,
                marginBottom: 16,
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="admin-btn admin-btn-secondary" onClick={() => setShowAdd(false)}>
                Cancel
              </button>
              <button
                className="admin-btn admin-btn-primary"
                onClick={addCatalog}
                disabled={!newName.trim()}
              >
                Add catalog
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Products modal — pick from existing library */}
      {addProductsCatalog && (
        <AddProductsModal
          catalog={addProductsCatalog}
          products={products}
          search={addSearch}
          onSearch={setAddSearch}
          selected={addSelected}
          onToggle={toggleAddSelected}
          busy={addBusy}
          onClose={closeAdd}
          onCommit={commitAdd}
        />
      )}

      {/* Suggest Products modal */}
      {suggestCatalog && (
        <div className="admin-modal-overlay" onClick={closeSuggest}>
          {previewImg && (
            <div
              style={{
                position: 'fixed',
                left: Math.min(previewImg.x, (typeof window !== 'undefined' ? window.innerWidth : 1600) - 280),
                top: Math.max(10, previewImg.y),
                width: 260,
                height: 340,
                borderRadius: 10,
                overflow: 'hidden',
                background: '#111',
                boxShadow: '0 20px 60px rgba(0,0,0,0.55)',
                zIndex: 10000,
                pointerEvents: 'none',
              }}
            >
              <img
                src={previewImg.url}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            </div>
          )}
          <div
            className="admin-modal"
            style={{ width: 720, maxWidth: '92vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ padding: '20px 24px 12px' }}>
              <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>
                Suggest Products for "{suggestCatalog.name}"
              </h2>
              <p style={{ margin: '0 0 14px', fontSize: 13, color: '#888' }}>
                Claude brainstorms specific product ideas for this vibe, then searches Google Shopping for each.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  autoFocus
                  placeholder='e.g. "brunch outfit", "quiet luxury", "make me hot"'
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
                  {brainstormPhase === 'brainstorming'
                    ? 'Brainstorming…'
                    : brainstormPhase === 'searching' && brainstormProgress
                      ? `Searching ${brainstormProgress.done}/${brainstormProgress.total}…`
                      : researchLoading
                        ? 'Searching…'
                        : 'Suggest'}
                </button>
              </div>
              {brainstormQueries.length > 0 && (
                <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <span style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', alignSelf: 'center' }}>Claude searched:</span>
                  {brainstormQueries.map((q, i) => (
                    <span key={i} style={{
                      padding: '3px 10px',
                      borderRadius: 999,
                      background: '#f1f5f9',
                      border: '1px solid #e2e8f0',
                      fontSize: 11,
                      color: '#475569',
                      fontWeight: 500,
                    }}>
                      {q}
                    </span>
                  ))}
                </div>
              )}
              {researchError && (
                <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12 }}>
                  <strong>Search failed:</strong> {researchError}
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
              {researchLoading && researchResults.length === 0 ? (
                <div style={{ padding: '40px 0', textAlign: 'center', color: '#999', fontSize: 13 }}>
                  {brainstormPhase === 'brainstorming'
                    ? 'Asking Claude for product ideas…'
                    : brainstormPhase === 'searching' && brainstormProgress
                      ? `Searching Google Shopping for each query (${brainstormProgress.done}/${brainstormProgress.total})…`
                      : 'Searching…'}
                </div>
              ) : researchResults.length === 0 ? (
                <div style={{ padding: '40px 0', textAlign: 'center', color: '#999', fontSize: 13 }}>
                  Press Suggest to have Claude brainstorm products for this catalog.
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
                        onMouseEnter={e => {
                          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          setPreviewImg({ url: p.image_url, x: r.right + 12, y: r.top });
                        }}
                        onMouseMove={e => {
                          setPreviewImg(prev => prev ? { ...prev, x: e.clientX + 16, y: e.clientY - 80 } : prev);
                        }}
                        onMouseLeave={() => setPreviewImg(null)}
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
                        <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
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
                          {p.sourceQuery && (
                            <div style={{ fontSize: 10, color: '#64748b', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                              </svg>
                              <span>{p.sourceQuery}</span>
                            </div>
                          )}
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
                <button className="admin-btn admin-btn-secondary" onClick={closeSuggest} disabled={ingesting}>
                  Cancel
                </button>
                <button
                  className="admin-btn admin-btn-primary"
                  onClick={ingestSelectedProducts}
                  disabled={ingesting || researchSelected.size === 0}
                >
                  {ingesting ? 'Adding…' : `Add ${researchSelected.size || ''} to Products`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Assemble Look modal */}
      {assembleCatalog && (
        <div className="admin-modal-overlay" onClick={() => !assembling && !savingLook && setAssembleCatalog(null)}>
          <div
            className="admin-modal"
            style={{ width: 640, maxWidth: '92vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ padding: '20px 24px 14px', borderBottom: '1px solid #f0f0f0' }}>
              <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>
                ✨ Assemble Look for "{assembleCatalog.name}"
              </h2>
              <p style={{ margin: 0, fontSize: 13, color: '#888' }}>
                Claude picks 5 products tagged with this catalog and writes a look concept ready for video generation.
              </p>
            </div>

            <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
              {!assembleResult && !assembling && !assembleError && (
                <div style={{ textAlign: 'center', padding: '40px 0' }}>
                  <button
                    className="admin-btn admin-btn-primary"
                    onClick={runAssemble}
                  >
                    Let Claude assemble this look
                  </button>
                  <div style={{ marginTop: 10, fontSize: 12, color: '#888' }}>
                    {products.filter(p => (p.catalog_tags || []).includes(assembleCatalog.name)).length} products tagged
                  </div>
                </div>
              )}

              {assembling && (
                <div style={{ textAlign: 'center', padding: '40px 0', color: '#888', fontSize: 13 }}>
                  Assembling… Claude is curating the outfit and writing a video concept.
                </div>
              )}

              {assembleError && (
                <div style={{ padding: '10px 14px', borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12 }}>
                  {assembleError}
                </div>
              )}

              {assembleResult && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Title</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#111' }}>{assembleResult.title}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Description</div>
                    <div style={{ fontSize: 14, color: '#333' }}>{assembleResult.description}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Style</div>
                    <span style={{ padding: '3px 10px', borderRadius: 999, background: '#eff6ff', color: '#1d4ed8', fontSize: 12, fontWeight: 600 }}>
                      {assembleResult.style}
                    </span>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Products ({assembleResult.productIds.length})</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8 }}>
                      {assembleResult.productIds.map(id => {
                        const p = products.find(x => x.id === id);
                        if (!p) return null;
                        return (
                          <div key={id} style={{ border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden', background: '#fff' }}>
                            {p.image_url && (
                              <img src={p.image_url} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }} />
                            )}
                            <div style={{ padding: 6 }}>
                              <div style={{ fontSize: 10, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.brand}</div>
                              <div style={{ fontSize: 11, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Video Prompt</div>
                    <div style={{ fontSize: 12, color: '#444', padding: 10, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                      {assembleResult.prompt}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div style={{ padding: '14px 24px', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 8 }}>
                {assembleResult && (
                  <button
                    className="admin-btn admin-btn-secondary"
                    style={{ fontSize: 12 }}
                    onClick={runAssemble}
                    disabled={assembling || savingLook}
                  >
                    Try another
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="admin-btn admin-btn-secondary"
                  onClick={() => setAssembleCatalog(null)}
                  disabled={assembling || savingLook}
                >
                  Cancel
                </button>
                {assembleResult && (
                  <button
                    className="admin-btn admin-btn-primary"
                    onClick={saveAssembledLook}
                    disabled={savingLook}
                  >
                    {savingLook ? 'Saving…' : 'Save as look'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: '#111', color: '#fff', padding: '10px 20px', borderRadius: 8,
          fontSize: 13, fontWeight: 500, zIndex: 9999, boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}

interface CatalogCreativeDropdownProps {
  isAll: boolean;
  loading: boolean;
  creative: CatalogCreativePayload | undefined;
  onReorder: (section: CatalogSection, fromIndex: number, toIndex: number) => void;
}

function CatalogCreativeDropdown({ isAll, loading, creative, onReorder }: CatalogCreativeDropdownProps) {
  if (loading && !creative) {
    return (
      <div style={{ padding: '16px 24px', color: '#888', fontSize: 12 }}>Loading creative…</div>
    );
  }
  if (!creative) return null;

  const { looks, products, creatives } = creative;
  const hasAny = looks.length > 0 || products.length > 0 || creatives.length > 0;
  if (!hasAny) {
    return (
      <div style={{ padding: '16px 24px', color: '#888', fontSize: 12 }}>
        No looks, products, or creative {isAll ? 'are currently active.' : 'tagged with this catalog yet.'}
      </div>
    );
  }

  return (
    <div style={{ padding: '14px 24px 18px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {isAll && (
        <div style={{ fontSize: 11, color: '#475569', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 10px' }}>
          The <strong>all</strong> catalog pulls every live look, rendered creative, and product — no duplicates, every entry shown in its entirety. Drag any tile to reorder.
        </div>
      )}

      <DraggableSection
        title="Looks"
        count={looks.length}
        emptyMessage="No looks in this catalog."
        minColumnPx={140}
        draggable={isAll}
        onReorder={(from, to) => onReorder('looks', from, to)}
      >
        {looks.map(l => (
          <LookThumb key={l.id} look={l} />
        ))}
      </DraggableSection>

      <DraggableSection
        title="Creative Videos"
        count={creatives.length}
        emptyMessage="No rendered product ads in this catalog yet."
        minColumnPx={140}
        draggable={isAll}
        onReorder={(from, to) => onReorder('creatives', from, to)}
      >
        {creatives.map(c => (
          <CreativeThumb key={c.id} creative={c} />
        ))}
      </DraggableSection>

      <DraggableSection
        title="Products"
        count={products.length}
        emptyMessage="No products in this catalog."
        minColumnPx={110}
        draggable={isAll}
        onReorder={(from, to) => onReorder('products', from, to)}
      >
        {products.map(p => (
          <div key={p.id} style={{ border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden', background: '#fff' }}>
            {p.image_url ? (
              <img src={p.image_url} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block', background: '#f5f5f5' }} />
            ) : (
              <div style={{ width: '100%', aspectRatio: '1', background: '#f5f5f5' }} />
            )}
            <div style={{ padding: 6 }}>
              <div style={{ fontSize: 10, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.brand || '—'}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name || '—'}</div>
            </div>
          </div>
        ))}
      </DraggableSection>
    </div>
  );
}

interface DraggableSectionProps {
  title: string;
  count: number;
  emptyMessage: string;
  minColumnPx: number;
  draggable: boolean;
  onReorder: (fromIndex: number, toIndex: number) => void;
  children: React.ReactNode;
}

function DraggableSection({ title, count, emptyMessage, minColumnPx, draggable, onReorder, children }: DraggableSectionProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const items = React.Children.toArray(children);

  const handleDragStart = (idx: number) => (e: React.DragEvent) => {
    if (!draggable) return;
    setDragIndex(idx);
    e.dataTransfer.effectAllowed = 'move';
    // Required for Firefox to initiate a drag.
    e.dataTransfer.setData('text/plain', String(idx));
  };
  const handleDragOver = (idx: number) => (e: React.DragEvent) => {
    if (!draggable || dragIndex === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (overIndex !== idx) setOverIndex(idx);
  };
  const handleDrop = (idx: number) => (e: React.DragEvent) => {
    if (!draggable || dragIndex === null) return;
    e.preventDefault();
    if (dragIndex !== idx) onReorder(dragIndex, idx);
    setDragIndex(null);
    setOverIndex(null);
  };
  const handleDragEnd = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#111', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          {title}
        </h3>
        <span style={{ fontSize: 11, color: '#888' }}>{count}</span>
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 12, color: '#888' }}>{emptyMessage}</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${minColumnPx}px, 1fr))`, gap: 8 }}>
          {items.map((child, idx) => (
            <div
              key={idx}
              draggable={draggable}
              onDragStart={handleDragStart(idx)}
              onDragOver={handleDragOver(idx)}
              onDrop={handleDrop(idx)}
              onDragEnd={handleDragEnd}
              style={{
                cursor: draggable ? (dragIndex === idx ? 'grabbing' : 'grab') : 'default',
                opacity: dragIndex === idx ? 0.4 : 1,
                outline: draggable && overIndex === idx && dragIndex !== idx ? '2px solid #2563eb' : 'none',
                outlineOffset: -2,
                borderRadius: 6,
                transition: 'opacity 120ms ease',
              }}
            >
              {child}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LookThumb({ look }: { look: CatalogLookRow }) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const src = look.videoPath
    ? (look.videoPath.startsWith('http') ? look.videoPath : `${import.meta.env.BASE_URL}${look.videoPath.replace(/^\//, '')}`)
    : null;

  return (
    <div
      style={{ border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden', background: '#111' }}
      onMouseEnter={() => { videoRef.current?.play().catch(() => {}); }}
      onMouseLeave={() => { if (videoRef.current) { videoRef.current.pause(); videoRef.current.currentTime = 0; } }}
    >
      <div style={{ width: '100%', aspectRatio: '9/16', background: '#000', position: 'relative' }}>
        {src ? (
          <video
            ref={videoRef}
            src={src}
            muted
            loop
            playsInline
            preload="metadata"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888', fontSize: 11 }}>
            No video
          </div>
        )}
      </div>
      <div style={{ padding: 6, background: '#fff' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {look.title || `Look #${look.legacyId ?? ''}`}
        </div>
        <div style={{ fontSize: 10, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {look.creatorHandle ? `@${look.creatorHandle}` : '—'} · {look.productCount} product{look.productCount === 1 ? '' : 's'}
        </div>
      </div>
    </div>
  );
}

function CreativeThumb({ creative }: { creative: CatalogCreativeVideo }) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const label = creative.productName || creative.title || 'Creative';
  return (
    <div
      style={{ border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden', background: '#111' }}
      onMouseEnter={() => { videoRef.current?.play().catch(() => {}); }}
      onMouseLeave={() => { if (videoRef.current) { videoRef.current.pause(); videoRef.current.currentTime = 0; } }}
    >
      <div style={{ width: '100%', aspectRatio: '9/16', background: '#000', position: 'relative' }}>
        <video
          ref={videoRef}
          src={creative.videoUrl}
          poster={creative.thumbnailUrl ?? undefined}
          muted
          loop
          playsInline
          preload="metadata"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
        <span style={{
          position: 'absolute', top: 6, right: 6,
          padding: '2px 6px', borderRadius: 3,
          fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
          background: creative.status === 'live' ? '#10b981' : 'rgba(17,24,39,0.75)',
          color: '#fff',
        }}>
          {creative.status}
        </span>
      </div>
      <div style={{ padding: 6, background: '#fff' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </div>
        <div style={{ fontSize: 10, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {creative.productBrand || '—'}
        </div>
      </div>
    </div>
  );
}

interface AddProductsModalProps {
  catalog: Catalog;
  products: ProductRow[];
  search: string;
  onSearch: (value: string) => void;
  selected: Set<string>;
  onToggle: (id: string) => void;
  busy: boolean;
  onClose: () => void;
  onCommit: () => void;
}

function AddProductsModal({
  catalog,
  products,
  search,
  onSearch,
  selected,
  onToggle,
  busy,
  onClose,
  onCommit,
}: AddProductsModalProps) {
  const tagged = useMemo(
    () => new Set(products.filter(p => (p.catalog_tags || []).includes(catalog.name)).map(p => p.id)),
    [products, catalog.name],
  );
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(p =>
      (p.name || '').toLowerCase().includes(q) || (p.brand || '').toLowerCase().includes(q),
    );
  }, [products, search]);

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ width: 'min(1040px, 96vw)', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16 }}>Add Products to “{catalog.name}”</h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#666' }}>
              {tagged.size} already in this catalog · {products.length} in library
            </p>
          </div>
          <input
            type="text"
            placeholder="Search by name or brand"
            value={search}
            onChange={e => onSearch(e.target.value)}
            autoFocus
            style={{ flex: '0 1 280px', padding: '6px 10px', fontSize: 13, border: '1px solid #ddd', borderRadius: 6 }}
          />
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#888', padding: 48, fontSize: 13 }}>
              No products match “{search}”.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
              {filtered.map(p => {
                const isTagged = tagged.has(p.id);
                const isSelected = selected.has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => !isTagged && onToggle(p.id)}
                    disabled={isTagged}
                    style={{
                      textAlign: 'left',
                      padding: 0,
                      border: `2px solid ${isSelected ? '#2563eb' : isTagged ? '#d1fae5' : '#e5e7eb'}`,
                      borderRadius: 8,
                      overflow: 'hidden',
                      background: '#fff',
                      cursor: isTagged ? 'default' : 'pointer',
                      opacity: isTagged ? 0.55 : 1,
                      position: 'relative',
                    }}
                  >
                    {p.image_url ? (
                      <img src={p.image_url} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block', background: '#f5f5f5' }} />
                    ) : (
                      <div style={{ width: '100%', aspectRatio: '1', background: '#f5f5f5' }} />
                    )}
                    <div style={{ padding: 8 }}>
                      <div style={{ fontSize: 10, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.brand || '—'}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name || '—'}</div>
                    </div>
                    {isTagged && (
                      <span style={{
                        position: 'absolute', top: 6, right: 6,
                        padding: '2px 6px', borderRadius: 4,
                        fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
                        background: '#10b981', color: '#fff',
                      }}>Added</span>
                    )}
                    {isSelected && !isTagged && (
                      <span style={{
                        position: 'absolute', top: 6, right: 6,
                        padding: '2px 6px', borderRadius: 4,
                        fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
                        background: '#2563eb', color: '#fff',
                      }}>Selected</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: '#666' }}>
            {selected.size} selected
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="admin-btn admin-btn-secondary"
              onClick={onClose}
              disabled={busy}
              style={{ fontSize: 12, padding: '6px 14px' }}
            >
              Cancel
            </button>
            <button
              className="admin-btn admin-btn-primary"
              onClick={onCommit}
              disabled={busy || selected.size === 0}
              style={{ fontSize: 12, padding: '6px 14px' }}
            >
              {busy ? 'Adding…' : `Add ${selected.size} product${selected.size === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

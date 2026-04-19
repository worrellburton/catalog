import { useState, Fragment, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from '@remix-run/react';
import { looks, creators } from '~/data/looks';
import { useSortableTable, SortableTh } from '~/components/SortableTable';
import { supabase } from '~/utils/supabase';
import { createBatchAds } from '~/services/product-ads';

interface CrawledProduct {
  id: string;
  name: string | null;
  brand: string | null;
  price: string | null;
  url: string | null;
  image_url: string | null;
  scraped_at: string | null;
  scrape_status: string;
  is_crawled: boolean;
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
  const [lookOrder, setLookOrder] = useState<number[] | null>(null);
  const [dragLookId, setDragLookId] = useState<number | null>(null);

  const deleteLook = useCallback((id: number) => {
    if (!window.confirm('Delete this look? This cannot be undone.')) return;
    setDeletedLookIds(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
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

  useEffect(() => {
    const loadCrawled = async () => {
      if (!supabase) return;
      const { data, error } = await supabase
        .from('products')
        .select('id, name, brand, price, url, image_url, scraped_at, scrape_status')
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
    const loadAdProductIds = async () => {
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
    };
    loadCrawled();
    loadAdProductIds();
  }, []);

  const allProducts = useMemo(() => {
    const allVideos: string[] = [];
    adVideoMap.forEach(vids => vids.forEach(v => allVideos.push(v)));
    const pickVideos = (count: number, startIdx: number): string[] => {
      if (allVideos.length === 0) return [];
      return Array.from({ length: count }, (_, i) => allVideos[(startIdx + i) % allVideos.length]);
    };
    let filler = 0;
    const productMap = new Map<string, { id?: string; brand: string; name: string; price: string; url: string; image_url?: string | null; video_urls: string[]; looks: Set<string>; creators: Set<string>; saves: number; clicks: number; impressions: number; connection: 'Look' | 'Crawl' | 'Ad' }>();
    looks.forEach(look => {
      const c = creators[look.creator];
      look.products.forEach(p => {
        const key = `${p.brand}-${p.name}`;
        if (!productMap.has(key)) {
          productMap.set(key, { brand: p.brand, name: p.name, price: p.price, url: p.url, image_url: (p as any).image, video_urls: [], looks: new Set(), creators: new Set(), saves: Math.floor(Math.random() * 20), clicks: Math.floor(Math.random() * 150) + 10, impressions: 0, connection: 'Look' });
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
      if (productMap.has(key)) {
        const entry = productMap.get(key)!;
        entry.id = cp.id;
        entry.image_url = cp.image_url;
        entry.video_urls = adVideoMap.get(cp.id) || [];
        entry.impressions = adImpressionsMap.get(cp.id) || 0;
        entry.clicks = adClicksMap.get(cp.id) || entry.clicks;
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
      const ownVideos = p.video_urls;
      const hasCreative = ownVideos.length > 0;
      const videos = hasCreative
        ? ownVideos
        : pickVideos(3, (filler++ * 3));
      return {
        ...p,
        video_urls: videos,
        hasCreative,
        lookCount: p.looks.size,
        creatorCount: p.creators.size,
      };
    });
  }, [crawledProducts, adProductIds, adVideoMap, adImpressionsMap, adClicksMap]);

  const lookTable = useSortableTable(lookRows);

  const toggleExpand = (id: number) => {
    setExpandedId(prev => prev === id ? null : id);
  };

  const navigate = useNavigate();

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }, []);

  const handleGenerateCreative = useCallback(async (productId: string, productName: string, style: string) => {
    if (generatingIds.has(productId)) return;
    setGeneratingIds(prev => new Set(prev).add(productId));
    showToast(`Agent started generating creative for "${productName}"`);
    const { error } = await createBatchAds([productId], style, 2);
    setGeneratingIds(prev => {
      const next = new Set(prev);
      next.delete(productId);
      return next;
    });
    if (error) {
      showToast(`Agent failed: ${error}`);
    } else {
      showToast(`Agent queued. View progress in Agents →`);
    }
  }, [generatingIds, showToast]);

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
                <th style={{ textAlign: 'left' }}>Product</th>
                <th>Price</th>
                <th>Connection</th>
                <th>In Looks</th>
                <th>Creators</th>
                <th>Impressions</th>
                <th>Saves</th>
                <th>Clicks</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {allProducts
                .filter(p => productFilter === 'all' || !p.hasCreative)
                .map((p, i) => (
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
                    <div className="admin-product-creative">
                      {p.image_url ? (
                        <img
                          src={p.image_url}
                          alt={p.name}
                          style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover' }}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      ) : (
                        <img
                          src={getBrandLogo(p.brand) || ''}
                          alt={p.brand}
                          className="admin-brand-logo"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      )}
                    </div>
                  </td>
                  <td style={{ textAlign: 'left' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 12 }}>{p.name}</div>
                      <div style={{ fontSize: 10, color: '#999' }}>{p.brand}</div>
                    </div>
                  </td>
                  <td style={{ fontWeight: 600 }}>{p.price}</td>
                  <td>
                    <span className={`admin-connection-pill admin-connection-${p.connection.toLowerCase()}`}>
                      {p.connection}
                    </span>
                  </td>
                  <td>{p.lookCount}</td>
                  <td>{p.creatorCount}</td>
                  <td>{p.impressions > 0 ? p.impressions.toLocaleString() : '—'}</td>
                  <td>{p.saves}</td>
                  <td>{p.clicks}</td>
                  <td><span className="admin-status admin-status-online">active</span></td>
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
                    handleGenerateCreative(picker.productId, picker.productName, s.value);
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

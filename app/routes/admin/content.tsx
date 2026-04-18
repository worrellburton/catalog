import { useState, Fragment, useMemo, useCallback, useEffect } from 'react';
import { looks, creators } from '~/data/looks';
import { useSortableTable, SortableTh } from '~/components/SortableTable';
import { supabase } from '~/utils/supabase';

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
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

  // Toggle states per look: { [lookId]: { platform, featured, splash } }
  const [toggles, setToggles] = useState<Record<number, { platform: boolean; featured: boolean; splash: boolean }>>({});

  const getToggles = useCallback((id: number) => toggles[id] || { platform: true, featured: true, splash: true }, [toggles]);

  const setToggle = useCallback((id: number, field: 'platform' | 'featured' | 'splash', value: boolean) => {
    setToggles(prev => ({
      ...prev,
      [id]: { ...prev[id] || { platform: true, featured: true, splash: true }, [field]: value },
    }));
  }, []);

  const lookRows: LookRow[] = useMemo(() =>
    looks.map(look => {
      const c = creators[look.creator];
      return {
        id: look.id,
        creator: look.creator,
        creatorDisplay: c?.displayName || look.creator,
        creatorAvatar: c?.avatar || '',
        video: look.video,
        products: look.products.length,
      };
    }),
  []);

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
        .select('product_id, video_url, status');
      if (data) {
        setAdProductIds(new Set(data.map(r => r.product_id)));
        const videoMap = new Map<string, string[]>();
        data.forEach(r => {
          if (r.video_url) {
            const existing = videoMap.get(r.product_id) || [];
            existing.push(r.video_url);
            videoMap.set(r.product_id, existing);
          }
        });
        setAdVideoMap(videoMap);
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
    const productMap = new Map<string, { id?: string; brand: string; name: string; price: string; url: string; image_url?: string | null; video_urls: string[]; looks: Set<string>; creators: Set<string>; saves: number; clicks: number; connection: 'Look' | 'Crawl' | 'Ad' }>();
    looks.forEach(look => {
      const c = creators[look.creator];
      look.products.forEach(p => {
        const key = `${p.brand}-${p.name}`;
        if (!productMap.has(key)) {
          productMap.set(key, { brand: p.brand, name: p.name, price: p.price, url: p.url, image_url: (p as any).image, video_urls: [], looks: new Set(), creators: new Set(), saves: Math.floor(Math.random() * 20), clicks: Math.floor(Math.random() * 150) + 10, connection: 'Look' });
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
          clicks: 0,
          connection,
        });
      }
    });

    return Array.from(productMap.values()).map(p => {
      const ownVideos = p.video_urls;
      const videos = ownVideos.length > 0
        ? ownVideos
        : pickVideos(3, (filler++ * 3));
      return {
        ...p,
        video_urls: videos,
        lookCount: p.looks.size,
        creatorCount: p.creators.size,
      };
    });
  }, [crawledProducts, adProductIds, adVideoMap]);

  const lookTable = useSortableTable(lookRows);

  const toggleExpand = (id: number) => {
    setExpandedId(prev => prev === id ? null : id);
  };

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Content</h1>
        <p className="admin-page-subtitle">Manage all platform content</p>
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
                <th>Creative</th>
                <SortableTh label="Creator" sortKey="creatorDisplay" currentSort={lookTable.sort} onSort={lookTable.handleSort} />
                <th>Created At</th>
                <th>Platform</th>
                <th>Featured</th>
                <th>Weight</th>
                <th>Splash</th>
                <th>Products</th>
              </tr>
            </thead>
            <tbody>
              {lookTable.sortedData.map(row => {
                const look = looks.find(l => l.id === row.id)!;
                const isExpanded = expandedId === row.id;
                return (
                  <Fragment key={row.id}>
                    <tr className="admin-look-main-row" onClick={() => toggleExpand(row.id)} style={{ cursor: 'pointer' }}>
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
                    </tr>
                    <tr className={`admin-look-expanded-row ${isExpanded ? 'open' : ''}`}>
                      <td colSpan={8} style={{ padding: 0 }}>
                        <div className="admin-expand-animate">
                          <div className="admin-look-products">
                            <h3 className="admin-products-title">Products</h3>
                            <table className="admin-table admin-products-table">
                              <thead>
                                <tr>
                                  <th>#</th>
                                  <th>Brand</th>
                                  <th>Name</th>
                                  <th>Price</th>
                                  <th>Links</th>
                                  <th>Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {look.products.map((product, pi) => (
                                  <tr key={pi}>
                                    <td className="admin-cell-muted">{pi + 1}</td>
                                    <td className="admin-cell-name">{product.brand}</td>
                                    <td>{product.name}</td>
                                    <td style={{ fontWeight: 600 }}>{product.price}</td>
                                    <td>
                                      <a href={product.url} target="_blank" rel="noopener noreferrer" className="admin-link-icon">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                                      </a>
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
                                ))}
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
                <th>Saves</th>
                <th>Clicks</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {allProducts.map((p, i) => (
                <tr key={`${p.brand}-${p.name}-${i}`}>
                  <td>
                    {p.video_urls.length > 0 ? (
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
                  <td>{p.saves}</td>
                  <td>{p.clicks}</td>
                  <td><span className="admin-status admin-status-online">active</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'musics' && (
        <div className="admin-empty">No music data yet</div>
      )}

      {activeTab === 'places' && (
        <div className="admin-empty">No places data yet</div>
      )}
    </div>
  );
}

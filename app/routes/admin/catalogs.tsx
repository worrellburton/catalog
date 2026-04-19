import { useState, useEffect, useCallback, useMemo } from 'react';
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

  // Suggest Products modal state
  const [suggestCatalog, setSuggestCatalog] = useState<Catalog | null>(null);
  const [researchQuery, setResearchQuery] = useState('');
  const [researchGender, setResearchGender] = useState<ProductGender | 'all'>('all');
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchResults, setResearchResults] = useState<BrainstormedProduct[]>([]);
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

    const { queries, products, error } = await brainstormCatalogProducts(researchQuery, {
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
    setResearchSource('live');
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
              return (
              <tr key={c.id}>
                <td style={{ textAlign: 'left', fontWeight: 600 }}>{c.name}</td>
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
                      className="admin-btn admin-btn-primary"
                      style={{ fontSize: 11, padding: '4px 10px' }}
                      onClick={() => openSuggest(c)}
                    >
                      Suggest Products
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

      {/* Suggest Products modal */}
      {suggestCatalog && (
        <div className="admin-modal-overlay" onClick={closeSuggest}>
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

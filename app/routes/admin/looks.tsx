import { useState, Fragment, useMemo, useEffect } from 'react';
import { useSearchParams } from '@remix-run/react';
import { looks, creators } from '~/data/looks';
import { useSortableTable, SortableTh } from '~/components/SortableTable';
import { supabase } from '~/utils/supabase';
import { createLook, addProductToLook } from '~/services/manage-looks';

interface LookRow {
  id: number;
  creator: string;
  creatorDisplay: string;
  creatorAvatar: string;
  video: string;
  products: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PublishDraft {
  generationId: string;
  videoUrl: string | null;
  style: string;
  creatorName: string;
  products: Array<{ id: string; name: string; brand: string; price: string | null; image_url: string | null; role_tag: string | null }>;
}

export default function AdminLooks() {
  const [activeTab, setActiveTab] = useState<'active' | 'incoming'>('active');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  const [searchParams, setSearchParams] = useSearchParams();

  // Publish flow state. The Publish buttons in admin/content.tsx
  // navigate here with ?publish=<id>. If the id is a UUID we treat
  // it as a user_generations row and load a confirm dialog; if it's
  // a numeric look id we just expand that row to show what's already
  // published.
  const [draft, setDraft] = useState<PublishDraft | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishMessage, setPublishMessage] = useState<string | null>(null);

  useEffect(() => {
    const publishParam = searchParams.get('publish');
    if (!publishParam) {
      setDraft(null);
      setDraftError(null);
      return;
    }
    if (!UUID_RE.test(publishParam)) {
      // Numeric / non-UUID - assume it's a static look id and expand
      // that row instead of opening the publish dialog.
      const numeric = Number(publishParam);
      if (!Number.isNaN(numeric)) setExpandedId(numeric);
      return;
    }
    if (!supabase) {
      setDraftError('Supabase not configured - can’t load the unpublished look.');
      return;
    }
    let cancelled = false;
    setDraftLoading(true);
    setDraftError(null);
    (async () => {
      const [{ data: gen, error: genErr }, { data: prodRows, error: prodErr }] = await Promise.all([
        supabase
          .from('user_generations')
          .select('id, style, video_url, status, user_id')
          .eq('id', publishParam)
          .maybeSingle(),
        supabase
          .from('user_generation_products')
          .select('product_id, role_tag, sort_order, products(id, name, brand, price, image_url)')
          .eq('generation_id', publishParam)
          .order('sort_order'),
      ]);
      if (cancelled) return;
      if (genErr || !gen) {
        setDraftError(genErr?.message || 'Generation not found.');
        setDraftLoading(false);
        return;
      }
      let creatorName = 'Unknown';
      if (gen.user_id) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('full_name, email')
          .eq('id', gen.user_id)
          .maybeSingle();
        creatorName = prof?.full_name || prof?.email || 'Unknown';
      }
      if (prodErr) {
        setDraftError(prodErr.message);
        setDraftLoading(false);
        return;
      }
      const products = ((prodRows || []) as unknown as Array<{
        product_id: string;
        role_tag: string | null;
        sort_order: number;
        products: { id: string; name: string | null; brand: string | null; price: string | null; image_url: string | null } | null;
      }>)
        .filter(r => !!r.products)
        .map(r => ({
          id: r.products!.id,
          name: r.products!.name || ' - ',
          brand: r.products!.brand || ' - ',
          price: r.products!.price,
          image_url: r.products!.image_url,
          role_tag: r.role_tag,
        }));
      setDraft({
        generationId: gen.id,
        videoUrl: gen.video_url,
        style: gen.style,
        creatorName,
        products,
      });
      setDraftLoading(false);
    })();
    return () => { cancelled = true; };
  }, [searchParams]);

  const closePublish = () => {
    setDraft(null);
    setDraftError(null);
    setPublishMessage(null);
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      p.delete('publish');
      return p;
    });
  };

  const confirmPublish = async () => {
    if (!draft) return;
    setPublishing(true);
    setPublishMessage(null);
    try {
      const { data: look } = await createLook({
        title: `${draft.creatorName}’s ${draft.style} look`,
        description: `Promoted from generation ${draft.generationId}`,
        gender: 'unisex',
      });
      // Best-effort attach products. Ignore individual product
      // failures so a single bad row doesn't fail the whole publish.
      await Promise.all(draft.products.map(p =>
        addProductToLook(look.id, { product_id: p.id }).catch(err => {
          console.warn('[publish] addProductToLook failed:', err);
        })
      ));
      setPublishMessage('Published to the catalog. Refresh once the look pipeline picks it up.');
    } catch (err) {
      setPublishMessage(err instanceof Error ? err.message : 'Publish failed.');
    } finally {
      setPublishing(false);
    }
  };

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

  const { sortedData, sort, handleSort } = useSortableTable(lookRows);

  const toggleExpand = (id: number) => {
    setExpandedId(prev => prev === id ? null : id);
  };

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Looks</h1>
        <p className="admin-page-subtitle">All look content on the platform</p>
      </div>
      <div className="admin-tabs">
        <button className={`admin-tab ${activeTab === 'active' ? 'active' : ''}`} onClick={() => setActiveTab('active')}>Active</button>
        <button className={`admin-tab ${activeTab === 'incoming' ? 'active' : ''}`} onClick={() => setActiveTab('incoming')}>
          Incoming
          <span className="admin-tab-badge">0</span>
        </button>
      </div>
      {activeTab === 'active' ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Thumbnail</th>
                <SortableTh label="Creator" sortKey="creatorDisplay" currentSort={sort} onSort={handleSort} />
                <th>Created At</th>
                <th>Platform</th>
                <th>Featured</th>
                <th>Weight</th>
                <th>Splash</th>
                <SortableTh label="Products" sortKey="products" currentSort={sort} onSort={handleSort} />
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedData.map(row => {
                const look = looks.find(l => l.id === row.id)!;
                const isExpanded = expandedId === row.id;
                return (
                  <Fragment key={row.id}>
                    <tr
                      className="admin-look-main-row"
                      onClick={() => toggleExpand(row.id)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>
                        <div className="admin-look-thumb">
                          <video
                            src={`${basePath}/${row.video}`}
                            muted
                            loop
                            playsInline
                            preload="metadata"
                          />
                        </div>
                      </td>
                      <td>
                        <div className="admin-look-creator">
                          <img
                            className="admin-look-creator-avatar"
                            src={row.creatorAvatar}
                            alt={row.creator}
                          />
                          <span>{row.creatorDisplay}</span>
                        </div>
                      </td>
                      <td className="admin-cell-muted">Feb 17, 2026, 12:16 PM</td>
                      <td><span className="admin-toggle on" /></td>
                      <td><span className="admin-toggle on" /></td>
                      <td><span className="admin-weight-input">5</span></td>
                      <td><span className="admin-toggle off" /></td>
                      <td>{row.products}</td>
                      <td>
                        <button className="admin-icon-btn" aria-label="Expand" onClick={(e) => { e.stopPropagation(); toggleExpand(row.id); }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
                            <polyline points="6 9 12 15 18 9"/>
                          </svg>
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="admin-look-expanded-row">
                        <td colSpan={9} style={{ padding: 0 }}>
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
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="admin-empty">No incoming looks yet</div>
      )}

      {(draft || draftLoading || draftError) && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
            zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
          onClick={closePublish}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 12, width: 520, maxWidth: '94vw',
              maxHeight: '92vh', overflow: 'auto', padding: 24,
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            }}
          >
            <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700 }}>Publish look</h2>
            <p style={{ margin: '0 0 18px', fontSize: 13, color: '#666' }}>
              Promote this user-generated look into the curated catalog.
            </p>
            {draftLoading && <div style={{ padding: 24, textAlign: 'center', color: '#888' }}>Loading…</div>}
            {draftError && <div style={{ padding: 16, background: '#fee2e2', color: '#991b1b', borderRadius: 8, fontSize: 13 }}>{draftError}</div>}
            {draft && (
              <>
                <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
                  <div style={{ width: 120, aspectRatio: '9 / 16', borderRadius: 8, overflow: 'hidden', background: '#000', flexShrink: 0 }}>
                    {draft.videoUrl ? (
                      <video src={draft.videoUrl} autoPlay muted loop playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888', fontSize: 11 }}>No video</div>
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{draft.creatorName}’s {draft.style} look</div>
                    <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>{draft.products.length} product{draft.products.length === 1 ? '' : 's'}</div>
                    <ul style={{ margin: '10px 0 0', padding: 0, listStyle: 'none', fontSize: 12, color: '#444' }}>
                      {draft.products.slice(0, 4).map(p => (
                        <li key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                          {p.image_url && <img src={p.image_url} alt="" style={{ width: 24, height: 24, borderRadius: 4, objectFit: 'cover' }} />}
                          <span style={{ fontWeight: 500 }}>{p.brand}</span>
                          <span style={{ color: '#888' }}> - </span>
                          <span>{p.name}</span>
                        </li>
                      ))}
                      {draft.products.length > 4 && <li style={{ color: '#888', padding: '4px 0' }}>+{draft.products.length - 4} more</li>}
                    </ul>
                  </div>
                </div>
                {publishMessage && (
                  <div style={{ padding: 12, background: publishMessage.toLowerCase().includes('fail') ? '#fee2e2' : '#dcfce7', color: publishMessage.toLowerCase().includes('fail') ? '#991b1b' : '#166534', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
                    {publishMessage}
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button className="admin-btn admin-btn-secondary" onClick={closePublish} disabled={publishing}>
                    Cancel
                  </button>
                  <button className="admin-btn admin-btn-primary" onClick={confirmPublish} disabled={publishing}>
                    {publishing ? 'Publishing…' : 'Publish to catalog'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

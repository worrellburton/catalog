import { useState, Fragment, useMemo } from 'react';
import { looks, creators } from '~/data/looks';
import { useSortableTable, SortableTh } from '~/components/SortableTable';

interface LookRow {
  id: number;
  creator: string;
  creatorDisplay: string;
  creatorAvatar: string;
  video: string;
  products: number;
}

export default function AdminLooks() {
  const [activeTab, setActiveTab] = useState<'active' | 'incoming'>('active');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

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
    </div>
  );
}

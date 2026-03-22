import { useState } from 'react';
import { looks, creators } from '~/data/looks';

export default function AdminLooks() {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

  const toggleExpand = (id: number) => {
    setExpandedId(prev => prev === id ? null : id);
  };

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Looks</h1>
        <p className="admin-page-subtitle">All look content on the platform</p>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Thumbnail</th>
              <th>Creator</th>
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
            {looks.map(look => {
              const creator = creators[look.creator];
              const isExpanded = expandedId === look.id;
              return (
                <tr key={look.id} className="admin-look-row-group">
                  <td colSpan={9} style={{ padding: 0 }}>
                    <div
                      className="admin-look-row"
                      onClick={() => toggleExpand(look.id)}
                    >
                      <div className="admin-look-cell" style={{ width: 80 }}>
                        <div className="admin-look-thumb">
                          <video
                            src={`${basePath}/${look.video}`}
                            muted
                            loop
                            playsInline
                            preload="metadata"
                          />
                        </div>
                      </div>
                      <div className="admin-look-cell" style={{ width: 160 }}>
                        <div className="admin-look-creator">
                          <img
                            className="admin-look-creator-avatar"
                            src={creator?.avatar || ''}
                            alt={look.creator}
                          />
                          <span>{creator?.displayName || look.creator}</span>
                        </div>
                      </div>
                      <div className="admin-look-cell admin-cell-muted" style={{ width: 140 }}>Feb 17, 2026, 12:16 PM</div>
                      <div className="admin-look-cell" style={{ width: 80 }}>
                        <span className="admin-toggle on" />
                      </div>
                      <div className="admin-look-cell" style={{ width: 80 }}>
                        <span className="admin-toggle on" />
                      </div>
                      <div className="admin-look-cell" style={{ width: 80 }}>
                        <span className="admin-weight-input">5</span>
                      </div>
                      <div className="admin-look-cell" style={{ width: 80 }}>
                        <span className="admin-toggle off" />
                      </div>
                      <div className="admin-look-cell" style={{ width: 60 }}>{look.products.length}</div>
                      <div className="admin-look-cell admin-look-actions">
                        <button className="admin-icon-btn" aria-label="Expand" onClick={(e) => { e.stopPropagation(); toggleExpand(look.id); }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
                            <polyline points="6 9 12 15 18 9"/>
                          </svg>
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
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
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

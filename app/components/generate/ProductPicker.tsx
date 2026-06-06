// Try-on product picker — the Generate flow's "Pick your products" step.
//
// A from-scratch rebuild of the inline picker that used to live in
// generate.tsx. Pure presentation: it receives the already-computed,
// per-category product data + the current filter/selection state and the
// handlers, and renders an elegant, mobile-first picker:
//
//   • one collapsible section per category (smooth grid-rows reveal),
//   • a per-section search field in the header,
//   • a horizontally-scrollable row of brand-filter chips,
//   • a horizontally-scrollable rail of 3:4 product cards with a select
//     checkmark, name, brand + price.
//
// The selected-products → Next dock lives in generate.tsx (shared across
// steps), so it's intentionally not part of this component.

import { memo } from 'react';

export interface PickerProduct {
  id: string;
  name: string | null;
  brand: string | null;
  price: string | null;
  image_url: string | null;
}

export interface PickerGroup {
  label: string;
}

interface ProductPickerProps {
  groups: PickerGroup[];
  loading: boolean;
  productsByCategory: Record<string, PickerProduct[]>;
  brandsByCategory: Record<string, string[]>;
  queries: Record<string, string>;
  brandFilters: Record<string, string | null>;
  expanded: Record<string, boolean | undefined>;
  pickedIds: Set<string>;
  /** Category that opens by default (e.g. the "All" bucket). */
  defaultExpanded?: string;
  onToggleExpand: (label: string) => void;
  onSearch: (label: string, value: string) => void;
  onBrand: (label: string, brand: string | null) => void;
  onTogglePick: (p: PickerProduct) => void;
}

function Chevron() {
  return (
    <svg className="gp-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function ProductPickerImpl({
  groups,
  loading,
  productsByCategory,
  brandsByCategory,
  queries,
  brandFilters,
  expanded,
  pickedIds,
  defaultExpanded = 'All',
  onToggleExpand,
  onSearch,
  onBrand,
  onTogglePick,
}: ProductPickerProps) {
  const anyProducts = Object.values(productsByCategory).some(a => a.length > 0);
  if (loading && !anyProducts) {
    return <div className="gp-loading">Loading products…</div>;
  }

  return (
    <div className="gp">
      {groups.map(group => {
        const label = group.label;
        const products = productsByCategory[label] || [];
        const query = queries[label] || '';
        const brands = brandsByCategory[label] || [];
        const activeBrand = brandFilters[label] || null;
        // Default-open category opens; everything else stays collapsed —
        // a typed query force-opens any section.
        const isOpen = (expanded[label] ?? label === defaultExpanded) || !!query;

        return (
          <section key={label} className={`gp-section${isOpen ? ' is-open' : ''}`}>
            <header className="gp-section-head">
              <button
                type="button"
                className="gp-section-toggle"
                onClick={() => onToggleExpand(label)}
                aria-expanded={isOpen}
              >
                <Chevron />
                <span className="gp-section-title">{label}</span>
                {products.length > 0 && <span className="gp-section-count">{products.length}</span>}
              </button>

              <div className="gp-search">
                <span className="gp-search-icon"><SearchIcon /></span>
                <input
                  type="search"
                  className="gp-search-input"
                  placeholder={`Search ${label.toLowerCase()}`}
                  value={query}
                  onChange={e => onSearch(label, e.target.value)}
                  aria-label={`Search ${label}`}
                />
                {query && (
                  <button
                    type="button"
                    className="gp-search-clear"
                    aria-label="Clear search"
                    onClick={() => onSearch(label, '')}
                  >×</button>
                )}
              </div>
            </header>

            {/* Collapsible body — grid-rows 0fr→1fr for a smooth, height-
                agnostic reveal that never clips the horizontal rails. */}
            <div className="gp-section-body" aria-hidden={!isOpen}>
              <div className="gp-section-body-inner">
                {brands.length > 0 && (
                  <div className="gp-brands" role="tablist" aria-label={`Filter ${label} by brand`}>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={!activeBrand}
                      className={`gp-brand${!activeBrand ? ' is-active' : ''}`}
                      onClick={() => onBrand(label, null)}
                    >All</button>
                    {brands.map(b => (
                      <button
                        key={b}
                        type="button"
                        role="tab"
                        aria-selected={activeBrand === b}
                        className={`gp-brand${activeBrand === b ? ' is-active' : ''}`}
                        onClick={() => onBrand(label, activeBrand === b ? null : b)}
                      >{b}</button>
                    ))}
                  </div>
                )}

                {/* Remount on filter change so the rail resets to the start. */}
                <div className="gp-rail" key={`${label}-${activeBrand || 'all'}-${query}`}>
                  {products.length === 0 ? (
                    <div className="gp-empty">
                      {query
                        ? `No ${label.toLowerCase()} match “${query}”`
                        : `No ${label.toLowerCase()} yet`}
                    </div>
                  ) : (
                    products.map(p => {
                      const picked = pickedIds.has(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          className={`gp-card${picked ? ' is-picked' : ''}`}
                          data-gen-card-id={p.id}
                          aria-pressed={picked}
                          onClick={() => onTogglePick(p)}
                        >
                          <div className="gp-card-media">
                            {p.image_url
                              ? <img src={p.image_url} alt="" loading="lazy" decoding="async" />
                              : <div className="gp-card-ph" aria-hidden="true" />}
                            <span className="gp-card-check" aria-hidden="true">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            </span>
                          </div>
                          <div className="gp-card-meta">
                            <span className="gp-card-name">{p.name || 'Product'}</span>
                            <span className="gp-card-sub">
                              {[p.brand, p.price].filter(Boolean).join(' · ')}
                            </span>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

export default memo(ProductPickerImpl);

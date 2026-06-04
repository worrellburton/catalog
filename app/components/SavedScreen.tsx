import { useCallback, useMemo, useRef, useState } from 'react';
import { creators, Look, Product } from '~/data/looks';
import { type ProductAd } from '~/services/product-creative';
import { useEscapeKey } from '~/hooks/useEscapeKey';
import { useSavedLayout, productKeyOf } from '~/services/saved-layout';
import LookCard from './LookCard';

interface BookmarksInterface {
  bookmarkedLooks: number[];
  bookmarkedProducts: Product[];
  followedCreators: string[];
  isLookBookmarked: (lookId: number) => boolean;
  toggleLookBookmark: (lookId: number) => void;
  isProductBookmarked: (p: Product) => boolean;
  toggleProductBookmark: (p: Product) => void;
  isCreatorFollowed: (handle: string) => boolean;
  toggleCreatorFollow: (handle: string) => void;
}

interface SavedScreenProps {
  bookmarks: BookmarksInterface;
  /** Live looks resolved from Supabase, used to render bookmarked look ids. */
  savedLooks: Look[];
  /** Page variant only — embedded variant (in profile / catalog) omits it. */
  onClose?: () => void;
  /** When true, render inline (no fixed overlay + back button). */
  embedded?: boolean;
  onOpenLook: (look: Look) => void;
  onOpenProduct?: (product: Product) => void;
  onOpenCreative?: (creative: ProductAd) => void;
  onOpenCreator?: (handle: string) => void;
  onOpenBrand?: (brandName: string) => void;
  onOpenBrowser: (url: string, title: string) => void;
}

/** Pull the leading number out of a price string ("$128.00" → 128). */
function parsePrice(raw: string | null | undefined): number {
  if (!raw) return 0;
  const m = raw.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
}

export default function SavedScreen({
  bookmarks,
  savedLooks,
  onClose,
  embedded = false,
  onOpenLook,
  onOpenProduct,
  onOpenCreative,
  onOpenCreator,
  onOpenBrand,
  onOpenBrowser,
}: SavedScreenProps) {
  useEscapeKey(onClose ?? (() => {}));

  const liveLookIds = useMemo(() => savedLooks.map(l => l.id), [savedLooks]);
  const liveProductKeys = useMemo(
    () => bookmarks.bookmarkedProducts.map(productKeyOf),
    [bookmarks.bookmarkedProducts],
  );
  const layout = useSavedLayout(liveLookIds, liveProductKeys);

  const [selected, setSelected] = useState<string>('all'); // 'all' | collectionId
  const [creatingName, setCreatingName] = useState<string | null>(null);
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const dragRef = useRef<{ kind: 'look' | 'product'; id: string } | null>(null);

  const looksById = useMemo(() => {
    const m = new Map<number, Look>();
    savedLooks.forEach(l => m.set(l.id, l));
    return m;
  }, [savedLooks]);
  const productsByKey = useMemo(() => {
    const m = new Map<string, Product>();
    bookmarks.bookmarkedProducts.forEach(p => m.set(productKeyOf(p), p));
    return m;
  }, [bookmarks.bookmarkedProducts]);

  const followedCreatorData = useMemo(
    () => bookmarks.followedCreators
      .map(handle => ({ handle, data: creators[handle] }))
      .filter(c => c.data),
    [bookmarks.followedCreators],
  );

  // ── Insights ────────────────────────────────────────────────────────
  const insights = useMemo(() => {
    const products = bookmarks.bookmarkedProducts;
    const brandTally = new Map<string, number>();
    let value = 0;
    products.forEach(p => {
      if (p.brand) brandTally.set(p.brand, (brandTally.get(p.brand) || 0) + 1);
      value += parsePrice(p.price);
    });
    savedLooks.forEach(l => l.products?.forEach(p => {
      if (p.brand) brandTally.set(p.brand, (brandTally.get(p.brand) || 0) + 1);
    }));
    const topBrand = [...brandTally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return {
      looks: savedLooks.length,
      products: products.length,
      creators: followedCreatorData.length,
      topBrand,
      value: Math.round(value),
    };
  }, [bookmarks.bookmarkedProducts, savedLooks, followedCreatorData.length]);

  // ── Filtered ids for the current collection ──────────────────────────
  const activeCollection = selected === 'all' ? null : layout.collections.find(c => c.id === selected) ?? null;
  const visibleLookIds = useMemo(() => {
    if (!activeCollection) return layout.orderedLookIds;
    const set = new Set(activeCollection.lookIds);
    return layout.orderedLookIds.filter(id => set.has(id));
  }, [activeCollection, layout.orderedLookIds]);
  const visibleProductKeys = useMemo(() => {
    if (!activeCollection) return layout.orderedProductKeys;
    const set = new Set(activeCollection.productKeys);
    return layout.orderedProductKeys.filter(k => set.has(k));
  }, [activeCollection, layout.orderedProductKeys]);

  const isEmpty = savedLooks.length === 0 && bookmarks.bookmarkedProducts.length === 0 && followedCreatorData.length === 0;

  // ── Handlers ──────────────────────────────────────────────────────────
  const handleOpenProductCard = useCallback((p: Product) => {
    if (p.video_url && onOpenCreative) {
      onOpenCreative({
        id: p.creative_id || '', product_id: (p as Product & { id?: string }).id || '', look_id: null,
        title: p.name, description: null, video_url: p.video_url, mobile_video_url: null, storage_path: null,
        thumbnail_url: p.thumbnail_url || null, affiliate_url: null, prompt: null, prompt_extra: null,
        style: '', model: null, status: 'live', duration_seconds: null, aspect_ratio: null, resolution: null,
        cost_usd: null, impressions: 0, clicks: 0, error: null, enabled: true, created_at: '', completed_at: null, updated_at: null,
        product: {
          id: (p as Product & { id?: string }).id || '', name: p.name, brand: p.brand, price: p.price,
          image_url: p.image || null, images: null, url: p.url, type: null, catalog_tags: null, gender: null,
        },
      });
    } else if (onOpenProduct) onOpenProduct(p);
    else if (p.url) onOpenBrowser(p.url, p.name);
  }, [onOpenCreative, onOpenProduct, onOpenBrowser]);

  const onDrop = useCallback((kind: 'look' | 'product', targetId: string) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.kind !== kind) return;
    if (kind === 'look') layout.reorderLooks(Number(drag.id), Number(targetId));
    else layout.reorderProducts(drag.id, targetId);
  }, [layout]);

  const submitNewCollection = useCallback(() => {
    const name = (creatingName ?? '').trim();
    if (name) { const id = layout.createCollection(name); setSelected(id); }
    setCreatingName(null);
  }, [creatingName, layout]);

  // ── Card-level collection menu ────────────────────────────────────────
  const renderCollectionMenu = (key: { lookId?: number; productKey?: string }, menuId: string) => {
    if (menuKey !== menuId) return null;
    return (
      <div className="saved-col-menu" onClick={e => e.stopPropagation()}>
        <span className="saved-col-menu-title">Add to collection</span>
        {layout.collections.length === 0 && <span className="saved-col-menu-empty">No collections yet</span>}
        {layout.collections.map(c => (
          <button
            key={c.id}
            type="button"
            className={`saved-col-menu-item${layout.isInCollection(c.id, key) ? ' is-in' : ''}`}
            onClick={() => layout.toggleInCollection(c.id, key)}
          >
            <span className="saved-col-menu-check">{layout.isInCollection(c.id, key) ? '✓' : ''}</span>
            {c.name}
          </button>
        ))}
        <button
          type="button"
          className="saved-col-menu-new"
          onClick={() => {
            const name = window.prompt('New collection name');
            if (name && name.trim()) { const id = layout.createCollection(name); layout.toggleInCollection(id, key); }
          }}
        >
          + New collection
        </button>
      </div>
    );
  };

  // Card overlay controls shared by look + product cards: collection
  // folder + remove. Stops propagation so taps don't open the item.
  const cardControls = (
    key: { lookId?: number; productKey?: string },
    menuId: string,
    onRemove: () => void,
  ) => (
    <div className="saved-card-controls" onClick={e => e.stopPropagation()}>
      <button
        className="saved-card-ctrl"
        aria-label="Add to collection"
        onClick={() => setMenuKey(m => (m === menuId ? null : menuId))}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      </button>
      <button className="saved-card-ctrl" aria-label="Remove from saved" onClick={onRemove}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
        </svg>
      </button>
      {renderCollectionMenu(key, menuId)}
    </div>
  );

  const looksRow = visibleLookIds.map(id => looksById.get(id)).filter((l): l is Look => !!l);
  const productsRow = visibleProductKeys.map(k => productsByKey.get(k)).filter((p): p is Product => !!p);

  const body = (
    <>
      {/* Insights — horizontal strip of stat tiles. */}
      {!isEmpty && (
        <div className="saved-insights" role="list" aria-label="Insights about your saves">
          <div className="saved-stat" role="listitem"><span className="saved-stat-num">{insights.looks + insights.products}</span><span className="saved-stat-label">Saved</span></div>
          <div className="saved-stat" role="listitem"><span className="saved-stat-num">{insights.looks}</span><span className="saved-stat-label">Looks</span></div>
          <div className="saved-stat" role="listitem"><span className="saved-stat-num">{insights.products}</span><span className="saved-stat-label">Products</span></div>
          <div className="saved-stat" role="listitem"><span className="saved-stat-num">{insights.creators}</span><span className="saved-stat-label">Creators</span></div>
          {insights.topBrand && <div className="saved-stat" role="listitem"><span className="saved-stat-num saved-stat-num--text">{insights.topBrand}</span><span className="saved-stat-label">Top brand</span></div>}
          {insights.value > 0 && <div className="saved-stat" role="listitem"><span className="saved-stat-num">${insights.value.toLocaleString()}</span><span className="saved-stat-label">Est. value</span></div>}
        </div>
      )}

      {/* Collections bar. */}
      {!isEmpty && (
        <div className="saved-collections-bar" role="tablist" aria-label="Collections">
          <button className={`saved-col-chip${selected === 'all' ? ' is-active' : ''}`} onClick={() => setSelected('all')}>All</button>
          {layout.collections.map(c => (
            <button key={c.id} className={`saved-col-chip${selected === c.id ? ' is-active' : ''}`} onClick={() => setSelected(c.id)}>
              {c.name}
              <span className="saved-col-chip-count">{c.lookIds.length + c.productKeys.length}</span>
            </button>
          ))}
          {creatingName === null ? (
            <button className="saved-col-chip saved-col-chip--new" onClick={() => setCreatingName('')}>+ New collection</button>
          ) : (
            <span className="saved-col-new-input-wrap">
              <input
                autoFocus
                className="saved-col-new-input"
                placeholder="Collection name"
                value={creatingName}
                onChange={e => setCreatingName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submitNewCollection(); if (e.key === 'Escape') setCreatingName(null); }}
                onBlur={submitNewCollection}
              />
            </span>
          )}
          {activeCollection && (
            <button className="saved-col-delete" onClick={() => { layout.deleteCollection(activeCollection.id); setSelected('all'); }} aria-label="Delete collection">
              Delete
            </button>
          )}
        </div>
      )}

      {isEmpty ? (
        <div className="saved-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3 }}><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
          <p>Nothing saved yet. Tap the bookmark on any look or product to start a collection.</p>
        </div>
      ) : (
        <div className="saved-rows">
          {/* Looks row */}
          {looksRow.length > 0 && (
            <section className="saved-row">
              <h3 className="saved-row-title">Looks <span className="saved-row-count">{looksRow.length}</span></h3>
              <div className="saved-row-scroller">
                {looksRow.map(look => {
                  const menuId = `look-${look.id}`;
                  return (
                    <div
                      key={look.id}
                      className="saved-tile saved-tile--look"
                      draggable
                      onDragStart={() => { dragRef.current = { kind: 'look', id: String(look.id) }; }}
                      onDragOver={e => e.preventDefault()}
                      onDrop={() => onDrop('look', String(look.id))}
                    >
                      <LookCard look={look} className="look-card loaded" onOpenLook={onOpenLook} onOpenCreator={() => onOpenCreator?.(look.creator)} />
                      {cardControls({ lookId: look.id }, menuId, () => bookmarks.toggleLookBookmark(look.id))}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Products row */}
          {productsRow.length > 0 && (
            <section className="saved-row">
              <h3 className="saved-row-title">Products <span className="saved-row-count">{productsRow.length}</span></h3>
              <div className="saved-row-scroller">
                {productsRow.map(p => {
                  const key = productKeyOf(p);
                  const menuId = `prod-${key}`;
                  return (
                    <div
                      key={key}
                      className="saved-tile saved-tile--product"
                      draggable
                      onDragStart={() => { dragRef.current = { kind: 'product', id: key }; }}
                      onDragOver={e => e.preventDefault()}
                      onDrop={() => onDrop('product', key)}
                    >
                      <button type="button" className="saved-product-card" onClick={() => handleOpenProductCard(p)}>
                        {p.video_url
                          ? <video className="saved-product-media" src={p.video_url} poster={p.thumbnail_url || p.image || ''} autoPlay muted loop playsInline />
                          : p.image
                            ? <img className="saved-product-media" src={p.image} alt={p.name} loading="lazy" />
                            : <div className="saved-product-media saved-product-media--blank" />}
                        <div className="saved-product-info">
                          {p.brand && <span className="saved-product-brand" role={onOpenBrand ? 'button' : undefined} onClick={onOpenBrand ? (e) => { e.stopPropagation(); onOpenBrand(p.brand!); } : undefined}>{p.brand}</span>}
                          <span className="saved-product-name">{p.name}</span>
                          {p.price && <span className="saved-product-price">{p.price}</span>}
                        </div>
                      </button>
                      {cardControls({ productKey: key }, menuId, () => bookmarks.toggleProductBookmark(p))}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Creators row — only on "All". */}
          {selected === 'all' && followedCreatorData.length > 0 && (
            <section className="saved-row">
              <h3 className="saved-row-title">Creators <span className="saved-row-count">{followedCreatorData.length}</span></h3>
              <div className="saved-row-scroller">
                {followedCreatorData.map(({ handle, data }) => (
                  <div key={handle} className="saved-creator" onClick={() => onOpenCreator?.(handle)}>
                    <div className="saved-creator-avatar-wrap">
                      <img className="saved-creator-avatar" src={data.avatar} alt={data.displayName} />
                      <button
                        className="saved-creator-toggle"
                        aria-label="Unfollow"
                        onClick={(e) => { e.stopPropagation(); bookmarks.toggleCreatorFollow(handle); }}
                      >−</button>
                    </div>
                    <span className="saved-creator-name">{data.displayName}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {looksRow.length === 0 && productsRow.length === 0 && activeCollection && (
            <div className="saved-empty saved-empty--collection">
              <p>“{activeCollection.name}” is empty. Use the folder button on any saved item to add it here.</p>
            </div>
          )}
        </div>
      )}
    </>
  );

  const header = (
    <div className="saved-header">
      <div className="saved-header-left">
        {!embedded && onClose && (
          <button className="saved-back" onClick={onClose} aria-label="Back">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
        )}
        <h1 className="saved-title">Saved</h1>
      </div>
      <button
        className={`saved-save-btn${layout.dirty ? ' is-dirty' : ''}`}
        onClick={layout.save}
        disabled={!layout.dirty}
        aria-label="Save your layout"
      >
        {layout.dirty ? 'Save layout' : (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            Saved
          </>
        )}
      </button>
    </div>
  );

  if (embedded) {
    return <div className="saved-screen saved-screen--embedded" onClick={() => menuKey && setMenuKey(null)}>{header}{body}</div>;
  }
  return (
    <div className="saved-screen saved-page" onClick={() => menuKey && setMenuKey(null)}>
      {header}
      {body}
    </div>
  );
}

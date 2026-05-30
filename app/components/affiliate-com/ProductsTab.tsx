// Products tab — search the affiliate.com product catalog, preview as a
// grid, and import any product into our own `products` table (source =
// 'affiliate.com', is_active = false so it lands in review). The
// affiliate/deep link is stored as the product url so clickouts monetize.

import { useState } from 'react';
import { supabase } from '~/utils/supabase';
import {
  affiliateCom, type AffiliateProduct,
  productTitle, productBrand, productImage, productLink, productPrice,
} from '~/services/affiliate-com';
import {
  useAffiliateCall, ErrorBanner, Spinner, EmptyState, Pagination, SearchBar, JsonDrawer,
} from './shared';

type ImportState = Record<string, 'idle' | 'saving' | 'done' | 'error'>;

function keyOf(p: AffiliateProduct, i: number): string {
  return String(p.id ?? `${p.merchant_id ?? ''}:${productTitle(p)}:${i}`);
}

export default function ProductsTab() {
  const [q, setQ] = useState('');
  const [submittedQ, setSubmittedQ] = useState('');
  const [page, setPage] = useState(1);
  const [drawer, setDrawer] = useState<AffiliateProduct | null>(null);
  const [importState, setImportState] = useState<ImportState>({});
  const perPage = 40;

  const { loading, result } = useAffiliateCall(
    () => affiliateCom.searchProducts({ q: submittedQ || undefined, page, per_page: perPage }),
    [page, submittedQ],
    { auto: submittedQ !== '' },
  );

  const rows = (result?.list?.items ?? []) as AffiliateProduct[];
  const total = result?.list?.total ?? null;

  const importProduct = async (p: AffiliateProduct, k: string) => {
    if (!supabase) return;
    setImportState(s => ({ ...s, [k]: 'saving' }));
    const img = productImage(p);
    // affiliate.com's real product schema uses snake_case + nested
    // objects for everything: brand / merchant / currency as
    // {name, …} / {code, symbol}, prices as final_price /
    // regular_price (numbers), gender as a string, URLs nested under
    // `urls.{affiliate,direct,outclick}`. Map each field through a
    // safe accessor so the row is always valid for the products schema.
    const raw = p as Record<string, unknown>;
    const finalPrice = raw.final_price ?? p.sale_price ?? null;
    const regularPrice = raw.regular_price ?? p.price ?? null;
    const currencyText = typeof p.currency === 'string'
      ? p.currency
      : (typeof p.currency === 'object' && p.currency !== null
          ? String((p.currency as Record<string, unknown>).code ?? (p.currency as Record<string, unknown>).symbol ?? '')
          : null);
    const genderText = typeof raw.gender === 'string' ? (raw.gender as string).toLowerCase() : null;
    const row = {
      name: productTitle(p),
      brand: productBrand(p) || null,
      price: regularPrice != null ? String(regularPrice) : null,
      discounted_price: finalPrice != null && finalPrice !== regularPrice ? String(finalPrice) : null,
      currency: currencyText || null,
      // The affiliate-tracked URL goes here — clickouts use this so
      // commission flows on every conversion. (Falls back to the bare
      // direct URL when no tracking link exists.)
      url: productLink(p),
      image_url: img,
      images: img ? [img] : [],
      description: typeof p.description === 'string' ? p.description : null,
      gender: genderText === 'male' || genderText === 'female' || genderText === 'unisex' ? genderText : null,
      source: 'affiliate.com',
      is_active: false,
      scrape_status: 'done',
      raw_data: p as Record<string, unknown>,
    };
    const { error } = await supabase.from('products').insert(row);
    setImportState(s => ({ ...s, [k]: error ? 'error' : 'done' }));
  };

  return (
    <div>
      <h2 style={{ margin: '0 0 12px', fontSize: 16 }}>Product search</h2>

      <SearchBar
        value={q} onChange={setQ}
        onSubmit={() => { setPage(1); setSubmittedQ(q); }}
        placeholder="Search products (e.g. ‘black hoodie’, ‘running shoes’)…"
      />

      <ErrorBanner error={result && !result.success ? result.error : null} />
      {loading && <Spinner label="Searching products…" />}

      {!submittedQ && !loading && !result && (
        <EmptyState label="Enter a query above to search the affiliate.com product catalog." />
      )}

      {result?.success && rows.length === 0 && !loading && (
        <EmptyState label="No products matched that query." />
      )}

      {result?.success && rows.length > 0 && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14 }}>
            {rows.map((p, i) => {
              const k = keyOf(p, i);
              const st = importState[k] ?? 'idle';
              const img = productImage(p);
              const link = productLink(p);
              return (
                <div key={k} style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', background: '#fff', display: 'flex', flexDirection: 'column' }}>
                  <button type="button" onClick={() => setDrawer(p)} style={{ border: 'none', padding: 0, background: '#f1f5f9', cursor: 'pointer' }}>
                    {img
                      ? <img src={img} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }} onError={e => { (e.target as HTMLImageElement).style.opacity = '0'; }} />
                      : <div style={{ width: '100%', aspectRatio: '1' }} />}
                  </button>
                  <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{productBrand(p)}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#111', lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                      {productTitle(p)}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, marginTop: 'auto' }}>{productPrice(p)}</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      <button
                        type="button"
                        className="admin-btn admin-btn-primary"
                        style={{ fontSize: 11, flex: 1 }}
                        disabled={st === 'saving' || st === 'done'}
                        onClick={() => importProduct(p, k)}
                      >
                        {st === 'saving' ? 'Importing…' : st === 'done' ? '✓ Imported' : st === 'error' ? 'Retry' : 'Import'}
                      </button>
                      {link && (
                        <a href={link} target="_blank" rel="noopener noreferrer" className="admin-btn admin-btn-secondary" style={{ fontSize: 11, textDecoration: 'none' }}>
                          ↗
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <Pagination page={page} perPage={perPage} total={total} onPage={setPage} />
        </>
      )}

      {drawer && <JsonDrawer title={productTitle(drawer)} value={drawer} onClose={() => setDrawer(null)} />}
    </div>
  );
}

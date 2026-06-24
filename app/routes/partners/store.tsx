import { usePartnersContext } from '~/hooks/useBrandMembership';

export default function PartnersStore() {
  const { brand, role } = usePartnersContext();
  const connected = Boolean(brand.shopify_shop);
  const canConnect = role === 'owner' || role === 'admin';

  return (
    <div style={{ padding: 24, maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px' }}>Store</h1>
      <p style={{ fontSize: 13, color: '#8b8b93', margin: '0 0 20px' }}>
        Connect your Shopify store to import products into the catalog.
      </p>

      <div style={{ padding: 20, borderRadius: 14, border: '1px solid #ececef', background: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <span style={{
            width: 40, height: 40, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: connected ? '#e7f7ec' : '#f3f3f5', fontSize: 18,
          }}>🛍️</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Shopify</div>
            <div style={{ fontSize: 12, color: connected ? '#188a4a' : '#8b8b93' }}>
              {connected ? `Connected — ${brand.shopify_shop}` : 'Not connected'}
            </div>
          </div>
        </div>

        <button
          type="button"
          disabled
          title="Shopify connect ships in Phase 2"
          style={{
            padding: '9px 16px', borderRadius: 9, border: 'none', fontSize: 13, fontWeight: 600,
            background: '#ececef', color: '#9a9aa2', cursor: 'not-allowed',
          }}
        >
          {connected ? 'Re-sync products' : 'Connect Shopify'}
        </button>

        <p style={{ fontSize: 12, color: '#a0a0a8', marginTop: 12 }}>
          {/* ponytail: OAuth lives in Phase 2 (shopify-connect / shopify-callback
              edge fns + brand_shopify_sessions). This page is the connect surface. */}
          {canConnect
            ? 'Shopify connection is being set up — this button activates in Phase 2.'
            : 'Only a brand owner or admin can connect Shopify.'}
        </p>
      </div>
    </div>
  );
}

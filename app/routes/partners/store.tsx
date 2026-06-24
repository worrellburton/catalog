import { useState } from 'react';
import { useSearchParams } from '@remix-run/react';
import { supabase } from '~/utils/supabase';
import { usePartnersContext } from '~/hooks/useBrandMembership';

const ERROR_COPY: Record<string, string> = {
  not_configured: 'Shopify isn’t configured yet. Contact the Catalog team.',
  bad_shop: 'That store domain looked invalid.',
  bad_hmac: 'Could not verify the response from Shopify.',
  bad_state: 'The connection request expired or was tampered with — try again.',
  state_expired: 'The connection request expired — try again.',
  token_exchange_failed: 'Shopify rejected the connection. Try again.',
  persist_failed: 'Connected to Shopify but failed to save — try again.',
};

const MAX_SYNC_PAGES = 200; // safety bound on the client continuation loop

interface SyncResp { success: boolean; synced?: number; hasMore?: boolean; cursor?: string | null; error?: string }

export default function PartnersStore() {
  const { brand, role } = usePartnersContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const [shop, setShop] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const connected = Boolean(brand.shopify_shop);
  const canConnect = role === 'owner' || role === 'admin';

  const justConnected = searchParams.get('connected') === '1';
  const callbackError = searchParams.get('error');

  const clearBanners = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('connected'); next.delete('error');
    setSearchParams(next, { replace: true });
  };

  async function connect() {
    setError(null);
    if (!supabase) { setError('Not signed in.'); return; }
    if (!shop.trim()) { setError('Enter your Shopify store domain.'); return; }
    setBusy(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('shopify-connect', {
        body: { brandId: brand.id, shop: shop.trim() },
      });
      if (fnErr || !data?.url) {
        setError(data?.error || fnErr?.message || 'Could not start the Shopify connection.');
        setBusy(false);
        return;
      }
      window.location.href = data.url as string;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unexpected error.');
      setBusy(false);
    }
  }

  async function syncProducts() {
    if (!supabase) return;
    setSyncing(true);
    setSyncMsg('Starting sync…');
    let total = 0;
    let cursor: string | null = null;
    try {
      for (let i = 0; i < MAX_SYNC_PAGES; i++) {
        // No generic on invoke() + cast: passing the reassigned `cursor` into the
        // body while typing the result off it creates a TS inference cycle.
        const resp = await supabase.functions.invoke('shopify-sync', {
          body: { brandId: brand.id, cursor },
        });
        const data = (resp.data ?? null) as SyncResp | null;
        if (resp.error || !data?.success) {
          setSyncMsg(`Sync failed: ${data?.error || resp.error?.message || 'unknown error'}`);
          setSyncing(false);
          return;
        }
        total += data.synced ?? 0;
        setSyncMsg(`Synced ${total} product${total === 1 ? '' : 's'}…`);
        if (!data.hasMore) break;
        cursor = data.cursor ?? null;
      }
      setSyncMsg(`Done — ${total} product${total === 1 ? '' : 's'} synced. They’ll appear in the catalog after review.`);
    } catch (e) {
      setSyncMsg(`Sync failed: ${e instanceof Error ? e.message : 'unexpected error'}`);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px' }}>Store</h1>
      <p style={{ fontSize: 13, color: '#8b8b93', margin: '0 0 20px' }}>
        Connect your Shopify store to import products into the catalog.
      </p>

      {justConnected && <Banner tone="ok" onClose={clearBanners}>Shopify connected. You can sync products now.</Banner>}
      {callbackError && <Banner tone="warn" onClose={clearBanners}>{ERROR_COPY[callbackError] ?? 'Something went wrong connecting Shopify.'}</Banner>}

      <div style={{ padding: 20, borderRadius: 14, border: '1px solid #ececef', background: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <span style={{ width: 40, height: 40, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: connected ? '#e7f7ec' : '#f3f3f5', fontSize: 18 }}>🛍️</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Shopify</div>
            <div style={{ fontSize: 12, color: connected ? '#188a4a' : '#8b8b93' }}>
              {connected ? `Connected — ${brand.shopify_shop}` : 'Not connected'}
            </div>
          </div>
        </div>

        {!canConnect ? (
          <p style={{ fontSize: 13, color: '#8b8b93', margin: 0 }}>Only a brand owner or admin can manage the Shopify connection.</p>
        ) : connected ? (
          <>
            <button
              type="button"
              onClick={syncProducts}
              disabled={syncing}
              style={{
                padding: '9px 16px', borderRadius: 9, border: 'none', fontSize: 13, fontWeight: 600,
                background: syncing ? '#ececef' : '#111', color: syncing ? '#9a9aa2' : '#fff',
                cursor: syncing ? 'default' : 'pointer',
              }}
            >
              {syncing ? 'Syncing…' : 'Sync products'}
            </button>
            {syncMsg && <p style={{ fontSize: 12, color: '#555', marginTop: 10, marginBottom: 0 }}>{syncMsg}</p>}
            <details style={{ marginTop: 14 }}>
              <summary style={{ fontSize: 12, color: '#8b8b93', cursor: 'pointer' }}>Reconnect a different store</summary>
              <div style={{ marginTop: 10 }}>{renderConnectForm()}</div>
            </details>
          </>
        ) : (
          renderConnectForm()
        )}
      </div>
    </div>
  );

  function renderConnectForm() {
    return (
      <>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b6b73', marginBottom: 6 }}>Store domain</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="text"
            value={shop}
            onChange={(e) => setShop(e.target.value)}
            placeholder="your-store.myshopify.com"
            disabled={busy}
            style={{ flex: '1 1 260px', minWidth: 220, padding: '9px 12px', borderRadius: 9, border: '1px solid #e2e2e6', fontSize: 13 }}
          />
          <button
            type="button"
            onClick={connect}
            disabled={busy}
            style={{
              padding: '9px 16px', borderRadius: 9, border: 'none', fontSize: 13, fontWeight: 600,
              background: busy ? '#ececef' : '#111', color: busy ? '#9a9aa2' : '#fff',
              cursor: busy ? 'default' : 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {busy ? 'Connecting…' : connected ? 'Reconnect' : 'Connect Shopify'}
          </button>
        </div>
        {error && <p style={{ fontSize: 12, color: '#c0392b', marginTop: 10, marginBottom: 0 }}>{error}</p>}
        <p style={{ fontSize: 12, color: '#a0a0a8', marginTop: 12, marginBottom: 0 }}>
          You’ll be sent to Shopify to approve access, then returned here.
        </p>
      </>
    );
  }
}

function Banner({ tone, children, onClose }: { tone: 'ok' | 'warn'; children: React.ReactNode; onClose: () => void }) {
  const bg = tone === 'ok' ? '#f1faf3' : '#fff8f1';
  const fg = tone === 'ok' ? '#188a4a' : '#9a6b00';
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 14px', borderRadius: 10, background: bg, color: fg, fontSize: 13, fontWeight: 600, marginBottom: 14 }}>
      <span>{children}</span>
      <button onClick={onClose} aria-label="Dismiss" style={{ border: 'none', background: 'transparent', color: fg, cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
    </div>
  );
}

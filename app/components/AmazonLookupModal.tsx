import { useState } from 'react';
import { lookupAmazonProduct, ingestRainforestProduct, type RainforestProduct } from '~/services/rainforest';

interface AmazonLookupModalProps {
  onClose: () => void;
  onIngested: (productId: string) => void;
}

function extractAsin(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  // Bare ASIN: 10 alphanumerics
  if (/^[A-Z0-9]{10}$/i.test(s)) return s.toUpperCase();
  // From Amazon URL
  const match = s.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i);
  return match ? match[1].toUpperCase() : null;
}

export default function AmazonLookupModal({ onClose, onIngested }: AmazonLookupModalProps) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [product, setProduct] = useState<RainforestProduct | null>(null);
  const [ingesting, setIngesting] = useState(false);

  const handleLookup = async () => {
    const raw = input.trim();
    if (!raw) return;
    setLoading(true);
    setError(null);
    setProduct(null);
    try {
      const asin = extractAsin(raw);
      const payload = asin ? { asin } : { url: raw };
      const found = await lookupAmazonProduct(payload);
      setProduct(found);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleIngest = async () => {
    if (!product) return;
    setIngesting(true);
    setError(null);
    try {
      const row = await ingestRainforestProduct(product);
      if (!row) throw new Error('Failed to save product');
      onIngested(row.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIngesting(false);
    }
  };

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div
        className="admin-modal"
        style={{ width: 560, maxWidth: '94vw', padding: 24 }}
        onClick={e => e.stopPropagation()}
      >
        <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>Add Amazon product</h2>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: '#888' }}>
          Paste an ASIN (e.g. <code>B073JYC4XM</code>) or a full Amazon product URL.
        </p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            type="text"
            autoFocus
            placeholder="B073JYC4XM or https://www.amazon.com/dp/…"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleLookup(); }}
            style={{
              flex: 1,
              padding: '10px 12px',
              borderRadius: 6,
              border: '1px solid #ddd',
              fontSize: 13,
              fontFamily: 'inherit',
            }}
          />
          <button
            className="admin-btn admin-btn-primary"
            onClick={handleLookup}
            disabled={loading || !input.trim()}
          >
            {loading ? 'Looking up…' : 'Look up'}
          </button>
        </div>

        {error && (
          <div style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', padding: '8px 12px', borderRadius: 6, fontSize: 12, marginBottom: 12 }}>
            <strong>Lookup failed:</strong> {error}
          </div>
        )}

        {product && (
          <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 14, marginBottom: 14, display: 'flex', gap: 14 }}>
            {product.image_url && (
              <img
                src={product.image_url}
                alt=""
                style={{ width: 120, height: 120, objectFit: 'contain', borderRadius: 6, background: '#fafafa', flexShrink: 0 }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {product.name}
              </div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
                {product.brand || '—'} {product.asin && <span style={{ fontFamily: 'monospace', marginLeft: 8, color: '#999' }}>{product.asin}</span>}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#111', marginBottom: 6 }}>
                {product.price || '—'}
              </div>
              {product.categories.length > 0 && (
                <div style={{ fontSize: 11, color: '#888' }}>
                  {product.categories.slice(0, 3).join(' › ')}
                </div>
              )}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="admin-btn admin-btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="admin-btn admin-btn-primary"
            onClick={handleIngest}
            disabled={!product || ingesting}
          >
            {ingesting ? 'Saving…' : 'Ingest to catalog'}
          </button>
        </div>
      </div>
    </div>
  );
}

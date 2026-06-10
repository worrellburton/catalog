// Conversion tab — affiliate.com's identifier conversion tools. Convert
// a product URL, barcode, ASIN, or SKU into the linked identifier(s).
// (POST /tools/convert/{type}). ASIN needs a locale; SKU needs a merchant.

import { useState } from 'react';
import { affiliateCom } from '~/services/affiliate-com';
import { ErrorBanner, Spinner } from './shared';

const TYPES: { value: string; label: string; needs?: 'asin' | 'merchant'; placeholder: string }[] = [
  { value: 'url-to-barcode', label: 'URL → Barcode', placeholder: 'https://merchant.com/product/123' },
  { value: 'barcode-to-asin', label: 'Barcode → ASIN', needs: 'asin', placeholder: '0123456789012' },
  { value: 'asin-to-barcode', label: 'ASIN → Barcode', needs: 'asin', placeholder: 'B0XXXXXXXX' },
  { value: 'barcode-to-sku', label: 'Barcode → SKU', needs: 'merchant', placeholder: '0123456789012' },
  { value: 'sku-to-barcode', label: 'SKU → Barcode', needs: 'merchant', placeholder: 'SKU-123' },
];

export default function ConversionTab() {
  const [type, setType] = useState(TYPES[0].value);
  const [value, setValue] = useState('');
  const [locale, setLocale] = useState('US');
  const [merchant, setMerchant] = useState('walmart');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<unknown>(null);

  const def = TYPES.find(t => t.value === type)!;

  const run = async () => {
    if (!value.trim()) return;
    setLoading(true); setError(null); setData(null);
    const config = def.needs === 'asin' ? { asin: { locale } }
      : def.needs === 'merchant' ? { merchant: { name: merchant } }
      : undefined;
    const r = await affiliateCom.convert({ type, data: [value.trim()], config });
    setLoading(false);
    if (!r.success) { setError(r.error); return; }
    setData(r.data);
  };

  return (
    <div style={{ maxWidth: 680 }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 16 }}>Conversion tools</h2>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: '#64748b' }}>
        Convert between product identifiers — URL, barcode (UPC/EAN), ASIN, and merchant SKU.
      </p>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {TYPES.map(t => (
          <button key={t.value} type="button" onClick={() => { setType(t.value); setData(null); setError(null); }}
            className={`admin-btn ${type === t.value ? 'admin-btn-primary' : 'admin-btn-secondary'}`} style={{ fontSize: 12 }}>
            {t.label}
          </button>
        ))}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); run(); }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ fontSize: 12, fontWeight: 600 }}>
          Input
          <input type="text" value={value} onChange={e => setValue(e.target.value)} placeholder={def.placeholder}
            style={{ width: '100%', marginTop: 4, padding: '9px 12px', borderRadius: 8, border: '1px solid #e0e0e0', fontSize: 13, boxSizing: 'border-box' }} />
        </label>

        {def.needs === 'asin' && (
          <label style={{ fontSize: 12, fontWeight: 600, maxWidth: 160 }}>
            Locale
            <input type="text" value={locale} onChange={e => setLocale(e.target.value)} placeholder="US"
              style={{ width: '100%', marginTop: 4, padding: '9px 12px', borderRadius: 8, border: '1px solid #e0e0e0', fontSize: 13, boxSizing: 'border-box' }} />
          </label>
        )}
        {def.needs === 'merchant' && (
          <label style={{ fontSize: 12, fontWeight: 600, maxWidth: 260 }}>
            Merchant (name or URL)
            <input type="text" value={merchant} onChange={e => setMerchant(e.target.value)} placeholder="walmart"
              style={{ width: '100%', marginTop: 4, padding: '9px 12px', borderRadius: 8, border: '1px solid #e0e0e0', fontSize: 13, boxSizing: 'border-box' }} />
          </label>
        )}

        <button type="submit" className="admin-btn admin-btn-primary" style={{ alignSelf: 'flex-start', fontSize: 13 }} disabled={loading}>
          {loading ? 'Converting…' : 'Convert'}
        </button>
      </form>

      <ErrorBanner error={error} />
      {loading && <Spinner label="Calling conversion API…" />}

      {data != null && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>Result:</div>
          <pre style={{ background: '#0f172a', color: '#e2e8f0', padding: 14, borderRadius: 8, fontSize: 12, overflow: 'auto', maxHeight: 420 }}>
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

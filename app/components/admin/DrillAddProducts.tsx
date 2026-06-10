// "Add products" for the type-brain drill view (/admin/governance/types →
// drill into a node). Same four sources as /admin/data's Add Products menu —
// Google Shopping, Amazon, brand website URLs, manual entry — but everything
// added here is auto-assigned to the drilled type by the caller (the page
// re-types the returned ids and reloads).
//
// Google + brand are thin UIs over the same services data.tsx uses
// (researchProducts / addProductUrl); Amazon and manual reuse the existing
// modals directly.

import { useRef, useState } from 'react';
import { researchProducts, type ResearchedProduct } from '~/services/product-research';
import { addProductUrl, triggerScrape } from '~/services/scrape-product';
import { supabase } from '~/utils/supabase';
import AmazonLookupModal from '~/components/AmazonLookupModal';
import ManualProductModal from '~/components/admin/ManualProductModal';

export type DrillAddSource = 'google' | 'amazon' | 'brand' | 'manual';

interface Props {
  source: DrillAddSource;
  /** Display name of the drilled type — everything added lands on it. */
  typeName: string;
  onClose: () => void;
  /** New product row ids — the page assigns them to the type + reloads. */
  onCreated: (ids: string[]) => void;
  showToast: (msg: string) => void;
}

const extractUrls = (raw: string): string[] =>
  [...new Set(raw.split(/[\s,]+/).map(s => s.trim()).filter(s => /^https?:\/\//i.test(s)))];

export default function DrillAddProducts({ source, typeName, onClose, onCreated, showToast }: Props) {
  if (source === 'manual') {
    return (
      <ManualProductModal
        onClose={onClose}
        showToast={showToast}
        initialFields={{ type: typeName.toLowerCase() }}
        onIngested={row => {
          const id = row.id;
          if (typeof id === 'string') onCreated([id]);
        }}
      />
    );
  }
  if (source === 'amazon') {
    return <AmazonAdd typeName={typeName} onClose={onClose} onCreated={onCreated} showToast={showToast} />;
  }
  if (source === 'brand') {
    return <BrandAdd typeName={typeName} onClose={onClose} onCreated={onCreated} showToast={showToast} />;
  }
  return <GoogleAdd typeName={typeName} onClose={onClose} onCreated={onCreated} showToast={showToast} />;
}

type FlowProps = Omit<Props, 'source'>;

function AmazonAdd({ typeName, onClose, onCreated, showToast }: FlowProps) {
  // onIngestedIds fires before onIngested in both modal paths — stash the
  // ids, then hand them over when the ingest completes.
  const idsRef = useRef<string[]>([]);
  return (
    <AmazonLookupModal
      onClose={onClose}
      onIngestedIds={ids => { idsRef.current = ids; }}
      onIngested={count => {
        showToast(`Added ${count} product${count === 1 ? '' : 's'} → ${typeName}`);
        if (idsRef.current.length) onCreated(idsRef.current);
        onClose();
      }}
    />
  );
}

function BrandAdd({ typeName, onClose, onCreated, showToast }: FlowProps) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const urls = extractUrls(input);

  const run = async () => {
    if (!urls.length) return;
    setBusy(true);
    setError(null);
    const ids: string[] = [];
    let failed = 0;
    for (let i = 0; i < urls.length; i++) {
      try {
        const row = await addProductUrl(urls[i]);
        if (row?.id) ids.push(row.id);
      } catch (err) {
        failed += 1;
        if (failed === 1) setError(`${urls[i]} — ${err instanceof Error ? err.message : 'failed'}`);
      }
      setProgress({ done: i + 1, total: urls.length });
    }
    setBusy(false);
    if (ids.length) {
      showToast(`${ids.length} product${ids.length === 1 ? '' : 's'} scraping → ${typeName}${failed ? ` · ${failed} failed` : ''}`);
      onCreated(ids);
      onClose();
    }
  };

  return (
    <div className="admin-modal-overlay" onClick={() => !busy && onClose()}>
      <div className="admin-modal" style={{ maxWidth: 560, padding: 20 }} onClick={e => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>Add via Brand Website → {typeName}</h2>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: '#666' }}>
          Paste one or many product URLs (one per line, comma- or space-separated). Each page is
          scraped and the product lands in <strong>{typeName}</strong> automatically.
        </p>
        <textarea
          autoFocus
          value={input}
          onChange={e => { setInput(e.target.value); setError(null); }}
          placeholder={'https://brand-a.com/products/foo\nhttps://brand-b.com/products/bar'}
          disabled={busy}
          rows={6}
          style={{
            width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8,
            border: `1px solid ${error ? '#dc2626' : '#e5e7eb'}`, fontSize: 13,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: 1.5,
            resize: 'vertical', marginBottom: 10,
          }}
        />
        {urls.length > 1 && (
          <div style={{ fontSize: 11, color: '#666', marginBottom: 10 }}>
            <strong>{urls.length}</strong> URLs detected — all will be queued.
          </div>
        )}
        {busy && progress && progress.total > 1 && (
          <div style={{ fontSize: 11, color: '#666', marginBottom: 10 }}>
            Queueing — {progress.done} / {progress.total}
          </div>
        )}
        {error && <div style={{ fontSize: 12, color: '#dc2626', marginBottom: 12 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="admin-btn admin-btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="admin-btn admin-btn-primary" onClick={() => { void run(); }} disabled={busy || urls.length === 0}>
            {busy ? 'Adding…' : urls.length > 1 ? `Add ${urls.length} URLs` : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}

function GoogleAdd({ typeName, onClose, onCreated, showToast }: FlowProps) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ResearchedProduct[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const run = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    const { products, error: err } = await researchProducts(query, { liveOnly: true });
    setResults(products);
    setSelected(new Set(products.map((_, i) => i)));
    setError(err);
    setLoading(false);
  };

  const add = async () => {
    if (!supabase || selected.size === 0) return;
    setAdding(true);
    const picks = [...selected].map(i => results[i]);
    const rows = picks.map(p => ({
      name: p.name,
      brand: p.brand,
      price: p.price,
      url: p.url || null,
      image_url: p.image_url,
      images: p.image_urls || [p.image_url].filter(Boolean),
      // The scraper resolves Google Shopping URLs to the merchant PDP.
      scrape_status: 'pending',
      scraped_at: null,
      source: 'google_shopping',
    }));
    const { data: inserted, error: err } = await supabase
      .from('products')
      .insert(rows)
      .select('id, url');
    setAdding(false);
    if (err || !inserted) {
      showToast(`Add failed: ${err?.message ?? 'unknown error'}`);
      return;
    }
    for (const p of inserted) {
      if (p.url && p.url.includes('google.com')) triggerScrape(p.id, p.url);
    }
    showToast(`Added ${inserted.length} product${inserted.length === 1 ? '' : 's'} → ${typeName}`);
    onCreated(inserted.map(p => p.id));
    onClose();
  };

  return (
    <div className="admin-modal-overlay" onClick={() => !adding && onClose()}>
      <div
        className="admin-modal"
        style={{ width: 720, maxWidth: '92vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '20px 24px 12px' }}>
          <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>Add via Google Shopping → {typeName}</h2>
          <p style={{ margin: '0 0 14px', fontSize: 13, color: '#888' }}>
            Search live Google Shopping — everything you add lands in <strong>{typeName}</strong>.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              autoFocus
              placeholder={`e.g. "${typeName.toLowerCase()}"`}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void run(); }}
              style={{ flex: 1, padding: '8px 12px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 }}
            />
            <button className="admin-btn admin-btn-primary" onClick={() => { void run(); }} disabled={loading || !query.trim()}>
              {loading ? 'Searching…' : 'Search'}
            </button>
          </div>
          {error && (
            <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12 }}>
              {error}
            </div>
          )}
        </div>
        {results.length > 0 && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 12px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
            {results.map((p, i) => {
              const isSel = selected.has(i);
              return (
                <button
                  key={`${p.url ?? p.name}-${i}`}
                  type="button"
                  onClick={() => setSelected(prev => {
                    const next = new Set(prev);
                    if (next.has(i)) next.delete(i); else next.add(i);
                    return next;
                  })}
                  style={{
                    textAlign: 'left', border: `2px solid ${isSel ? '#4f46e5' : '#eee'}`, borderRadius: 10,
                    padding: 6, background: '#fff', cursor: 'pointer',
                  }}
                >
                  {p.image_url && (
                    <img src={p.image_url} alt="" loading="lazy" style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 6 }} />
                  )}
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#6366f1', marginTop: 6, textTransform: 'uppercase' }}>{p.brand}</div>
                  <div style={{ fontSize: 12, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                  {p.price && <div style={{ fontSize: 12, color: '#666' }}>{p.price}</div>}
                </button>
              );
            })}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 24px 20px', borderTop: results.length ? '1px solid #f0f0f0' : 'none' }}>
          <button className="admin-btn admin-btn-secondary" onClick={onClose} disabled={adding}>Cancel</button>
          <button className="admin-btn admin-btn-primary" onClick={() => { void add(); }} disabled={adding || selected.size === 0}>
            {adding ? 'Adding…' : `Add ${selected.size} to ${typeName}`}
          </button>
        </div>
      </div>
    </div>
  );
}

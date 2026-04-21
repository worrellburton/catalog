import { useState } from 'react';
import {
  lookupAmazonProduct,
  searchAmazonProducts,
  ingestRainforestProduct,
  ingestRainforestProducts,
  type RainforestProduct,
} from '~/services/rainforest';

type Mode = 'lookup' | 'search';

interface AmazonLookupModalProps {
  onClose: () => void;
  onIngested: (count: number) => void;
}

function extractAsin(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^[A-Z0-9]{10}$/i.test(s)) return s.toUpperCase();
  const match = s.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i);
  return match ? match[1].toUpperCase() : null;
}

function looksLikeUrlOrAsin(s: string): boolean {
  const t = s.trim();
  return /^[A-Z0-9]{10}$/i.test(t) || /^https?:\/\//i.test(t);
}

export default function AmazonLookupModal({ onClose, onIngested }: AmazonLookupModalProps) {
  const [mode, setMode] = useState<Mode>('search');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lookup mode state
  const [product, setProduct] = useState<RainforestProduct | null>(null);

  // Search mode state
  const [results, setResults] = useState<RainforestProduct[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [ingesting, setIngesting] = useState(false);

  const handleGo = async () => {
    const raw = input.trim();
    if (!raw) return;
    setLoading(true);
    setError(null);
    setProduct(null);
    setResults([]);
    setSelected(new Set());

    try {
      // Auto-detect: if the user pastes an ASIN or URL while in search mode,
      // flip to lookup for a single-product result.
      const effectiveMode: Mode = looksLikeUrlOrAsin(raw) ? 'lookup' : mode;

      if (effectiveMode === 'lookup') {
        const asin = extractAsin(raw);
        const payload = asin ? { asin } : { url: raw };
        const found = await lookupAmazonProduct(payload);
        setProduct(found);
        setMode('lookup');
      } else {
        const found = await searchAmazonProducts(raw, 24);
        setResults(found);
        setMode('search');
        // Preselect all — user de-selects what they don't want.
        setSelected(new Set(found.map(p => p.url!).filter(Boolean)));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const toggleOne = (url: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url); else next.add(url);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(results.map(p => p.url!).filter(Boolean)));
  const selectNone = () => setSelected(new Set());

  const handleIngestOne = async () => {
    if (!product) return;
    setIngesting(true);
    setError(null);
    try {
      const row = await ingestRainforestProduct(product);
      if (!row) throw new Error('Failed to save product');
      onIngested(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIngesting(false);
    }
  };

  const handleIngestSelected = async () => {
    const picks = results.filter(p => p.url && selected.has(p.url));
    if (picks.length === 0) return;
    setIngesting(true);
    setError(null);
    try {
      const { inserted, failed } = await ingestRainforestProducts(picks);
      if (failed > 0 && inserted === 0) {
        setError(`All ${failed} ingests failed`);
      } else {
        onIngested(inserted);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIngesting(false);
    }
  };

  const hasResults = mode === 'search' ? results.length > 0 : !!product;
  const canIngest = mode === 'search' ? selected.size > 0 : !!product;

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div
        className="admin-modal"
        style={{ width: 760, maxWidth: '94vw', maxHeight: '88vh', padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '22px 24px 12px' }}>
          <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>Add from Amazon</h2>
          <p style={{ margin: '0 0 14px', fontSize: 13, color: '#888' }}>
            Search Amazon by keyword, or paste an ASIN / product URL for one item.
          </p>

          <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
            <div style={{ display: 'inline-flex', borderRadius: 6, overflow: 'hidden', border: '1px solid #e5e7eb' }}>
              <button
                className="admin-btn"
                onClick={() => { setMode('search'); setProduct(null); setError(null); }}
                style={{
                  padding: '6px 12px', fontSize: 12, borderRadius: 0, border: 'none',
                  background: mode === 'search' ? '#111' : '#fff',
                  color: mode === 'search' ? '#fff' : '#444',
                }}
              >
                Search
              </button>
              <button
                className="admin-btn"
                onClick={() => { setMode('lookup'); setResults([]); setSelected(new Set()); setError(null); }}
                style={{
                  padding: '6px 12px', fontSize: 12, borderRadius: 0, border: 'none',
                  background: mode === 'lookup' ? '#111' : '#fff',
                  color: mode === 'lookup' ? '#fff' : '#444',
                }}
              >
                ASIN / URL
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              autoFocus
              placeholder={mode === 'search' ? 'e.g. "linen shirt men"' : 'B073JYC4XM or https://www.amazon.com/dp/…'}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleGo(); }}
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
              onClick={handleGo}
              disabled={loading || !input.trim()}
            >
              {loading ? (mode === 'search' ? 'Searching…' : 'Looking up…') : (mode === 'search' ? 'Search' : 'Look up')}
            </button>
          </div>
        </div>

        {error && (
          <div style={{ margin: '0 24px 12px', background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', padding: '8px 12px', borderRadius: 6, fontSize: 12 }}>
            <strong>{mode === 'search' ? 'Search' : 'Lookup'} failed:</strong> {error}
          </div>
        )}

        <div style={{ flex: 1, overflow: 'auto', padding: '0 24px 8px' }}>
          {mode === 'lookup' && product && (
            <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 14, marginBottom: 14, display: 'flex', gap: 14 }}>
              {product.image_url && (
                <img
                  src={product.image_url}
                  alt=""
                  style={{ width: 140, height: 140, objectFit: 'contain', borderRadius: 6, background: '#fafafa', flexShrink: 0 }}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{product.name}</div>
                <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
                  {product.brand || '—'} {product.asin && <span style={{ fontFamily: 'monospace', marginLeft: 8, color: '#999' }}>{product.asin}</span>}
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#111', marginBottom: 6 }}>{product.price || '—'}</div>
                {product.categories.length > 0 && (
                  <div style={{ fontSize: 11, color: '#888' }}>{product.categories.slice(0, 3).join(' › ')}</div>
                )}
              </div>
            </div>
          )}

          {mode === 'search' && results.length > 0 && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0' }}>
                <div style={{ fontSize: 12, color: '#666' }}>
                  {results.length} results · {selected.size} selected
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="admin-btn admin-btn-secondary" onClick={selectAll} style={{ fontSize: 11, padding: '3px 10px' }}>Select all</button>
                  <button className="admin-btn admin-btn-secondary" onClick={selectNone} style={{ fontSize: 11, padding: '3px 10px' }}>Select none</button>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                {results.map((p) => {
                  if (!p.url) return null;
                  const isSel = selected.has(p.url);
                  return (
                    <button
                      key={p.url}
                      onClick={() => toggleOne(p.url!)}
                      style={{
                        textAlign: 'left',
                        border: `2px solid ${isSel ? '#111' : '#eee'}`,
                        borderRadius: 10,
                        background: '#fff',
                        padding: 8,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        position: 'relative',
                      }}
                    >
                      {p.image_url ? (
                        <img src={p.image_url} alt="" style={{ width: '100%', aspectRatio: '1/1', objectFit: 'contain', background: '#fafafa', borderRadius: 6 }} />
                      ) : (
                        <div style={{ width: '100%', aspectRatio: '1/1', background: '#fafafa', borderRadius: 6 }} />
                      )}
                      <div style={{ fontSize: 11, fontWeight: 600, marginTop: 6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {p.name}
                      </div>
                      <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{p.brand || '—'}</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#111', marginTop: 2 }}>{p.price || '—'}</div>
                      {isSel && (
                        <div style={{ position: 'absolute', top: 6, right: 6, background: '#111', color: '#fff', borderRadius: '50%', width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>
                          ✓
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {!hasResults && !loading && !error && (
            <div style={{ padding: '24px 8px', textAlign: 'center', color: '#888', fontSize: 13 }}>
              {mode === 'search' ? 'Type a search term and press Enter.' : 'Paste an ASIN or Amazon product URL.'}
            </div>
          )}
        </div>

        <div style={{ padding: '12px 24px 18px', borderTop: '1px solid #f0f0f0', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="admin-btn admin-btn-secondary" onClick={onClose} disabled={ingesting}>Cancel</button>
          <button
            className="admin-btn admin-btn-primary"
            onClick={mode === 'search' ? handleIngestSelected : handleIngestOne}
            disabled={!canIngest || ingesting}
          >
            {ingesting
              ? 'Saving…'
              : mode === 'search'
                ? `Ingest ${selected.size} product${selected.size === 1 ? '' : 's'}`
                : 'Ingest to catalog'}
          </button>
        </div>
      </div>
    </div>
  );
}

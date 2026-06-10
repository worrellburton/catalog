// "Add Manually" product modal (admin /admin/data → Add Products menu).
// Flow: drop a screenshot of any product page → Claude vision prefills
// name / brand / price / currency / description / type / gender → the
// admin reviews, uploads the REAL primary image (+ optional gallery),
// and saves. The screenshot is only an extraction source — it is never
// stored; the uploaded images are what the product ships with.

import { useRef, useState } from 'react';
import {
  createManualProduct,
  extractProductFromScreenshot,
  uploadProductImage,
  type ExtractedProductFields,
} from '~/services/manual-product';

interface Props {
  onClose: () => void;
  /** Receives the inserted row (ingest-select shape) for table merge. */
  onIngested: (row: Record<string, unknown>) => void;
  showToast: (msg: string) => void;
}

const EMPTY_FIELDS: ExtractedProductFields = {
  name: '', brand: '', price: '', currency: '', description: '', type: '', gender: '',
};

const label: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: '#475569',
  textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4, display: 'block',
};
const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 6,
  border: '1px solid #ddd', fontSize: 13, fontFamily: 'inherit',
};

export default function ManualProductModal({ onClose, onIngested, showToast }: Props) {
  const [fields, setFields] = useState<ExtractedProductFields>(EMPTY_FIELDS);
  const [url, setUrl] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extractErr, setExtractErr] = useState<string | null>(null);
  const [screenshotName, setScreenshotName] = useState<string | null>(null);
  const [primary, setPrimary] = useState<{ url: string; uploading: boolean } | null>(null);
  const [gallery, setGallery] = useState<{ url: string }[]>([]);
  const [galleryUploading, setGalleryUploading] = useState(0);
  const [saving, setSaving] = useState(false);
  const busy = extracting || saving || galleryUploading > 0 || primary?.uploading === true;

  const screenshotInput = useRef<HTMLInputElement>(null);
  const primaryInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);

  const set = (k: keyof ExtractedProductFields, v: string) => setFields(prev => ({ ...prev, [k]: v }));

  const onScreenshot = async (file: File | undefined) => {
    if (!file) return;
    setExtracting(true);
    setExtractErr(null);
    setScreenshotName(file.name);
    try {
      const extracted = await extractProductFromScreenshot(file);
      // Only fill blanks the admin hasn't already typed over.
      setFields(prev => {
        const next = { ...prev };
        for (const k of Object.keys(extracted) as (keyof ExtractedProductFields)[]) {
          if (!next[k]) next[k] = extracted[k];
        }
        return next;
      });
      showToast('Screenshot read — review the extracted fields');
    } catch (err) {
      setExtractErr(err instanceof Error ? err.message : 'Extraction failed');
    } finally {
      setExtracting(false);
    }
  };

  const onPrimary = async (file: File | undefined) => {
    if (!file) return;
    setPrimary({ url: URL.createObjectURL(file), uploading: true });
    try {
      const publicUrl = await uploadProductImage(file);
      setPrimary({ url: publicUrl, uploading: false });
    } catch (err) {
      setPrimary(null);
      showToast(`Primary image upload failed: ${err instanceof Error ? err.message : 'error'}`);
    }
  };

  const onGallery = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files).slice(0, 8);
    setGalleryUploading(n => n + list.length);
    for (const file of list) {
      try {
        const publicUrl = await uploadProductImage(file);
        setGallery(prev => [...prev, { url: publicUrl }]);
      } catch (err) {
        showToast(`Gallery upload failed: ${err instanceof Error ? err.message : 'error'}`);
      } finally {
        setGalleryUploading(n => n - 1);
      }
    }
  };

  const save = async () => {
    if (!fields.name.trim()) { showToast('Name is required'); return; }
    if (!primary || primary.uploading) { showToast('Upload a primary image first'); return; }
    setSaving(true);
    try {
      const row = await createManualProduct({
        ...fields,
        url,
        primaryImageUrl: primary.url,
        galleryImageUrls: gallery.map(g => g.url),
      });
      showToast(`Added ${fields.name}`);
      onIngested(row);
      onClose();
    } catch (err) {
      showToast(`Save failed: ${err instanceof Error ? err.message : 'error'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-modal-overlay" onClick={() => !busy && onClose()}>
      <div
        className="admin-modal"
        style={{ width: 640, maxWidth: '92vw', maxHeight: '88vh', overflowY: 'auto', padding: 24 }}
        onClick={e => e.stopPropagation()}
      >
        <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>Add product manually</h2>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: '#888' }}>
          Drop a screenshot of the product page — Claude pulls out the name, brand, price and
          details. Then upload the real primary image and any gallery shots.
        </p>

        {/* Screenshot extraction */}
        <button
          type="button"
          onClick={() => screenshotInput.current?.click()}
          disabled={extracting}
          style={{
            width: '100%', padding: '18px 16px', borderRadius: 10,
            border: '1.5px dashed #c7d2fe', background: '#f5f7ff', cursor: 'pointer',
            fontSize: 13, color: '#4338ca', fontWeight: 600, marginBottom: 6,
          }}
        >
          {extracting
            ? 'Reading screenshot with Claude…'
            : screenshotName
              ? `↺ Re-extract from another screenshot (used: ${screenshotName})`
              : '⇪ Upload a screenshot — Claude extracts price, name, brand & more'}
        </button>
        <input
          ref={screenshotInput} type="file" accept="image/*" hidden
          onChange={e => { void onScreenshot(e.target.files?.[0]); e.target.value = ''; }}
        />
        {extractErr && (
          <div style={{ background: '#fef2f2', color: '#b91c1c', borderRadius: 8, padding: '8px 12px', fontSize: 12.5, marginBottom: 8 }}>
            {extractErr}
          </div>
        )}

        {/* Reviewable fields */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={label}>Name *</label>
            <input style={input} value={fields.name} onChange={e => set('name', e.target.value)} placeholder="The Jordan Belt" />
          </div>
          <div>
            <label style={label}>Brand</label>
            <input style={input} value={fields.brand} onChange={e => set('brand', e.target.value)} placeholder="Favorite Daughter" />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={label}>Price</label>
              <input style={input} value={fields.price} onChange={e => set('price', e.target.value)} placeholder="128.00" />
            </div>
            <div style={{ width: 90 }}>
              <label style={label}>Currency</label>
              <input style={input} value={fields.currency} onChange={e => set('currency', e.target.value)} placeholder="USD" />
            </div>
          </div>
          <div>
            <label style={label}>Type</label>
            <input style={input} value={fields.type} onChange={e => set('type', e.target.value)} placeholder="belts" />
          </div>
          <div>
            <label style={label}>Gender</label>
            <select style={{ ...input, cursor: 'pointer' }} value={fields.gender} onChange={e => set('gender', e.target.value)}>
              <option value="">—</option>
              <option value="women">women</option>
              <option value="men">men</option>
              <option value="unisex">unisex</option>
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={label}>Product URL (optional)</label>
            <input style={input} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://brand.com/products/…" />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={label}>Description</label>
            <textarea
              style={{ ...input, minHeight: 64, resize: 'vertical' }}
              value={fields.description}
              onChange={e => set('description', e.target.value)}
            />
          </div>
        </div>

        {/* Images */}
        <div style={{ display: 'flex', gap: 16, marginTop: 16, alignItems: 'flex-start' }}>
          <div>
            <label style={label}>Primary image *</label>
            <button
              type="button"
              onClick={() => primaryInput.current?.click()}
              style={{
                width: 110, height: 146, borderRadius: 10, border: '1.5px dashed #d1d5db',
                background: primary ? `center/cover no-repeat url(${primary.url})` : '#fafafa',
                cursor: 'pointer', fontSize: 12, color: '#9ca3af', position: 'relative',
              }}
            >
              {!primary && '+ upload'}
              {primary?.uploading && (
                <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: 700, color: '#4338ca' }}>uploading…</span>
              )}
            </button>
            <input ref={primaryInput} type="file" accept="image/*" hidden onChange={e => { void onPrimary(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={label}>Gallery images</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {gallery.map((g, i) => (
                <div key={g.url} style={{ position: 'relative' }}>
                  <div style={{ width: 64, height: 84, borderRadius: 8, background: `center/cover no-repeat url(${g.url})`, border: '1px solid #eee' }} />
                  <button
                    type="button"
                    aria-label="Remove gallery image"
                    onClick={() => setGallery(prev => prev.filter((_, j) => j !== i))}
                    style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', border: 'none', background: '#111', color: '#fff', fontSize: 11, lineHeight: 1, cursor: 'pointer' }}
                  >×</button>
                </div>
              ))}
              {galleryUploading > 0 && (
                <div style={{ width: 64, height: 84, borderRadius: 8, border: '1.5px dashed #c7d2fe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#4338ca', fontWeight: 700 }}>…</div>
              )}
              <button
                type="button"
                onClick={() => galleryInput.current?.click()}
                style={{ width: 64, height: 84, borderRadius: 8, border: '1.5px dashed #d1d5db', background: '#fafafa', cursor: 'pointer', fontSize: 18, color: '#9ca3af' }}
              >+</button>
              <input ref={galleryInput} type="file" accept="image/*" multiple hidden onChange={e => { void onGallery(e.target.files); e.target.value = ''; }} />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 22 }}>
          <button className="admin-btn admin-btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="admin-btn admin-btn-primary" onClick={() => { void save(); }} disabled={busy}>
            {saving ? 'Saving…' : 'Add product'}
          </button>
        </div>
      </div>
    </div>
  );
}

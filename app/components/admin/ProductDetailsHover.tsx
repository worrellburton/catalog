// imports
import type { MouseEvent } from 'react';

// types
interface ProductDetailsHoverProps {
  gender: string | null | undefined;
  /** Short composition string derived from materials_care (extractFabric). */
  fabric: string | null | undefined;
  sizeFit: string | null | undefined;
  materialsCare: string | null | undefined;
  /** Claude Haiku's read of the primary image. */
  haiku: string | null | undefined;
  barcode: string | null | undefined;
  barcodeType: string | null | undefined;
  regenerating?: boolean;
  /** Present when the row has a cloud id and the Haiku read can be re-run. */
  onRegenerate?: () => void;
}

// constants
const GENDER_LABEL: Record<string, string> = { male: 'Men', female: 'Women', unisex: 'Unisex' };

// helpers
function stop(e: MouseEvent) { e.stopPropagation(); }

// main logic
/**
 * One ⓘ icon per product row that reveals the long-tail fields on hover
 * or keyboard focus: gender, fabric, size & fit, materials & care, the
 * Haiku image read (with its regenerate button), and the barcode. These
 * used to be five separate columns; the icon is tinted when any of them
 * has data so a glance still tells you whether there's anything to see.
 */
export default function ProductDetailsHover({
  gender, fabric, sizeFit, materialsCare, haiku, barcode, barcodeType, regenerating = false, onRegenerate,
}: ProductDetailsHoverProps) {
  const rows: Array<{ label: string; value: string | null | undefined }> = [
    { label: 'Gender', value: gender ? (GENDER_LABEL[gender] ?? gender) : null },
    { label: 'Fabric', value: fabric },
    { label: 'Size & fit', value: sizeFit },
    { label: 'Materials & care', value: materialsCare },
    { label: barcodeType ? `Barcode · ${barcodeType}` : 'Barcode', value: barcode },
  ];
  const hasAny = rows.some(r => !!r.value) || !!haiku;
  return (
    <div
      className={`admin-detail-hover${hasAny ? ' has-data' : ''}`}
      tabIndex={0}
      aria-label={hasAny ? 'Product details' : 'No details captured yet'}
      onClick={stop}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
      <div className="admin-detail-hover-panel" role="tooltip">
        <div className="admin-detail-hover-row">
          <div className="admin-detail-hover-label">
            Haiku read
            {onRegenerate && (
              <button
                type="button"
                className="admin-detail-hover-regen"
                onClick={(e) => { e.stopPropagation(); if (!regenerating) onRegenerate(); }}
                disabled={regenerating}
                title="Regenerate from the primary image"
                aria-label="Regenerate Haiku read"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                  style={regenerating ? { animation: 'admin-spin 0.9s linear infinite' } : undefined}>
                  <polyline points="23 4 23 10 17 10" />
                  <polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
              </button>
            )}
          </div>
          <div className={`admin-detail-hover-value${haiku && !regenerating ? '' : ' is-empty'}`}>
            {regenerating ? 'Regenerating…' : (haiku || 'Pending')}
          </div>
        </div>
        {rows.map(r => (
          <div key={r.label} className="admin-detail-hover-row">
            <div className="admin-detail-hover-label">{r.label}</div>
            <div className={`admin-detail-hover-value${r.value ? '' : ' is-empty'}`}>{r.value || 'Not available'}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

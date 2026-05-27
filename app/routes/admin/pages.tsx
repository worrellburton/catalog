import { useState } from 'react';

/**
 * Admin · Pages
 *
 * Single place to configure the section order of consumer-facing
 * pages. Two sub-tabs:
 *   - Product: section order for the ProductPage rail (Product →
 *     Similar → Popular → You might also like).
 *   - Looks:   section order for the LookOverlay rail (Products →
 *     About → More from creator).
 *
 * This is the scaffolding pass. The full reorder UI (drag-and-drop
 * + persistence + preview) lands in follow-up phases.
 */

type Tab = 'product' | 'looks';

// Initial section catalog per page surface. Future phases will hydrate
// these from a `page_sections` table so the order is editable.
interface SectionRow {
  id: string;
  label: string;
  description: string;
}

const PRODUCT_SECTIONS: SectionRow[] = [
  { id: 'hero',              label: 'Hero',                description: 'The selected product card + creator chip at the top of the page.' },
  { id: 'similar',           label: 'Similar',             description: 'Similar products from the same brand or look graph.' },
  { id: 'popular',           label: 'Popular',             description: 'Most-engaged products from the same category.' },
  { id: 'you-might-also-like', label: 'You might also like', description: 'Infinite editorial feed scoped to the shopper.' },
];

const LOOKS_SECTIONS: SectionRow[] = [
  { id: 'video',                label: 'Video / hero media',     description: 'Full-bleed video on the left half of the overlay.' },
  { id: 'creator-chip',         label: 'Creator chip',           description: 'Avatar + handle + follow button at the bottom of the media.' },
  { id: 'tabs',                 label: 'Products / About tabs',  description: 'Tab nav between the products list and the creator about panel.' },
  { id: 'products',             label: 'Products list',          description: 'All garments tagged on the look, sorted by garment role.' },
  { id: 'more-from-creator',    label: 'More from this creator', description: 'Horizontal rail of additional looks from the same creator.' },
];

export default function AdminPages() {
  const [tab, setTab] = useState<Tab>('product');
  const sections = tab === 'product' ? PRODUCT_SECTIONS : LOOKS_SECTIONS;

  return (
    <div style={{ padding: 24, maxWidth: 980 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Pages</h1>
      <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
        Configure the section order of consumer pages. Drag-to-reorder
        + persistence land in a follow-up phase.
      </p>

      <div style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 999, background: '#f1f5f9', marginBottom: 20 }}>
        <button
          type="button"
          onClick={() => setTab('product')}
          style={pillStyle(tab === 'product')}
        >
          Product
        </button>
        <button
          type="button"
          onClick={() => setTab('looks')}
          style={pillStyle(tab === 'looks')}
        >
          Looks
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sections.map((s, i) => (
          <div
            key={s.id}
            style={{
              display: 'grid',
              gridTemplateColumns: '32px 1fr auto',
              alignItems: 'center',
              gap: 12,
              padding: '12px 16px',
              borderRadius: 12,
              border: '1px solid #e5e7eb',
              background: '#fff',
            }}
          >
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              background: '#f1f5f9', color: '#475569',
              fontSize: 13, fontWeight: 700,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {i + 1}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{s.label}</div>
              <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.45 }}>{s.description}</div>
            </div>
            <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
              static
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function pillStyle(active: boolean): React.CSSProperties {
  return {
    padding: '6px 16px',
    borderRadius: 999,
    border: 'none',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    background: active ? '#0f172a' : 'transparent',
    color: active ? '#fff' : '#475569',
    transition: 'background 0.15s, color 0.15s',
  };
}

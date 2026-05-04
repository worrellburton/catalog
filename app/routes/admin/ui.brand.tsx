// /admin/ui/brand - typeface picker for the Catalog wordmark. Renders
// inside the /admin/ui shell which provides the page header + tab nav,
// so this view is just the variant grid + a footer reset row.

import { useEffect, useMemo, useRef } from 'react';
import { useBrandLogo } from '~/hooks/useBrandLogo';
import { BRAND_VARIANTS, ensureBrandFont, getVariant, type BrandVariant } from '~/utils/brandFonts';
import { useInViewport } from '~/hooks/useInViewport';
import CatalogLogo from '~/components/CatalogLogo';

function VariantPreview({ variant }: { variant: BrandVariant }) {
  const ref = useRef<HTMLSpanElement>(null);
  const visible = useInViewport(ref, '200% 0%');
  useEffect(() => {
    if (visible && variant.googleFontUrl) ensureBrandFont(variant.googleFontUrl);
  }, [visible, variant.googleFontUrl]);

  if (!variant.fontFamily) {
    return <CatalogLogo style={{ height: 56, fontSize: 56, color: '#fff' }} />;
  }
  return (
    <span
      ref={ref}
      style={{
        fontFamily: variant.fontFamily,
        fontWeight: variant.weight ?? 700,
        fontStyle: variant.italic ? 'italic' : 'normal',
        letterSpacing: variant.letterSpacing ?? '-0.02em',
        textTransform: variant.textTransform ?? 'none',
        color: '#fff',
        fontSize: 56,
        lineHeight: 1,
      }}
    >
      Catalog
    </span>
  );
}

const GROUP_DEFS: Array<{ label: string; ids: string[] }> = [
  { label: 'Default', ids: ['original'] },
  { label: 'Geometric sans', ids: ['inter', 'manrope', 'jakarta', 'space-grotesk', 'sora', 'outfit', 'rubik'] },
  { label: 'Bold display', ids: ['archivo-black', 'big-shoulders', 'unbounded', 'monoton', 'tilt-warp'] },
  { label: 'Serif', ids: ['playfair', 'bodoni', 'cormorant', 'cinzel', 'dm-serif', 'fraunces', 'instrument'] },
  { label: 'Mono', ids: ['plex-mono', 'jetbrains-mono'] },
  { label: 'Hand', ids: ['caveat'] },
];

const VARIANT_GROUPS: Array<{ label: string; variants: BrandVariant[] }> = GROUP_DEFS.map(g => ({
  label: g.label,
  variants: g.ids
    .map(id => BRAND_VARIANTS.find(v => v.id === id))
    .filter((v): v is BrandVariant => Boolean(v)),
}));

export default function AdminUiBrand() {
  const { variantId, setVariant, reset } = useBrandLogo();

  const active = useMemo(() => getVariant(variantId), [variantId]);
  useEffect(() => {
    if (active.googleFontUrl) ensureBrandFont(active.googleFontUrl);
  }, [active.googleFontUrl]);

  return (
    <>
      <div className="admin-ui-section-head">
        <h2>Brand wordmark</h2>
        <div className="admin-ui-active">
          <span className="admin-ui-active-label">Currently set</span>
          <span className="admin-ui-active-name">{active.label}</span>
        </div>
      </div>

      {VARIANT_GROUPS.map(group => (
        <section key={group.label} className="admin-branding-group">
          <div className="admin-branding-group-label">{group.label}</div>
          <div className="admin-branding-grid">
            {group.variants.map(v => {
              const isActive = v.id === variantId;
              return (
                <div key={v.id} className={`admin-branding-tile${isActive ? ' is-active' : ''}`}>
                  <div className="admin-branding-preview">
                    <VariantPreview variant={v} />
                  </div>
                  <div className="admin-branding-tile-meta">
                    <span className="admin-branding-tile-label">{v.label}</span>
                    <button
                      type="button"
                      className={`admin-branding-set${isActive ? ' is-active' : ''}`}
                      onClick={() => setVariant(v.id)}
                      disabled={isActive}
                    >
                      {isActive ? 'Active' : 'Set'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <div className="admin-branding-footer">
        <button
          type="button"
          className="admin-branding-reset"
          onClick={reset}
          disabled={variantId === 'original'}
        >
          Reset to original
        </button>
      </div>
    </>
  );
}

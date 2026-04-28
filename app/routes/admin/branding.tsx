// Admin → Branding. Lets an admin pick the typeface for the Catalog
// wordmark. The choice persists in localStorage (useBrandLogo) and the
// CatalogLogo component reads from it everywhere it renders — header,
// password gate, landing — so a single click here re-skins the brand
// across the app immediately.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import { useAuth } from '~/hooks/useAuth';
import { useBrandLogo } from '~/hooks/useBrandLogo';
import { BRAND_VARIANTS, ensureBrandFont, getVariant, type BrandVariant } from '~/utils/brandFonts';
import { useInViewport } from '~/hooks/useInViewport';
import CatalogLogo from '~/components/CatalogLogo';

/** Render a single variant preview WITHOUT reading from useBrandLogo —
 *  this is the catalog of choices, so each tile has to render its own
 *  variant, not whatever's currently active globally. The font for
 *  this variant only loads once the tile crosses into the viewport
 *  (rootMargin 200%), so the page doesn't fire 23 Google Fonts
 *  requests on mount. */
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

export default function AdminBranding() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { variantId, setVariant, reset } = useBrandLogo();

  // Admin gate. We don't want non-admins peeking at this surface even if
  // they guessed the URL. Redirect quietly to the home admin page.
  useEffect(() => {
    if (!user) return;
    if (user.role !== 'admin' && user.role !== 'super_admin') {
      navigate('/admin', { replace: true });
    }
  }, [user, navigate]);

  // Always preload the currently-active variant's font so the "Currently
  // set" badge in the header renders correctly without a fallback flash.
  // All other variants are lazy-loaded by VariantPreview when their tile
  // crosses into the viewport.
  const active = useMemo(() => getVariant(variantId), [variantId]);
  useEffect(() => {
    if (active.googleFontUrl) ensureBrandFont(active.googleFontUrl);
  }, [active.googleFontUrl]);

  return (
    <div className="admin-branding">
      <header className="admin-branding-header">
        <div>
          <h1>Branding</h1>
          <p className="admin-branding-sub">
            Pick a typeface for the <strong>Catalog</strong> wordmark. Applies
            everywhere it renders — header, sign-in, landing — the moment you
            tap Set.
          </p>
        </div>
        <div className="admin-branding-active">
          <div className="admin-branding-active-label">Currently set</div>
          <div className="admin-branding-active-name">{active.label}</div>
        </div>
      </header>

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
        <button type="button" className="admin-branding-reset" onClick={reset} disabled={variantId === 'original'}>
          Reset to original
        </button>
      </div>
    </div>
  );
}

// Variants grouped by visual character so the admin scans by feel, not
// alphabetically. Order roughly mirrors the brandFonts.ts comment groups.
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

// Admin → Branding. Lets an admin pick the typeface for the Catalog
// wordmark. The choice persists in localStorage (useBrandLogo) and the
// CatalogLogo component reads from it everywhere it renders — header,
// password gate, landing — so a single click here re-skins the brand
// across the app immediately.

import { useEffect, useMemo } from 'react';
import { useNavigate } from '@remix-run/react';
import { useAuth } from '~/hooks/useAuth';
import { useBrandLogo } from '~/hooks/useBrandLogo';
import { BRAND_VARIANTS, ensureBrandFont, getVariant, type BrandVariant } from '~/utils/brandFonts';
import CatalogLogo from '~/components/CatalogLogo';

/** Render a single variant preview WITHOUT reading from useBrandLogo —
 *  this is the catalog of choices, so each tile has to render its own
 *  variant, not whatever's currently active globally. */
function VariantPreview({ variant }: { variant: BrandVariant }) {
  if (!variant.fontFamily) {
    // Original SVG mark.
    return <CatalogLogo style={{ height: 56, fontSize: 56, color: '#fff' }} />;
  }
  return (
    <span
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

  // Preload every variant's font so the previews render instantly when
  // the page paints (otherwise the user sees a fallback flash before each
  // Google font lands).
  useEffect(() => {
    BRAND_VARIANTS.forEach(v => v.googleFontUrl && ensureBrandFont(v.googleFontUrl));
  }, []);

  const active = useMemo(() => getVariant(variantId), [variantId]);

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

      <div className="admin-branding-grid">
        {BRAND_VARIANTS.map(v => {
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

      <div className="admin-branding-footer">
        <button type="button" className="admin-branding-reset" onClick={reset} disabled={variantId === 'original'}>
          Reset to original
        </button>
      </div>
    </div>
  );
}

import React, { useEffect } from "react";
import { useBrandLogo } from "~/hooks/useBrandLogo";
import { ensureBrandFont, getVariant } from "~/utils/brandFonts";
import { CATALOG_LOGO_PATH, CATALOG_LOGO_VIEWBOX } from "~/constants/brand-logo";

interface CatalogLogoProps {
  className?: string;
  style?: React.CSSProperties;
}

/** Fixed-width SVG of the canonical wordmark - used when variant=='original'. */
function OriginalLogo({ className, style }: CatalogLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={CATALOG_LOGO_VIEWBOX}
      className={className}
      style={style}
    >
      <path fill="currentColor" d={CATALOG_LOGO_PATH} />
    </svg>
  );
}

/** Word-rendered variant - wraps "Catalog" in a span styled per BrandVariant. */
const CatalogLogo: React.FC<CatalogLogoProps> = ({ className, style }) => {
  const { variantId } = useBrandLogo();
  const variant = getVariant(variantId);

  // Lazy-load the variant's font on demand.
  useEffect(() => {
    if (variant.googleFontUrl) ensureBrandFont(variant.googleFontUrl);
  }, [variant.googleFontUrl]);

  if (!variant.fontFamily) {
    return <OriginalLogo className={className} style={style} />;
  }

  // The font-rendered wordmark inherits the SVG mark's height via line-height.
  // Container's height controls the visual scale (passed via className).
  const wordStyle: React.CSSProperties = {
    fontFamily: variant.fontFamily,
    fontWeight: variant.weight ?? 700,
    fontStyle: variant.italic ? 'italic' : 'normal',
    letterSpacing: variant.letterSpacing ?? '-0.02em',
    textTransform: variant.textTransform ?? 'none',
    color: 'currentColor',
    display: 'inline-flex',
    alignItems: 'center',
    lineHeight: 1,
    fontSize: '1em',
    // Scale font-size to fit the container height - callers set height via
    // className (e.g. .pw-logo { height: 56px }), and this picks up that
    // computed height through the parent.
    ...style,
  };

  return (
    <span
      className={className}
      style={wordStyle}
      data-brand-variant={variant.id}
    >
      Catalog
    </span>
  );
};

export default CatalogLogo;

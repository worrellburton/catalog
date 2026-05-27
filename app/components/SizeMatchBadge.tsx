import { useMemo } from 'react';
import type { Product } from '~/data/looks';
import { matchSize, type ShopperBody, type SizeMatchResult } from '~/services/size-match';

interface SizeMatchBadgeProps {
  product: Product;
  body: ShopperBody;
  variant?: 'inline' | 'pill';
}

export default function SizeMatchBadge({ product, body, variant = 'pill' }: SizeMatchBadgeProps) {
  const match = useMemo(() => matchSize(product, body), [product, body]);
  if (!match) return null;

  const cls = variant === 'inline' ? 'size-badge size-badge--inline' : 'size-badge';
  const confCls = `size-badge--${match.confidence}`;
  const stockCls = match.available === false ? ' size-badge--oos' : '';

  return (
    <span className={`${cls} ${confCls}${stockCls}`}>
      <span className="size-badge-size">Your size: {match.size}</span>
      {match.available === false && <span className="size-badge-oos">Out of stock</span>}
      {match.fitNote && <span className="size-badge-note">{match.fitNote}</span>}
    </span>
  );
}

export function SizeMatchSummary({ products, body }: { products: Product[]; body: ShopperBody }) {
  const matches = useMemo(() => {
    const out: Array<{ product: Product; match: SizeMatchResult }> = [];
    for (const p of products) {
      const m = matchSize(p, body);
      if (m) out.push({ product: p, match: m });
    }
    return out;
  }, [products, body]);

  if (matches.length === 0) return null;

  const allAvailable = matches.every(m => m.match.available !== false);
  const anyHigh = matches.some(m => m.match.confidence === 'high' || m.match.confidence === 'medium');

  return (
    <div className="size-match-summary">
      <svg className="size-match-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V7" />
        <path d="M16 3l-4 4-4-4" />
      </svg>
      <span className="size-match-text">
        {anyHigh && allAvailable
          ? `Good fit — ${matches.length} product${matches.length > 1 ? 's' : ''} in your size`
          : allAvailable
            ? `${matches.length} product${matches.length > 1 ? 's' : ''} sized for you`
            : `${matches.filter(m => m.match.available !== false).length} of ${matches.length} sized products available in your size`
        }
      </span>
    </div>
  );
}

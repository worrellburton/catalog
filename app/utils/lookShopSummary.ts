// Shoppability summary for a look tile — "4 products · from $58".
// Look product prices are display strings ("$58", "€1,200.00", "58"),
// so the "from" price is parsed defensively and dropped when nothing
// numeric survives.

import type { Look } from '~/data/looks';

function parsePrice(price: string | undefined | null): { value: number; symbol: string } | null {
  if (!price) return null;
  const numeric = price.replace(/[^\d.,]/g, '').replace(/,/g, '');
  const value = parseFloat(numeric);
  if (!Number.isFinite(value) || value <= 0) return null;
  const symbol = price.match(/[$€£¥]/)?.[0] ?? '$';
  return { value, symbol };
}

/** One line for the look-card pill, or null when the look has no products. */
export function lookProductsSummary(look: Look): string | null {
  const products = look.products ?? [];
  if (products.length === 0) return null;
  const count = `${products.length} ${products.length === 1 ? 'product' : 'products'}`;

  let min: { value: number; symbol: string } | null = null;
  for (const p of products) {
    const parsed = parsePrice(p.price);
    if (parsed && (!min || parsed.value < min.value)) min = parsed;
  }
  if (!min) return count;
  const amount = Number.isInteger(min.value) ? String(min.value) : min.value.toFixed(2);
  return `${count} · from ${min.symbol}${amount}`;
}

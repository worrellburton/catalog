import { useEffect, useState } from 'react';

// Accounting-formatted dollar input: shows thousands separators at rest
// (e.g. 100,000), shows the raw text while editing, and understands
// shorthand — "10M" → 10,000,000, "10.5m" → 10,500,000, "250k", "1.2B".
// Shared by OpEx and Equity.

/** "$10.5M" / "250k" / "1,000,000" → a number, or null while the text
 *  isn't a complete amount yet (e.g. "10." mid-typing). */
function parseAmount(raw: string): number | null {
  const m = raw.trim().replace(/[$,\s]/g, '').match(/^([0-9]*\.?[0-9]+)\s*([kmb])?$/i);
  if (!m) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] ?? '').toLowerCase() as 'k' | 'm' | 'b'] ?? 1;
  return Number(m[1]) * mult;
}

export default function AcctInput({ value, onChange, className }: {
  value: number;
  onChange: (n: number) => void;
  className?: string;
}) {
  const [local, setLocal] = useState(() => value.toLocaleString('en-US'));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setLocal(value.toLocaleString('en-US')); }, [value, focused]);
  return (
    <input
      className={className}
      type="text"
      inputMode="decimal"
      value={local}
      onFocus={() => { setFocused(true); setLocal(value ? String(value) : ''); }}
      onBlur={() => { setFocused(false); setLocal(value.toLocaleString('en-US')); }}
      onChange={(e) => {
        setLocal(e.target.value);
        const n = parseAmount(e.target.value);
        // Bounded — a runaway paste can't push the shared model into
        // magnitudes the math (and the layout) can't survive.
        if (n != null) onChange(Math.min(n, 1e15));
      }}
    />
  );
}

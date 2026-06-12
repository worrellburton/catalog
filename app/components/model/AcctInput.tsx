import { useEffect, useState } from 'react';

// Accounting-formatted dollar input: shows thousands separators at rest
// (e.g. 100,000), shows the raw number while editing, and parses digits.
// Shared by OpEx and Equity.
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
      inputMode="numeric"
      value={local}
      onFocus={() => { setFocused(true); setLocal(value ? String(value) : ''); }}
      onBlur={() => { setFocused(false); setLocal(value.toLocaleString('en-US')); }}
      onChange={(e) => {
        setLocal(e.target.value);
        const n = Number(e.target.value.replace(/[^0-9.]/g, ''));
        // Bounded — a runaway paste can't push the shared model into
        // magnitudes the math (and the layout) can't survive.
        if (!Number.isNaN(n)) onChange(Math.min(n, 1e15));
      }}
    />
  );
}

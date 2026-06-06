import { useEffect, useState } from 'react';

// Shared input card for the financial-model pages (Projections +
// Go to Market). Lives under components/model so both tabs draw the
// exact same control — one source of truth for parse/format/step
// behaviour. `key` is a plain string so each page can type it against
// its own assumptions shape.

export type FieldFormat = 'currency' | 'percent' | 'number' | 'integer';

export interface FieldDef {
  key: string;
  label: string;
  hint: string;
  format: FieldFormat;
  step: number;
  min?: number;
  max?: number;
  /** Optional industry benchmark, shown under the hint for defensibility. */
  benchmark?: string;
}

export function formatForInput(value: number, format: FieldFormat): string {
  if (format === 'percent') return (value * 100).toFixed(2);
  if (format === 'integer') return String(Math.round(value));
  // Currency carries thousands separators (250,000) so big budgets stay
  // readable. parseInputToNumber strips the commas back out on input.
  if (format === 'currency') return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return String(value);
}

export function parseInputToNumber(raw: string, format: FieldFormat): number | null {
  const cleaned = raw.replace(/,/g, '').trim();
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  if (Number.isNaN(n)) return null;
  if (format === 'percent') return n / 100;
  return n;
}

export default function AssumptionCard({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: number;
  onChange: (next: number) => void;
}) {
  const [local, setLocal] = useState<string>(() => formatForInput(value, field.format));
  // Keep local state in sync if external value changes (e.g. reset to defaults).
  useEffect(() => {
    setLocal(formatForInput(value, field.format));
  }, [value, field.format]);

  return (
    <label className="proj-card">
      <span className="proj-card-label">{field.label}</span>
      <span className="proj-card-input-wrap">
        {field.format === 'currency' && <span className="proj-card-prefix">$</span>}
        <input
          // Currency uses a text input so the comma-formatted value
          // (e.g. "250,000") renders — a number input would reject it.
          type={field.format === 'currency' ? 'text' : 'number'}
          inputMode={field.format === 'currency' ? 'numeric' : undefined}
          className="proj-card-input"
          value={local}
          step={field.format === 'currency' ? undefined : field.step}
          min={field.format === 'currency' ? undefined : field.min}
          max={field.format === 'currency' ? undefined : field.max}
          onChange={(e) => {
            setLocal(e.target.value);
            const n = parseInputToNumber(e.target.value, field.format);
            if (n !== null) onChange(n);
          }}
          onBlur={() => setLocal(formatForInput(value, field.format))}
        />
        {field.format === 'percent' && <span className="proj-card-suffix">%</span>}
      </span>
      <span className="proj-card-hint">{field.hint}</span>
      {field.benchmark && <span className="proj-card-bench">≈ {field.benchmark}</span>}
    </label>
  );
}

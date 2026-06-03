// imports
import { useEffect } from 'react';
import type { SimilarProductDiagnostics } from '~/services/product-creative';

// types/interfaces
export type DebugTone = 'good' | 'bad' | 'muted' | 'accent';

export interface DebugBadge {
  label: string;
  value: string;
  tone?: DebugTone;
}

export interface DebugSection {
  heading: string;
  lines: string[];
}

export interface DebugColumn {
  key: string;
  label: string;
  align?: 'left' | 'right';
}

export interface DebugCell {
  text: string;
  tone?: DebugTone;
}

export interface DebugRow {
  id: string;
  included: boolean;
  cells: Record<string, DebugCell>;
}

/** A surface-agnostic "why am I seeing this?" report. Surfaces build one of
 *  these and hand it to the modal; the modal stays purely presentational. */
export interface SimilarDebugReport {
  title: string;
  subtitle?: string;
  badges: DebugBadge[];
  sections: DebugSection[];
  columns: DebugColumn[];
  rows: DebugRow[];
  footnote?: string;
}

interface SimilarDebugModalProps {
  report: SimilarDebugReport | null;
  loading?: boolean;
  onClose: () => void;
}

// helpers
function fmtDist(d: number): string {
  return Number.isFinite(d) ? d.toFixed(4) : '∞';
}

/** Translate the raw embedding diagnostics into the display report. Lives here
 *  so both the math (service) and the copy (here) sit next to the thing that
 *  renders them. */
export function buildProductSimilarReport(
  diag: SimilarProductDiagnostics,
  ctx: { seedName?: string | null; seedBrand?: string | null; ownBrand: string },
): SimilarDebugReport {
  const dialPretty = diag.threshold === 0
    ? '0 → no band (show all K nearest)'
    : `${diag.threshold} → keep ≤ ${(1 / diag.dialFrac).toFixed(2)}× nearest`;
  const anchor = diag.anchorDistance != null ? fmtDist(diag.anchorDistance) : '—';
  const cutoff = diag.widened && diag.widenedMax != null ? diag.widenedMax : diag.strictMax;

  const badges: DebugBadge[] = [
    { label: 'dial', value: String(diag.threshold), tone: 'accent' },
    { label: 'fetched', value: `${diag.rawCount}/${diag.fetchK}` },
    { label: 'gender-pass', value: `${diag.genderPassCount}` },
    { label: 'anchor dist', value: anchor },
    { label: 'cutoff', value: fmtDist(cutoff), tone: diag.widened ? 'bad' : 'good' },
    { label: 'shown', value: `${diag.chosenCount}`, tone: 'good' },
  ];

  const sections: DebugSection[] = [
    {
      heading: 'How it’s fetched',
      lines: [
        'Source: find_similar_products RPC (migration 020) — pgvector cosine over public.products.',
        `The seed product’s 384-dim gte-small text embedding (name + brand + type + description) is matched with the \`<=>\` distance operator.`,
        'Hard server filters: same category (type) only · is_active = true · primary_video_url present · seed itself excluded.',
        `Over-fetched ${diag.fetchK} rows (5× the ${diag.requestedK} rail size) to absorb the gender + band filtering below.`,
      ],
    },
    {
      heading: 'The logic (gates, in order)',
      lines: [
        `1. Gender gate — shopper = "${diag.shopperGender}". ${diag.genderPassCount}/${diag.rawCount} rows survive. Applied first so the band anchors on a row the shopper can actually see.`,
        `2. Relative band — dial ${dialPretty}. Cutoff scales off the nearest gender-passing match (${anchor}), so it auto-adapts to how tightly the category clusters.`,
        `3. Sparse widen — if the strict band holds < ${diag.minSimilar} items, widen to 3× the anchor so single-brand categories don’t collapse to same-brand tiles (true outliers stay past 3×).`,
      ],
    },
    {
      heading: 'How it calculated this rail',
      lines: [
        `strictMax = anchor ÷ (dial/100) = ${anchor} ÷ ${diag.dialFrac || 0} = ${fmtDist(diag.strictMax)}`,
        diag.widened
          ? `Strict band was sparse → widened to max(strictMax, anchor × 3) = ${fmtDist(diag.widenedMax ?? Infinity)}.`
          : 'Strict band had enough matches → no widening.',
        `Result: ${diag.chosenCount} product(s) returned to the rail (before the page’s cross-brand-first reorder).`,
      ],
    },
  ];

  const columns: DebugColumn[] = [
    { key: 'rank', label: '#' },
    { key: 'name', label: 'Product' },
    { key: 'brand', label: 'Brand' },
    { key: 'dist', label: 'Dist', align: 'right' },
    { key: 'gender', label: 'Gender' },
    { key: 'verdict', label: 'Verdict' },
  ];

  const ownBrand = ctx.ownBrand.trim().toLowerCase();
  const rows: DebugRow[] = diag.candidates.map(c => {
    const sameBrand = !!c.brand && c.brand.trim().toLowerCase() === ownBrand;
    let verdict: DebugCell;
    if (c.chosen) {
      verdict = { text: sameBrand ? 'shown · same-brand' : 'shown · cross-brand', tone: 'good' };
    } else if (!c.passesGender) {
      verdict = { text: 'cut · gender', tone: 'bad' };
    } else if (!c.withinStrict && !diag.widened) {
      verdict = { text: 'cut · outside band', tone: 'muted' };
    } else {
      verdict = { text: 'cut · past cutoff', tone: 'muted' };
    }
    return {
      id: c.id,
      included: c.chosen,
      cells: {
        rank: { text: String(c.rank), tone: 'muted' },
        name: { text: c.name || '—' },
        brand: { text: c.brand || '—', tone: sameBrand ? 'accent' : undefined },
        dist: { text: fmtDist(c.distance), tone: 'muted' },
        gender: { text: c.gender || '∅', tone: c.passesGender ? undefined : 'bad' },
        verdict,
      },
    };
  });

  return {
    title: 'Similar — product embedding',
    subtitle: ctx.seedName
      ? `Seed: ${ctx.seedName}${ctx.seedBrand ? ` · ${ctx.seedBrand}` : ''}`
      : `Seed product ${diag.seedProductId.slice(0, 8)}…`,
    badges,
    sections,
    columns,
    rows,
    footnote: 'The page then drops the seed/dupes, requires a primary video, and reorders cross-brand first with same-brand backfill before painting the rail.',
  };
}

// main component
export default function SimilarDebugModal({ report, loading, onClose }: SimilarDebugModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="simdbg-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="simdbg-card" onClick={e => e.stopPropagation()}>
        <header className="simdbg-head">
          <div>
            <h2 className="simdbg-title">{report ? report.title : 'Similar — debug'}</h2>
            {report?.subtitle && <p className="simdbg-sub">{report.subtitle}</p>}
          </div>
          <button className="simdbg-close" onClick={onClose} aria-label="Close">×</button>
        </header>

        {loading && <div className="simdbg-loading">Computing…</div>}

        {!loading && report && (
          <div className="simdbg-body">
            <div className="simdbg-badges">
              {report.badges.map((b, i) => (
                <span key={i} className={`simdbg-badge tone-${b.tone || 'plain'}`}>
                  <span className="simdbg-badge-k">{b.label}</span>
                  <span className="simdbg-badge-v">{b.value}</span>
                </span>
              ))}
            </div>

            {report.sections.map((s, i) => (
              <section key={i} className="simdbg-section">
                <h3 className="simdbg-section-h">{s.heading}</h3>
                <ul className="simdbg-lines">
                  {s.lines.map((l, j) => <li key={j}>{l}</li>)}
                </ul>
              </section>
            ))}

            {report.rows.length > 0 && (
              <div className="simdbg-tablewrap">
                <table className="simdbg-table">
                  <thead>
                    <tr>
                      {report.columns.map(c => (
                        <th key={c.key} className={c.align === 'right' ? 'ta-r' : undefined}>{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map(r => (
                      <tr key={r.id} className={r.included ? 'is-in' : 'is-out'}>
                        {report.columns.map(c => {
                          const cell = r.cells[c.key];
                          return (
                            <td key={c.key} className={`${c.align === 'right' ? 'ta-r ' : ''}tone-${cell?.tone || 'plain'}`}>
                              {cell?.text ?? ''}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {report.footnote && <p className="simdbg-foot">{report.footnote}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

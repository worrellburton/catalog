// imports
import { useEffect } from 'react';
import type { SimilarProductDiagnostics } from '~/services/product-creative';
import type { FeedSearchDiagnostics } from '~/services/feed-search';
import type { GraphPair } from '~/services/graph-pairs';
import { AFFINITY_MIN_SIGNAL, MAX_PROMOTION, type UserAffinity } from '~/services/user-affinity';

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

/** Translate the feed-search lane diagnostics into the display report. Powers
 *  the admin → catalogs "why this feed?" popup. */
export function buildFeedSearchReport(
  diag: FeedSearchDiagnostics,
  catalogName: string,
): SimilarDebugReport {
  const winLabel = diag.winningLane === 'none'
    ? 'none — no lane matched'
    : diag.lanes.find(l => l.id === diag.winningLane)?.label || diag.winningLane;

  const badges: DebugBadge[] = [
    { label: 'lane', value: diag.winningLane, tone: 'accent' },
    { label: 'lane hits', value: String(diag.rawCount) },
    { label: 'deduped out', value: String(diag.dedupedOut), tone: diag.dedupedOut > 0 ? 'bad' : 'muted' },
    { label: 'shown', value: String(diag.finalCount), tone: 'good' },
  ];

  const laneLines = diag.lanes.map(l => {
    if (!l.attempted) return `${l.label} — not reached (an earlier lane already matched).`;
    if (l.error) return `${l.label} — errored: ${l.error}.`;
    if (l.won) return `${l.label} — ✓ MATCHED with ${l.rawCount} hit(s). Pipeline stops here.`;
    return `${l.label} — 0 hits, fell through.`;
  });

  const sections: DebugSection[] = [
    {
      heading: 'How it’s fetched',
      lines: [
        `Source: getFeedSearchResults("${catalogName}") — the exact pipeline the consumer feed runs when a shopper types this catalog name in the search bar.`,
        'Three lanes are tried in order; the FIRST lane that returns anything wins outright (no blending):',
        '1. Brand fast-path — exact brand-name match → only that brand’s creatives.',
        '2. Tier-1 catalog_tags / product.type — products tagged with this catalog name.',
        '3. Semantic search — vector search via the search edge function, hydrating placeholder rows with real creatives.',
      ],
    },
    {
      heading: `The logic — winning lane: ${diag.winningLane}`,
      lines: laneLines,
    },
    {
      heading: 'How it calculated this feed',
      lines: [
        diag.winningLane === 'none'
          ? 'No lane returned results — the feed is empty for this catalog name.'
          : `Lane "${diag.winningLane}" returned ${diag.rawCount} hit(s) → ${diag.dedupedOut} dropped as duplicate id/product_id → ${diag.finalCount} shown.`,
        'Dedup rule: no repeated creative id, and no two creatives of the same product_id.',
        `Only creatives with a playable video are kept (image-only rows are filtered, matching the consumer feed).`,
      ],
    },
  ];

  const columns: DebugColumn[] = [
    { key: 'rank', label: '#' },
    { key: 'name', label: 'Product' },
    { key: 'brand', label: 'Brand' },
    { key: 'pid', label: 'product_id' },
  ];

  const rows: DebugRow[] = diag.items.map((it, i) => ({
    id: `${it.id}-${i}`,
    included: true,
    cells: {
      rank: { text: String(i + 1), tone: 'muted' },
      name: { text: it.name || '—' },
      brand: { text: it.brand || '—' },
      pid: { text: it.productId ? `${it.productId.slice(0, 8)}…` : '—', tone: 'muted' },
    },
  }));

  return {
    title: `Feed results — “${catalogName}”`,
    subtitle: `Resolved via ${winLabel}`,
    badges,
    sections,
    columns,
    rows,
    footnote: 'Feed-search products without catalog_tags are merged into this catalog’s Products section so they still surface. The MIX column on the catalogs table is a separate stat: the % male / female / unisex split of this catalog’s tagged products.',
  };
}

/** How each edge type was derived — used to explain the "Pairs well with" rail. */
const EDGE_LABEL: Record<string, string> = {
  pairs_with: 'co-appears in looks',
  same_brand: 'same brand',
  same_type: 'same category',
  same_outfit: 'same outfit',
  same_aesthetic: 'same aesthetic',
  same_occasion: 'same occasion',
};

/** Translate the entity_edges graph pairs into the display report. Powers the
 *  "Pairs well with" rail's "why these?" popup. Unlike the embedding report,
 *  this needs no extra fetch — the rail already carries the edge metadata that
 *  explains each tile, so we build the report straight from the rendered rows. */
export function buildGraphPairsReport(
  pairs: GraphPair[],
  ctx: { seedName?: string | null; seedBrand?: string | null; shownCount: number },
): SimilarDebugReport {
  const shown = Math.min(ctx.shownCount, pairs.length);
  const edgeCounts = pairs.reduce<Record<string, number>>((acc, p) => {
    acc[p.edge_type] = (acc[p.edge_type] || 0) + 1;
    return acc;
  }, {});
  const edgeSummary = Object.entries(edgeCounts)
    .map(([t, n]) => `${n}× ${EDGE_LABEL[t] || t}`)
    .join(' · ') || 'none';

  const badges: DebugBadge[] = [
    { label: 'connected', value: String(pairs.length), tone: 'accent' },
    { label: 'shown', value: String(shown), tone: 'good' },
    ...Object.entries(edgeCounts).map(([t, n]): DebugBadge => ({
      label: EDGE_LABEL[t] || t,
      value: String(n),
      tone: t === 'pairs_with' ? 'good' : 'muted',
    })),
  ];

  const sections: DebugSection[] = [
    {
      heading: 'How it’s fetched',
      lines: [
        'Source: get_graph_pairs RPC (migration 20260515) — a lookup over the entity_edges knowledge graph, NOT an embedding search.',
        'Returns active products that share an explicit relationship edge with this product, deduped and sorted by edge weight (strongest connection first).',
        'Edge types traversed: pairs_with (products that co-appear in the same look) and same_brand. Same category (same_type) edges are not requested for this rail.',
      ],
    },
    {
      heading: 'The logic (why each tile is here)',
      lines: [
        '• pairs_with — the two products were worn together in one or more looks. Weight is the normalised look co-occurrence (0–1): the more looks they share, the higher it ranks.',
        '• same_brand — fixed weight 0.5. A fallback connection so the rail still fills when a product has few or no look co-occurrences.',
        `This rail’s mix: ${edgeSummary}.`,
      ],
    },
    {
      heading: 'How it calculated this rail',
      lines: [
        `${pairs.length} connected product(s) returned by the graph, sorted by edge weight desc.`,
        `The rail paints the top ${ctx.shownCount}; any beyond that are listed below as “cut · over rail cap”.`,
      ],
    },
  ];

  const columns: DebugColumn[] = [
    { key: 'rank', label: '#' },
    { key: 'name', label: 'Product' },
    { key: 'brand', label: 'Brand' },
    { key: 'edge', label: 'Connection' },
    { key: 'weight', label: 'Weight', align: 'right' },
    { key: 'verdict', label: 'Verdict' },
  ];

  const rows: DebugRow[] = pairs.map((p, i) => {
    const inRail = i < ctx.shownCount;
    return {
      id: p.product_id,
      included: inRail,
      cells: {
        rank: { text: String(i + 1), tone: 'muted' },
        name: { text: p.name || '—' },
        brand: { text: p.brand || '—' },
        edge: {
          text: EDGE_LABEL[p.edge_type] || p.edge_type,
          tone: p.edge_type === 'pairs_with' ? 'good' : 'muted',
        },
        weight: { text: p.edge_weight.toFixed(3), tone: 'muted' },
        verdict: inRail
          ? { text: 'shown', tone: 'good' }
          : { text: 'cut · over rail cap', tone: 'muted' },
      },
    };
  });

  return {
    title: 'Pairs well with — knowledge graph',
    subtitle: ctx.seedName
      ? `Seed: ${ctx.seedName}${ctx.seedBrand ? ` · ${ctx.seedBrand}` : ''}`
      : 'Seed product',
    badges,
    sections,
    columns,
    rows,
    footnote: 'pairs_with edges come from the offline look co-occurrence builder (build_entity_edges_from_looks); same_brand edges are derived directly from the products table. Both live in entity_edges.',
  };
}

/** Explains the personalized "You might also like" feed: the per-shopper
 *  category affinity (from taps + searches), whether it's strong enough to
 *  re-rank the feed, and how the joke-y heading is chosen. No fetch needed —
 *  the affinity is already computed client-side, so the report is built
 *  synchronously from the live signal. Super-admin only. */
export function buildAffinityReport(
  affinity: UserAffinity,
  ctx: {
    heading: string;
    recentProductCount: number;
    recentSearchCount: number;
  },
): SimilarDebugReport {
  const active = affinity.total >= AFFINITY_MIN_SIGNAL;
  const maxWeight = affinity.entries[0]?.weight ?? 0;
  const climbFor = (w: number) => (maxWeight > 0 ? (w / maxWeight) * MAX_PROMOTION : 0);

  const badges: DebugBadge[] = [
    { label: 'signal', value: affinity.total.toFixed(2), tone: 'accent' },
    { label: 'threshold', value: AFFINITY_MIN_SIGNAL.toFixed(1) },
    { label: 're-rank', value: active ? 'ACTIVE' : 'dormant', tone: active ? 'good' : 'muted' },
    { label: 'dominant', value: affinity.dominant ?? '—', tone: affinity.dominant ? 'good' : 'muted' },
    { label: 'categories', value: String(affinity.entries.length) },
    { label: 'max climb', value: `${MAX_PROMOTION} pos` },
  ];

  const sections: DebugSection[] = [
    {
      heading: 'What this is',
      lines: [
        'The "You might also like" feed is the home continuous feed, personalized to this shopper. Two things are tuned: the order of the tiles (soft re-rank) and the section heading (a joke-y, per-view name).',
        'Everything here is derived ON-DEVICE from localStorage — no server profile, no PII. Anonymous shoppers build a signal too.',
      ],
    },
    {
      heading: 'Signal sources (newest-first, recency-decayed)',
      lines: [
        `Tapped products: ${ctx.recentProductCount} in catalog.recentProducts → grouped by products.type. Most-recent tap weighted 1.0, decaying ×0.95 per step back.`,
        `Searches: ${ctx.recentSearchCount} in catalog.recentSearches → mapped to canonical types via resolveCatalogTypes (same table the search bar uses), counted at 0.5× a tap.`,
        affinity.entries.length === 0
          ? 'No categorized signal yet → affinity is cold.'
          : `Resulting lean: ${affinity.entries.map(e => `${e.type} ${e.weight.toFixed(2)}`).join(' · ')}.`,
      ],
    },
    {
      heading: 'The logic',
      lines: [
        `1. Gate — total signal ${affinity.total.toFixed(2)} ${active ? '≥' : '<'} ${AFFINITY_MIN_SIGNAL} → re-rank ${active ? 'APPLIES' : 'is skipped (feed stays in natural order)'}.`,
        `2. Soft re-rank — each tile climbs by (its category weight ÷ strongest weight) × ${MAX_PROMOTION}, capped at ${MAX_PROMOTION} positions. Stable sort preserves original order for ties, so variety is kept (never an all-one-category wall).`,
        '3. Heading — cold → "You might also like". Warm → an instant local joke-y line, upgraded to a Claude (Haiku) line from the dynamic-feed-name edge function, cached per dominant category per session.',
      ],
    },
    {
      heading: 'Heading shown now',
      lines: [
        `"${ctx.heading}"`,
        affinity.dominant
          ? `Built around dominant category "${affinity.dominant}".`
          : 'Neutral default — not enough signal to theme it yet.',
      ],
    },
  ];

  const columns: DebugColumn[] = [
    { key: 'rank', label: '#' },
    { key: 'cat', label: 'Category' },
    { key: 'weight', label: 'Weight', align: 'right' },
    { key: 'share', label: 'Share', align: 'right' },
    { key: 'climb', label: 'Climb', align: 'right' },
    { key: 'verdict', label: 'Effect' },
  ];

  const rows: DebugRow[] = affinity.entries.map((e, i) => ({
    id: e.type,
    included: active,
    cells: {
      rank: { text: String(i + 1), tone: 'muted' },
      cat: { text: e.type, tone: e.type === affinity.dominant ? 'accent' : undefined },
      weight: { text: e.weight.toFixed(2), tone: 'muted' },
      share: { text: `${((e.weight / (affinity.total || 1)) * 100).toFixed(0)}%`, tone: 'muted' },
      climb: { text: `+${climbFor(e.weight).toFixed(1)}`, tone: 'muted' },
      verdict: active
        ? { text: `boosts ${e.type} tiles`, tone: 'good' }
        : { text: 'dormant · below threshold', tone: 'muted' },
    },
  }));

  return {
    title: 'You might also like — personalization',
    subtitle: affinity.dominant
      ? `Leaning toward: ${affinity.topTypes.slice(0, 3).join(' · ')}`
      : 'Cold start — no behavioural signal yet',
    badges,
    sections,
    columns,
    rows,
    footnote: 'Signal lives in localStorage (catalog.recentProducts / catalog.recentSearches) on this device only. Clearing site data resets it. The Claude heading is fetched once per category per session; the local line is used instantly and as the fallback.',
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

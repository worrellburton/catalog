import { useState, useEffect, useCallback } from 'react';
import { supabase } from '~/utils/supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CanonicalRow {
  type: string;
  active_count: number;
  total_count: number;
}

interface TaxonomyRow {
  type: string;
  category: string | null;
  synonyms: string[] | null;
  keywords: string | null;
  generated_at: string | null;
}

interface MergedRow extends CanonicalRow {
  category: string | null;
  synonyms: string[] | null;
  keywords: string | null;
  generated_at: string | null;
}

const CATEGORIES = ['fashion', 'beauty', 'home', 'tech', 'lifestyle', 'other'] as const;
type Category = typeof CATEGORIES[number];

const CATEGORY_LABELS: Record<string, string> = {
  fashion:   'Fashion',
  beauty:    'Beauty',
  home:      'Home & Living',
  tech:      'Tech & Gadgets',
  lifestyle: 'Lifestyle',
  other:     'Other',
};

const CATEGORY_COLORS: Record<string, string> = {
  fashion:   '#8b5cf6',
  beauty:    '#ec4899',
  home:      '#f59e0b',
  tech:      '#3b82f6',
  lifestyle: '#10b981',
  other:     '#6b7280',
};

const DEFAULT_VISIBLE = 8;

// ── Component ─────────────────────────────────────────────────────────────────

export default function AdminCategories() {
  const [rows, setRows] = useState<MergedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatingFor, setGeneratingFor] = useState<Set<string>>(new Set());
  const [generatingAll, setGeneratingAll] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [newType, setNewType] = useState('');
  const [newCategory, setNewCategory] = useState<Category>('other');
  const [addingNew, setAddingNew] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [canonicalRes, taxonomyRes] = await Promise.all([
      supabase.from('product_types_canonical').select('type, active_count, total_count'),
      supabase.from('product_taxonomy').select('type, category, synonyms, keywords, generated_at'),
    ]);

    const canonical = (canonicalRes.data ?? []) as CanonicalRow[];
    const taxonomy  = (taxonomyRes.data ?? []) as TaxonomyRow[];
    const taxMap    = new Map(taxonomy.map(r => [r.type, r]));

    const merged: MergedRow[] = canonical.map(c => {
      const t = taxMap.get(c.type);
      return {
        ...c,
        category:     t?.category ?? null,
        synonyms:     t?.synonyms ?? null,
        keywords:     t?.keywords ?? null,
        generated_at: t?.generated_at ?? null,
      };
    });

    // Add taxonomy rows that aren't in canonical (manually added types)
    taxonomy.forEach(t => {
      if (!merged.find(m => m.type === t.type)) {
        merged.push({ type: t.type, active_count: 0, total_count: 0, ...t });
      }
    });

    merged.sort((a, b) => b.active_count - a.active_count);
    setRows(merged);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const generateForType = useCallback(async (type: string, category: string | null) => {
    setGeneratingFor(prev => new Set([...prev, type]));
    try {
      const { data, error } = await supabase.functions.invoke('taxonomy-gen', {
        body: { type, category },
      });
      if (error) throw error;
      const result = data as { ok: boolean; synonyms?: string[]; keywords?: string };
      if (!result.ok) throw new Error('generation failed');
      setRows(prev => prev.map(r =>
        r.type === type
          ? { ...r, synonyms: result.synonyms ?? r.synonyms, keywords: result.keywords ?? r.keywords, generated_at: new Date().toISOString() }
          : r,
      ));
      showToast(`✓ Generated synonyms for ${type}`);
    } catch (err) {
      showToast(`✗ Failed to generate for ${type}: ${String(err)}`);
    } finally {
      setGeneratingFor(prev => { const s = new Set(prev); s.delete(type); return s; });
    }
  }, [showToast]);

  const generateAllMissing = useCallback(async () => {
    const missing = rows.filter(r => !r.synonyms || r.synonyms.length === 0);
    if (missing.length === 0) { showToast('All types already have synonyms'); return; }
    setGeneratingAll(true);
    for (const row of missing) {
      if (generatingFor.size > 0) continue; // avoid race if individual gen is running
      await generateForType(row.type, row.category);
    }
    setGeneratingAll(false);
    showToast(`✓ Generated synonyms for ${missing.length} types`);
  }, [rows, generatingFor, generateForType, showToast]);

  const addAndGenerate = useCallback(async () => {
    if (!newType.trim()) return;
    setAddingNew(true);
    // Upsert to taxonomy table first
    await supabase.from('product_taxonomy').upsert(
      { type: newType.trim(), category: newCategory, updated_at: new Date().toISOString() },
      { onConflict: 'type' },
    );
    // Reload to get the canonical count (may be 0 if it's brand new)
    await load();
    // Then generate
    await generateForType(newType.trim(), newCategory);
    setNewType('');
    setAddingNew(false);
  }, [newType, newCategory, load, generateForType]);

  const toggleGroup = useCallback((cat: string) => {
    setExpandedGroups(prev => {
      const s = new Set(prev);
      if (s.has(cat)) s.delete(cat); else s.add(cat);
      return s;
    });
  }, []);

  // Group rows by category
  const grouped = CATEGORIES.reduce<Record<string, MergedRow[]>>((acc, cat) => {
    acc[cat] = rows.filter(r => r.category === cat);
    return acc;
  }, {} as Record<string, MergedRow[]>);
  // Uncategorised (null category)
  const uncategorised = rows.filter(r => !r.category || !CATEGORIES.includes(r.category as Category));

  const missingCount = rows.filter(r => !r.synonyms || r.synonyms.length === 0).length;
  const totalCount   = rows.length;
  const coveredCount = totalCount - missingCount;

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1>Product Taxonomy</h1>
          <p className="admin-page-subtitle">
            Synonym registry for search query expansion — teaches the AI which user terms map to canonical types.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button
            className="admin-btn admin-btn-secondary"
            onClick={load}
            disabled={loading}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button
            className="admin-btn admin-btn-primary"
            onClick={generateAllMissing}
            disabled={generatingAll || loading || missingCount === 0}
          >
            {generatingAll ? `Generating…` : `Generate Missing (${missingCount})`}
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {[
          { label: 'Total Types', value: totalCount },
          { label: 'With Synonyms', value: coveredCount },
          { label: 'Missing Synonyms', value: missingCount },
        ].map(s => (
          <div key={s.label} className="admin-stat-card" style={{ minWidth: 140 }}>
            <div className="admin-stat-value">{s.value}</div>
            <div className="admin-stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Add new type */}
      <div className="admin-section" style={{ marginBottom: '1.5rem' }}>
        <div className="admin-section-header">
          <h2>Add New Type</h2>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label className="admin-label">Type name</label>
            <input
              className="admin-input"
              placeholder="e.g. Loungewear"
              value={newType}
              onChange={e => setNewType(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && newType.trim()) addAndGenerate(); }}
            />
          </div>
          <div>
            <label className="admin-label">Category</label>
            <select
              className="admin-input"
              value={newCategory}
              onChange={e => setNewCategory(e.target.value as Category)}
            >
              {CATEGORIES.map(c => (
                <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
              ))}
            </select>
          </div>
          <button
            className="admin-btn admin-btn-primary"
            onClick={addAndGenerate}
            disabled={!newType.trim() || addingNew}
          >
            {addingNew ? 'Adding…' : '+ Add & Generate'}
          </button>
        </div>
      </div>

      {/* Taxonomy groups */}
      {loading ? (
        <div className="admin-empty">Loading taxonomy…</div>
      ) : (
        <>
          {[...CATEGORIES, '_uncategorised' as const].map(cat => {
            const groupRows = cat === '_uncategorised' ? uncategorised : (grouped[cat] ?? []);
            if (groupRows.length === 0) return null;
            const isExpanded = expandedGroups.has(cat);
            const visible    = isExpanded ? groupRows : groupRows.slice(0, DEFAULT_VISIBLE);
            const color      = cat === '_uncategorised' ? '#9ca3af' : CATEGORY_COLORS[cat];
            const label      = cat === '_uncategorised' ? 'Uncategorised' : CATEGORY_LABELS[cat];
            return (
              <TaxonomyGroup
                key={cat}
                category={cat}
                label={label}
                color={color}
                rows={visible}
                totalCount={groupRows.length}
                isExpanded={isExpanded}
                onToggle={() => toggleGroup(cat)}
                generatingFor={generatingFor}
                onGenerate={generateForType}
              />
            );
          })}
        </>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: '1.5rem', right: '1.5rem',
          background: '#1e293b', color: '#f1f5f9', padding: '0.75rem 1.25rem',
          borderRadius: '0.5rem', boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          fontSize: '0.875rem', zIndex: 9999,
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface TaxonomyGroupProps {
  category: string;
  label: string;
  color: string;
  rows: MergedRow[];
  totalCount: number;
  isExpanded: boolean;
  onToggle: () => void;
  generatingFor: Set<string>;
  onGenerate: (type: string, category: string | null) => void;
}

function TaxonomyGroup({
  category, label, color, rows, totalCount, isExpanded, onToggle,
  generatingFor, onGenerate,
}: TaxonomyGroupProps) {
  return (
    <div className="admin-section" style={{ marginBottom: '1rem' }}>
      <div
        className="admin-section-header"
        style={{ cursor: 'pointer', userSelect: 'none' }}
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onToggle(); }}
        aria-expanded={isExpanded}
      >
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span
            style={{
              display: 'inline-block', width: 10, height: 10,
              borderRadius: '50%', background: color, flexShrink: 0,
            }}
          />
          {label}
          <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 400 }}>
            {totalCount} type{totalCount !== 1 ? 's' : ''}
          </span>
        </h2>
        <span style={{ fontSize: '1rem', color: '#64748b' }}>{isExpanded ? '▲' : '▼'}</span>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Active</th>
              <th>Synonyms</th>
              <th>Keywords</th>
              <th>Last Generated</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <TaxonomyRow
                key={r.type}
                row={r}
                category={category}
                generating={generatingFor.has(r.type)}
                onGenerate={onGenerate}
              />
            ))}
          </tbody>
        </table>
      </div>

      {totalCount > DEFAULT_VISIBLE && (
        <button
          className="admin-btn admin-btn-ghost"
          onClick={onToggle}
          style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}
        >
          {isExpanded
            ? `Show fewer`
            : `Show all ${totalCount} types ▼`}
        </button>
      )}
    </div>
  );
}

interface TaxonomyRowProps {
  row: MergedRow;
  category: string;
  generating: boolean;
  onGenerate: (type: string, category: string | null) => void;
}

function TaxonomyRow({ row, category, generating, onGenerate }: TaxonomyRowProps) {
  const hasSynonyms = row.synonyms && row.synonyms.length > 0;
  const genDate = row.generated_at
    ? new Date(row.generated_at).toLocaleDateString()
    : null;

  return (
    <tr>
      <td style={{ fontWeight: 600 }}>{row.type}</td>
      <td>
        <span style={{
          padding: '0.15rem 0.5rem', borderRadius: 999,
          background: row.active_count > 0 ? '#0f172a' : '#1e293b',
          color: row.active_count > 0 ? '#34d399' : '#475569',
          fontSize: '0.75rem',
        }}>
          {row.active_count}
        </span>
      </td>
      <td>
        {hasSynonyms ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', maxWidth: 400 }}>
            {row.synonyms!.slice(0, 6).map(s => (
              <span key={s} style={{
                padding: '0.1rem 0.45rem', borderRadius: 4,
                background: '#1e293b', color: '#94a3b8',
                fontSize: '0.72rem', lineHeight: 1.6,
              }}>
                {s}
              </span>
            ))}
            {row.synonyms!.length > 6 && (
              <span style={{ fontSize: '0.72rem', color: '#475569', padding: '0.1rem 0.25rem' }}>
                +{row.synonyms!.length - 6} more
              </span>
            )}
          </div>
        ) : (
          <span style={{ color: '#475569', fontSize: '0.8rem' }}>—</span>
        )}
      </td>
      <td style={{ color: '#94a3b8', fontSize: '0.8rem', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {row.keywords || '—'}
      </td>
      <td style={{ color: '#64748b', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
        {genDate ?? '—'}
      </td>
      <td>
        <button
          className="admin-btn admin-btn-secondary"
          style={{ fontSize: '0.75rem', padding: '0.25rem 0.75rem' }}
          onClick={() => onGenerate(row.type, category === '_uncategorised' ? null : category)}
          disabled={generating}
        >
          {generating ? '…' : hasSynonyms ? 'Regen' : 'Generate'}
        </button>
      </td>
    </tr>
  );
}

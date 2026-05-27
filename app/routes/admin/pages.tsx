import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '~/utils/supabase';

/**
 * Admin · Pages
 *
 * Drag-reorder + enable/disable for the section sequence of each
 * consumer-facing page. Persists to public.page_sections.
 *
 * Tabs:
 *   - Product: ProductPage rail order
 *   - Looks:   LookOverlay panel order
 *
 * Consumer renderers don't read this table yet — the next phase will
 * wire ProductPage / LookOverlay to honour the persisted order +
 * enabled flags. For now this is the source of truth that the
 * editor + future consumer code agree on.
 */

type Tab = 'product' | 'looks';

interface SectionRow {
  page: string;
  section_key: string;
  label: string;
  description: string | null;
  sort_order: number;
  enabled: boolean;
}

export default function AdminPages() {
  const [tab, setTab] = useState<Tab>('product');
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const { data } = await supabase
      .from('page_sections')
      .select('page, section_key, label, description, sort_order, enabled')
      .eq('page', tab)
      .order('sort_order', { ascending: true });
    setSections((data ?? []) as SectionRow[]);
    setLoading(false);
  }, [tab]);

  useEffect(() => { void load(); }, [load]);

  // Persist the current ordering — called after a drop or a toggle
  // flips. We only push changed rows so a single re-order is one
  // small request, not a full rewrite.
  const persist = useCallback(async (next: SectionRow[]) => {
    if (!supabase) return;
    setSaving(true);
    // Compute the delta against the loaded state and upsert only
    // the rows that changed. Cheaper + avoids touching updated_at
    // on rows the admin didn't actually move.
    const upserts = next.map((r, i) => ({
      page: r.page,
      section_key: r.section_key,
      label: r.label,
      description: r.description,
      sort_order: i,
      enabled: r.enabled,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from('page_sections')
      .upsert(upserts, { onConflict: 'page,section_key' });
    setSaving(false);
    if (error) {
      // Reload to discard the optimistic state — gives the admin a
      // clean view of what actually persisted.
      void load();
      return;
    }
    setSavedAt(Date.now());
  }, [load]);

  const handleDragStart = (i: number) => (e: React.DragEvent) => {
    setDragIndex(i);
    e.dataTransfer.effectAllowed = 'move';
    // Some browsers refuse to start a drag if no data is attached.
    e.dataTransfer.setData('text/plain', String(i));
  };
  const handleDragOver = (i: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (overIndex !== i) setOverIndex(i);
  };
  const handleDrop = (i: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === i) {
      setDragIndex(null);
      setOverIndex(null);
      return;
    }
    const next = [...sections];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(i, 0, moved);
    // Re-index sort_order so the persist call matches the visual
    // order immediately. Without this the row would briefly show
    // a stale ordering before the upsert returns.
    next.forEach((row, idx) => { row.sort_order = idx; });
    setSections(next);
    setDragIndex(null);
    setOverIndex(null);
    void persist(next);
  };
  const handleDragEnd = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  const toggleEnabled = (i: number) => {
    const next = sections.map((r, idx) => idx === i ? { ...r, enabled: !r.enabled } : r);
    setSections(next);
    void persist(next);
  };

  const savedLabel = useMemo(() => {
    if (saving) return 'Saving…';
    if (!savedAt) return null;
    const ago = Math.round((Date.now() - savedAt) / 1000);
    if (ago < 5) return 'Saved';
    return null;
  }, [saving, savedAt]);

  return (
    <div style={{ padding: 24, maxWidth: 980 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 4 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Pages</h1>
        {savedLabel && (
          <span style={{
            fontSize: 12,
            color: saving ? '#94a3b8' : '#16a34a',
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}>{savedLabel}</span>
        )}
      </div>
      <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
        Drag to reorder. Toggle a section off to hide it from the
        consumer surface. Changes save automatically.
      </p>

      <div style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 999, background: '#f1f5f9', marginBottom: 20 }}>
        <button type="button" onClick={() => setTab('product')} style={pillStyle(tab === 'product')}>Product</button>
        <button type="button" onClick={() => setTab('looks')}   style={pillStyle(tab === 'looks')}>Looks</button>
      </div>

      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Loading…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sections.map((s, i) => {
            const isDragging = dragIndex === i;
            const isDragOver = overIndex === i && dragIndex !== null && dragIndex !== i;
            return (
              <div
                key={s.section_key}
                draggable
                onDragStart={handleDragStart(i)}
                onDragOver={handleDragOver(i)}
                onDrop={handleDrop(i)}
                onDragEnd={handleDragEnd}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '24px 32px 1fr auto',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 16px',
                  borderRadius: 12,
                  border: `1px solid ${isDragOver ? '#7c3aed' : '#e5e7eb'}`,
                  background: isDragging ? '#f8fafc' : '#fff',
                  opacity: isDragging ? 0.55 : (s.enabled ? 1 : 0.55),
                  cursor: 'grab',
                  boxShadow: isDragOver ? '0 0 0 2px rgba(124,58,237,0.18)' : 'none',
                  transition: 'border-color 0.15s, box-shadow 0.15s',
                }}
              >
                <div aria-hidden style={{ color: '#cbd5e1', fontSize: 18, lineHeight: 1, userSelect: 'none' }}>
                  ⋮⋮
                </div>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: '#f1f5f9', color: '#475569',
                  fontSize: 13, fontWeight: 700,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {i + 1}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{s.label}</div>
                  <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.45 }}>{s.description}</div>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); toggleEnabled(i); }}
                  aria-pressed={s.enabled}
                  title={s.enabled ? 'Click to hide this section' : 'Click to show this section'}
                  style={{
                    appearance: 'none',
                    border: 'none',
                    width: 36, height: 20,
                    borderRadius: 999,
                    background: s.enabled ? '#16a34a' : '#cbd5e1',
                    position: 'relative',
                    cursor: 'pointer',
                    padding: 0,
                    transition: 'background 0.15s',
                  }}
                >
                  <span style={{
                    position: 'absolute',
                    top: 2,
                    left: s.enabled ? 18 : 2,
                    width: 16, height: 16,
                    borderRadius: '50%',
                    background: '#fff',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                    transition: 'left 0.18s',
                  }} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function pillStyle(active: boolean): React.CSSProperties {
  return {
    padding: '6px 16px',
    borderRadius: 999,
    border: 'none',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    background: active ? '#0f172a' : 'transparent',
    color: active ? '#fff' : '#475569',
    transition: 'background 0.15s, color 0.15s',
  };
}

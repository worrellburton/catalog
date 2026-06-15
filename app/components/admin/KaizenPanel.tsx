// Kaizen report for the type brain (/admin/governance/types → "Kaizen").
// One sweep over EVERYTHING: product placement (re-types), drifted
// denormalized columns, empty branches, duplicate type names, and type
// strings no node owns. Every finding is checkable; apply lands as one
// undoable gesture. A server twin runs each morning at 6 a.m. ET — the
// header shows its last pass.

import { useEffect, useState, type ReactNode } from 'react';
import { supabase } from '~/utils/supabase';
import type {
  KaizenDrift, KaizenDuplicate, KaizenEmptyType, KaizenGenderChange, KaizenOrphan, KaizenReport,
  TypeAuditRecommendation,
} from '~/services/type-governance';

export interface KaizenPicked {
  retypes: TypeAuditRecommendation[];
  drift: KaizenDrift[];
  genderChanges: KaizenGenderChange[];
  emptyTypes: KaizenEmptyType[];
  duplicateTypes: KaizenDuplicate[];
  orphanTypes: KaizenOrphan[];
}

interface Props {
  report: KaizenReport;
  onApply: (picked: KaizenPicked) => void;
  onClose: () => void;
  /** Natural-language steering: "the glasses should go into dishware
   *  instead of art" → the route maps it onto real moves and updates the
   *  open report. Resolves null on success, else a message to show. */
  onRefine?: (instruction: string) => Promise<string | null>;
}

const SECTIONS = [
  { key: 'retypes', title: 'Better placements', hint: 'products that belong in a more specific type' },
  { key: 'drift', title: 'Type improvements', hint: 'type / path lagging the tree — applies to the type column only' },
  { key: 'genderChanges', title: 'Gender improvements', hint: 'gender set by a male/female type — applies to the gender column only' },
  { key: 'duplicateTypes', title: 'Duplicate types', hint: 'two nodes with the same name — merge into the busier one' },
  { key: 'orphanTypes', title: 'Unowned type names', hint: 'products typed with a name no node owns — create the node' },
  { key: 'emptyTypes', title: 'Empty branches', hint: 'no products anywhere inside — delete' },
] as const;

type SectionKey = typeof SECTIONS[number]['key'];

export default function KaizenPanel({ report, onApply, onClose, onRefine }: Props) {
  const [refineText, setRefineText] = useState('');
  const [refining, setRefining] = useState(false);
  const [refineNote, setRefineNote] = useState<string | null>(null);
  const submitRefine = async () => {
    const note = refineText.trim();
    if (!note || !onRefine || refining) return;
    setRefining(true);
    setRefineNote(null);
    try {
      const result = await onRefine(note);
      setRefineNote(result); // null = applied silently into the list above
      if (!result) setRefineText('');
    } catch (err) {
      setRefineNote(err instanceof Error ? err.message : 'Refine failed');
    } finally {
      setRefining(false);
    }
  };
  const keyOf: Record<SectionKey, (r: never) => string> = {
    retypes: (r: TypeAuditRecommendation) => r.productId,
    drift: (r: KaizenDrift) => r.productId,
    genderChanges: (r: KaizenGenderChange) => r.productId,
    duplicateTypes: (r: KaizenDuplicate) => r.dropId,
    orphanTypes: (r: KaizenOrphan) => r.typeName,
    emptyTypes: (r: KaizenEmptyType) => r.nodeId,
  };
  const allKeys = (k: SectionKey) => new Set((report[k] as never[]).map(keyOf[k]));
  const [checked, setChecked] = useState<Record<SectionKey, Set<string>>>(() => ({
    retypes: allKeys('retypes'),
    drift: allKeys('drift'),
    genderChanges: allKeys('genderChanges'),
    duplicateTypes: allKeys('duplicateTypes'),
    orphanTypes: allKeys('orphanTypes'),
    emptyTypes: allKeys('emptyTypes'),
  }));
  const [lastRun, setLastRun] = useState<string | null>(null);
  // A refine swaps new suggestions into the report — re-seed the checks so
  // the fresh rows arrive selected.
  useEffect(() => {
    setChecked({
      retypes: allKeys('retypes'),
      drift: allKeys('drift'),
      genderChanges: allKeys('genderChanges'),
      duplicateTypes: allKeys('duplicateTypes'),
      orphanTypes: allKeys('orphanTypes'),
      emptyTypes: allKeys('emptyTypes'),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report]);

  // The morning twin's last pass, for the header.
  useEffect(() => {
    if (!supabase) return;
    void supabase
      .from('kaizen_runs')
      .select('run_at, auto_fixed, finding_count')
      .order('run_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        const d = data as { run_at: string; auto_fixed: number; finding_count: number };
        setLastRun(`Morning run ${new Date(d.run_at).toLocaleString()} — ${d.finding_count} findings, ${d.auto_fixed} auto-fixed`);
      });
  }, []);

  const toggle = (section: SectionKey, id: string) => setChecked(prev => {
    const next = new Set(prev[section]);
    if (next.has(id)) next.delete(id); else next.add(id);
    return { ...prev, [section]: next };
  });
  const toggleAll = (section: SectionKey) => setChecked(prev => ({
    ...prev,
    [section]: prev[section].size === (report[section] as never[]).length ? new Set<string>() : allKeys(section),
  }));

  const total = SECTIONS.reduce((acc, s) => acc + (report[s.key] as never[]).length, 0);
  const pickedCount = SECTIONS.reduce((acc, s) => acc + checked[s.key].size, 0);
  const picked: KaizenPicked = {
    retypes: report.retypes.filter(r => checked.retypes.has(r.productId)),
    drift: report.drift.filter(r => checked.drift.has(r.productId)),
    genderChanges: report.genderChanges.filter(r => checked.genderChanges.has(r.productId)),
    duplicateTypes: report.duplicateTypes.filter(r => checked.duplicateTypes.has(r.dropId)),
    orphanTypes: report.orphanTypes.filter(r => checked.orphanTypes.has(r.typeName)),
    emptyTypes: report.emptyTypes.filter(r => checked.emptyTypes.has(r.nodeId)),
  };

  const sectionHead = (s: typeof SECTIONS[number], count: number) => (
    <div className="gov-kaizen-section">
      <div>
        <h3>{s.title} <em>({count})</em></h3>
        <small>{s.hint}</small>
      </div>
      <button type="button" className="gov-ghost" onClick={() => toggleAll(s.key)}>
        {checked[s.key].size === count ? 'Uncheck all' : 'Check all'}
      </button>
    </div>
  );

  const row = (key: string, section: SectionKey, body: ReactNode) => (
    <label key={key} className={`gov-audit-row${checked[section].has(key) ? ' is-checked' : ''}`}>
      <input type="checkbox" checked={checked[section].has(key)} onChange={() => toggle(section, key)} />
      {body}
    </label>
  );

  const prodCells = (r: { image: string | null; name: string; brand: string | null }) => (
    <span className="gov-audit-thumb">
      {r.image ? <img src={r.image} alt="" loading="lazy" decoding="async" /> : <i>{r.name.slice(0, 2)}</i>}
    </span>
  );

  return (
    <div className="gov-audit">
      <div className="gov-audit-head">
        <div>
          <h2>Kaizen</h2>
          <span>
            {total === 0
              ? 'Everything is in order — nothing to improve today.'
              : `${total} improvement${total === 1 ? '' : 's'} found across the whole catalog.`}
            {lastRun && <i style={{ display: 'block', fontStyle: 'normal', opacity: 0.65 }}>{lastRun}</i>}
          </span>
        </div>
        <button type="button" className="gov-ghost" onClick={onClose}>✕ Close</button>
      </div>

      {total > 0 && (
        <>
          <div className="gov-audit-list">
            {report.retypes.length > 0 && sectionHead(SECTIONS[0], report.retypes.length)}
            {report.retypes.map(r => row(r.productId, 'retypes', (
              <>
                {prodCells(r)}
                <span className="gov-audit-prod">
                  {r.brand && <em>{r.brand}</em>}
                  <strong>{r.name}</strong>
                  <small>{r.reason}</small>
                </span>
                <span className="gov-audit-change">
                  <s>{r.fromType ?? 'unassigned'}</s><i aria-hidden="true">→</i><b>{r.toPath}</b>
                </span>
              </>
            )))}

            {report.drift.length > 0 && sectionHead(SECTIONS[1], report.drift.length)}
            {report.drift.map(r => row(r.productId, 'drift', (
              <>
                {prodCells(r)}
                <span className="gov-audit-prod">
                  {r.brand && <em>{r.brand}</em>}
                  <strong>{r.name}</strong>
                  <small>type path out of sync with the tree</small>
                </span>
                <span className="gov-audit-change">
                  <s>{r.fromPath ?? 'no path'}</s>
                  <i aria-hidden="true">→</i>
                  <b>{r.toPath}</b>
                </span>
              </>
            )))}

            {report.genderChanges.length > 0 && sectionHead(SECTIONS[2], report.genderChanges.length)}
            {report.genderChanges.map(r => row(r.productId, 'genderChanges', (
              <>
                {prodCells(r)}
                <span className="gov-audit-prod">
                  {r.brand && <em>{r.brand}</em>}
                  <strong>{r.name}</strong>
                  <small>{r.path} — gender only</small>
                </span>
                <span className="gov-audit-change">
                  <s>{r.fromGender ?? 'unset'}</s>
                  <i aria-hidden="true">→</i>
                  <b>{r.toGender}</b>
                </span>
              </>
            )))}

            {report.duplicateTypes.length > 0 && sectionHead(SECTIONS[3], report.duplicateTypes.length)}
            {report.duplicateTypes.map(r => row(r.dropId, 'duplicateTypes', (
              <span className="gov-audit-change" style={{ flex: 1 }}>
                <s>{r.dropPath}</s><i aria-hidden="true">→</i><b>{r.keepPath}</b>
                <small style={{ marginLeft: 8 }}>{r.productCount} product{r.productCount === 1 ? '' : 's'} move, duplicate node deleted</small>
              </span>
            )))}

            {report.orphanTypes.length > 0 && sectionHead(SECTIONS[4], report.orphanTypes.length)}
            {report.orphanTypes.map(r => row(r.typeName, 'orphanTypes', (
              <span className="gov-audit-change" style={{ flex: 1 }}>
                <b>“{r.typeName}”</b>
                <small style={{ marginLeft: 8 }}>{r.productIds.length} product{r.productIds.length === 1 ? '' : 's'} use it — create as a top-level type</small>
              </span>
            )))}

            {report.emptyTypes.length > 0 && sectionHead(SECTIONS[5], report.emptyTypes.length)}
            {report.emptyTypes.map(r => row(r.nodeId, 'emptyTypes', (
              <span className="gov-audit-change" style={{ flex: 1 }}>
                <s>{r.path}</s>
                <small style={{ marginLeft: 8 }}>no products anywhere inside{r.subtreeIds.length > 1 ? ` (${r.subtreeIds.length} nodes)` : ''} — delete</small>
              </span>
            )))}
          </div>
          {onRefine && (
            <div className="gov-kaizen-refine">
              <input
                value={refineText}
                onChange={e => setRefineText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void submitRefine(); }}
                placeholder='Steer these suggestions — e.g. "the glasses should go into dishware instead of art"'
                disabled={refining}
              />
              <button type="button" className="gov-audit-apply" disabled={refining || !refineText.trim()} onClick={() => void submitRefine()}>
                {refining ? 'Thinking…' : '✦ Refine'}
              </button>
              {refineNote && <span className="gov-kaizen-refine-note">{refineNote}</span>}
            </div>
          )}
          <div className="gov-audit-foot">
            <span style={{ marginRight: 'auto', fontSize: 12, opacity: 0.7 }}>{pickedCount} of {total} selected</span>
            <button type="button" className="gov-ghost" onClick={onClose}>Cancel</button>
            <button
              type="button"
              className="gov-audit-apply"
              disabled={pickedCount === 0}
              onClick={() => onApply(picked)}
            >
              Apply {pickedCount} improvement{pickedCount === 1 ? '' : 's'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

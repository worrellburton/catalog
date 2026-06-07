import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@remix-run/react';
import { MONTHS, monthLabel, fmtCurrency, fmtPercent, niceCeiling } from '~/services/projections';
import { buildModel } from '~/services/model';
import { buildCashflow } from '~/services/model-metrics';
import { useSharedModelSettings } from '~/hooks/useSharedModelSettings';
import {
  type EmploymentType,
  type OpexCategory,
  type OpexItem,
  type PayrollItem,
  OPEX_CATEGORIES,
  OPEX_CATEGORY_COLORS,
  CONTINUOUS_END,
  buildCombinedByCategory,
  buildCombinedSchedule,
  isContinuous,
  opexAverage,
  opexTotal,
  payrollMonthly,
  uid,
} from '~/services/opex';
import { useSharedOpex, useSharedPayroll, useSharedCreatorPayout } from '~/hooks/useSharedOpex';
import ModelTabs from '~/components/model/ModelTabs';
import DragCard from '~/components/model/DragCard';
import AssumptionCard, { type FieldDef } from '~/components/model/AssumptionCard';

const PAYOUT_PCT_FIELD: FieldDef = { key: 'percent', label: 'Payout (% of revenue)', hint: 'Share of revenue paid to creators', format: 'percent', step: 0.01, min: 0, max: 1 };
const TARGET_MARGIN_FIELD: FieldDef = { key: 'targetMargin', label: 'Target operating margin', hint: 'Hold this margin; pay the surplus to creators', format: 'percent', step: 0.01, min: 0, max: 1 };

const MONTH_OPTS = Array.from({ length: MONTHS }, (_, i) => ({ value: i, label: monthLabel(i) }));
const active = (m: number, s: number, e: number) => m >= s && m <= e;

type OpexSection = 'payroll' | 'creators' | 'expenses' | 'chart' | 'sheet';
const DEFAULT_SECTIONS: OpexSection[] = ['payroll', 'creators', 'expenses', 'chart', 'sheet'];
const SECTIONS_KEY = 'catalog:opex:sections:v2';

function readSections(): OpexSection[] {
  if (typeof window === 'undefined') return DEFAULT_SECTIONS;
  try {
    const raw = window.localStorage.getItem(SECTIONS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const order = (Array.isArray(parsed) ? parsed : DEFAULT_SECTIONS).filter((k: OpexSection) => DEFAULT_SECTIONS.includes(k));
    for (const k of DEFAULT_SECTIONS) if (!order.includes(k)) order.push(k);
    return order;
  } catch { return DEFAULT_SECTIONS; }
}

// "End" select that includes a Continuous (no-end) option.
function EndSelect({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <select className="opex-in" value={isContinuous(value) ? CONTINUOUS_END : value} onChange={e => onChange(Number(e.target.value))}>
      <option value={CONTINUOUS_END}>Continuous</option>
      {MONTH_OPTS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
    </select>
  );
}

// Accounting-formatted dollar input: shows thousands separators at rest
// (e.g. 100,000), shows the raw number while editing, and parses digits.
function AcctInput({ value, onChange, className }: { value: number; onChange: (n: number) => void; className?: string }) {
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
        if (!Number.isNaN(n)) onChange(n);
      }}
    />
  );
}

function OpexChart({ items, payroll }: { items: OpexItem[]; payroll: PayrollItem[] }) {
  const byCat = useMemo(() => buildCombinedByCategory(items, payroll), [items, payroll]);
  const schedule = useMemo(() => buildCombinedSchedule(items, payroll), [items, payroll]);
  const W = 1100, H = 240, PADL = 60, PADR = 12, PADT = 12, PADB = 28;
  const innerW = W - PADL - PADR, innerH = H - PADT - PADB;
  const colW = innerW / MONTHS;
  const barW = colW * 0.62;
  const max = niceCeiling(Math.max(1, ...schedule));
  const y = (v: number) => PADT + innerH - (innerH * v) / max;
  const cats = OPEX_CATEGORIES.map(c => c.id);

  return (
    <div className="opex-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="opex-chart-svg">
        {[0, 0.5, 1].map((t, gi) => {
          const gy = PADT + innerH * (1 - t);
          return (
            <g key={gi}>
              <line x1={PADL} y1={gy} x2={W - PADR} y2={gy} stroke="#e5e7eb" strokeDasharray="3 4" />
              <text x={PADL - 8} y={gy + 4} textAnchor="end" fontSize="11" fill="#94a3b8">{fmtCurrency(max * t, { compact: true })}</text>
            </g>
          );
        })}
        {schedule.map((_, i) => {
          const x = PADL + colW * i + (colW - barW) / 2;
          let acc = 0;
          return (
            <g key={i}>
              {cats.map(cat => {
                const v = byCat[cat as OpexCategory][i];
                if (v <= 0) return null;
                const yTop = y(acc + v);
                const h = y(acc) - y(acc + v);
                acc += v;
                return <rect key={cat} x={x} y={yTop} width={barW} height={Math.max(0, h)} fill={OPEX_CATEGORY_COLORS[cat as OpexCategory]} />;
              })}
              <title>{`${monthLabel(i)}: ${fmtCurrency(schedule[i])}`}</title>
              <text x={x + barW / 2} y={H - PADB + 16} textAnchor="middle" fontSize="9" fill="#94a3b8">{monthLabel(i).split(' ')[0]}</text>
            </g>
          );
        })}
      </svg>
      <div className="opex-legend">
        {OPEX_CATEGORIES.map(c => (
          <span key={c.id} className="opex-legend-item"><i style={{ background: OPEX_CATEGORY_COLORS[c.id] }} />{c.label}</span>
        ))}
      </div>
    </div>
  );
}

// Classic spreadsheet: every line × every month, with row + column totals.
function OpexSheet({ items, payroll }: { items: OpexItem[]; payroll: PayrollItem[] }) {
  const rows: { name: string; cells: number[] }[] = [];
  for (const p of payroll) {
    const monthly = payrollMonthly(p);
    rows.push({ name: `${p.role}${p.count > 1 ? ` ×${p.count}` : ''}`, cells: MONTH_OPTS.map((_, m) => (active(m, p.startMonth, p.endMonth) ? monthly : 0)) });
  }
  for (const it of items) {
    rows.push({ name: it.name, cells: MONTH_OPTS.map((_, m) => (active(m, it.startMonth, it.endMonth) ? it.amount * Math.pow(1 + it.growth, m - it.startMonth) : 0)) });
  }
  const totals = MONTH_OPTS.map((_, m) => rows.reduce((a, r) => a + r.cells[m], 0));
  const grand = totals.reduce((a, b) => a + b, 0);

  return (
    <div className="opex-sheet-wrap">
      <table className="opex-sheet">
        <thead>
          <tr>
            <th className="opex-sheet-name">Line</th>
            {MONTH_OPTS.map(m => <th key={m.value}>{m.label}</th>)}
            <th className="opex-sheet-total">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              <td className="opex-sheet-name">{r.name}</td>
              {r.cells.map((v, m) => <td key={m}>{v > 0 ? fmtCurrency(v, { compact: true }) : <span className="opex-sheet-zero">–</span>}</td>)}
              <td className="opex-sheet-total">{fmtCurrency(r.cells.reduce((a, b) => a + b, 0), { compact: true })}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td className="opex-empty" colSpan={MONTHS + 2}>Add payroll or expense lines to populate the sheet.</td></tr>
          )}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr>
              <td className="opex-sheet-name">Total OpEx</td>
              {totals.map((v, m) => <td key={m}>{fmtCurrency(v, { compact: true })}</td>)}
              <td className="opex-sheet-total">{fmtCurrency(grand, { compact: true })}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

export default function AdminModelOpex() {
  const { items, setItems, live } = useSharedOpex();
  const { items: payroll, setItems: setPayroll } = useSharedPayroll();

  const { value: payout, setValue: setPayout } = useSharedCreatorPayout();
  const { rev, acq, econ } = useSharedModelSettings();

  const schedule = useMemo(() => buildCombinedSchedule(items, payroll), [items, payroll]);
  const avg = opexAverage(schedule);
  const total = opexTotal(schedule);
  const headcount = payroll.reduce((a, p) => a + (p.count || 0), 0);
  const monthEnd = schedule[schedule.length - 1] ?? 0;

  // Creator payout impact — needs revenue, so we rebuild the model here.
  const built = useMemo(() => buildModel(rev, acq, true), [rev, acq]);
  const payoutCash = useMemo(() => buildCashflow(built.revenue, built.acquisition, econ, schedule, payout), [built, econ, schedule, payout]);
  const payoutTotal = useMemo(() => payoutCash.reduce((a, c) => a + c.creatorPayout, 0), [payoutCash]);
  const revTotal = useMemo(() => built.revenue.reduce((a, m) => a + m.revenue, 0), [built]);
  const avgOpMargin = useMemo(() => {
    let s = 0, n = 0;
    for (let i = 0; i < payoutCash.length; i++) { const r = built.revenue[i].revenue; if (r > 0) { s += payoutCash[i].net / r; n++; } }
    return n ? s / n : 0;
  }, [payoutCash, built]);

  // OpEx expense lines
  const update = (id: string, patch: Partial<OpexItem>) => setItems(prev => prev.map(it => (it.id === id ? { ...it, ...patch } : it)));
  const remove = (id: string) => setItems(prev => prev.filter(it => it.id !== id));
  const add = () => setItems(prev => [...prev, { id: uid(), name: 'New line', category: 'other', amount: 5000, startMonth: 0, endMonth: CONTINUOUS_END, growth: 0 }]);

  // Payroll lines
  const updateP = (id: string, patch: Partial<PayrollItem>) => setPayroll(prev => prev.map(p => (p.id === id ? { ...p, ...patch } : p)));
  const removeP = (id: string) => setPayroll(prev => prev.filter(p => p.id !== id));
  const addP = () => setPayroll(prev => [...prev, { id: uid(), role: 'New role', type: 'employee', count: 1, basis: 'annual', comp: 120000, startMonth: 0, endMonth: CONTINUOUS_END }]);

  // Drag-to-reorder the page sections (persisted per browser).
  const [sections, setSections] = useState<OpexSection[]>(() => readSections());
  useEffect(() => { try { window.localStorage.setItem(SECTIONS_KEY, JSON.stringify(sections)); } catch { /* quota */ } }, [sections]);
  const dragKey = useRef<OpexSection | null>(null);
  const [overKey, setOverKey] = useState<OpexSection | null>(null);
  const dnd = (key: OpexSection) => ({
    onDragStart: () => { dragKey.current = key; },
    onDragEnter: () => { if (dragKey.current && dragKey.current !== key) setOverKey(key); },
    onDragEnd: () => { dragKey.current = null; setOverKey(null); },
    onDrop: () => {
      const from = dragKey.current;
      dragKey.current = null; setOverKey(null);
      if (!from || from === key) return;
      setSections(prev => {
        const next = [...prev];
        next.splice(next.indexOf(from), 1);
        next.splice(next.indexOf(key), 0, from);
        return next;
      });
    },
    isDragging: dragKey.current === key,
    isDragOver: overKey === key,
  });

  // Drag-to-reorder rows within a table (order persists via the shared list).
  const dragRow = useRef<{ list: 'payroll' | 'expenses'; id: string } | null>(null);
  const [overRow, setOverRow] = useState<string | null>(null);
  const moveById = <T extends { id: string }>(arr: T[], fromId: string, toId: string): T[] => {
    const fi = arr.findIndex(x => x.id === fromId);
    const ti = arr.findIndex(x => x.id === toId);
    if (fi < 0 || ti < 0 || fi === ti) return arr;
    const next = [...arr];
    const [moved] = next.splice(fi, 1);
    next.splice(ti, 0, moved);
    return next;
  };
  const rowDnd = (list: 'payroll' | 'expenses', id: string) => ({
    className: overRow === id ? 'opex-row-over' : undefined,
    onDragOver: (e: React.DragEvent) => { if (dragRow.current?.list === list) e.preventDefault(); },
    onDragEnter: () => { if (dragRow.current?.list === list && dragRow.current.id !== id) setOverRow(id); },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const d = dragRow.current;
      dragRow.current = null; setOverRow(null);
      if (!d || d.list !== list || d.id === id) return;
      if (list === 'payroll') setPayroll(prev => moveById(prev, d.id, id));
      else setItems(prev => moveById(prev, d.id, id));
    },
  });
  const Grip = ({ list, id }: { list: 'payroll' | 'expenses'; id: string }) => (
    <td className="opex-grip-cell">
      <span
        className="model-row-grip"
        draggable
        onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; dragRow.current = { list, id }; }}
        onDragEnd={() => { dragRow.current = null; setOverRow(null); }}
        title="Drag to reorder"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" /></svg>
      </span>
    </td>
  );

  const renderSection = (key: OpexSection) => {
    if (key === 'payroll') {
      return (
        <DragCard key="payroll" {...dnd('payroll')} title="Payroll" action={<button className="opex-add-btn" onClick={addP} title="Add employee" aria-label="Add employee">+</button>}>
          <div className="opex-table-wrap">
            <table className="opex-table">
              <thead>
                <tr><th></th><th>Role</th><th>Type</th><th>#</th><th>Comp basis</th><th>Comp / person</th><th>Start</th><th>End</th><th>Monthly</th><th></th></tr>
              </thead>
              <tbody>
                {payroll.map(p => (
                  <tr key={p.id} {...rowDnd('payroll', p.id)}>
                    <Grip list="payroll" id={p.id} />
                    <td><input className="opex-in opex-in-name" value={p.role} onChange={e => updateP(p.id, { role: e.target.value })} /></td>
                    <td>
                      <select className="opex-in" value={p.type} onChange={e => updateP(p.id, { type: e.target.value as EmploymentType })}>
                        <option value="employee">Employee</option>
                        <option value="contractor">Contractor</option>
                      </select>
                    </td>
                    <td><input className="opex-in opex-in-sm" type="number" min={0} step={1} value={p.count} onChange={e => updateP(p.id, { count: Number(e.target.value) || 0 })} /></td>
                    <td>
                      <select className="opex-in" value={p.basis} onChange={e => {
                        const basis = e.target.value as 'annual' | 'monthly';
                        updateP(p.id, basis === 'annual' ? { basis, endMonth: CONTINUOUS_END } : { basis });
                      }}>
                        <option value="annual">Annual</option>
                        <option value="monthly">Monthly</option>
                      </select>
                    </td>
                    <td><AcctInput className="opex-in opex-in-num" value={p.comp} onChange={n => updateP(p.id, { comp: n })} /></td>
                    <td>
                      <select className="opex-in" value={p.startMonth} onChange={e => updateP(p.id, { startMonth: Number(e.target.value) })}>
                        {MONTH_OPTS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                    </td>
                    <td>
                      {p.basis === 'monthly'
                        ? <EndSelect value={p.endMonth} onChange={n => updateP(p.id, { endMonth: n })} />
                        : <span className="opex-thru">Continuous</span>}
                    </td>
                    <td className="opex-monthly">{fmtCurrency(payrollMonthly(p), { compact: true })}</td>
                    <td><button className="opex-del" onClick={() => removeP(p.id)} aria-label={`Remove ${p.role}`}>×</button></td>
                  </tr>
                ))}
                {payroll.length === 0 && (
                  <tr><td colSpan={10} className="opex-empty">No employees yet — add your team and choose annual or monthly comp.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </DragCard>
      );
    }
    if (key === 'expenses') {
      return (
        <DragCard key="expenses" {...dnd('expenses')} title="Other expenses" action={<button className="opex-add-btn" onClick={add} title="Add line" aria-label="Add line">+</button>}>
          <div className="opex-table-wrap">
            <table className="opex-table">
              <thead>
                <tr><th></th><th>Name</th><th>Category</th><th>Monthly $</th><th>Start</th><th>End</th><th>Ramp / mo</th><th></th></tr>
              </thead>
              <tbody>
                {items.map(it => (
                  <tr key={it.id} {...rowDnd('expenses', it.id)}>
                    <Grip list="expenses" id={it.id} />
                    <td><input className="opex-in opex-in-name" value={it.name} onChange={e => update(it.id, { name: e.target.value })} /></td>
                    <td>
                      <select className="opex-in" value={it.category} onChange={e => update(it.id, { category: e.target.value as OpexCategory })}>
                        {OPEX_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                      </select>
                    </td>
                    <td><AcctInput className="opex-in opex-in-num" value={it.amount} onChange={n => update(it.id, { amount: n })} /></td>
                    <td>
                      <select className="opex-in" value={it.startMonth} onChange={e => update(it.id, { startMonth: Number(e.target.value) })}>
                        {MONTH_OPTS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                    </td>
                    <td><EndSelect value={it.endMonth} onChange={n => update(it.id, { endMonth: n })} /></td>
                    <td><span className="opex-in-pct"><input className="opex-in opex-in-sm" type="number" step={1} value={Math.round(it.growth * 100)} onChange={e => update(it.id, { growth: (Number(e.target.value) || 0) / 100 })} />%</span></td>
                    <td><button className="opex-del" onClick={() => remove(it.id)} aria-label={`Remove ${it.name}`}>×</button></td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr><td colSpan={8} className="opex-empty">No expense lines yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </DragCard>
      );
    }
    if (key === 'creators') {
      return (
        <DragCard key="creators" {...dnd('creators')} title="Payout to creators">
          <p className="model-link-note">A continuous share of revenue redistributed to creators. Pay a fixed % of revenue, or hold a target operating margin and pay out the surplus.</p>
          <div className="creator-modes">
            <button className={payout.mode === 'percent' ? 'is-active' : ''} onClick={() => setPayout(p => ({ ...p, mode: 'percent' }))}>% of revenue</button>
            <button className={payout.mode === 'margin' ? 'is-active' : ''} onClick={() => setPayout(p => ({ ...p, mode: 'margin', targetMargin: p.targetMargin || 0.2 }))}>
              Keep operating margin at {fmtPercent(payout.targetMargin || 0.2, 0)}
            </button>
          </div>
          <div className="creator-row">
            <div className="proj-cards model-cards creator-input">
              {payout.mode === 'percent'
                ? <AssumptionCard field={PAYOUT_PCT_FIELD} value={payout.percent} onChange={n => setPayout(p => ({ ...p, percent: n }))} />
                : <AssumptionCard field={TARGET_MARGIN_FIELD} value={payout.targetMargin} onChange={n => setPayout(p => ({ ...p, targetMargin: n }))} />}
            </div>
            <div className="creator-stats">
              <span><strong>{fmtCurrency(payoutTotal / MONTHS)}</strong> avg / mo · {fmtPercent(revTotal > 0 ? payoutTotal / revTotal : 0, 0)} of rev</span>
              <span><strong>{fmtCurrency(payoutTotal, { compact: true })}</strong> 16-mo to creators</span>
              <span><strong>{fmtPercent(avgOpMargin, 0)}</strong> op margin after payout</span>
            </div>
          </div>
        </DragCard>
      );
    }
    if (key === 'chart') {
      return (
        <DragCard key="chart" {...dnd('chart')} title="OpEx by month">
          <OpexChart items={items} payroll={payroll} />
        </DragCard>
      );
    }
    return (
      <DragCard key="sheet" {...dnd('sheet')} title="Spreadsheet">
        <OpexSheet items={items} payroll={payroll} />
      </DragCard>
    );
  };

  return (
    <div className="admin-page opex-page">
      <div className="admin-page-header">
        <h1>
          Monthly OpEx
          <span className={`model-live${live ? ' is-live' : ''}`}>
            <span className="model-live-dot" />{live ? 'Live · shared' : 'Shared'}
          </span>
        </h1>
        <p className="admin-page-subtitle">
          Build OpEx from payroll + expenses across {MONTHS} months. The average feeds <Link to="/admin/model" className="opex-link">the Model</Link>’s Monthly OpEx.
        </p>
      </div>

      <ModelTabs active="opex" />

      <div className="proj-summary model-dials">
        <div className="proj-summary-card">
          <span className="proj-summary-label">Avg monthly OpEx</span>
          <span className="proj-summary-value">{fmtCurrency(avg)}</span>
          <span className="proj-summary-sub">used by the model</span>
        </div>
        <div className="proj-summary-card">
          <span className="proj-summary-label">16-month OpEx</span>
          <span className="proj-summary-value">{fmtCurrency(total, { compact: true })}</span>
        </div>
        <div className="proj-summary-card">
          <span className="proj-summary-label">Month {MONTHS} OpEx</span>
          <span className="proj-summary-value">{fmtCurrency(monthEnd)}</span>
        </div>
        <div className="proj-summary-card gtm-dial-paid">
          <span className="proj-summary-label">Headcount</span>
          <span className="proj-summary-value">{headcount}</span>
          <span className="proj-summary-sub">{payroll.length} role{payroll.length === 1 ? '' : 's'}</span>
        </div>
      </div>

      {sections.map(renderSection)}
    </div>
  );
}

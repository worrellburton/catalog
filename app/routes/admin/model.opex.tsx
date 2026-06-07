import { useMemo } from 'react';
import { Link } from '@remix-run/react';
import { MONTHS, monthLabel, fmtCurrency, niceCeiling } from '~/services/projections';
import {
  type EmploymentType,
  type OpexCategory,
  type OpexItem,
  type PayrollItem,
  OPEX_CATEGORIES,
  OPEX_CATEGORY_COLORS,
  buildCombinedByCategory,
  buildCombinedSchedule,
  opexAverage,
  opexTotal,
  payrollMonthly,
  uid,
} from '~/services/opex';
import { useSharedOpex, useSharedPayroll } from '~/hooks/useSharedOpex';
import ModelTabs from '~/components/model/ModelTabs';

const MONTH_OPTS = Array.from({ length: MONTHS }, (_, i) => ({ value: i, label: monthLabel(i) }));
const active = (m: number, s: number, e: number) => m >= s && m <= e;

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

  const schedule = useMemo(() => buildCombinedSchedule(items, payroll), [items, payroll]);
  const avg = opexAverage(schedule);
  const total = opexTotal(schedule);
  const headcount = payroll.reduce((a, p) => a + (p.count || 0), 0);
  const monthEnd = schedule[schedule.length - 1] ?? 0;

  // OpEx expense lines
  const update = (id: string, patch: Partial<OpexItem>) => setItems(prev => prev.map(it => (it.id === id ? { ...it, ...patch } : it)));
  const remove = (id: string) => setItems(prev => prev.filter(it => it.id !== id));
  const add = () => setItems(prev => [...prev, { id: uid(), name: 'New line', category: 'other', amount: 5000, startMonth: 0, endMonth: MONTHS - 1, growth: 0 }]);

  // Payroll lines
  const updateP = (id: string, patch: Partial<PayrollItem>) => setPayroll(prev => prev.map(p => (p.id === id ? { ...p, ...patch } : p)));
  const removeP = (id: string) => setPayroll(prev => prev.filter(p => p.id !== id));
  const addP = () => setPayroll(prev => [...prev, { id: uid(), role: 'New role', type: 'employee', count: 1, basis: 'annual', comp: 120000, startMonth: 0, endMonth: MONTHS - 1 }]);

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

      {/* Payroll — people first, above other OpEx. */}
      <section className="model-card opex-table-card">
        <div className="model-card-head">
          <h3>Payroll</h3>
          <button className="admin-btn admin-btn-secondary" onClick={addP}>+ Add employee</button>
        </div>
        <div className="opex-table-wrap">
          <table className="opex-table">
            <thead>
              <tr>
                <th>Role</th><th>Type</th><th>#</th><th>Comp basis</th><th>Comp / person</th><th>Start</th><th>End</th><th>Monthly</th><th></th>
              </tr>
            </thead>
            <tbody>
              {payroll.map(p => (
                <tr key={p.id}>
                  <td><input className="opex-in opex-in-name" value={p.role} onChange={e => updateP(p.id, { role: e.target.value })} /></td>
                  <td>
                    <select className="opex-in" value={p.type} onChange={e => updateP(p.id, { type: e.target.value as EmploymentType })}>
                      <option value="employee">Employee</option>
                      <option value="contractor">Contractor</option>
                    </select>
                  </td>
                  <td><input className="opex-in opex-in-sm" type="number" min={0} step={1} value={p.count} onChange={e => updateP(p.id, { count: Number(e.target.value) || 0 })} /></td>
                  <td>
                    <select className="opex-in" value={p.basis} onChange={e => updateP(p.id, { basis: e.target.value as 'annual' | 'monthly' })}>
                      <option value="annual">Annual</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </td>
                  <td><input className="opex-in opex-in-num" type="number" min={0} step={1000} value={p.comp} onChange={e => updateP(p.id, { comp: Number(e.target.value) || 0 })} /></td>
                  <td>
                    <select className="opex-in" value={p.startMonth} onChange={e => updateP(p.id, { startMonth: Number(e.target.value) })}>
                      {MONTH_OPTS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </td>
                  <td>
                    <select className="opex-in" value={p.endMonth} onChange={e => updateP(p.id, { endMonth: Number(e.target.value) })}>
                      {MONTH_OPTS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </td>
                  <td className="opex-monthly">{fmtCurrency(payrollMonthly(p), { compact: true })}</td>
                  <td><button className="opex-del" onClick={() => removeP(p.id)} aria-label={`Remove ${p.role}`}>×</button></td>
                </tr>
              ))}
              {payroll.length === 0 && (
                <tr><td colSpan={9} className="opex-empty">No employees yet — add your team and choose annual or monthly comp.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Other OpEx expense lines. */}
      <section className="model-card opex-table-card">
        <div className="model-card-head">
          <h3>Other expenses</h3>
          <button className="admin-btn admin-btn-secondary" onClick={add}>+ Add line</button>
        </div>
        <div className="opex-table-wrap">
          <table className="opex-table">
            <thead>
              <tr>
                <th>Name</th><th>Category</th><th>Monthly $</th><th>Start</th><th>End</th><th>Ramp / mo</th><th></th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id}>
                  <td><input className="opex-in opex-in-name" value={it.name} onChange={e => update(it.id, { name: e.target.value })} /></td>
                  <td>
                    <select className="opex-in" value={it.category} onChange={e => update(it.id, { category: e.target.value as OpexCategory })}>
                      {OPEX_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  </td>
                  <td><input className="opex-in opex-in-num" type="number" min={0} step={500} value={it.amount} onChange={e => update(it.id, { amount: Number(e.target.value) || 0 })} /></td>
                  <td>
                    <select className="opex-in" value={it.startMonth} onChange={e => update(it.id, { startMonth: Number(e.target.value) })}>
                      {MONTH_OPTS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </td>
                  <td>
                    <select className="opex-in" value={it.endMonth} onChange={e => update(it.id, { endMonth: Number(e.target.value) })}>
                      {MONTH_OPTS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </td>
                  <td><span className="opex-in-pct"><input className="opex-in opex-in-sm" type="number" step={1} value={Math.round(it.growth * 100)} onChange={e => update(it.id, { growth: (Number(e.target.value) || 0) / 100 })} />%</span></td>
                  <td><button className="opex-del" onClick={() => remove(it.id)} aria-label={`Remove ${it.name}`}>×</button></td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={7} className="opex-empty">No expense lines yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="model-card">
        <h3>OpEx by month</h3>
        <OpexChart items={items} payroll={payroll} />
      </section>

      <section className="model-card">
        <h3>Spreadsheet</h3>
        <OpexSheet items={items} payroll={payroll} />
      </section>
    </div>
  );
}

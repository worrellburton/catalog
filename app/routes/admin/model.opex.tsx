import { useMemo } from 'react';
import { Link } from '@remix-run/react';
import { MONTHS, monthLabel, fmtCurrency, niceCeiling } from '~/services/projections';
import {
  type OpexCategory,
  type OpexItem,
  OPEX_CATEGORIES,
  OPEX_CATEGORY_COLORS,
  buildOpexByCategory,
  buildOpexSchedule,
  opexAverage,
  opexTotal,
  uid,
} from '~/services/opex';
import { useSharedOpex } from '~/hooks/useSharedOpex';

const MONTH_OPTS = Array.from({ length: MONTHS }, (_, i) => ({ value: i, label: monthLabel(i) }));

function OpexChart({ items }: { items: OpexItem[] }) {
  const byCat = useMemo(() => buildOpexByCategory(items), [items]);
  const schedule = useMemo(() => buildOpexSchedule(items), [items]);
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

export default function AdminModelOpex() {
  const { items, setItems, live } = useSharedOpex();

  const schedule = useMemo(() => buildOpexSchedule(items), [items]);
  const avg = opexAverage(schedule);
  const total = opexTotal(schedule);
  const headcount = items.filter(i => i.category === 'payroll').length;
  const monthEnd = schedule[schedule.length - 1] ?? 0;

  const update = (id: string, patch: Partial<OpexItem>) =>
    setItems(prev => prev.map(it => (it.id === id ? { ...it, ...patch } : it)));
  const remove = (id: string) => setItems(prev => prev.filter(it => it.id !== id));
  const add = () =>
    setItems(prev => [...prev, { id: uid(), name: 'New line', category: 'other', amount: 5000, startMonth: 0, endMonth: MONTHS - 1, growth: 0 }]);

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
          Build OpEx from employees + expenses across {MONTHS} months — each line can ramp up or down.
          The average feeds <Link to="/admin/model" className="opex-link">the Model</Link>’s Monthly OpEx.
        </p>
      </div>

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
        <div className="proj-summary-card">
          <span className="proj-summary-label">Headcount lines</span>
          <span className="proj-summary-value">{headcount}</span>
          <span className="proj-summary-sub">payroll items</span>
        </div>
      </div>

      <section className="model-card">
        <h3>OpEx by month</h3>
        <OpexChart items={items} />
      </section>

      <section className="model-card opex-table-card">
        <div className="model-card-head">
          <h3>Line items</h3>
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
                  <td>
                    <span className="opex-in-pct">
                      <input className="opex-in opex-in-num" type="number" step={1} value={Math.round(it.growth * 100)} onChange={e => update(it.id, { growth: (Number(e.target.value) || 0) / 100 })} />%
                    </span>
                  </td>
                  <td><button className="opex-del" onClick={() => remove(it.id)} aria-label={`Remove ${it.name}`}>×</button></td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={7} className="opex-empty">No line items yet — add employees and expenses to build your OpEx.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

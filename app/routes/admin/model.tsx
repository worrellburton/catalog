import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type Assumptions,
  DEFAULTS,
  MONTHS,
  STORAGE_KEY,
  fmtCurrency,
  fmtNumber,
  fmtPercent,
  readStored,
  summarize,
} from '~/services/projections';
import {
  type GtmAssumptions,
  DAU_MAU_RATIO,
  GTM_DEFAULTS,
  GTM_STORAGE_KEY,
  readGtmStored,
  summarizeGtm,
} from '~/services/go-to-market';
import { buildModel } from '~/services/model';
import AssumptionCard, { type FieldDef } from '~/components/model/AssumptionCard';
import ModelRow from '~/components/model/ModelRow';
import UnifiedModelChart from '~/components/model/UnifiedModelChart';

const COLORS = { acquisition: '#6366f1', engagement: '#f59e0b', revenue: '#10b981' };
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

// Acquisition — budget leads, per request.
const ACQ_FIELDS: FieldDef[] = [
  { key: 'budget',          label: 'Total advertising spend',     hint: 'Total ad spend across 16 months',    format: 'currency', step: 5000, min: 0 },
  { key: 'cpa',             label: 'CPA',                         hint: 'Cost per paid acquisition',          format: 'currency', step: 1,    min: 0 },
  { key: 'organicGrowth',   label: 'Organic growth',              hint: 'Word-of-mouth adds, % of base / mo', format: 'percent',  step: 0.01, min: 0, max: 1 },
  { key: 'budgetDistEarly', label: 'Budget split (early)',        hint: 'Share of spend up front · totals 100%', format: 'percent', step: 0.01, min: 0, max: 1 },
  { key: 'budgetDistLate',  label: 'Budget split (late)',         hint: 'Share of spend at the tail · totals 100%', format: 'percent', step: 0.01, min: 0, max: 1 },
];

// Engagement — session behaviour that turns MAU into sales.
const ENGAGEMENT_FIELDS: FieldDef[] = [
  { key: 'sessionsPerUserPerMonth',  label: 'Sessions / user / mo',  hint: 'Avg sessions per MAU per month', format: 'number',  step: 0.5,   min: 0 },
  { key: 'sessionTimeMinutes',       label: 'Session time (min)',    hint: 'Average session length',         format: 'number',  step: 0.5,   min: 0 },
  { key: 'avgImpressionsPerSession', label: 'Impressions / session', hint: 'Product views per session',      format: 'integer', step: 1,     min: 0 },
  { key: 'productConversion',        label: 'Product conversion',    hint: 'Sale per impression',            format: 'percent', step: 0.001, min: 0, max: 0.5 },
];

// Revenue — monetisation applied to sales.
const REVENUE_FIELDS: FieldDef[] = [
  { key: 'avgCostPerSale',         label: 'Avg cost per sale',        hint: 'Average order value', format: 'currency', step: 5,     min: 0 },
  { key: 'avgAffiliateCommission', label: 'Avg affiliate commission', hint: 'Take rate per sale',  format: 'percent',  step: 0.005, min: 0, max: 0.5 },
];

type RowKey = 'acquisition' | 'engagement' | 'revenue';
const DEFAULT_ORDER: RowKey[] = ['acquisition', 'engagement', 'revenue'];

interface ModelUi {
  order: RowKey[];
  show: Record<RowKey, boolean>;
  open: Record<RowKey, boolean>;
}
const UI_KEY = 'catalog:model:ui:v2';
const UI_DEFAULTS: ModelUi = {
  order: DEFAULT_ORDER,
  show: { acquisition: true, engagement: true, revenue: true },
  open: { acquisition: true, engagement: false, revenue: false },
};

function readUi(): ModelUi {
  if (typeof window === 'undefined') return UI_DEFAULTS;
  try {
    const raw = window.localStorage.getItem(UI_KEY);
    if (!raw) return UI_DEFAULTS;
    const p = JSON.parse(raw);
    // Guard the order against missing/extra keys so a stale blob can't
    // drop or duplicate a row.
    const order = (Array.isArray(p.order) ? p.order : DEFAULT_ORDER).filter((k: RowKey) => DEFAULT_ORDER.includes(k));
    for (const k of DEFAULT_ORDER) if (!order.includes(k)) order.push(k);
    return {
      order,
      show: { ...UI_DEFAULTS.show, ...(p.show || {}) },
      open: { ...UI_DEFAULTS.open, ...(p.open || {}) },
    };
  } catch { return UI_DEFAULTS; }
}

export default function AdminModel() {
  const [rev, setRev] = useState<Assumptions>(() => readStored());
  const [acq, setAcq] = useState<GtmAssumptions>(() => readGtmStored());
  const [ui, setUi] = useState<ModelUi>(() => readUi());

  useEffect(() => { try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rev)); } catch { /* quota */ } }, [rev]);
  useEffect(() => { try { window.localStorage.setItem(GTM_STORAGE_KEY, JSON.stringify(acq)); } catch { /* quota */ } }, [acq]);
  useEffect(() => { try { window.localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch { /* quota */ } }, [ui]);

  // Acquisition always supplies the MAU the funnel runs on.
  const { revenue, acquisition } = useMemo(() => buildModel(rev, acq, true), [rev, acq]);
  const revSummary = useMemo(() => summarize(revenue), [revenue]);
  const acqSummary = useMemo(() => summarizeGtm(acquisition, acq), [acquisition, acq]);
  const lastAcq = acquisition[acquisition.length - 1];
  const totalSales = useMemo(() => revenue.reduce((a, s) => a + s.sales, 0), [revenue]);

  const setRevField = (k: keyof Assumptions, v: number) => setRev(prev => ({ ...prev, [k]: v }));
  const setAcqField = (k: keyof GtmAssumptions, v: number) => setAcq(prev => ({ ...prev, [k]: v }));

  // Budget split is a complementary pair that always totals 100%.
  const onAcqChange = (k: keyof GtmAssumptions, n: number) => {
    if (k === 'budgetDistEarly') setAcq(p => ({ ...p, budgetDistEarly: clamp01(n), budgetDistLate: clamp01(1 - n) }));
    else if (k === 'budgetDistLate') setAcq(p => ({ ...p, budgetDistLate: clamp01(n), budgetDistEarly: clamp01(1 - n) }));
    else setAcqField(k, n);
  };

  const setShow = (k: RowKey, v: boolean) => setUi(p => ({ ...p, show: { ...p.show, [k]: v } }));
  const toggleOpen = (k: RowKey) => setUi(p => ({ ...p, open: { ...p.open, [k]: !p.open[k] } }));
  const resetEngagement = () => setRev(p => ({ ...p, sessionsPerUserPerMonth: DEFAULTS.sessionsPerUserPerMonth, sessionTimeMinutes: DEFAULTS.sessionTimeMinutes, avgImpressionsPerSession: DEFAULTS.avgImpressionsPerSession, productConversion: DEFAULTS.productConversion }));
  const resetRevenue = () => setRev(p => ({ ...p, avgCostPerSale: DEFAULTS.avgCostPerSale, avgAffiliateCommission: DEFAULTS.avgAffiliateCommission }));

  // Drag-to-reorder the cards.
  const dragKey = useRef<RowKey | null>(null);
  const [overKey, setOverKey] = useState<RowKey | null>(null);
  const onDrop = (target: RowKey) => {
    const from = dragKey.current;
    dragKey.current = null;
    setOverKey(null);
    if (!from || from === target) return;
    setUi(p => {
      const order = [...p.order];
      order.splice(order.indexOf(from), 1);
      order.splice(order.indexOf(target), 0, from);
      return { ...p, order };
    });
  };

  const renderRow = (key: RowKey) => {
    const common = {
      key,
      color: COLORS[key],
      checked: ui.show[key],
      onCheckedChange: (v: boolean) => setShow(key, v),
      open: ui.open[key],
      onToggle: () => toggleOpen(key),
      onDragStart: () => { dragKey.current = key; },
      onDragEnter: () => { if (dragKey.current && dragKey.current !== key) setOverKey(key); },
      onDragEnd: () => { dragKey.current = null; setOverKey(null); },
      onDrop: () => onDrop(key),
      isDragging: dragKey.current === key,
      isDragOver: overKey === key,
    };

    if (key === 'acquisition') {
      return (
        <ModelRow {...common} title="Acquisition" subtitle="Paid + organic → MAU">
          <div className="model-row-actions">
            <button className="admin-btn admin-btn-secondary" onClick={() => setAcq(GTM_DEFAULTS)}>Reset acquisition</button>
          </div>
          <div className="proj-cards model-cards">
            {ACQ_FIELDS.map(f => (
              <AssumptionCard key={f.key} field={f} value={acq[f.key as keyof GtmAssumptions]} onChange={(n) => onAcqChange(f.key as keyof GtmAssumptions, n)} />
            ))}
          </div>
        </ModelRow>
      );
    }
    if (key === 'engagement') {
      return (
        <ModelRow {...common} title="Engagement" subtitle="Sessions × impressions × conversion → sales">
          <div className="model-row-actions">
            <button className="admin-btn admin-btn-secondary" onClick={resetEngagement}>Reset engagement</button>
          </div>
          <p className="model-link-note">Runs on <strong style={{ color: COLORS.acquisition }}>Acquisition</strong>'s MAU and feeds <strong style={{ color: COLORS.revenue }}>Revenue</strong>'s sales.</p>
          <div className="proj-cards model-cards">
            {ENGAGEMENT_FIELDS.map(f => (
              <AssumptionCard key={f.key} field={f} value={rev[f.key as keyof Assumptions]} onChange={(n) => setRevField(f.key as keyof Assumptions, n)} />
            ))}
          </div>
        </ModelRow>
      );
    }
    return (
      <ModelRow {...common} title="Revenue" subtitle="AOV × commission → revenue">
        <div className="model-row-actions">
          <button className="admin-btn admin-btn-secondary" onClick={resetRevenue}>Reset revenue</button>
        </div>
        <p className="model-link-note">Monetises <strong style={{ color: COLORS.engagement }}>Engagement</strong>'s sales — {fmtNumber(totalSales)} orders over {MONTHS} months.</p>
        <div className="proj-cards model-cards">
          {REVENUE_FIELDS.map(f => (
            <AssumptionCard key={f.key} field={f} value={rev[f.key as keyof Assumptions]} onChange={(n) => setRevField(f.key as keyof Assumptions, n)} />
          ))}
        </div>
      </ModelRow>
    );
  };

  return (
    <div className="admin-page model-page">
      <div className="admin-page-header">
        <h1>Model</h1>
        <p className="admin-page-subtitle">Acquisition → MAU, Engagement → sales, Revenue → $. Each feeds the next. Toggle any line, drag to reorder.</p>
      </div>

      <div className="model-layout">
        <div className="model-left">
          <div className="model-rows">
            {ui.order.map(renderRow)}
          </div>

          {/* Headline dials — results, including DAU/MAU averages. */}
          <div className="proj-summary model-dials">
            {ui.show.revenue && (
              <>
                <div className="proj-summary-card">
                  <span className="proj-summary-label">16-month revenue</span>
                  <span className="proj-summary-value">{fmtCurrency(revSummary.total)}</span>
                </div>
                <div className="proj-summary-card">
                  <span className="proj-summary-label">Exit run-rate (ARR)</span>
                  <span className="proj-summary-value">{fmtCurrency(revSummary.finalRunRate)}</span>
                  <span className="proj-summary-sub">Final month × 12</span>
                </div>
              </>
            )}
            {ui.show.engagement && (
              <div className="proj-summary-card gtm-dial-engage">
                <span className="proj-summary-label">Total sales</span>
                <span className="proj-summary-value">{fmtNumber(totalSales)}</span>
                <span className="proj-summary-sub">orders over {MONTHS} months</span>
              </div>
            )}
            {ui.show.acquisition && (
              <>
                <div className="proj-summary-card gtm-dial-organic">
                  <span className="proj-summary-label">Avg MAU</span>
                  <span className="proj-summary-value">{fmtNumber(acqSummary.avgMau)}</span>
                  <span className="proj-summary-sub">month {MONTHS}: {fmtNumber(lastAcq?.cumulativeUsers ?? 0)} · DAU {fmtNumber(acqSummary.avgDau)}</span>
                </div>
                <div className="proj-summary-card gtm-dial-paid">
                  <span className="proj-summary-label">Blended CAC</span>
                  <span className="proj-summary-value">{fmtCurrency(acqSummary.blendedCac)}</span>
                  <span className="proj-summary-sub">{fmtPercent(acqSummary.organicShare, 0)} organic · vs {fmtCurrency(acq.cpa)} CPA</span>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="model-right">
          <UnifiedModelChart
            revenue={revenue}
            acquisition={acquisition}
            showRevenue={ui.show.revenue}
            showAcquisition={ui.show.acquisition}
            showEngagement={ui.show.engagement}
          />
        </div>
      </div>
    </div>
  );
}

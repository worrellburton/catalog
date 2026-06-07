import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type Assumptions,
  DEFAULTS,
  MONTHS,
  fmtNumber,
  fmtPercent,
  summarize,
} from '~/services/projections';
import {
  type GtmAssumptions,
  GTM_DEFAULTS,
  summarizeGtm,
} from '~/services/go-to-market';
import { buildModel } from '~/services/model';
import {
  type EconAssumptions,
  type ScenarioId,
  ECON_DEFAULTS,
  buildCashflow,
  cohortRetention,
  deriveScenario,
  investorMetrics,
  sensitivity,
  toCsv,
} from '~/services/model-metrics';
import { useSharedModelSettings } from '~/hooks/useSharedModelSettings';
import AssumptionCard, { type FieldDef } from '~/components/model/AssumptionCard';
import ModelRow from '~/components/model/ModelRow';
import UnifiedModelChart from '~/components/model/UnifiedModelChart';
import ModelHeadline from '~/components/model/ModelHeadline';
import ModelMetrics from '~/components/model/ModelMetrics';
import SensitivityChart from '~/components/model/SensitivityChart';
import RetentionSparkline from '~/components/model/RetentionSparkline';
import FunnelTable from '~/components/model/FunnelTable';

const COLORS = { acquisition: '#6366f1', engagement: '#f59e0b', revenue: '#10b981', costs: '#0f172a' };
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

const ACQ_FIELDS: FieldDef[] = [
  { key: 'budget',          label: 'Total advertising spend',     hint: 'Total ad spend across 16 months',    format: 'currency', step: 5000, min: 0 },
  { key: 'cpa',             label: 'CPA',                         hint: 'Cost per paid acquisition',          format: 'currency', step: 1,    min: 0, benchmark: '$5–$30 consumer' },
  { key: 'organicGrowth',   label: 'Organic growth',              hint: 'Word-of-mouth adds, % of base / mo', format: 'percent',  step: 0.01, min: 0, max: 1, benchmark: '10–30%/mo early' },
  { key: 'budgetDistEarly', label: 'Budget split (early)',        hint: 'Share of spend up front · totals 100%', format: 'percent', step: 0.01, min: 0, max: 1 },
  { key: 'budgetDistLate',  label: 'Budget split (late)',         hint: 'Share of spend at the tail · totals 100%', format: 'percent', step: 0.01, min: 0, max: 1 },
];

const CHURN_FIELD: FieldDef = { key: 'churn', label: 'Monthly churn', hint: "Active users who don't return / mo", format: 'percent', step: 0.01, min: 0, max: 1, benchmark: '3–8%/mo consumer' };

const ENGAGEMENT_FIELDS: FieldDef[] = [
  { key: 'sessionsPerUserPerMonth',  label: 'Sessions / user / mo',  hint: 'Avg sessions per MAU per month', format: 'number',  step: 0.5,   min: 0, benchmark: '6–12' },
  { key: 'sessionTimeMinutes',       label: 'Session time (min)',    hint: 'Average session length',         format: 'number',  step: 0.5,   min: 0, benchmark: '3–6 min' },
  { key: 'avgImpressionsPerSession', label: 'Impressions / session', hint: 'Product views per session',      format: 'integer', step: 1,     min: 0, benchmark: '10–40' },
  { key: 'productConversion',        label: 'Product conversion',    hint: 'Sale per impression',            format: 'percent', step: 0.001, min: 0, max: 0.5, benchmark: '1–2% marketplace' },
];

const REVENUE_FIELDS: FieldDef[] = [
  { key: 'avgCostPerSale',         label: 'Avg cost per sale',        hint: 'Average order value', format: 'currency', step: 5,     min: 0, benchmark: '$40–$120 AOV' },
  { key: 'avgAffiliateCommission', label: 'Avg affiliate commission', hint: 'Take rate per sale',  format: 'percent',  step: 0.005, min: 0, max: 0.5, benchmark: '8–15%' },
];

const COSTS_FIELDS: FieldDef[] = [
  { key: 'grossMargin',  label: 'Gross margin',  hint: 'Margin on revenue',          format: 'percent',  step: 0.01,   min: 0, max: 1, benchmark: '80–90% affiliate' },
  { key: 'monthlyOpex',  label: 'Monthly OpEx',  hint: 'Fixed operating cost / mo',  format: 'currency', step: 5000,   min: 0 },
  { key: 'startingCash', label: 'Cash raised',   hint: 'Cash on hand at month 0',    format: 'currency', step: 100000, min: 0 },
];

type RowKey = 'acquisition' | 'engagement' | 'revenue' | 'costs';
const DEFAULT_ORDER: RowKey[] = ['acquisition', 'engagement', 'revenue', 'costs'];

interface ModelUi {
  order: RowKey[];
  show: Record<RowKey, boolean>;
  open: Record<RowKey, boolean>;
  showFunnel: boolean;
  scenario: ScenarioId;
}
const UI_KEY = 'catalog:model:ui:v4';
const UI_DEFAULTS: ModelUi = {
  order: DEFAULT_ORDER,
  show: { acquisition: true, engagement: true, revenue: true, costs: false },
  open: { acquisition: true, engagement: false, revenue: false, costs: false },
  showFunnel: false,
  scenario: 'base',
};

function readUi(): ModelUi {
  if (typeof window === 'undefined') return UI_DEFAULTS;
  try {
    const raw = window.localStorage.getItem(UI_KEY);
    if (!raw) return UI_DEFAULTS;
    const p = JSON.parse(raw);
    const order = (Array.isArray(p.order) ? p.order : DEFAULT_ORDER).filter((k: RowKey) => DEFAULT_ORDER.includes(k));
    for (const k of DEFAULT_ORDER) if (!order.includes(k)) order.push(k);
    return {
      order,
      show: { ...UI_DEFAULTS.show, ...(p.show || {}) },
      open: { ...UI_DEFAULTS.open, ...(p.open || {}) },
      showFunnel: !!p.showFunnel,
      scenario: (p.scenario === 'bear' || p.scenario === 'bull') ? p.scenario : 'base',
    };
  } catch { return UI_DEFAULTS; }
}

export default function AdminModel() {
  // Model numbers are shared + real-time (one app_settings row, synced
  // across every admin session). UI prefs (order, open/closed, which lines
  // show) stay per-browser.
  const { rev, acq, econ, setRev, setAcq, setEcon, live } = useSharedModelSettings();
  const [ui, setUi] = useState<ModelUi>(() => readUi());

  useEffect(() => { try { window.localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch { /* quota */ } }, [ui]);

  // Base is the editable source of truth; Bear/Bull are derived from it
  // and locked. `eff` is whatever scenario is currently being viewed.
  const readOnly = ui.scenario !== 'base';
  const eff = useMemo(() => deriveScenario({ rev, acq, econ }, ui.scenario), [rev, acq, econ, ui.scenario]);
  const { rev: erev, acq: eacq, econ: eecon } = eff;

  const { revenue, acquisition } = useMemo(() => buildModel(erev, eacq, true), [erev, eacq]);
  const revSummary = useMemo(() => summarize(revenue), [revenue]);
  const acqSummary = useMemo(() => summarizeGtm(acquisition, eacq), [acquisition, eacq]);
  const cash = useMemo(() => buildCashflow(revenue, acquisition, eecon), [revenue, acquisition, eecon]);
  const metrics = useMemo(() => investorMetrics(erev, eacq, revenue, acquisition, acqSummary, eecon, cash), [erev, eacq, revenue, acquisition, acqSummary, eecon, cash]);
  const sens = useMemo(() => sensitivity(erev, eacq), [erev, eacq]);
  const retention = useMemo(() => cohortRetention(eacq.churn), [eacq.churn]);
  const totalSales = useMemo(() => revenue.reduce((a, s) => a + s.sales, 0), [revenue]);

  const setRevField = (k: keyof Assumptions, v: number) => setRev(prev => ({ ...prev, [k]: v }));
  const setAcqField = (k: keyof GtmAssumptions, v: number) => setAcq(prev => ({ ...prev, [k]: v }));
  const setEconField = (k: keyof EconAssumptions, v: number) => setEcon(prev => ({ ...prev, [k]: v }));

  const onAcqChange = (k: keyof GtmAssumptions, n: number) => {
    if (k === 'budgetDistEarly') setAcq(p => ({ ...p, budgetDistEarly: clamp01(n), budgetDistLate: clamp01(1 - n) }));
    else if (k === 'budgetDistLate') setAcq(p => ({ ...p, budgetDistLate: clamp01(n), budgetDistEarly: clamp01(1 - n) }));
    else setAcqField(k, n);
  };

  const setShow = (k: RowKey, v: boolean) => setUi(p => ({ ...p, show: { ...p.show, [k]: v } }));
  const toggleOpen = (k: RowKey) => setUi(p => ({ ...p, open: { ...p.open, [k]: !p.open[k] } }));
  const resetEngagement = () => {
    setRev(p => ({ ...p, sessionsPerUserPerMonth: DEFAULTS.sessionsPerUserPerMonth, sessionTimeMinutes: DEFAULTS.sessionTimeMinutes, avgImpressionsPerSession: DEFAULTS.avgImpressionsPerSession, productConversion: DEFAULTS.productConversion }));
    setAcq(p => ({ ...p, churn: GTM_DEFAULTS.churn }));
  };
  const resetRevenue = () => setRev(p => ({ ...p, avgCostPerSale: DEFAULTS.avgCostPerSale, avgAffiliateCommission: DEFAULTS.avgAffiliateCommission }));

  const setScenario = (id: ScenarioId) => setUi(p => ({ ...p, scenario: id }));
  const exportCsv = () => {
    const csv = toCsv(revenue, acquisition, cash);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'catalog-model.csv';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  // Drag-to-reorder.
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
        <ModelRow {...common} title="Acquisition" subtitle="Paid + organic → MAU" onReset={readOnly ? undefined : () => setAcq(GTM_DEFAULTS)}>
          <div className="proj-cards model-cards">
            {ACQ_FIELDS.map(f => (
              <AssumptionCard key={f.key} field={f} value={eacq[f.key as keyof GtmAssumptions]} readOnly={readOnly} onChange={(n) => onAcqChange(f.key as keyof GtmAssumptions, n)} />
            ))}
          </div>
        </ModelRow>
      );
    }
    if (key === 'engagement') {
      return (
        <ModelRow {...common} title="Engagement" subtitle="Retention × sessions × conversion → sales" onReset={readOnly ? undefined : resetEngagement}>
          <p className="model-link-note">Churn trims <strong style={{ color: COLORS.acquisition }}>Acquisition</strong>'s MAU; the rest turns it into <strong style={{ color: COLORS.revenue }}>Revenue</strong>'s sales.</p>
          <div className="proj-cards model-cards">
            <AssumptionCard key="churn" field={CHURN_FIELD} value={eacq.churn} readOnly={readOnly} onChange={(n) => setAcqField('churn', clamp01(n))} />
            {ENGAGEMENT_FIELDS.map(f => (
              <AssumptionCard key={f.key} field={f} value={erev[f.key as keyof Assumptions]} readOnly={readOnly} onChange={(n) => setRevField(f.key as keyof Assumptions, n)} />
            ))}
          </div>
        </ModelRow>
      );
    }
    if (key === 'costs') {
      return (
        <ModelRow {...common} title="Costs & cash" subtitle="Margin, OpEx, runway → cash line" onReset={readOnly ? undefined : () => setEcon(ECON_DEFAULTS)}>
          <p className="model-link-note">Burn = marketing + OpEx − gross profit. The checkbox plots the <strong style={{ color: COLORS.costs }}>cash</strong> balance.</p>
          <div className="proj-cards model-cards">
            {COSTS_FIELDS.map(f => (
              <AssumptionCard key={f.key} field={f} value={eecon[f.key as keyof EconAssumptions]} readOnly={readOnly} onChange={(n) => setEconField(f.key as keyof EconAssumptions, n)} />
            ))}
          </div>
        </ModelRow>
      );
    }
    return (
      <ModelRow {...common} title="Revenue" subtitle="AOV × commission → revenue" onReset={readOnly ? undefined : resetRevenue}>
        <p className="model-link-note">Monetises <strong style={{ color: COLORS.engagement }}>Engagement</strong>'s sales — {fmtNumber(totalSales)} orders over {MONTHS} months.</p>
        <div className="proj-cards model-cards">
          {REVENUE_FIELDS.map(f => (
            <AssumptionCard key={f.key} field={f} value={erev[f.key as keyof Assumptions]} readOnly={readOnly} onChange={(n) => setRevField(f.key as keyof Assumptions, n)} />
          ))}
        </div>
      </ModelRow>
    );
  };

  return (
    <div className="admin-page model-page">
      <div className="admin-page-header">
        <h1>
          Model
          <span className={`model-live${live ? ' is-live' : ''}`} title={live ? 'Saved for everyone — edits sync live across admins' : 'Shared model — connecting…'}>
            <span className="model-live-dot" />
            {live ? 'Live · shared' : 'Shared'}
          </span>
        </h1>
        <p className="admin-page-subtitle">Acquisition → MAU, Engagement → sales, Revenue → $, Costs → runway. Numbers are shared with every admin in real time. Toggle any line, drag to reorder.</p>
      </div>

      <ModelHeadline scenario={ui.scenario} onScenario={setScenario} onExportCsv={exportCsv} onPrint={() => window.print()} />

      {readOnly && (
        <div className="model-locked-banner">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span>Viewing the <strong>{ui.scenario === 'bear' ? 'Bear' : 'Bull'}</strong> case — derived from your Base. Switch to <strong>Base</strong> to edit the assumptions.</span>
        </div>
      )}

      <div className="model-layout">
        <div className="model-left">
          <div className="model-rows">
            {ui.order.map(renderRow)}
          </div>
        </div>

        <div className="model-right">
          {/* All the headline facts in one minimal card, above the curve. */}
          <ModelMetrics metrics={metrics} revSummary={revSummary} acqSummary={acqSummary} totalSales={totalSales} rev={erev} acq={eacq} econ={eecon} />

          <UnifiedModelChart
            revenue={revenue}
            acquisition={acquisition}
            cash={cash}
            showRevenue={ui.show.revenue}
            showAcquisition={ui.show.acquisition}
            showEngagement={ui.show.engagement}
            showCash={ui.show.costs}
          />
        </div>
      </div>

      {/* Investor analysis: sensitivity + cohort retention, plus the full funnel. */}
      <div className="model-analysis">
        <div className="model-analysis-grid">
          <section className="model-card">
            <h3>Sensitivity — exit ARR swing at ±20%</h3>
            <SensitivityChart rows={sens} />
          </section>
          <section className="model-card">
            <h3>Cohort retention at {fmtPercent(acq.churn, 0)} churn</h3>
            <RetentionSparkline data={retention} />
            <p className="model-card-note">Of a cohort acquired in month 1, the share still active each month after.</p>
          </section>
        </div>
        <section className="model-card">
          <div className="model-card-head">
            <h3>Monthly funnel</h3>
            <button className="admin-btn admin-btn-secondary" onClick={() => setUi(p => ({ ...p, showFunnel: !p.showFunnel }))}>
              {ui.showFunnel ? 'Hide' : 'Show'} table
            </button>
          </div>
          {ui.showFunnel && <FunnelTable revenue={revenue} acquisition={acquisition} />}
        </section>
      </div>
    </div>
  );
}

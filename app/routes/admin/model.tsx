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
  deriveScenario,
  investorMetrics,
  toCsv,
} from '~/services/model-metrics';
import { useSharedModelSettings } from '~/hooks/useSharedModelSettings';
import { useSharedOpex, useSharedPayroll, useSharedCreatorPayout } from '~/hooks/useSharedOpex';
import { buildCombinedSchedule } from '~/services/opex';
import { Link } from '@remix-run/react';
import AssumptionCard, { type FieldDef } from '~/components/model/AssumptionCard';
import ModelRow from '~/components/model/ModelRow';
import UnifiedModelChart from '~/components/model/UnifiedModelChart';
import ModelHeadline from '~/components/model/ModelHeadline';
import ModelMetrics from '~/components/model/ModelMetrics';
import ModelTabs from '~/components/model/ModelTabs';
import { openBusinessPlan } from '~/utils/business-plan';
import RateAssumptionsModal from '~/components/model/RateAssumptionsModal';
import FunnelTable from '~/components/model/FunnelTable';

const COLORS = { acquisition: '#6366f1', engagement: '#f59e0b', revenue: '#10b981', costs: '#0f172a', payout: '#ec4899' };
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

const ACQ_FIELDS: FieldDef[] = [
  { key: 'budget',          label: 'Total advertising spend',     hint: 'Total ad spend across 16 months',    format: 'currency', step: 5000, min: 0 },
  { key: 'cpa',             label: 'CPA',                         hint: 'Cost per acquired user',             format: 'currency', step: 1,    min: 0, benchmark: '$5–$30 consumer' },
  { key: 'organicGrowth',   label: 'Organic growth',              hint: 'Word-of-mouth adds, % of base / mo', format: 'percent',  step: 0.01, min: 0, max: 1, benchmark: '10–30%/mo early' },
  { key: 'budgetDistEarly', label: 'Budget split (early)',        hint: 'Share of spend up front · totals 100%', format: 'percent', step: 0.01, min: 0, max: 1 },
  { key: 'budgetDistLate',  label: 'Budget split (late)',         hint: 'Share of spend at the tail · totals 100%', format: 'percent', step: 0.01, min: 0, max: 1 },
];

// New users churn far harder than the established base, so retention is
// split into two inputs surfaced in the Engagement card.
const RETENTION_FIELD: FieldDef = { key: 'newUserRetention', label: 'New-user retention', hint: 'New users who return next month', format: 'percent', step: 0.01, min: 0, max: 1, benchmark: '25–45% M1' };
const MAU_CHURN_FIELD: FieldDef = { key: 'mauChurn', label: 'Monthly active churn', hint: 'Retained base lost / mo', format: 'percent', step: 0.01, min: 0, max: 1, benchmark: '3–6%/mo' };

const ENGAGEMENT_FIELDS: FieldDef[] = [
  { key: 'sessionsPerUserPerMonth',  label: 'Sessions / user / mo',  hint: 'Avg sessions per MAU per month', format: 'number',  step: 0.5,   min: 0, benchmark: '6–12' },
  { key: 'sessionTimeMinutes',       label: 'Session time (min)',    hint: 'Average session length',         format: 'number',  step: 0.5,   min: 0, benchmark: '3–6 min' },
  { key: 'avgImpressionsPerSession', label: 'Impressions / session', hint: 'Product views per session',      format: 'integer', step: 1,     min: 0, benchmark: '10–40' },
];

const REVENUE_FIELDS: FieldDef[] = [
  { key: 'productConversion',      label: 'Product conversion',       hint: 'Sale per impression', format: 'percent',  step: 0.001, min: 0, max: 0.5, benchmark: '1–2% marketplace' },
  { key: 'avgCostPerSale',         label: 'Avg cost per sale',        hint: 'Average order value', format: 'currency', step: 5,     min: 0, benchmark: '$40–$120 AOV' },
  { key: 'avgAffiliateCommission', label: 'Avg affiliate commission', hint: 'Take rate per sale',  format: 'percent',  step: 0.005, min: 0, max: 0.5, benchmark: '8–15%' },
];

const COSTS_FIELDS: FieldDef[] = [
  { key: 'grossMargin',  label: 'Gross margin',  hint: 'Margin on revenue',          format: 'percent',  step: 0.01,   min: 0, max: 1, benchmark: '80–90% affiliate' },
  { key: 'monthlyOpex',  label: 'Monthly OpEx',  hint: 'Fixed operating cost / mo',  format: 'currency', step: 5000,   min: 0 },
  { key: 'startingCash', label: 'Cash raised',   hint: 'Cash on hand at month 0',    format: 'currency', step: 100000, min: 0 },
];

type RowKey = 'acquisition' | 'engagement' | 'revenue' | 'costs' | 'payout';
const DEFAULT_ORDER: RowKey[] = ['acquisition', 'engagement', 'revenue', 'costs', 'payout'];

interface ModelUi {
  order: RowKey[];
  show: Record<RowKey, boolean>;
  open: Record<RowKey, boolean>;
  showFunnel: boolean;
  scenario: ScenarioId;
}
const UI_KEY = 'catalog:model:ui:v5';
const UI_DEFAULTS: ModelUi = {
  order: DEFAULT_ORDER,
  show: { acquisition: true, engagement: true, revenue: true, costs: false, payout: false },
  open: { acquisition: true, engagement: false, revenue: false, costs: false, payout: false },
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
  const { items: opexItems } = useSharedOpex();
  const { items: payrollItems } = useSharedPayroll();
  const { value: creatorPayout } = useSharedCreatorPayout();
  const [ui, setUi] = useState<ModelUi>(() => readUi());

  // OpEx can be driven by the detailed builder (payroll + expenses); when
  // it has line items the model runs on its per-month schedule and the
  // Monthly OpEx field shows the (read-only) average.
  const opexSchedule = useMemo(() => buildCombinedSchedule(opexItems, payrollItems), [opexItems, payrollItems]);
  const hasOpex = (opexItems.length > 0 || payrollItems.length > 0) && opexSchedule.some(v => v > 0);

  useEffect(() => { try { window.localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch { /* quota */ } }, [ui]);

  // Base is the editable source of truth; Bear/Bull are derived from it
  // and locked. `eff` is whatever scenario is currently being viewed.
  const readOnly = ui.scenario !== 'base';
  const eff = useMemo(() => deriveScenario({ rev, acq, econ }, ui.scenario), [rev, acq, econ, ui.scenario]);
  const { rev: erev, acq: eacq, econ: eecon } = eff;

  const { revenue, acquisition } = useMemo(() => buildModel(erev, eacq, true), [erev, eacq]);
  const revSummary = useMemo(() => summarize(revenue), [revenue]);
  const acqSummary = useMemo(() => summarizeGtm(acquisition, eacq), [acquisition, eacq]);
  const cash = useMemo(() => buildCashflow(revenue, acquisition, eecon, hasOpex ? opexSchedule : undefined, creatorPayout), [revenue, acquisition, eecon, hasOpex, opexSchedule, creatorPayout]);
  const metrics = useMemo(() => investorMetrics(erev, eacq, revenue, acquisition, acqSummary, eecon, cash), [erev, eacq, revenue, acquisition, acqSummary, eecon, cash]);
  const totalSales = useMemo(() => revenue.reduce((a, s) => a + s.sales, 0), [revenue]);
  // Creator payout is part of OpEx, so the displayed monthly average includes it.
  const opexAvg = useMemo(() => {
    const per = cash.map(c => c.opex + c.creatorPayout);
    return per.length ? per.reduce((a, b) => a + b, 0) / per.length : 0;
  }, [cash]);

  // "Rate my assumptions" — compact model snapshot sent to Claude + Gemini.
  const [showRate, setShowRate] = useState(false);
  const ratePayload = useMemo(() => ({
    business: 'One consumer shopping app — a single platform across web + iOS/Android with one unified user base — earning affiliate commission on the sales it drives. A broad shopping destination (think Amazon / Pinterest / TikTok), not a fashion-only app.',
    horizonMonths: MONTHS,
    scenario: ui.scenario,
    acquisition: {
      cpa: eacq.cpa, organicGrowthPctPerMonth: eacq.organicGrowth, totalAdSpend: eacq.budget,
      budgetSplitEarly: eacq.budgetDistEarly, budgetSplitLate: eacq.budgetDistLate,
      newUserRetentionM1: eacq.newUserRetention, monthlyActiveChurn: eacq.mauChurn,
    },
    engagement: { sessionsPerUserPerMonth: erev.sessionsPerUserPerMonth, sessionTimeMinutes: erev.sessionTimeMinutes, impressionsPerSession: erev.avgImpressionsPerSession },
    revenue: { productConversion: erev.productConversion, avgOrderValue: erev.avgCostPerSale, affiliateCommission: erev.avgAffiliateCommission },
    costs: { grossMargin: eecon.grossMargin, monthlyOpex: opexAvg, cashRaised: eecon.startingCash },
    creatorPayout,
    results: {
      exitArr: Math.round(metrics.exitArr), total16moRevenue: Math.round(revSummary.total), gmvTotal: Math.round(metrics.gmvTotal),
      ltv: Math.round(metrics.ltv), ltvCac: Number(metrics.ltvCac.toFixed(1)), cacPaybackMonths: Number(metrics.paybackMonths.toFixed(2)),
      blendedCac: Number(acqSummary.blendedCac.toFixed(2)), avgMau: Math.round(acqSummary.avgMau),
      runwayMonths: metrics.runwayMonths, avgMonthlyBurn: Math.round(metrics.avgBurn),
    },
  }), [eacq, erev, eecon, creatorPayout, metrics, revSummary, acqSummary, opexAvg, ui.scenario]);

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
    setRev(p => ({ ...p, sessionsPerUserPerMonth: DEFAULTS.sessionsPerUserPerMonth, sessionTimeMinutes: DEFAULTS.sessionTimeMinutes, avgImpressionsPerSession: DEFAULTS.avgImpressionsPerSession }));
    setAcq(p => ({ ...p, newUserRetention: GTM_DEFAULTS.newUserRetention, mauChurn: GTM_DEFAULTS.mauChurn }));
  };
  const resetRevenue = () => setRev(p => ({ ...p, productConversion: DEFAULTS.productConversion, avgCostPerSale: DEFAULTS.avgCostPerSale, avgAffiliateCommission: DEFAULTS.avgAffiliateCommission }));

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

  // Full Catalog-branded business plan (target customer → product → market →
  // GTM → unit economics → financials WITH assumptions), built from the live
  // model snapshot. Opens in a new tab to read / Save as PDF.
  const downloadBusinessPlan = () => {
    openBusinessPlan({
      generatedAt: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      scenario: ui.scenario,
      horizonMonths: MONTHS,
      acquisition: {
        cpa: eacq.cpa,
        organicGrowth: eacq.organicGrowth,
        budget: eacq.budget,
        budgetSplitEarly: eacq.budgetDistEarly,
        budgetSplitLate: eacq.budgetDistLate,
        newUserRetention: eacq.newUserRetention,
        monthlyActiveChurn: eacq.mauChurn,
      },
      engagement: {
        sessionsPerUserPerMonth: erev.sessionsPerUserPerMonth,
        sessionTimeMinutes: erev.sessionTimeMinutes,
        impressionsPerSession: erev.avgImpressionsPerSession,
      },
      revenue: {
        productConversion: erev.productConversion,
        avgOrderValue: erev.avgCostPerSale,
        affiliateCommission: erev.avgAffiliateCommission,
      },
      costs: { grossMargin: eecon.grossMargin, monthlyOpex: opexAvg, cashRaised: eecon.startingCash },
      creatorPayout: creatorPayout.percent,
      results: {
        exitArr: metrics.exitArr,
        total16moRevenue: revSummary.total,
        gmvTotal: metrics.gmvTotal,
        totalSales,
        ltv: metrics.ltv,
        ltvCac: metrics.ltvCac,
        cacPaybackMonths: metrics.paybackMonths,
        blendedCac: acqSummary.blendedCac,
        avgMau: acqSummary.avgMau,
        runwayMonths: metrics.runwayMonths,
        avgBurn: metrics.avgBurn,
      },
    });
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
        <ModelRow {...common} title="Engagement" subtitle="Retention × sessions → impressions" onReset={readOnly ? undefined : resetEngagement}>
          <p className="model-link-note">Retention &amp; churn shape <strong style={{ color: COLORS.acquisition }}>Acquisition</strong>'s MAU; the rest turns it into <strong style={{ color: COLORS.revenue }}>Revenue</strong>'s sales.</p>
          <div className="proj-cards model-cards">
            <AssumptionCard key="newUserRetention" field={RETENTION_FIELD} value={eacq.newUserRetention} readOnly={readOnly} onChange={(n) => setAcqField('newUserRetention', clamp01(n))} />
            <AssumptionCard key="mauChurn" field={MAU_CHURN_FIELD} value={eacq.mauChurn} readOnly={readOnly} onChange={(n) => setAcqField('mauChurn', clamp01(n))} />
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
          <p className="model-link-note">
            Burn = marketing + OpEx − gross profit. The checkbox plots the <strong style={{ color: COLORS.costs }}>cash</strong> balance.
            {' '}Build OpEx from headcount &amp; expenses in the <Link to="/admin/model/opex" className="opex-link">OpEx builder →</Link>
          </p>
          <div className="proj-cards model-cards">
            {COSTS_FIELDS.map(f => {
              if (f.key === 'monthlyOpex' && hasOpex) {
                return <AssumptionCard key={f.key} field={{ ...f, hint: 'Avg incl. creator payout · per-month drives the model' }} value={opexAvg} readOnly onChange={() => {}} />;
              }
              return <AssumptionCard key={f.key} field={f} value={eecon[f.key as keyof EconAssumptions]} readOnly={readOnly} onChange={(n) => setEconField(f.key as keyof EconAssumptions, n)} />;
            })}
          </div>
          {/* Creator payout folded in as a sub-toggle of Costs & cash — it's
              part of OpEx/cash, not a standalone driver. Plots the payout line. */}
          <label
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 12,
              paddingTop: 10, borderTop: '1px solid #f0f0f0', fontSize: 12.5,
              color: '#475569', cursor: 'pointer', lineHeight: 1.45,
            }}
          >
            <input
              type="checkbox"
              checked={ui.show.payout}
              onChange={(e) => setShow('payout', e.target.checked)}
              style={{ accentColor: COLORS.payout, marginTop: 2 }}
            />
            <span>
              <strong style={{ color: COLORS.payout }}>Creator payout</strong>
              {' — '}
              {creatorPayout.mode === 'percent'
                ? <>{fmtPercent(creatorPayout.percent, 0)} of revenue to creators</>
                : <>hold a {fmtPercent(creatorPayout.targetMargin, 0)} operating margin; surplus to creators</>}
              {'. Plot the payout line · '}
              <Link to="/admin/model/opex" className="opex-link">configure →</Link>
            </span>
          </label>
        </ModelRow>
      );
    }
    return (
      <ModelRow {...common} title="Revenue" subtitle="Conversion × AOV × commission → revenue" onReset={readOnly ? undefined : resetRevenue}>
        <p className="model-link-note">Monetises <strong style={{ color: COLORS.engagement }}>Engagement</strong>'s sales — {fmtNumber(totalSales)} orders over {MONTHS} months.</p>
        <div className="proj-cards model-cards">
          {REVENUE_FIELDS.map(f => (
            <AssumptionCard key={f.key} field={f} value={erev[f.key as keyof Assumptions]} readOnly={readOnly} onChange={(n) => setRevField(f.key as keyof Assumptions, n)} />
          ))}
        </div>
      </ModelRow>
    );
  };

  // Print → PDF as a single LANDSCAPE page: scale the whole model view to fit
  // one landscape Letter page (usable area at 96 CSS px/in less 0.3in margins),
  // force @page landscape, and isolate the model root from the rest of the admin
  // chrome. Self-contained — the injected <style> is removed on afterprint.
  const printModel = () => {
    const el = document.getElementById('model-print-area');
    let scale = 1;
    let widthPx = 0;
    if (el) {
      const PAGE_W = (11 - 0.6) * 96;   // landscape Letter usable width  (~998px)
      const PAGE_H = (8.5 - 0.6) * 96;  // landscape Letter usable height (~758px)
      const rect = el.getBoundingClientRect();
      widthPx = Math.ceil(rect.width);
      scale = Math.min(PAGE_W / rect.width, PAGE_H / el.scrollHeight, 1);
    }
    const style = document.createElement('style');
    style.textContent = `@media print {
      @page { size: landscape; margin: 0.3in; }
      body * { visibility: hidden !important; }
      #model-print-area, #model-print-area * { visibility: visible !important; }
      #model-print-area {
        position: absolute !important; left: 0 !important; top: 0 !important;
        ${widthPx ? `width: ${widthPx}px !important; max-width: none !important;` : ''}
        /* zoom (not transform) so the layout actually reflows smaller and the
           browser paginates it as ONE page — a transform is paint-only and
           Chrome still breaks pages by the pre-scale height. */
        zoom: ${scale};
      }
    }`;
    document.head.appendChild(style);
    const cleanup = () => { style.remove(); window.removeEventListener('afterprint', cleanup); };
    window.addEventListener('afterprint', cleanup);
    window.print();
  };

  return (
    <div className="admin-page model-page" id="model-print-area">
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

      <ModelTabs active="model" />

      <ModelHeadline scenario={ui.scenario} onScenario={setScenario} onExportCsv={exportCsv} onPrint={printModel} onBusinessPlan={downloadBusinessPlan} onRate={() => setShowRate(true)} />
      <RateAssumptionsModal open={showRate} onClose={() => setShowRate(false)} payload={ratePayload} />

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
            {/* Creator payout is rendered as a sub-toggle inside Costs & cash,
                so it's filtered out of the top-level rows here. */}
            {ui.order.filter(k => k !== 'payout').map(renderRow)}
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
            showPayout={ui.show.payout}
          />
        </div>
      </div>

      {/* Full monthly funnel. */}
      <div className="model-analysis">
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

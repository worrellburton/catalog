import { useEffect, useMemo, useState } from 'react';
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

const REVENUE = '#10b981';
const ACQ = '#6366f1';

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

// Revenue funnel inputs. MAU + its growth are intentionally absent — the
// user base is supplied by the Acquisition model below.
const REV_FIELDS: FieldDef[] = [
  { key: 'avgCostPerSale',           label: 'Avg cost per sale',        hint: 'Average order value',            format: 'currency', step: 5,      min: 0 },
  { key: 'avgAffiliateCommission',   label: 'Avg affiliate commission', hint: 'Take rate per sale',             format: 'percent',  step: 0.005,  min: 0, max: 0.5 },
  { key: 'sessionTimeMinutes',       label: 'Session time (min)',       hint: 'Average session length',         format: 'number',   step: 0.5,    min: 0 },
  { key: 'avgImpressionsPerSession', label: 'Impressions / session',    hint: 'Product views per session',      format: 'integer',  step: 1,      min: 0 },
  { key: 'productConversion',        label: 'Product conversion',       hint: 'Sale per impression',            format: 'percent',  step: 0.001,  min: 0, max: 0.5 },
  { key: 'sessionsPerUserPerMonth',  label: 'Sessions / user / mo',     hint: 'Avg sessions per MAU per month', format: 'number',   step: 0.5,    min: 0 },
];

const ACQ_FIELDS: FieldDef[] = [
  { key: 'cpa',             label: 'CPA',                         hint: 'Cost per paid acquisition',          format: 'currency', step: 1,    min: 0 },
  { key: 'organicGrowth',   label: 'Organic growth',              hint: 'Word-of-mouth adds, % of base / mo', format: 'percent',  step: 0.01, min: 0, max: 1 },
  { key: 'budget',          label: 'Total advertising spend',     hint: 'Total ad spend across 16 months',    format: 'currency', step: 5000, min: 0 },
  { key: 'budgetDistEarly', label: 'Budget split (early)',        hint: 'Share of spend up front · totals 100%', format: 'percent', step: 0.01, min: 0, max: 1 },
  { key: 'budgetDistLate',  label: 'Budget split (late)',         hint: 'Share of spend at the tail · totals 100%', format: 'percent', step: 0.01, min: 0, max: 1 },
];

interface ModelUi {
  showRevenue: boolean;
  showAcquisition: boolean;
  openRevenue: boolean;
  openAcquisition: boolean;
}
const UI_KEY = 'catalog:model:ui:v1';
const UI_DEFAULTS: ModelUi = { showRevenue: true, showAcquisition: true, openRevenue: false, openAcquisition: true };

function readUi(): ModelUi {
  if (typeof window === 'undefined') return UI_DEFAULTS;
  try {
    const raw = window.localStorage.getItem(UI_KEY);
    return raw ? { ...UI_DEFAULTS, ...JSON.parse(raw) } : UI_DEFAULTS;
  } catch { return UI_DEFAULTS; }
}

export default function AdminModel() {
  const [rev, setRev] = useState<Assumptions>(() => readStored());
  const [acq, setAcq] = useState<GtmAssumptions>(() => readGtmStored());
  const [ui, setUi] = useState<ModelUi>(() => readUi());

  useEffect(() => { try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rev)); } catch { /* quota */ } }, [rev]);
  useEffect(() => { try { window.localStorage.setItem(GTM_STORAGE_KEY, JSON.stringify(acq)); } catch { /* quota */ } }, [acq]);
  useEffect(() => { try { window.localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch { /* quota */ } }, [ui]);

  // Acquisition always supplies the MAU the revenue funnel runs on.
  const { revenue, acquisition } = useMemo(() => buildModel(rev, acq, true), [rev, acq]);
  const revSummary = useMemo(() => summarize(revenue), [revenue]);
  const acqSummary = useMemo(() => summarizeGtm(acquisition, acq), [acquisition, acq]);
  const lastAcq = acquisition[acquisition.length - 1];

  const setRevField = (k: keyof Assumptions, v: number) => setRev(prev => ({ ...prev, [k]: v }));
  const setAcqField = (k: keyof GtmAssumptions, v: number) => setAcq(prev => ({ ...prev, [k]: v }));
  const patchUi = (p: Partial<ModelUi>) => setUi(prev => ({ ...prev, ...p }));

  // Budget split is a complementary pair — editing one sets the other so
  // they always total 100%.
  const onAcqChange = (k: keyof GtmAssumptions, n: number) => {
    if (k === 'budgetDistEarly') setAcq(p => ({ ...p, budgetDistEarly: clamp01(n), budgetDistLate: clamp01(1 - n) }));
    else if (k === 'budgetDistLate') setAcq(p => ({ ...p, budgetDistLate: clamp01(n), budgetDistEarly: clamp01(1 - n) }));
    else setAcqField(k, n);
  };

  return (
    <div className="admin-page model-page">
      <div className="admin-page-header">
        <h1>Model</h1>
        <p className="admin-page-subtitle">The financial model — Acquisition drives the MAU that Revenue runs on. Toggle either line onto the graph.</p>
      </div>

      <div className="model-layout">
        <div className="model-left">
          <div className="model-rows">
            <ModelRow
              title="Acquisition"
              subtitle="Paid + organic → DAU / MAU"
              color={ACQ}
              checked={ui.showAcquisition}
              onCheckedChange={(v) => patchUi({ showAcquisition: v })}
              open={ui.openAcquisition}
              onToggle={() => patchUi({ openAcquisition: !ui.openAcquisition })}
            >
              <div className="model-row-actions">
                <button className="admin-btn admin-btn-secondary" onClick={() => setAcq(GTM_DEFAULTS)}>Reset acquisition</button>
              </div>
              <div className="proj-cards model-cards">
                {ACQ_FIELDS.map(f => (
                  <AssumptionCard key={f.key} field={f} value={acq[f.key as keyof GtmAssumptions]} onChange={(n) => onAcqChange(f.key as keyof GtmAssumptions, n)} />
                ))}
              </div>
            </ModelRow>

            <ModelRow
              title="Revenue"
              subtitle="16-month revenue funnel"
              color={REVENUE}
              checked={ui.showRevenue}
              onCheckedChange={(v) => patchUi({ showRevenue: v })}
              open={ui.openRevenue}
              onToggle={() => patchUi({ openRevenue: !ui.openRevenue })}
            >
              <div className="model-row-actions">
                <button className="admin-btn admin-btn-secondary" onClick={() => setRev(DEFAULTS)}>Reset revenue</button>
              </div>
              <p className="model-link-note">
                MAU is driven by <strong>Acquisition</strong> — month 1: {fmtNumber(acquisition[0]?.cumulativeUsers ?? 0)}, month {MONTHS}: {fmtNumber(lastAcq?.cumulativeUsers ?? 0)}.
              </p>
              <div className="proj-cards model-cards">
                {REV_FIELDS.map(f => (
                  <AssumptionCard key={f.key} field={f} value={rev[f.key as keyof Assumptions]} onChange={(n) => setRevField(f.key as keyof Assumptions, n)} />
                ))}
              </div>
            </ModelRow>
          </div>

          {/* Headline dials — results, including DAU/MAU averages. */}
          <div className="proj-summary model-dials">
            {ui.showRevenue && (
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
            {ui.showAcquisition && (
              <>
                <div className="proj-summary-card gtm-dial-organic">
                  <span className="proj-summary-label">Avg MAU</span>
                  <span className="proj-summary-value">{fmtNumber(acqSummary.avgMau)}</span>
                  <span className="proj-summary-sub">month {MONTHS}: {fmtNumber(lastAcq?.cumulativeUsers ?? 0)}</span>
                </div>
                <div className="proj-summary-card gtm-dial-organic">
                  <span className="proj-summary-label">Avg DAU</span>
                  <span className="proj-summary-value">{fmtNumber(acqSummary.avgDau)}</span>
                  <span className="proj-summary-sub">{fmtPercent(DAU_MAU_RATIO, 0)} of MAU</span>
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
            showRevenue={ui.showRevenue}
            showAcquisition={ui.showAcquisition}
          />
        </div>
      </div>
    </div>
  );
}

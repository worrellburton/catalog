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

// Revenue inputs. The first three drive the user base via the growth
// taper — they're hidden when Acquisition is on, because Acquisition
// then supplies the MAU instead.
const REV_GROWTH_KEYS = new Set(['mauStart', 'mauGrowthStart', 'mauGrowthEnd']);
const REV_FIELDS: FieldDef[] = [
  { key: 'mauStart',                 label: 'MAU (month 1)',            hint: 'Monthly active users at start',         format: 'integer',  step: 100,    min: 0 },
  { key: 'mauGrowthStart',           label: 'MAU growth (early)',       hint: 'MoM in the first month',                format: 'percent',  step: 0.01,   min: -0.5, max: 1 },
  { key: 'mauGrowthEnd',             label: 'MAU growth (late)',        hint: 'MoM in the final month - model tapers', format: 'percent',  step: 0.01,   min: -0.5, max: 1 },
  { key: 'avgCostPerSale',           label: 'Avg cost per sale',        hint: 'Average order value',                   format: 'currency', step: 5,      min: 0 },
  { key: 'avgAffiliateCommission',   label: 'Avg affiliate commission', hint: 'Take rate per sale',                    format: 'percent',  step: 0.005,  min: 0, max: 0.5 },
  { key: 'sessionTimeMinutes',       label: 'Session time (min)',       hint: 'Average session length',                format: 'number',   step: 0.5,    min: 0 },
  { key: 'avgImpressionsPerSession', label: 'Impressions / session',    hint: 'Product views per session',             format: 'integer',  step: 1,      min: 0 },
  { key: 'productConversion',        label: 'Product conversion',       hint: 'Sale per impression',                   format: 'percent',  step: 0.001,  min: 0, max: 0.5 },
  { key: 'sessionsPerUserPerMonth',  label: 'Sessions / user / mo',     hint: 'Avg sessions per MAU per month',        format: 'number',   step: 0.5,    min: 0 },
];

const ACQ_FIELDS: FieldDef[] = [
  { key: 'cpa',             label: 'CPA',                         hint: 'Cost per paid acquisition',          format: 'currency', step: 1,    min: 0 },
  { key: 'organicGrowth',   label: 'Organic growth',              hint: 'Word-of-mouth adds, % of base / mo', format: 'percent',  step: 0.01, min: 0, max: 1 },
  { key: 'budget',          label: 'Budget',                      hint: 'Total marketing spend, 16 months',   format: 'currency', step: 5000, min: 0 },
  { key: 'budgetDistEarly', label: 'Budget distribution (early)', hint: 'Relative spend weight in month 1',   format: 'number',   step: 0.1,  min: 0 },
  { key: 'budgetDistLate',  label: 'Budget distribution (late)',  hint: 'Relative spend weight in month 16',  format: 'number',   step: 0.1,  min: 0 },
  { key: 'dauMauRatio',     label: 'DAU / MAU',                   hint: 'Daily-active share of the base',     format: 'percent',  step: 0.01, min: 0, max: 1 },
];

interface ModelUi {
  showRevenue: boolean;
  showAcquisition: boolean;
  openRevenue: boolean;
  openAcquisition: boolean;
}
const UI_KEY = 'catalog:model:ui:v1';
const UI_DEFAULTS: ModelUi = { showRevenue: true, showAcquisition: true, openRevenue: true, openAcquisition: false };

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

  // Acquisition drives the revenue MAU whenever its line is on.
  const linked = ui.showAcquisition;

  const { revenue, acquisition } = useMemo(() => buildModel(rev, acq, linked), [rev, acq, linked]);
  const revSummary = useMemo(() => summarize(revenue), [revenue]);
  const acqSummary = useMemo(() => summarizeGtm(acquisition, acq), [acquisition, acq]);
  const lastAcq = acquisition[acquisition.length - 1];

  const setRevField = (k: keyof Assumptions, v: number) => setRev(prev => ({ ...prev, [k]: v }));
  const setAcqField = (k: keyof GtmAssumptions, v: number) => setAcq(prev => ({ ...prev, [k]: v }));
  const patchUi = (p: Partial<ModelUi>) => setUi(prev => ({ ...prev, ...p }));

  const revFields = linked ? REV_FIELDS.filter(f => !REV_GROWTH_KEYS.has(f.key)) : REV_FIELDS;

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Model</h1>
        <p className="admin-page-subtitle">The financial model — toggle Revenue and Acquisition onto one graph. Acquisition drives the MAU that Revenue runs on.</p>
      </div>

      <div className="model-rows">
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
          {linked && (
            <p className="model-link-note">
              MAU is driven by <strong>Acquisition</strong> — month 1: {fmtNumber(acquisition[0]?.cumulativeUsers ?? 0)}, month {MONTHS}: {fmtNumber(lastAcq?.cumulativeUsers ?? 0)}. Turn Acquisition off to model growth directly.
            </p>
          )}
          <div className="proj-cards model-cards">
            {revFields.map(f => (
              <AssumptionCard key={f.key} field={f} value={rev[f.key as keyof Assumptions]} onChange={(n) => setRevField(f.key as keyof Assumptions, n)} />
            ))}
          </div>
        </ModelRow>

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
          <div className="proj-cards gtm-cards model-cards">
            {ACQ_FIELDS.map(f => (
              <AssumptionCard key={f.key} field={f} value={acq[f.key as keyof GtmAssumptions]} onChange={(n) => setAcqField(f.key as keyof GtmAssumptions, n)} />
            ))}
          </div>
        </ModelRow>
      </div>

      {/* Headline dials — reflect whichever lines are on. */}
      <div className="proj-summary">
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
              <span className="proj-summary-label">MAU (month {MONTHS})</span>
              <span className="proj-summary-value">{fmtNumber(lastAcq?.cumulativeUsers ?? 0)}</span>
              <span className="proj-summary-sub">DAU {fmtNumber(lastAcq?.dau ?? 0)}</span>
            </div>
            <div className="proj-summary-card gtm-dial-paid">
              <span className="proj-summary-label">Blended CAC</span>
              <span className="proj-summary-value">{fmtCurrency(acqSummary.blendedCac)}</span>
              <span className="proj-summary-sub">{fmtPercent(acqSummary.organicShare, 0)} organic · vs {fmtCurrency(acq.cpa)} CPA</span>
            </div>
          </>
        )}
      </div>

      <UnifiedModelChart
        revenue={revenue}
        acquisition={acquisition}
        showRevenue={ui.showRevenue}
        showAcquisition={ui.showAcquisition}
      />
    </div>
  );
}

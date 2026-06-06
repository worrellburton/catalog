// Unifies the two halves of the financial model so the Model page can
// draw them on one graph. Revenue and Acquisition are connected: when
// `linked` is set, the Acquisition model's cumulative users become the
// MAU that the Revenue funnel runs on — Acquisition "replaces the
// growth" on Revenue and feeds the DAU/MAU figures everything else reads.

import {
  type Assumptions,
  type MonthBreakdown,
  buildSeries,
} from './projections';
import {
  type GtmAssumptions,
  type GtmMonth,
  buildGtmSeries,
} from './go-to-market';

export interface UnifiedModel {
  revenue: MonthBreakdown[];
  acquisition: GtmMonth[];
}

export function buildModel(
  rev: Assumptions,
  acq: GtmAssumptions,
  linked: boolean,
): UnifiedModel {
  const acquisition = buildGtmSeries(acq);
  const mauOverride = linked ? acquisition.map(m => m.cumulativeUsers) : undefined;
  const revenue = buildSeries(rev, mauOverride);
  return { revenue, acquisition };
}

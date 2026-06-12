// Client for the equity-advisor edge function — Claude as the
// fundraise advisor, fed the live equity state, the tool's computed
// stages, and the shared model assumptions so its numbers are the
// page's numbers.

import { supabase } from '~/utils/supabase';
import { computeEquity, mergeEquity, type EquityState } from '~/services/equity';
import { readStored } from '~/services/projections';
import { readGtmStored } from '~/services/go-to-market';
import { readEconStored } from '~/services/model-metrics';

export interface AdvisorTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AdvisorAnswer {
  reply: string;
  /** A complete updated EquityState when the advice implies one. */
  proposal: EquityState | null;
}

export async function askEquityAdvisor(messages: AdvisorTurn[], equity: EquityState): Promise<AdvisorAnswer> {
  if (!supabase) throw new Error('No database connection');
  const summary = computeEquity(equity);
  const computed = {
    foundationCap: summary.foundationCap,
    safeShares: summary.safeShares,
    stages: summary.stages.map(s => ({
      round: s.round.name,
      pricePerShare: +s.pricePerShare.toFixed(4),
      postMoney: s.postMoney,
      sharesAfter: s.sharesAfter,
      groups: s.groups.map(g => ({ label: g.label, pct: +(g.pct * 100).toFixed(2), value: Math.round(g.equityValue) })),
    })),
  };
  const model = { rev: readStored(), acq: readGtmStored(), econ: readEconStored() };
  // One automatic retry: long generations occasionally hit the edge
  // runtime's upstream window — the second attempt almost always lands
  // (and the function now keeps answers inside the budget).
  let lastErr = 'advisor unreachable';
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase.functions.invoke('equity-advisor', {
      body: { messages, equity, computed, model },
    });
    const out = data as { success?: boolean; error?: string; reply?: string; proposal?: unknown } | null;
    if (!error && out?.success && out.reply) {
      return {
        reply: out.reply,
        proposal: out.proposal ? mergeEquity(out.proposal) : null,
      };
    }
    lastErr = out?.error ?? error?.message ?? lastErr;
  }
  throw new Error(lastErr);
}

/** The Kaizen pass — one canned, hard-hitting audit prompt. */
export const KAIZEN_PROMPT =
  'Run a kaizen pass on this fundraise. Audit the cap table end to end: round sizes vs the model’s burn, valuations vs market, founder dilution trajectory, option pool sizing and timing, SAFE caps/discounts and how they convert. Give your top recommendations with concrete numbers, and if you are confident in a better structure, include it as a proposal.';

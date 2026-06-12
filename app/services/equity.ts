// Equity / fundraise math — the three early rounds (Friends & Family,
// Pre-seed, Seed) as a dilution waterfall. Each round is a cap-style
// priced equivalent: post = pre + raise, the new money owns
// raise/post, an optional option pool is carved out of post, and every
// existing holder dilutes by the same factor. SAFEs at a cap convert to
// ~the same numbers, so one set of math covers both.

export interface EquityRound {
  id: 'ff' | 'preseed' | 'seed';
  name: string;
  /** $ raised in the round. */
  raise: number;
  /** $ pre-money valuation (or SAFE cap). */
  preMoney: number;
  /** Option pool created in the round, as a share of post-money (0–1). */
  optionPool: number;
}

export interface EquityState {
  rounds: EquityRound[];
  /** Monthly burn used to translate each raise into months of runway. */
  monthlyBurn: number;
}

export const EQUITY_DEFAULTS: EquityState = {
  rounds: [
    { id: 'ff', name: 'Friends & Family', raise: 250_000, preMoney: 2_250_000, optionPool: 0 },
    { id: 'preseed', name: 'Pre-seed', raise: 1_500_000, preMoney: 8_500_000, optionPool: 0.05 },
    { id: 'seed', name: 'Seed', raise: 4_000_000, preMoney: 16_000_000, optionPool: 0.10 },
  ],
  monthlyBurn: 185_000,
};

export const EQUITY_STORAGE_KEY = 'catalog:equity:v1';

export function readEquityStored(): EquityState {
  if (typeof window === 'undefined') return EQUITY_DEFAULTS;
  try {
    const raw = window.localStorage.getItem(EQUITY_STORAGE_KEY);
    if (!raw) return EQUITY_DEFAULTS;
    return mergeEquity(JSON.parse(raw));
  } catch { return EQUITY_DEFAULTS; }
}

/** Tolerant merge so stored shapes survive new fields/rounds. */
export function mergeEquity(p: unknown): EquityState {
  const parsed = (p ?? {}) as Partial<EquityState>;
  const byId = new Map((parsed.rounds ?? []).map(r => [r.id, r]));
  return {
    rounds: EQUITY_DEFAULTS.rounds.map(d => ({ ...d, ...(byId.get(d.id) ?? {}) })),
    monthlyBurn: typeof parsed.monthlyBurn === 'number' && parsed.monthlyBurn > 0
      ? parsed.monthlyBurn
      : EQUITY_DEFAULTS.monthlyBurn,
  };
}

export interface HolderSlice {
  label: string;
  pct: number;   // 0–1 of the company at this stage
  color: string;
}

export interface RoundOutcome {
  round: EquityRound;
  postMoney: number;
  /** What the round's new investors own at close (0–1). */
  investorPct: number;
  /** Pool carved in this round (of post, 0–1). */
  poolPct: number;
  /** Founders' stake immediately after the round closes. */
  foundersAfter: number;
  /** Everything founders gave up in THIS round (investors + pool effect). */
  roundDilution: number;
  /** Months of runway this raise buys at the configured burn. */
  runwayMonths: number;
  cumulativeRaised: number;
  /** Full cap table at this stage, founders first. */
  capTable: HolderSlice[];
}

export const EQUITY_COLORS = {
  founders: '#0f172a',
  pool: '#94a3b8',
  ff: '#f59e0b',
  preseed: '#8b5cf6',
  seed: '#10b981',
} as const;

/** Walks the rounds in order and returns each stage's outcome. */
export function computeEquity(state: EquityState): RoundOutcome[] {
  let founders = 1;
  let pool = 0;
  const investors = new Map<EquityRound['id'], number>();
  let raisedSoFar = 0;
  const out: RoundOutcome[] = [];

  for (const round of state.rounds) {
    const post = round.preMoney + round.raise;
    const investorPct = post > 0 ? round.raise / post : 0;
    const poolPct = Math.max(0, Math.min(0.5, round.optionPool));
    // Existing holders share what's left after the new money + new pool.
    const keep = Math.max(0, 1 - investorPct - poolPct);
    const foundersBefore = founders;
    founders *= keep;
    pool = pool * keep + poolPct;
    for (const [id, pct] of investors) investors.set(id, pct * keep);
    investors.set(round.id, (investors.get(round.id) ?? 0) + investorPct);
    raisedSoFar += round.raise;

    out.push({
      round,
      postMoney: post,
      investorPct,
      poolPct,
      foundersAfter: founders,
      roundDilution: foundersBefore - founders,
      runwayMonths: state.monthlyBurn > 0 ? round.raise / state.monthlyBurn : 0,
      cumulativeRaised: raisedSoFar,
      capTable: [
        { label: 'Founders', pct: founders, color: EQUITY_COLORS.founders },
        ...state.rounds
          .filter(r => investors.has(r.id))
          .map(r => ({ label: r.name, pct: investors.get(r.id)!, color: EQUITY_COLORS[r.id] })),
        ...(pool > 0 ? [{ label: 'Option pool', pct: pool, color: EQUITY_COLORS.pool }] : []),
      ],
    });
  }
  return out;
}

// Equity / cap-table engine. The founder's spreadsheet is the seed data;
// the math comes in two modes:
//
//  'sheet' — reproduces the spreadsheet exactly. SAFEs pre-convert in the
//    foundation at price = valCap × (1 − discount) ÷ founders' shares
//    (the sheet divides the cap by FOUNDER shares only — e.g. Burton
//    Family $375k @ $5M cap / 20% → $1.3333 → 281,250 shares). Priced
//    rounds: pps = pre-money ÷ all outstanding shares. Verified: Seed
//    $12.5M/4,171,250 → $3.00 → 834,250 sh; A $50M/5,005,500 → $9.99 →
//    750,825; B $150M/5,756,325 → $26.06 → 575,633.
//
//  'postMoney' — the YC post-money SAFE standard (what actually signs
//    today). Each SAFE locks ownership = investment ÷ post-money cap
//    against the Company Capitalization (everything outstanding incl.
//    converting SAFEs + pools, EXCLUDING the new round money), and
//    converts at the FIRST priced round at whichever is better for the
//    investor: the cap-derived price or (1 − discount) × round price.
//    Cap-table circularity (SAFE shares ↔ share count ↔ round price ↔
//    discount election, plus any pool top-up) is solved by fixed-point
//    iteration — converges in a handful of passes.
//
// Priced rounds optionally top the option pool up pre-money (the
// classic "pool shuffle": new pool shares are added BEFORE pricing so
// existing holders absorb the dilution, sized so the pool hits a target
// % of post-money).

export interface CapHolder {
  id: string;
  kind: 'founders' | 'advisory' | 'pool';
  name: string;
  shares: number;
}

export interface SafeNote {
  id: string;
  name: string;
  investment: number;
  valCap: number;
  /** 0–1; 0 = converts at the cap only. */
  discount: number;
}

export interface PricedRound {
  id: string;
  name: string;
  preMoney: number;
  investment: number;
  /** Target option pool as a share of POST-money (0–1), topped up
   *  pre-money. 0 = no top-up (the sheet's behaviour). */
  poolTopUp: number;
}

export type SafeMode = 'sheet' | 'postMoney';

export interface EquityState {
  safeMode: SafeMode;
  holders: CapHolder[];
  safes: SafeNote[];
  rounds: PricedRound[];
}

export const EQUITY_DEFAULTS: EquityState = {
  safeMode: 'postMoney',
  holders: [
    { id: 'founders', kind: 'founders', name: 'Worrell Burton LLC', shares: 3_000_000 },
    { id: 'advisory', kind: 'advisory', name: 'Alex/Dan (advisory)', shares: 40_000 },
    { id: 'pool-influencer', kind: 'pool', name: 'Influencer Pool', shares: 360_000 },
    { id: 'pool-employee', kind: 'pool', name: 'Employee Pool', shares: 400_000 },
  ],
  safes: [
    { id: 'safe-burton', name: 'Burton Family', investment: 375_000, valCap: 5_000_000, discount: 0.20 },
    { id: 'safe-bwl', name: 'BWL Investments', investment: 50_000, valCap: 5_000_000, discount: 0.20 },
    { id: 'safe-madison', name: 'Madison Logan Holdings Inc', investment: 50_000, valCap: 5_000_000, discount: 0.20 },
    { id: 'safe-dane', name: 'Dane Hagy', investment: 25_000, valCap: 5_000_000, discount: 0 },
  ],
  rounds: [
    { id: 'seed', name: 'Seed', preMoney: 12_500_000, investment: 2_500_000, poolTopUp: 0 },
    { id: 'series-a', name: 'Series A', preMoney: 50_000_000, investment: 7_500_000, poolTopUp: 0 },
    { id: 'series-b', name: 'Series B', preMoney: 150_000_000, investment: 15_000_000, poolTopUp: 0 },
  ],
};

export const EQUITY_STORAGE_KEY = 'catalog:equity:v2';

export function readEquityStored(): EquityState {
  if (typeof window === 'undefined') return EQUITY_DEFAULTS;
  try {
    const raw = window.localStorage.getItem(EQUITY_STORAGE_KEY);
    if (!raw) return EQUITY_DEFAULTS;
    return mergeEquity(JSON.parse(raw));
  } catch { return EQUITY_DEFAULTS; }
}

/** Tolerant merge: any list that parses as a non-empty array wins;
 *  anything missing/malformed falls back to the defaults. */
export function mergeEquity(p: unknown): EquityState {
  const parsed = (p ?? {}) as Partial<EquityState>;
  const list = <T,>(v: T[] | undefined, fallback: T[]): T[] =>
    Array.isArray(v) && v.length > 0 ? v : fallback;
  return {
    safeMode: parsed.safeMode === 'sheet' ? 'sheet' : 'postMoney',
    holders: list(parsed.holders, EQUITY_DEFAULTS.holders),
    safes: list(parsed.safes, EQUITY_DEFAULTS.safes),
    rounds: list(parsed.rounds, EQUITY_DEFAULTS.rounds).map(r => ({ ...r, poolTopUp: r.poolTopUp ?? 0 })),
  };
}

export const equityUid = (): string => Math.random().toString(36).slice(2, 9);

// ── Computation ───────────────────────────────────────────────────────

export interface CapRow {
  id: string;
  group: 'founders' | 'advisory' | 'pool' | 'safe' | 'round';
  type: string;
  name: string;
  investment: number | null;
  valCap: number | null;
  shares: number;
  /** Of fully-diluted shares after this stage closes (0–1). */
  pct: number;
  /** shares × price per share at this stage. */
  equityValue: number;
}

export interface StageOutcome {
  round: PricedRound;
  pricePerShare: number;
  postMoney: number;
  sharesBefore: number;
  newShares: number;
  poolAdded: number;
  sharesAfter: number;
  rows: CapRow[];
  groups: Array<{ label: string; shares: number; pct: number; equityValue: number; color: string }>;
}

export interface SafeConversion {
  safe: SafeNote;
  shares: number;
  price: number;
  /** Which leg won the investor's election ('postMoney' mode only). */
  basis: 'cap' | 'discount' | 'sheet';
}

export interface EquitySummary {
  foundersShares: number;
  optionShares: number;
  safeConversions: SafeConversion[];
  safeShares: number;
  /** founders + SAFE shares — the sheet's "Company's Capitalization". */
  foundationCap: number;
  stages: StageOutcome[];
}

export const EQUITY_GROUP_COLORS = {
  founders: '#0f172a',
  advisory: '#f59e0b',
  pool: '#94a3b8',
  investors: '#10b981',
} as const;

const clampDiscount = (d: number) => Math.max(0, Math.min(0.9, d));

/** 'sheet' mode SAFE price: cap × (1 − discount) ÷ founders' shares. */
function sheetConversions(safes: SafeNote[], foundersShares: number): SafeConversion[] {
  return safes.map(safe => {
    const price = foundersShares > 0 ? (safe.valCap * (1 - clampDiscount(safe.discount))) / foundersShares : 0;
    return { safe, price, shares: price > 0 ? Math.round(safe.investment / price) : 0, basis: 'sheet' as const };
  });
}

/** 'postMoney' mode: solve SAFE conversion + pool top-up + round pricing
 *  for the FIRST priced round by fixed-point iteration. */
function postMoneyConversions(
  safes: SafeNote[],
  baseShares: number,            // founders + advisory + pools before the round
  firstRound: PricedRound | undefined,
): SafeConversion[] {
  if (!firstRound) {
    // No priced round yet — show the cap-implied ownership on today's base.
    return safes.map(safe => {
      const own = safe.valCap > 0 ? safe.investment / safe.valCap : 0;
      const shares = own < 1 ? Math.round((baseShares * own) / (1 - own)) : 0;
      return { safe, shares, price: shares > 0 ? safe.investment / shares : 0, basis: 'cap' as const };
    });
  }
  let safeShares = safes.map(() => 0);
  let basis: Array<'cap' | 'discount'> = safes.map(() => 'cap');
  for (let pass = 0; pass < 24; pass++) {
    const companyCap = baseShares + safeShares.reduce((a, b) => a + b, 0); // incl. converting SAFEs, excl. new money
    const roundPps = companyCap > 0 ? firstRound.preMoney / companyCap : 0;
    const next = safes.map((safe, i) => {
      const capPrice = safe.valCap > 0 && companyCap > 0 ? safe.valCap / companyCap : Infinity;
      const discPrice = safe.discount > 0 && roundPps > 0 ? roundPps * (1 - clampDiscount(safe.discount)) : Infinity;
      const price = Math.min(capPrice, discPrice);
      basis[i] = capPrice <= discPrice ? 'cap' : 'discount';
      return price > 0 && Number.isFinite(price) ? safe.investment / price : 0;
    });
    const drift = next.reduce((a, v, i) => a + Math.abs(v - safeShares[i]), 0);
    safeShares = next;
    if (drift < 0.5) break;
  }
  return safes.map((safe, i) => ({
    safe,
    shares: Math.round(safeShares[i]),
    price: safeShares[i] > 0 ? safe.investment / safeShares[i] : 0,
    basis: basis[i],
  }));
}

export function computeEquity(state: EquityState): EquitySummary {
  const foundersShares = state.holders.filter(h => h.kind === 'founders').reduce((a, h) => a + h.shares, 0);
  const optionShares = state.holders.filter(h => h.kind !== 'founders').reduce((a, h) => a + h.shares, 0);
  const baseShares = foundersShares + optionShares;

  const safeConversions = state.safeMode === 'sheet'
    ? sheetConversions(state.safes, foundersShares)
    : postMoneyConversions(state.safes, baseShares, state.rounds[0]);
  const safeShares = safeConversions.reduce((a, s) => a + s.shares, 0);

  // Rows present before any priced round (SAFEs shown as converted).
  const baseRows: Array<Omit<CapRow, 'pct' | 'equityValue'>> = [
    ...state.holders.map(h => ({
      id: h.id,
      group: h.kind,
      type: h.kind === 'founders' ? 'Founders' : h.kind === 'advisory' ? 'Advisory' : 'Pool',
      name: h.name,
      investment: null,
      valCap: null,
      shares: h.shares,
    })),
    ...safeConversions.map(({ safe, shares }) => ({
      id: safe.id,
      group: 'safe' as const,
      type: 'SAFE Investor',
      name: safe.name,
      investment: safe.investment,
      valCap: safe.valCap,
      shares,
    })),
  ];

  const stages: StageOutcome[] = [];
  const laterRows: Array<Omit<CapRow, 'pct' | 'equityValue'>> = [];
  let poolExtra = 0; // cumulative pool top-up shares (kept as one synthetic row)
  let sharesOutstanding = baseRows.reduce((a, r) => a + r.shares, 0);

  for (const round of state.rounds) {
    const target = Math.max(0, Math.min(0.5, round.poolTopUp));
    // Solve pool top-up + pricing together (both move the denominator).
    let poolAdded = 0;
    let pps = 0;
    let newShares = 0;
    for (let pass = 0; pass < 24; pass++) {
      const preShares = sharesOutstanding + poolAdded;
      pps = preShares > 0 ? round.preMoney / preShares : 0;
      newShares = pps > 0 ? round.investment / pps : 0;
      const after = preShares + newShares;
      const poolNow = optionShares + poolExtra + poolAdded;
      const wanted = Math.max(0, target * after - poolNow);
      if (Math.abs(wanted - poolAdded) < 0.5) { poolAdded = wanted; break; }
      poolAdded = wanted;
    }
    poolAdded = Math.round(poolAdded);
    newShares = Math.round(newShares);
    const sharesBefore = sharesOutstanding + poolAdded;
    const sharesAfter = sharesBefore + newShares;
    const post = round.preMoney + round.investment;
    poolExtra += poolAdded;
    sharesOutstanding = sharesAfter;

    laterRows.push({
      id: round.id,
      group: 'round',
      type: round.name,
      name: `${round.name} Investor`,
      investment: round.investment,
      valCap: null,
      shares: newShares,
    });

    const all = [
      ...baseRows,
      ...(poolExtra > 0
        ? [{ id: 'pool-topups', group: 'pool' as const, type: 'Pool', name: 'Pool top-ups', investment: null, valCap: null, shares: poolExtra }]
        : []),
      ...laterRows,
    ];
    const rows: CapRow[] = all.map(r => ({
      ...r,
      pct: sharesAfter > 0 ? r.shares / sharesAfter : 0,
      equityValue: r.shares * pps,
    }));

    const sum = (filter: (r: CapRow) => boolean) => {
      const sel = rows.filter(filter);
      return {
        shares: sel.reduce((a, r) => a + r.shares, 0),
        pct: sel.reduce((a, r) => a + r.pct, 0),
        equityValue: sel.reduce((a, r) => a + r.equityValue, 0),
      };
    };
    stages.push({
      round,
      pricePerShare: pps,
      postMoney: post,
      sharesBefore,
      newShares,
      poolAdded,
      sharesAfter,
      rows,
      groups: [
        { label: 'Founders', color: EQUITY_GROUP_COLORS.founders, ...sum(r => r.group === 'founders') },
        { label: 'Advisory', color: EQUITY_GROUP_COLORS.advisory, ...sum(r => r.group === 'advisory') },
        { label: 'Option pools', color: EQUITY_GROUP_COLORS.pool, ...sum(r => r.group === 'pool') },
        { label: 'Investors', color: EQUITY_GROUP_COLORS.investors, ...sum(r => r.group === 'safe' || r.group === 'round') },
      ],
    });
  }

  return {
    foundersShares,
    optionShares,
    safeConversions,
    safeShares,
    foundationCap: foundersShares + safeShares,
    stages,
  };
}

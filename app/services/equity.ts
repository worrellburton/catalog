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
  /** When the check landed (ISO date) — drives the Ledger view's order. */
  date?: string;
}

export interface RoundInvestor {
  id: string;
  name: string;
  investment: number;
  /** When the check landed (ISO date) — drives the Ledger view's order. */
  date?: string;
}

export interface PricedRound {
  id: string;
  name: string;
  preMoney: number;
  /** Legacy single-check field — superseded by `investors`; kept so
   *  states saved before named investors still merge cleanly. */
  investment?: number;
  /** The round's checks, named. The round's size is their sum. */
  investors: RoundInvestor[];
  /** Target option pool as a share of POST-money (0–1), topped up
   *  pre-money. 0 = no top-up (the sheet's behaviour). */
  poolTopUp: number;
}

export const roundSize = (r: PricedRound): number =>
  r.investors.reduce((a, i) => a + i.investment, 0);

/** "+ Investor" thinks before it adds: rounds are usually built to
 *  ~20% post-money dilution (target ≈ pre ÷ 4), the lead takes the
 *  biggest bite, and later checks fill what's left. The suggestion
 *  sizes the check against that target and names the role — every
 *  check in a priced round shares the round's terms ($/share) by
 *  definition, so terms come from the round itself. */
export function suggestRoundInvestor(round: PricedRound): RoundInvestor {
  const nice = (n: number) => Math.max(50_000, Math.round(n / 50_000) * 50_000);
  const target = round.preMoney / 4;
  const current = roundSize(round);
  const gap = target - current;
  const n = round.investors.length;
  const role =
    n === 0 ? `${round.name} Lead`
    : n === 1 ? 'Co-lead'
    : ['Angel syndicate', 'Strategic investor', 'Follow-on fund', 'Operator angels'][(n - 2) % 4];
  const investment =
    n === 0 ? nice(target * 0.6)            // the lead anchors ~60% of the round
    : gap > target * 0.1 ? nice(gap)        // fill the round to its target size
    : nice(target * 0.1);                   // round's full — a smaller follower
  return { id: equityUid(), name: role, investment };
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
    { id: 'seed', name: 'Seed', preMoney: 12_500_000, poolTopUp: 0, investors: [{ id: 'seed-inv', name: 'Seed Investor', investment: 2_500_000 }] },
    { id: 'series-a', name: 'Series A', preMoney: 50_000_000, poolTopUp: 0, investors: [{ id: 'series-a-inv', name: 'Series A Investor', investment: 7_500_000 }] },
    { id: 'series-b', name: 'Series B', preMoney: 150_000_000, poolTopUp: 0, investors: [{ id: 'series-b-inv', name: 'Series B Investor', investment: 15_000_000 }] },
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

/** Coerce any value (number, "1,000,000" string, garbage from an AI
 *  proposal) into a bounded non-negative number. */
const num = (v: unknown, fallback = 0, max = 1e15): number => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^0-9.eE+-]/g, ''));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(max, n));
};

/** Tolerant merge: any list that parses as a non-empty array wins;
 *  anything missing/malformed falls back to the defaults. Every numeric
 *  field is coerced and bounded — advisor proposals and hand edits can't
 *  smuggle strings or absurd magnitudes into the math. */
export function mergeEquity(p: unknown): EquityState {
  const parsed = (p ?? {}) as Partial<EquityState>;
  const list = <T,>(v: T[] | undefined, fallback: T[]): T[] =>
    Array.isArray(v) && v.length > 0 ? v : fallback;
  return {
    safeMode: parsed.safeMode === 'sheet' ? 'sheet' : 'postMoney',
    holders: list(parsed.holders, EQUITY_DEFAULTS.holders).map(h => ({
      ...h, shares: num(h.shares, 0, 1e12),
    })),
    safes: list(parsed.safes, EQUITY_DEFAULTS.safes).map(s => ({
      ...s,
      investment: num(s.investment),
      valCap: num(s.valCap),
      discount: Math.min(0.9, num(s.discount, 0, 0.9)),
    })),
    rounds: list(parsed.rounds, EQUITY_DEFAULTS.rounds).map(r => ({
      ...r,
      preMoney: num(r.preMoney),
      poolTopUp: Math.min(0.5, num(r.poolTopUp, 0, 0.5)),
      // Pre-named-investor states carried a single `investment` — fold it
      // into a one-investor list so old saves keep their numbers.
      investors: (Array.isArray(r.investors) && r.investors.length > 0
        ? r.investors
        : [{ id: `${r.id}-inv`, name: `${r.name} Investor`, investment: r.investment ?? 0 }]
      ).map(i => ({ ...i, investment: num(i.investment) })),
    })),
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
  /** cap < check: an impossible note (it would buy >100% of the
   *  company). Excluded from conversion math until the cap is fixed —
   *  usually a mid-typing or missing-zeros state. */
  invalid?: boolean;
}

export interface EquitySummary {
  foundersShares: number;
  optionShares: number;
  safeConversions: SafeConversion[];
  safeShares: number;
  /** founders + SAFE shares — the sheet's "Company's Capitalization". */
  foundationCap: number;
  /** The Friends & Family round: the cap table once the SAFEs convert,
   *  before any priced money (equityValue stays 0 — nothing has priced
   *  the company yet). */
  foundationRows: CapRow[];
  foundationGroups: StageOutcome['groups'];
  stages: StageOutcome[];
}

export const EQUITY_GROUP_COLORS = {
  founders: '#0f172a',
  advisory: '#f59e0b',
  pool: '#94a3b8',
  investors: '#10b981',
} as const;

const clampDiscount = (d: number) => Math.max(0, Math.min(0.9, d));

/** cap below the check = the note would buy more than the whole company. */
const isBrokenSafe = (s: SafeNote) => s.valCap <= 0 || s.valCap < s.investment;

/** 'sheet' mode SAFE price: cap × (1 − discount) ÷ founders' shares. */
function sheetConversions(safes: SafeNote[], foundersShares: number): SafeConversion[] {
  return safes.map(safe => {
    if (isBrokenSafe(safe)) return { safe, price: 0, shares: 0, basis: 'sheet' as const, invalid: true };
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
  // A SAFE block whose cap-implied ownerships sum to ≥100% is an
  // impossible structure (the notes would own more than the company) —
  // it only happens on typo'd caps (e.g. $12,500 instead of $12.5M).
  // Without this ceiling the fixed point DIVERGES (~80× per pass →
  // 1e45 shares — the founder's broken ledger screenshot).
  const CEILING = baseShares * 19; // SAFE block ≤ 95% of company cap
  // Broken notes (cap < check — usually a mid-typing state) sit out of
  // the math entirely instead of starving every other note via the
  // ceiling's proportional crush.
  const broken = safes.map(isBrokenSafe);
  if (!firstRound) {
    // No priced round yet — show the cap-implied ownership on today's base.
    return safes.map((safe, i) => {
      if (broken[i]) return { safe, shares: 0, price: 0, basis: 'cap' as const, invalid: true };
      const own = Math.min(safe.valCap > 0 ? safe.investment / safe.valCap : 0, 0.95);
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
      if (broken[i]) return 0;
      const capPrice = safe.valCap > 0 && companyCap > 0 ? safe.valCap / companyCap : Infinity;
      const discPrice = safe.discount > 0 && roundPps > 0 ? roundPps * (1 - clampDiscount(safe.discount)) : Infinity;
      const price = Math.min(capPrice, discPrice);
      basis[i] = capPrice <= discPrice ? 'cap' : 'discount';
      return price > 0 && Number.isFinite(price) ? safe.investment / price : 0;
    });
    const total = next.reduce((a, b) => a + b, 0);
    const bounded = total > CEILING ? next.map(v => (v * CEILING) / total) : next;
    const drift = bounded.reduce((a, v, i) => a + Math.abs(v - safeShares[i]), 0);
    safeShares = bounded;
    if (drift < 0.5) break;
  }
  return safes.map((safe, i) => ({
    safe,
    shares: Math.round(safeShares[i]),
    price: safeShares[i] > 0 ? safe.investment / safeShares[i] : 0,
    basis: basis[i],
    invalid: broken[i] || undefined,
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

  // The Friends & Family round IS the SAFE block — its own stage view:
  // who owns what once the notes convert, before any priced money. No
  // dollar values yet (nothing has priced the company), so equityValue
  // stays 0 and the page hides that column for this stage.
  const baseTotal = sharesOutstanding;
  const foundationRows: CapRow[] = baseRows.map(r => ({
    ...r,
    pct: baseTotal > 0 ? r.shares / baseTotal : 0,
    equityValue: 0,
  }));
  const groupTotals = (rows: CapRow[]) => {
    const sum = (filter: (r: CapRow) => boolean) => {
      const sel = rows.filter(filter);
      return {
        shares: sel.reduce((a, r) => a + r.shares, 0),
        pct: sel.reduce((a, r) => a + r.pct, 0),
        equityValue: sel.reduce((a, r) => a + r.equityValue, 0),
      };
    };
    return [
      { label: 'Founders', color: EQUITY_GROUP_COLORS.founders, ...sum(r => r.group === 'founders') },
      { label: 'Advisory', color: EQUITY_GROUP_COLORS.advisory, ...sum(r => r.group === 'advisory') },
      { label: 'Option pools', color: EQUITY_GROUP_COLORS.pool, ...sum(r => r.group === 'pool') },
      { label: 'Investors', color: EQUITY_GROUP_COLORS.investors, ...sum(r => r.group === 'safe' || r.group === 'round') },
    ];
  };
  const foundationGroups = groupTotals(foundationRows);

  for (const round of state.rounds) {
    const investment = roundSize(round);
    const target = Math.max(0, Math.min(0.5, round.poolTopUp));
    // Solve pool top-up + pricing together (both move the denominator).
    let poolAdded = 0;
    let pps = 0;
    let newShares = 0;
    for (let pass = 0; pass < 24; pass++) {
      const preShares = sharesOutstanding + poolAdded;
      pps = preShares > 0 ? round.preMoney / preShares : 0;
      newShares = pps > 0 ? investment / pps : 0;
      const after = preShares + newShares;
      const poolNow = optionShares + poolExtra + poolAdded;
      const wanted = Math.max(0, target * after - poolNow);
      if (Math.abs(wanted - poolAdded) < 0.5) { poolAdded = wanted; break; }
      poolAdded = wanted;
    }
    poolAdded = Math.round(poolAdded);
    // One row per named check; the stage's new shares are their sum so
    // the table always reconciles with its own rounding.
    const investorRows = round.investors.map(inv => ({
      id: inv.id,
      group: 'round' as const,
      type: round.name,
      name: inv.name,
      investment: inv.investment,
      valCap: null,
      shares: pps > 0 ? Math.round(inv.investment / pps) : 0,
    }));
    newShares = investorRows.reduce((a, r) => a + r.shares, 0);
    const sharesBefore = sharesOutstanding + poolAdded;
    const sharesAfter = sharesBefore + newShares;
    const post = round.preMoney + investment;
    poolExtra += poolAdded;
    sharesOutstanding = sharesAfter;

    laterRows.push(...investorRows);

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

    stages.push({
      round,
      pricePerShare: pps,
      postMoney: post,
      sharesBefore,
      newShares,
      poolAdded,
      sharesAfter,
      rows,
      groups: groupTotals(rows),
    });
  }

  return {
    foundersShares,
    optionShares,
    safeConversions,
    safeShares,
    foundationCap: foundersShares + safeShares,
    foundationRows,
    foundationGroups,
    stages,
  };
}

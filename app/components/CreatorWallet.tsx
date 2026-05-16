import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  type WalletEntry,
  getWallet,
  initiateWithdrawal,
  deleteDotsUser,
} from '~/services/earnings';
import { type EngagementSummary, getEngagementSummary } from '~/services/creator-engagement';
import { supabase } from '~/utils/supabase';
import DotsSignupModal from './DotsSignupModal';
import WalletBackground from './WalletBackground';

/* Deterministic 7-point sparkline curve. We don't have daily
   time-series data — just totals and the past-week delta — so the
   curve is reconstructed from those: the right edge is the total,
   the left edge is `total - week`, and the interior softly
   modulates between them via a low-amplitude cosine so flat data
   doesn't look spiky. Pure presentation; never read for analytics. */
function buildSparkPath(total: number, week: number, w: number, h: number) {
  const start = Math.max(0, total - week);
  const end = total;
  const N = 7;
  const pts: { x: number; y: number }[] = [];
  const range = Math.max(end - start, 1);
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const base = start + (end - start) * t;
    const wobble = Math.sin(t * Math.PI * 1.4) * range * 0.08;
    pts.push({ x: t * w, y: base + wobble });
  }
  const min = Math.min(...pts.map(p => p.y));
  const max = Math.max(...pts.map(p => p.y));
  const span = Math.max(max - min, 1);
  const ys = pts.map(p => h - 4 - ((p.y - min) / span) * (h - 10));
  const xs = pts.map(p => p.x);
  let line = `M ${xs[0].toFixed(2)} ${ys[0].toFixed(2)}`;
  for (let i = 1; i < N; i++) {
    const cx = (xs[i - 1] + xs[i]) / 2;
    line += ` Q ${cx.toFixed(2)} ${ys[i - 1].toFixed(2)} ${xs[i].toFixed(2)} ${ys[i].toFixed(2)}`;
  }
  const area = `${line} L ${xs[N - 1].toFixed(2)} ${h} L 0 ${h} Z`;
  return { line, area };
}

function Sparkline({ total, week }: { total: number; week: number }) {
  const w = 120;
  const h = 36;
  const { line, area } = useMemo(() => buildSparkPath(total, week, w, h), [total, week]);
  const gradId = useMemo(() => `wsg-${Math.random().toString(36).slice(2, 8)}`, []);
  return (
    <svg className="wallet-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#4ade80" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#4ade80" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path d={line} fill="none" stroke="#4ade80" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface PayoutProfile {
  id: string;
  email?: string;
  full_name?: string;
  dots_user_id?: string | null;
  is_payout_active?: boolean;
  is_payout_verified?: boolean;
  payout_withdraw_link?: string | null;
}

interface Props {
  onProfileChange?: () => void;
}

const ENTRY_CODE_LABELS: Record<string, string> = {
  DISCOVER: 'Discover',
  REWARD: 'Reward',
  WITHDRAW: 'Withdrawal',
  CATALOG_ORDER: 'Order',
  ADMIN_CREDIT: 'Admin Credit',
};

function entryLabel(code: string | null) {
  if (!code) return 'Transaction';
  return ENTRY_CODE_LABELS[code] ?? code;
}

export default function CreatorWallet({ onProfileChange }: Props) {
  const [profile, setProfile] = useState<PayoutProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [balance, setBalance] = useState(0);
  const [totalEarning, setTotalEarning] = useState(0);
  const [totalWithdraw, setTotalWithdraw] = useState(0);
  const [entries, setEntries] = useState<WalletEntry[]>([]);
  const [withdrawLink, setWithdrawLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState('');
  const [showSignup, setShowSignup] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [engagement, setEngagement] = useState<EngagementSummary | null>(null);
  const insightsRef = useRef<HTMLDivElement | null>(null);
  const summaryRef = useRef<HTMLDivElement | null>(null);

  const scrollToInsights = useCallback(() => {
    insightsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);
  const scrollToSummary = useCallback(() => {
    summaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  useEffect(() => {
    let cancelled = false;
    getEngagementSummary().then(s => { if (!cancelled) setEngagement(s); });
    return () => { cancelled = true; };
  }, []);

  // The login toast and the legacy 'open-wallet-analytics' event both
  // expect the analytics block to scroll into view.
  useEffect(() => {
    const openAndScroll = () => {
      requestAnimationFrame(() => {
        insightsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    };
    window.addEventListener('catalog:scroll-wallet-analytics', openAndScroll);
    window.addEventListener('catalog:open-wallet-analytics', openAndScroll);
    return () => {
      window.removeEventListener('catalog:scroll-wallet-analytics', openAndScroll);
      window.removeEventListener('catalog:open-wallet-analytics', openAndScroll);
    };
  }, []);

  const loadProfile = useCallback(async () => {
    if (!supabase) return;
    setProfileLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setProfileLoading(false); return; }
    const { data } = await supabase
      .from('profiles')
      .select('id, email, full_name, dots_user_id, is_payout_active, is_payout_verified, payout_withdraw_link')
      .eq('id', user.id)
      .single();
    setProfile(data ?? null);
    setProfileLoading(false);
  }, []);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const wallet = await getWallet();
      setBalance(wallet.current_balance);
      setTotalEarning(wallet.total_earning);
      setTotalWithdraw(wallet.total_withdraw);
      setEntries(wallet.entries);
      setWithdrawLink(wallet.payout_withdraw_link);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleWithdraw() {
    if (!profile?.is_payout_active) {
      setShowSignup(true);
      return;
    }
    setWithdrawing(true);
    setWithdrawError('');
    try {
      const res = await initiateWithdrawal();
      setWithdrawLink(res.withdraw_link);
      window.open(res.withdraw_link, '_blank', 'noopener,noreferrer');
      await load();
    } catch (e: unknown) {
      setWithdrawError((e as Error).message ?? 'Failed to initiate withdrawal');
    } finally {
      setWithdrawing(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm('Disconnect your Dots payout account? You can reconnect later.')) return;
    setDisconnecting(true);
    try {
      await deleteDotsUser();
      onProfileChange?.();
      await loadProfile();
      await load();
    } finally {
      setDisconnecting(false);
    }
  }

  const isConnected = profile?.is_payout_active && profile?.dots_user_id;

  return (
    <div className="wallet-root">
      <WalletBackground />

      <div className="wallet-content">
        {profileLoading && (
          <div className="wallet-loading">
            <span className="wallet-spinner" />
          </div>
        )}

        {!profileLoading && !isConnected && (
          <div className="wallet-setup-banner">
            <div className="wallet-setup-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
                <line x1="1" y1="10" x2="23" y2="10" />
              </svg>
            </div>
            <div className="wallet-setup-text">
              <div className="wallet-setup-title">Set up earnings</div>
              <div className="wallet-setup-sub">Connect Dots to withdraw to bank, Venmo, or PayPal</div>
            </div>
            <button className="wallet-setup-btn" onClick={() => setShowSignup(true)}>
              Get started
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          </div>
        )}

        {!profileLoading && loading && (
          <div className="wallet-loading">
            <span className="wallet-spinner" />
          </div>
        )}
        {!profileLoading && !loading && (
          <>
            {/* ── Page 1 — Summary. Hero is dead-center on first view. ── */}
            <div ref={summaryRef} className="wallet-page wallet-page--summary">
              <div className="wallet-hero">
                <div className="wallet-hero-label">Total Earned</div>
                <div className="wallet-hero-amount">${totalEarning.toFixed(2)}</div>
                <div className="wallet-hero-glow" aria-hidden />
              </div>

              <div className="wallet-cards">
                <div className="wallet-card wallet-card--main">
                  <div className="wallet-card-label">Available Balance</div>
                  <div className="wallet-card-amount">${balance.toFixed(2)}</div>
                  <div className="wallet-card-sub">Withdraw anytime</div>
                  {isConnected ? (
                    <button
                      className={`wallet-withdraw-btn${balance <= 0 ? ' wallet-withdraw-btn--disabled' : ''}`}
                      onClick={handleWithdraw}
                      disabled={withdrawing || balance <= 0}
                    >
                      {withdrawing ? 'Processing…' : 'Withdraw'}
                    </button>
                  ) : (
                    <button className="wallet-withdraw-btn" onClick={() => setShowSignup(true)}>
                      Connect to Withdraw
                    </button>
                  )}
                </div>

                <div className="wallet-card wallet-card--secondary">
                  <div className="wallet-card-label">Total Withdrawn</div>
                  <div className="wallet-card-amount">${totalWithdraw.toFixed(2)}</div>
                  <div className="wallet-card-sub">Lifetime payouts</div>
                </div>
              </div>

              {withdrawLink && (
                <div className="wallet-payout-banner">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  <span className="wallet-payout-banner-text">Payout pending — complete via your link</span>
                  <button
                    className="wallet-payout-banner-btn"
                    onClick={() => window.open(withdrawLink!, '_blank', 'noopener,noreferrer')}
                  >
                    Open link
                  </button>
                </div>
              )}

              {withdrawError && (
                <div className="wallet-error">{withdrawError}</div>
              )}

              <button
                type="button"
                className="wallet-view-insights"
                onClick={scrollToInsights}
                aria-label="View insights"
              >
                <span>View insights</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </div>

            {/* ── Page 2 — Insights with sparkline graphs + history. ── */}
            <div ref={insightsRef} className="wallet-page wallet-page--insights">
              <div className="wallet-insights-head">
                <h2 className="wallet-insights-title">Insights</h2>
                <button
                  type="button"
                  className="wallet-insights-up"
                  onClick={scrollToSummary}
                  aria-label="Back to summary"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <polyline points="18 15 12 9 6 15" />
                  </svg>
                  Summary
                </button>
              </div>

              <div className="wallet-analytics">
                <div className="wallet-analytics-cards">
                  <div className="wallet-analytics-card">
                    <div className="wallet-analytics-card-head">
                      <div className="wallet-analytics-card-label">Impressions</div>
                      <div className="wallet-analytics-card-amount">
                        {(engagement?.total_impressions ?? 0).toLocaleString()}
                      </div>
                      <div className="wallet-analytics-card-sub">
                        +{(engagement?.week_impressions ?? 0).toLocaleString()} this week
                      </div>
                    </div>
                    <Sparkline
                      total={engagement?.total_impressions ?? 0}
                      week={engagement?.week_impressions ?? 0}
                    />
                  </div>
                  <div className="wallet-analytics-card">
                    <div className="wallet-analytics-card-head">
                      <div className="wallet-analytics-card-label">Clicks</div>
                      <div className="wallet-analytics-card-amount">
                        {(engagement?.total_clicks ?? 0).toLocaleString()}
                      </div>
                      <div className="wallet-analytics-card-sub">
                        +{(engagement?.week_clicks ?? 0).toLocaleString()} this week
                      </div>
                    </div>
                    <Sparkline
                      total={engagement?.total_clicks ?? 0}
                      week={engagement?.week_clicks ?? 0}
                    />
                  </div>
                  <div className="wallet-analytics-card">
                    <div className="wallet-analytics-card-head">
                      <div className="wallet-analytics-card-label">Clickouts</div>
                      <div className="wallet-analytics-card-amount">
                        {(engagement?.total_clickouts ?? 0).toLocaleString()}
                      </div>
                      <div className="wallet-analytics-card-sub">
                        +{(engagement?.week_clickouts ?? 0).toLocaleString()} this week
                      </div>
                    </div>
                    <Sparkline
                      total={engagement?.total_clickouts ?? 0}
                      week={engagement?.week_clickouts ?? 0}
                    />
                  </div>
                </div>
              </div>

              <div className="wallet-history">
                <div className="wallet-history-header">Transaction History</div>
                {entries.length === 0 ? (
                  <div className="wallet-history-empty">No transactions yet</div>
                ) : (
                  <div className="wallet-history-list">
                    {entries.map(entry => (
                      <div key={entry.id} className="wallet-entry">
                        <div className={`wallet-entry-icon wallet-entry-icon--${entry.type}`}>
                          {entry.type === 'credit' ? (
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 19 19 12"/></svg>
                          ) : entry.type === 'debit' ? (
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 5 5 12"/></svg>
                          ) : (
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                          )}
                        </div>
                        <div className="wallet-entry-info">
                          <div className="wallet-entry-label">{entry.comment || entryLabel(entry.entry_code)}</div>
                          <div className="wallet-entry-date">
                            {new Date(entry.created_at).toLocaleDateString('en-US', {
                              month: 'short', day: 'numeric', year: 'numeric',
                              hour: '2-digit', minute: '2-digit',
                            })}
                          </div>
                        </div>
                        <div className="wallet-entry-amounts">
                          <div className={`wallet-entry-amount wallet-entry-amount--${entry.type}`}>
                            {entry.type === 'credit' ? '+' : entry.type === 'debit' ? '-' : ''}
                            ${entry.amount.toFixed(2)}
                          </div>
                          <div className="wallet-entry-bal">Bal: ${entry.current_balance.toFixed(2)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {isConnected && (
              <div className="wallet-status">
                <div className="wallet-status-left">
                  <span className="wallet-status-dot" />
                  <span className="wallet-status-label">Dots connected</span>
                  {profile.is_payout_verified && (
                    <span className="wallet-status-badge">VERIFIED</span>
                  )}
                </div>
                <button
                  className="wallet-status-disconnect"
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                >
                  {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {showSignup && (
        <DotsSignupModal
          userEmail={profile?.email}
          onConnected={() => {
            setShowSignup(false);
            onProfileChange?.();
            loadProfile();
            load();
          }}
          onClose={() => setShowSignup(false)}
        />
      )}
    </div>
  );
}

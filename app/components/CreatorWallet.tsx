import { useState, useEffect, useCallback, useRef } from 'react';
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
import '~/styles/my-looks.css';

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
  const [insightsOpen, setInsightsOpen] = useState(false);

  const [engagement, setEngagement] = useState<EngagementSummary | null>(null);
  const insightsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    getEngagementSummary().then(s => { if (!cancelled) setEngagement(s); });
    return () => { cancelled = true; };
  }, []);

  // Live-tick the Analytics cards. Subscribes to user_events INSERT
  // on rows whose target is one of my looks, then nudges the matching
  // counter up. The same RLS policy that powers ActivityRealtimeToasts
  // gates which events get delivered — we just don't toast them here,
  // we mutate the engagement summary in place.
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    type Channel = ReturnType<NonNullable<typeof supabase>['channel']>;
    let channel: Channel | null = null;
    let myLookIds = new Set<string>();
    let myUserId: string | null = null;

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled || !user) return;
      myUserId = user.id;
      const { data: looksRes } = await supabase
        .from('looks').select('id').eq('user_id', user.id);
      myLookIds = new Set(((looksRes ?? []) as { id: string }[]).map(r => r.id));
      if (myLookIds.size === 0) return;

      channel = supabase
        .channel(`wallet-analytics-${user.id}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'user_events' },
          (payload) => {
            const row = payload.new as {
              user_id?: string | null;
              event_type?: string | null;
              target_type?: string | null;
              target_uuid?: string | null;
            };
            if (!row) return;
            if (row.user_id === myUserId) return;
            if (row.target_type !== 'look') return;
            if (!row.target_uuid || !myLookIds.has(row.target_uuid)) return;
            const ev = row.event_type;
            if (ev !== 'impression' && ev !== 'click' && ev !== 'clickout') return;
            setEngagement(prev => {
              if (!prev) return prev;
              const next = { ...prev };
              if (ev === 'impression') { next.total_impressions += 1; next.week_impressions += 1; }
              if (ev === 'click')      { next.total_clicks      += 1; next.week_clicks      += 1; }
              if (ev === 'clickout')   { next.total_clickouts   += 1; next.week_clickouts   += 1; }
              return next;
            });
          },
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel && supabase) supabase.removeChannel(channel);
    };
  }, []);

  // The login toast and the legacy 'open-wallet-analytics' event both
  // expect the analytics block to scroll into view — opening Insights
  // and scrolling to it preserves that behaviour.
  useEffect(() => {
    const openAndScroll = () => {
      setInsightsOpen(true);
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

  // Dispatch a burst-of-pulses celebration centered on the CTA the
  // user just tapped. WalletBackground listens for this event and
  // spawns ~36 free-flying particles fanning outward from the
  // origin, so the network visually "reacts" to the action.
  function emitWithdrawBurst(origin?: { x: number; y: number }) {
    if (typeof window === 'undefined') return;
    const detail = origin ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    window.dispatchEvent(new CustomEvent('wallet:burst', { detail }));
  }

  async function handleWithdraw(e?: React.MouseEvent<HTMLButtonElement>) {
    if (!profile?.is_payout_active) {
      setShowSignup(true);
      return;
    }
    // Burst centered on the clicked button so the celebration looks
    // intentional, not arbitrary.
    const target = e?.currentTarget;
    const rect = target?.getBoundingClientRect();
    emitWithdrawBurst(rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined);
    setWithdrawing(true);
    setWithdrawError('');
    try {
      const res = await initiateWithdrawal();
      setWithdrawLink(res.withdraw_link);
      // Gold ribbon along the bottom — marks the payout having
      // posted. Fires once on the successful response.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('wallet:payout'));
      }
      window.open(res.withdraw_link, '_blank', 'noopener,noreferrer');
      await load();
    } catch (err: unknown) {
      setWithdrawError((err as Error).message ?? 'Failed to initiate withdrawal');
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

  // Scrolling happens on the .my-looks-overlay--wallet ancestor that
  // wraps the wallet route — walk up from the root once on mount to
  // find it so the canvas can subscribe to its scrollTop.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    let node: HTMLElement | null = rootRef.current;
    while (node && node !== document.body) {
      if (node.classList.contains('my-looks-overlay')) {
        setScrollEl(node);
        return;
      }
      node = node.parentElement;
    }
  }, []);

  return (
    <div className="wallet-root" ref={rootRef}>
      <WalletBackground scrollEl={scrollEl} />
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
            {/* Hero — Total Earned dead-centre of the viewport.
                No card, no border; the glow + the number do the
                work. The "Show insights" pill sits at the bottom
                of the same viewport-height block so above-the-fold
                is exclusively the hero. Pressing it expands the
                insights panel AND scrolls it into view. */}
            <div className="wallet-hero">
              {/* Concentric green rings, anchored to the hero box so they're
                  guaranteed centered on the $ amount (the prior version
                  hardcoded 28vh from the page top and detached on layout
                  shifts). Six rings, hairline-thin (0.5px border), each
                  with a brighter arc that sweeps via a conic-gradient mask. */}
              <div className="wallet-hero-rings" aria-hidden="true">
                {Array.from({ length: 6 }, (_, i) => (
                  <span key={i} className="wallet-hero-ring" />
                ))}
              </div>
              <div className="wallet-hero-glow" aria-hidden />
              <div className="wallet-hero-label">Total Earned</div>
              <div className="wallet-hero-amount">${totalEarning.toFixed(2)}</div>
              {/* Withdraw CTA sits directly under the hero amount so the
                  primary action is in arm's reach. Goes to Connect when
                  Dots isn't wired up yet so the flow is one-tap from
                  cold. */}
              {isConnected ? (
                <button
                  type="button"
                  className={`wallet-hero-withdraw${balance <= 0 ? ' wallet-hero-withdraw--disabled' : ''}`}
                  onClick={handleWithdraw}
                  disabled={withdrawing || balance <= 0}
                >
                  {withdrawing ? 'Processing…' : `Withdraw $${balance.toFixed(2)}`}
                </button>
              ) : (
                <button
                  type="button"
                  className="wallet-hero-withdraw"
                  onClick={() => setShowSignup(true)}
                >
                  Connect to Withdraw
                </button>
              )}
              <button
                type="button"
                className="wallet-insights-toggle"
                onClick={() => {
                  setInsightsOpen(true);
                  requestAnimationFrame(() => {
                    insightsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  });
                }}
                aria-expanded={insightsOpen}
              >
                <span className="wallet-insights-toggle-label">Show insights</span>
                <svg
                  className="wallet-insights-chevron"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </div>

            {/* Secondary cards: balance + withdrawn */}
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

            {/* Insights — collapsible section wrapping analytics + history.
                Toggle button lives in the hero block now; clicking it sets
                insightsOpen=true and scrolls this container into view. */}
            <div ref={insightsRef} className={`wallet-insights${insightsOpen ? ' wallet-insights--open' : ''}`}>
              <div className="wallet-insights-panel">
                <div className="wallet-insights-inner">
                  <div className="wallet-analytics">
                    <div className="wallet-analytics-header">Analytics</div>
                    <div className="wallet-analytics-cards">
                      <div className="wallet-analytics-card">
                        <div className="wallet-analytics-card-label">Impressions</div>
                        <div className="wallet-analytics-card-amount">
                          {(engagement?.total_impressions ?? 0).toLocaleString()}
                        </div>
                        <div className="wallet-analytics-card-sub">
                          +{(engagement?.week_impressions ?? 0).toLocaleString()} this week
                        </div>
                      </div>
                      <div className="wallet-analytics-card">
                        <div className="wallet-analytics-card-label">Clicks</div>
                        <div className="wallet-analytics-card-amount">
                          {(engagement?.total_clicks ?? 0).toLocaleString()}
                        </div>
                        <div className="wallet-analytics-card-sub">
                          +{(engagement?.week_clicks ?? 0).toLocaleString()} this week
                        </div>
                      </div>
                      <div className="wallet-analytics-card">
                        <div className="wallet-analytics-card-label">Clickouts</div>
                        <div className="wallet-analytics-card-amount">
                          {(engagement?.total_clickouts ?? 0).toLocaleString()}
                        </div>
                        <div className="wallet-analytics-card-sub">
                          +{(engagement?.week_clickouts ?? 0).toLocaleString()} this week
                        </div>
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

import { useState, useEffect, useCallback } from 'react';
import {
  type WalletEntry,
  getWallet,
  initiateWithdrawal,
  deleteDotsUser,
} from '~/services/earnings';
import { supabase } from '~/utils/supabase';
import DotsSignupModal from './DotsSignupModal';

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

  // Fetch payout-related profile columns
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

  if (profileLoading) {
    return (
      <div className="wallet-loading">
        <span className="wallet-spinner" />
      </div>
    );
  }

  return (
    <div className="wallet-root">
      {/* Setup banner — only when not connected */}
      {!isConnected && (
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

      {loading ? (
        <div className="wallet-loading">
          <span className="wallet-spinner" />
        </div>
      ) : (
        <>
          {/* Stat cards */}
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

            <div className="wallet-card wallet-card--earned">
              <div className="wallet-card-label">Total Earned</div>
              <div className="wallet-card-amount wallet-card-amount--green">${totalEarning.toFixed(2)}</div>
            </div>

            <div className="wallet-card wallet-card--secondary">
              <div className="wallet-card-label">Total Withdrawn</div>
              <div className="wallet-card-amount">${totalWithdraw.toFixed(2)}</div>
            </div>
          </div>

          {/* Pending payout link */}
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

          {/* Transaction history */}
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

          {/* Connected account status */}
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

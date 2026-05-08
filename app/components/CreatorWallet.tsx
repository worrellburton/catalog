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
    return <div style={{ padding: 32, textAlign: 'center', color: '#888', fontSize: 14 }}>Loading…</div>;
  }

  return (
    <div>
      {/* Connect banner */}
      {!isConnected && (
        <div style={{
          background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 12,
          padding: '16px 20px', marginBottom: 20, display: 'flex',
          alignItems: 'center', justifyContent: 'space-between', gap: 12,
          flexWrap: 'wrap',
        }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>Connect your payout account</div>
            <div style={{ fontSize: 13, color: '#666' }}>
              Link your Dots account to withdraw earnings to your bank, Venmo, or PayPal
            </div>
          </div>
          <button
            onClick={() => setShowSignup(true)}
            style={{
              padding: '9px 20px', background: '#000', color: '#fff',
              border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14,
            }}
          >
            Connect Dots
          </button>
        </div>
      )}

      {/* Balance cards */}
      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: '#888', fontSize: 14 }}>
          Loading wallet…
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            {/* Balance */}
            <div style={{
              flex: '1 1 180px', padding: '20px 24px', background: '#000',
              color: '#fff', borderRadius: 16,
            }}>
              <div style={{ fontSize: 12, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                Available Balance
              </div>
              <div style={{ fontSize: 32, fontWeight: 700 }}>
                ${balance.toFixed(2)}
              </div>
              <div style={{ fontSize: 11, opacity: 0.5, marginTop: 4 }}>
                Withdraw anytime
              </div>
              {isConnected ? (
                <button
                  onClick={handleWithdraw}
                  disabled={withdrawing || balance <= 0}
                  title={balance <= 0 ? 'No balance to withdraw' : undefined}
                  style={{
                    marginTop: 14, padding: '8px 18px', background: '#fff',
                    color: balance <= 0 ? '#999' : '#000', border: 'none', borderRadius: 8,
                    cursor: balance <= 0 ? 'default' : 'pointer', fontWeight: 600, fontSize: 13,
                    opacity: balance <= 0 ? 0.5 : 1,
                  }}
                >
                  {withdrawing ? 'Processing…' : 'Withdraw'}
                </button>
              ) : (
                <button
                  onClick={() => setShowSignup(true)}
                  style={{
                    marginTop: 14, padding: '8px 18px', background: '#fff',
                    color: '#000', border: 'none', borderRadius: 8,
                    cursor: 'pointer', fontWeight: 600, fontSize: 13,
                  }}
                >
                  Connect to Withdraw
                </button>
              )}
            </div>
            {/* Total earned */}
            <div style={{
              flex: '1 1 140px', padding: '20px 24px', background: '#f0fdf4',
              borderRadius: 16, border: '1px solid #bbf7d0',
            }}>
              <div style={{ fontSize: 12, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                Total Earned
              </div>
              <div style={{ fontSize: 26, fontWeight: 700, color: '#15803d' }}>
                ${totalEarning.toFixed(2)}
              </div>
            </div>
            {/* Total withdrawn */}
            <div style={{
              flex: '1 1 140px', padding: '20px 24px', background: '#fafafa',
              borderRadius: 16, border: '1px solid #e5e7eb',
            }}>
              <div style={{ fontSize: 12, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                Total Withdrawn
              </div>
              <div style={{ fontSize: 26, fontWeight: 700 }}>
                ${totalWithdraw.toFixed(2)}
              </div>
            </div>
          </div>

          {/* Open existing withdraw link */}
          {withdrawLink && (
            <div style={{
              background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12,
              padding: '12px 16px', marginBottom: 16, display: 'flex',
              alignItems: 'center', justifyContent: 'space-between', gap: 12,
              flexWrap: 'wrap',
            }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>
                Your payout link is ready — complete the withdrawal at any time
              </div>
              <button
                onClick={() => window.open(withdrawLink!, '_blank', 'noopener,noreferrer')}
                style={{
                  padding: '7px 16px', background: '#92400e', color: '#fff',
                  border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                }}
              >
                Open Payout Link
              </button>
            </div>
          )}

          {withdrawError && (
            <div style={{ background: '#fef2f2', border: '1px solid #fee2e2', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: '#dc2626' }}>
              {withdrawError}
            </div>
          )}

          {/* Transaction history */}
          <div style={{ borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', fontWeight: 600, fontSize: 14, borderBottom: '1px solid #f0f0f0', background: '#fafafa' }}>
              Transaction History
            </div>
            {entries.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: '#888', fontSize: 14 }}>
                No transactions yet
              </div>
            ) : (
              <div>
                {entries.map(entry => (
                  <div
                    key={entry.id}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '12px 16px', borderBottom: '1px solid #f5f5f5',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: '50%', display: 'flex',
                        alignItems: 'center', justifyContent: 'center', fontSize: 16,
                        background: entry.type === 'credit' ? '#f0fdf4' :
                                     entry.type === 'debit' ? '#fef2f2' : '#fefce8',
                      }}>
                        {entry.type === 'credit' ? '↓' : entry.type === 'debit' ? '↑' : '⏳'}
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 500 }}>
                          {entry.comment || entryLabel(entry.entry_code)}
                        </div>
                        <div style={{ fontSize: 12, color: '#888' }}>
                          {new Date(entry.created_at).toLocaleDateString('en-US', {
                            month: 'short', day: 'numeric', year: 'numeric',
                            hour: '2-digit', minute: '2-digit',
                          })}
                        </div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{
                        fontSize: 15, fontWeight: 700,
                        color: entry.type === 'credit' ? '#15803d' :
                               entry.type === 'debit' ? '#dc2626' : '#92400e',
                      }}>
                        {entry.type === 'credit' ? '+' : entry.type === 'debit' ? '-' : ''}
                        ${entry.amount.toFixed(2)}
                      </div>
                      <div style={{ fontSize: 11, color: '#888' }}>
                        Bal: ${entry.current_balance.toFixed(2)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Payout account status */}
          {isConnected && (
            <div style={{ marginTop: 20, padding: '12px 16px', background: '#fafafa', borderRadius: 12, border: '1px solid #e5e7eb' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 8, height: 8, background: '#22c55e', borderRadius: '50%', display: 'inline-block' }} />
                  <span style={{ fontSize: 13, fontWeight: 500 }}>Dots account connected</span>
                  {profile.is_payout_verified && (
                    <span style={{ fontSize: 11, background: '#dcfce7', color: '#15803d', padding: '2px 7px', borderRadius: 6, fontWeight: 600 }}>
                      VERIFIED
                    </span>
                  )}
                </div>
                <button
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: 12 }}
                >
                  {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                </button>
              </div>
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

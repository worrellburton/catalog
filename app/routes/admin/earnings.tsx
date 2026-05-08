import { useState, useEffect, useCallback } from 'react';
import {
  type PayoutSettings,
  type PayoutCreator,
  type PayoutFrequency,
  getPayoutSettings,
  updatePayoutSettings,
  getPayoutCreators,
  adminCreditCreator,
} from '~/services/earnings';

const FREQUENCY_LABELS: Record<PayoutFrequency, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  biweekly: 'Bi-Weekly',
  monthly: 'Monthly',
};

export default function AdminEarnings() {
  const [settings, setSettings] = useState<PayoutSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  const [payoutValue, setPayoutValue] = useState('5');
  const [cac, setCac] = useState('2');
  const [frequency, setFrequency] = useState<PayoutFrequency>('weekly');

  const [showCreatePayout, setShowCreatePayout] = useState(false);
  const [payoutSearch, setPayoutSearch] = useState('');
  const [creators, setCreators] = useState<PayoutCreator[]>([]);
  const [loadingCreators, setLoadingCreators] = useState(false);

  const [transferTarget, setTransferTarget] = useState<PayoutCreator | null>(null);
  const [transferAmount, setTransferAmount] = useState('');
  const [transferComment, setTransferComment] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [transferMsg, setTransferMsg] = useState('');

  // Load settings on mount
  useEffect(() => {
    getPayoutSettings().then(s => {
      setSettings(s);
      setPayoutValue(s.payout_value.toString());
      setCac(s.cac.toString());
      setFrequency(s.frequency);
    }).catch(() => {});
  }, []);

  // Load creators when panel opens
  const loadCreators = useCallback(async (search: string) => {
    setLoadingCreators(true);
    try {
      const res = await getPayoutCreators(search);
      setCreators(res.creators);
    } finally {
      setLoadingCreators(false);
    }
  }, []);

  useEffect(() => {
    if (showCreatePayout) {
      loadCreators(payoutSearch);
    }
  }, [showCreatePayout, payoutSearch, loadCreators]);

  async function saveSettings() {
    setSavingSettings(true);
    setSettingsSaved(false);
    try {
      const updated = await updatePayoutSettings(
        parseFloat(payoutValue) || 5,
        parseFloat(cac) || 2,
        frequency,
      );
      setSettings(updated);
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 3000);
    } finally {
      setSavingSettings(false);
    }
  }

  async function doTransfer() {
    if (!transferTarget || !transferAmount) return;
    setTransferring(true);
    setTransferMsg('');
    try {
      await adminCreditCreator(
        transferTarget.id,
        parseFloat(transferAmount),
        transferComment || undefined,
      );
      setTransferMsg('Transfer sent successfully');
      setTransferAmount('');
      setTransferComment('');
      setTransferTarget(null);
    } catch (e: unknown) {
      setTransferMsg((e as Error).message ?? 'Transfer failed');
    } finally {
      setTransferring(false);
    }
  }

  const displayName = (c: PayoutCreator) =>
    c.full_name ?? c.email ?? c.id.slice(0, 8);

  return (
    <div className="admin-page">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0 }}>Earnings</h1>
          <p className="admin-page-subtitle" style={{ margin: '4px 0 0' }}>Creator payout configuration via Dots</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
          {/* Payout Pool */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, fontWeight: 500, color: '#666', textTransform: 'uppercase', letterSpacing: 0.3 }}>Payout Pool</label>
            <div className="admin-popover-input-wrap" style={{ width: 120 }}>
              <span className="admin-popover-input-prefix">$</span>
              <input type="number" min="0" step="0.01" value={payoutValue} onChange={e => setPayoutValue(e.target.value)} />
            </div>
          </div>
          {/* CAC */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, fontWeight: 500, color: '#666', textTransform: 'uppercase', letterSpacing: 0.3 }}>Acquisition Cost</label>
            <div className="admin-popover-input-wrap" style={{ width: 120 }}>
              <span className="admin-popover-input-prefix">$</span>
              <input type="number" min="0" step="0.01" value={cac} onChange={e => setCac(e.target.value)} />
            </div>
          </div>
          {/* Frequency */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, fontWeight: 500, color: '#666', textTransform: 'uppercase', letterSpacing: 0.3 }}>Pay Frequency</label>
            <select
              value={frequency}
              onChange={e => setFrequency(e.target.value as PayoutFrequency)}
              className="admin-date-input"
              style={{ height: 34, paddingRight: 28, cursor: 'pointer' }}
            >
              {(Object.keys(FREQUENCY_LABELS) as PayoutFrequency[]).map(f => (
                <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>
              ))}
            </select>
          </div>
          {/* Save */}
          <button
            className="admin-btn admin-btn-primary"
            onClick={saveSettings}
            disabled={savingSettings}
            style={{ alignSelf: 'flex-end' }}
          >
            {savingSettings ? 'Saving…' : settingsSaved ? '✓ Saved' : 'Save Settings'}
          </button>
          {/* Create Payout */}
          <button
            className="admin-btn admin-btn-primary"
            onClick={() => setShowCreatePayout(v => !v)}
            style={{ alignSelf: 'flex-end' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {showCreatePayout ? 'Close' : 'Send Payout'}
          </button>
        </div>
      </div>

      {/* Current settings summary */}
      {settings && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
          {[
            { label: 'Payout Pool', value: `$${settings.payout_value.toFixed(2)}` },
            { label: 'Acquisition Cost', value: `$${settings.cac.toFixed(2)}` },
            { label: 'Frequency', value: FREQUENCY_LABELS[settings.frequency] },
            { label: 'Effective', value: new Date(settings.effective_at).toLocaleDateString() },
          ].map(({ label, value }) => (
            <div key={label} className="admin-table-wrap" style={{ padding: '12px 20px', minWidth: 140 }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Send payout panel */}
      {showCreatePayout && (
        <div className="admin-table-wrap" style={{ marginBottom: 24, padding: 20 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 600 }}>Send Manual Payout</h3>

          {/* Search creators */}
          <input
            type="text"
            placeholder="Search creator by name or email…"
            value={payoutSearch}
            onChange={e => setPayoutSearch(e.target.value)}
            className="admin-date-input"
            style={{ width: '100%', marginBottom: 12 }}
          />

          {loadingCreators && (
            <div style={{ padding: '12px 0', color: '#888', fontSize: 13 }}>Loading creators…</div>
          )}

          {!loadingCreators && creators.map(c => (
            <div
              key={c.id}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 0', borderBottom: '1px solid #f0f0f0',
                background: transferTarget?.id === c.id ? '#f0f7ff' : 'transparent',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="admin-user-avatar" style={{ background: '#e0e0e0', width: 28, height: 28, fontSize: 10 }}>
                  {displayName(c).slice(0, 2).toUpperCase()}
                </span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>{displayName(c)}</div>
                  {c.email && <div style={{ fontSize: 11, color: '#888' }}>{c.email}</div>}
                </div>
                {c.is_payout_verified && (
                  <span className="admin-status admin-status-online" style={{ fontSize: 9 }}>DOTS VERIFIED</span>
                )}
                {!c.is_payout_active && (
                  <span className="admin-status" style={{ fontSize: 9, background: '#f5f5f5', color: '#999' }}>NOT CONNECTED</span>
                )}
              </div>
              <button
                className="admin-action-btn approve"
                onClick={() => setTransferTarget(transferTarget?.id === c.id ? null : c)}
              >
                {transferTarget?.id === c.id ? 'Cancel' : 'Select'}
              </button>
            </div>
          ))}

          {!loadingCreators && creators.length === 0 && (
            <div style={{ padding: 12, color: '#888', fontSize: 13 }}>No creators found</div>
          )}

          {/* Transfer form */}
          {transferTarget && (
            <div style={{ marginTop: 16, padding: 16, background: '#f8f9fa', borderRadius: 8 }}>
              <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 13 }}>
                Send to: {displayName(transferTarget)}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 0.3 }}>Amount</label>
                  <div className="admin-popover-input-wrap" style={{ width: 130 }}>
                    <span className="admin-popover-input-prefix">$</span>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="0.00"
                      value={transferAmount}
                      onChange={e => setTransferAmount(e.target.value)}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                  <label style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 0.3 }}>Note (optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. Performance bonus"
                    value={transferComment}
                    onChange={e => setTransferComment(e.target.value)}
                    className="admin-date-input"
                    style={{ flex: 1 }}
                  />
                </div>
                <button
                  className="admin-btn admin-btn-primary"
                  onClick={doTransfer}
                  disabled={transferring || !transferAmount}
                >
                  {transferring ? 'Sending…' : 'Send'}
                </button>
              </div>
              {transferMsg && (
                <div style={{ marginTop: 8, fontSize: 12, color: transferMsg.includes('success') ? '#2e7d32' : '#c62828' }}>
                  {transferMsg}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Creators payout status table */}
      <div className="admin-table-wrap">
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', fontWeight: 600, fontSize: 13 }}>
          Creator Payout Status
        </div>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Creator</th>
              <th>Dots Status</th>
              <th>Verified</th>
              <th>Active</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {creators.length === 0 && !loadingCreators && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: 24, color: '#999' }}>
                  {showCreatePayout ? 'No creators match your search' : 'Open "Send Payout" to browse creators'}
                </td>
              </tr>
            )}
            {creators.map(c => (
              <tr key={c.id}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="admin-user-avatar" style={{ background: '#e0e0e0', width: 28, height: 28, fontSize: 10 }}>
                      {displayName(c).slice(0, 2).toUpperCase()}
                    </span>
                    <div>
                      <div>{displayName(c)}</div>
                      {c.email && <div style={{ fontSize: 11, color: '#888' }}>{c.email}</div>}
                    </div>
                  </div>
                </td>
                <td>
                  {c.dots_user_id ? (
                    <span style={{ fontSize: 11, color: '#1976d2', fontWeight: 500 }}>
                      {c.dots_user_id.slice(0, 12)}…
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, color: '#999' }}>Not registered</span>
                  )}
                </td>
                <td>
                  {c.is_payout_verified ? (
                    <span className="admin-status admin-status-online" style={{ fontSize: 9 }}>VERIFIED</span>
                  ) : (
                    <span className="admin-status" style={{ fontSize: 9, background: '#fef3c7', color: '#92400e' }}>PENDING</span>
                  )}
                </td>
                <td>
                  {c.is_payout_active ? (
                    <span className="admin-status admin-status-online" style={{ fontSize: 9 }}>ACTIVE</span>
                  ) : (
                    <span className="admin-status" style={{ fontSize: 9, background: '#f5f5f5', color: '#999' }}>INACTIVE</span>
                  )}
                </td>
                <td className="admin-cell-muted">
                  {new Date(c.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

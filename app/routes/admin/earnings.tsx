import { useState, useEffect, useCallback, Fragment } from 'react';
import {
  type PayoutSettings,
  type PayoutCreator,
  type EarningsSummary,
  type WalletEntry,
  getPayoutSettings,
  updatePayoutSettings,
  getPayoutCreators,
  getEarningsSummary,
  adminGetCreatorWallet,
  adminCreditCreator,
} from '~/services/earnings';

// ── Chevron icon ──────────────────────────────────────────────────────────────
function ChevronRight({ open }: { open: boolean }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ transition: 'transform 0.18s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', flexShrink: 0 }}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export default function AdminEarnings() {
  const [settings, setSettings] = useState<PayoutSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [payoutValue, setPayoutValue] = useState('5');
  const [cac, setCac] = useState('2');

  const [summary, setSummary] = useState<EarningsSummary | null>(null);
  const [earningsSort, setEarningsSort] = useState<'total_earning' | 'current_balance' | 'created_at'>('total_earning');
  const [earningsSearch, setEarningsSearch] = useState('');
  const [creators, setCreators] = useState<PayoutCreator[]>([]);
  const [loadingCreators, setLoadingCreators] = useState(false);

  const [showCreatePayout, setShowCreatePayout] = useState(false);
  const [payoutSearch, setPayoutSearch] = useState('');
  const [transferTarget, setTransferTarget] = useState<PayoutCreator | null>(null);
  const [transferAmount, setTransferAmount] = useState('');
  const [transferComment, setTransferComment] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [transferMsg, setTransferMsg] = useState('');

  const [expandedCreator, setExpandedCreator] = useState<string | null>(null);
  const [walletCache, setWalletCache] = useState<Record<string, { entries: WalletEntry[]; loading: boolean }>>({});

  const [creditModal, setCreditModal] = useState<{ creator: PayoutCreator } | null>(null);
  const [creditAmount, setCreditAmount] = useState('');
  const [creditNote, setCreditNote] = useState('');
  const [crediting, setCrediting] = useState(false);
  const [creditMsg, setCreditMsg] = useState('');

  function toggleExpand(creatorId: string) {
    if (expandedCreator === creatorId) { setExpandedCreator(null); return; }
    setExpandedCreator(creatorId);
    if (!walletCache[creatorId]) {
      setWalletCache(prev => ({ ...prev, [creatorId]: { entries: [], loading: true } }));
      adminGetCreatorWallet(creatorId).then(res => {
        setWalletCache(prev => ({ ...prev, [creatorId]: { entries: res.entries, loading: false } }));
      }).catch(() => {
        setWalletCache(prev => ({ ...prev, [creatorId]: { entries: [], loading: false } }));
      });
    }
  }

  useEffect(() => {
    getPayoutSettings().then(s => {
      setSettings(s);
      setPayoutValue(s.payout_value.toString());
      setCac(s.cac.toString());
    }).catch(() => {});
    getEarningsSummary().then(setSummary).catch(() => {});
  }, []);

  const loadCreators = useCallback(async (search: string, sort: string) => {
    setLoadingCreators(true);
    try {
      const res = await getPayoutCreators(search, 1, 100, sort);
      setCreators(res.creators);
    } finally {
      setLoadingCreators(false);
    }
  }, []);

  useEffect(() => {
    loadCreators(earningsSearch, earningsSort);
  }, [earningsSearch, earningsSort, loadCreators]);

  const payoutPanelCreators = payoutSearch
    ? creators.filter(c => {
        const q = payoutSearch.toLowerCase();
        return (c.full_name ?? '').toLowerCase().includes(q) || (c.email ?? '').toLowerCase().includes(q);
      })
    : creators;

  async function saveSettings() {
    setSavingSettings(true); setSettingsSaved(false);
    try {
      const updated = await updatePayoutSettings(parseFloat(payoutValue) || 5, parseFloat(cac) || 2);
      setSettings(updated);
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 3000);
    } finally { setSavingSettings(false); }
  }

  function openCreditModal(creator: PayoutCreator) {
    setCreditModal({ creator });
    setCreditAmount('');
    setCreditNote('');
    setCreditMsg('');
  }

  async function doCredit() {
    if (!creditModal || !creditAmount) return;
    setCrediting(true); setCreditMsg('');
    try {
      await adminCreditCreator(creditModal.creator.id, parseFloat(creditAmount), creditNote || undefined);
      // Refresh wallet if this creator is expanded
      const cid = creditModal.creator.id;
      if (expandedCreator === cid) {
        adminGetCreatorWallet(cid).then(res => {
          setWalletCache(prev => ({ ...prev, [cid]: { entries: res.entries, loading: false } }));
        }).catch(() => {});
      }
      loadCreators(earningsSearch, earningsSort);
      getEarningsSummary().then(setSummary).catch(() => {});
      setCreditModal(null);
    } catch (e: unknown) {
      setCreditMsg((e as Error).message ?? 'Failed to add credit');
    } finally { setCrediting(false); }
  }

  async function doTransfer() {
    setTransferring(true); setTransferMsg('');
    if (!transferTarget) return;
    try {
      await adminCreditCreator(transferTarget.id, parseFloat(transferAmount), transferComment || undefined);
      setTransferMsg('Transfer sent successfully');
      setTransferAmount(''); setTransferComment(''); setTransferTarget(null);
      loadCreators(earningsSearch, earningsSort);
      getEarningsSummary().then(setSummary).catch(() => {});
    } catch (e: unknown) {
      setTransferMsg((e as Error).message ?? 'Transfer failed');
    } finally { setTransferring(false); }
  }

  const displayName = (c: PayoutCreator) => c.full_name ?? c.email ?? c.id.slice(0, 8);
  const fmt = (n: number) => `$${n.toFixed(2)}`;

  const statCards = summary ? [
    { label: 'Total Distributed', value: fmt(summary.total_platform_earnings), change: 'all time' },
    { label: 'Outstanding Balance', value: fmt(summary.total_outstanding_balance), change: 'pending payout' },
    { label: 'Total Withdrawn', value: fmt(summary.total_withdrawn), change: 'paid out' },
    { label: 'Active Earners', value: String(summary.creators_with_earnings), change: 'creators' },
  ] : [];

  return (
    <div className="admin-page">

      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div className="admin-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Earnings</h1>
          <p className="admin-page-subtitle">Creator payout insights and configuration via Dots</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button
            className={`admin-btn admin-btn-secondary`}
            onClick={() => setShowSettings(v => !v)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            {showSettings ? 'Hide Settings' : 'Settings'}
          </button>
          <button className="admin-btn admin-btn-primary" onClick={() => setShowCreatePayout(v => !v)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              {showCreatePayout ? <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></> : <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>}
            </svg>
            {showCreatePayout ? 'Close' : 'Send Payout'}
          </button>
        </div>
      </div>

      {/* ── Stats grid ────────────────────────────────────────────────────── */}
      <div className="admin-stats-grid">
        {summary === null ? (
          [1, 2, 3, 4].map(i => (
            <div key={i} className="admin-stat-card" style={{ opacity: 0.4 }}>
              <div className="admin-stat-label">—</div>
              <div className="admin-stat-value">—</div>
            </div>
          ))
        ) : statCards.map(s => (
          <div key={s.label} className="admin-stat-card">
            <div className="admin-stat-label">{s.label}</div>
            <div className="admin-stat-value">{s.value}</div>
            <div className="admin-stat-change neutral">{s.change}</div>
          </div>
        ))}
        {settings && (
          <>
            <div className="admin-stat-card">
              <div className="admin-stat-label">Payout Rate</div>
              <div className="admin-stat-value">{fmt(settings.payout_value)}</div>
              <div className="admin-stat-change neutral">per action</div>
            </div>
            <div className="admin-stat-card">
              <div className="admin-stat-label">Acquisition Cost</div>
              <div className="admin-stat-value">{fmt(settings.cac)}</div>
              <div className="admin-stat-change neutral">per creator</div>
            </div>
          </>
        )}
      </div>

      {/* ── Settings panel ────────────────────────────────────────────────── */}
      {showSettings && (
        <div className="admin-table-wrap" style={{ marginBottom: 20, padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>Payout Rate</div>
              <div className="admin-popover-input-wrap" style={{ width: 130 }}>
                <span className="admin-popover-input-prefix">$</span>
                <input type="number" min="0" step="0.01" value={payoutValue} onChange={e => setPayoutValue(e.target.value)} />
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>Acquisition Cost</div>
              <div className="admin-popover-input-wrap" style={{ width: 130 }}>
                <span className="admin-popover-input-prefix">$</span>
                <input type="number" min="0" step="0.01" value={cac} onChange={e => setCac(e.target.value)} />
              </div>
            </div>
            <button className="admin-btn admin-btn-primary" onClick={saveSettings} disabled={savingSettings}>
              {savingSettings ? 'Saving…' : settingsSaved ? '✓ Saved' : 'Save Settings'}
            </button>
            {settings && (
              <span style={{ fontSize: 12, color: '#aaa' }}>
                Last updated {new Date(settings.effective_at).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Send payout panel ─────────────────────────────────────────────── */}
      {showCreatePayout && (
        <div className="admin-table-wrap" style={{ marginBottom: 20 }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid #f0f0f0', fontWeight: 600, fontSize: 13 }}>
            Send Manual Payout
          </div>
          <div style={{ padding: '14px 16px' }}>
            <input
              type="text"
              placeholder="Search creator by name or email…"
              value={payoutSearch}
              onChange={e => setPayoutSearch(e.target.value)}
              className="admin-date-input"
              style={{ width: '100%', marginBottom: 12 }}
            />
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              {loadingCreators && <div style={{ padding: '10px 0', color: '#aaa', fontSize: 13 }}>Loading…</div>}
              {!loadingCreators && payoutPanelCreators.length === 0 && (
                <div style={{ padding: '10px 0', color: '#999', fontSize: 13 }}>No creators found</div>
              )}
              {!loadingCreators && payoutPanelCreators.map(c => (
                <div
                  key={c.id}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 10px', borderRadius: 8, marginBottom: 2,
                    background: transferTarget?.id === c.id ? '#f0f7ff' : 'transparent',
                    cursor: 'pointer',
                  }}
                  onClick={() => setTransferTarget(transferTarget?.id === c.id ? null : c)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="admin-user-avatar" style={{ background: '#e8eaed', fontSize: 11 }}>
                      {displayName(c).slice(0, 2).toUpperCase()}
                    </span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{displayName(c)}</div>
                      {c.email && <div style={{ fontSize: 11, color: '#888' }}>{c.email}</div>}
                    </div>
                    {c.is_payout_verified && (
                      <span className="admin-status admin-status-online" style={{ fontSize: 10 }}>Verified</span>
                    )}
                    {c.current_balance > 0 && (
                      <span className="admin-status admin-status-away" style={{ fontSize: 10 }}>bal {fmt(c.current_balance)}</span>
                    )}
                  </div>
                  <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    borderColor: transferTarget?.id === c.id ? '#1976d2' : '#ddd',
                    background: transferTarget?.id === c.id ? '#1976d2' : 'transparent' }}>
                    {transferTarget?.id === c.id && (
                      <svg width="9" height="9" viewBox="0 0 10 8" fill="none">
                        <polyline points="1 4 4 7 9 1" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {transferTarget && (
              <div style={{ marginTop: 14, padding: '14px 16px', background: '#f8faff', border: '1px solid #e3eaff', borderRadius: 10 }}>
                <div style={{ fontSize: 12, color: '#555', marginBottom: 10 }}>
                  Sending to <strong>{displayName(transferTarget)}</strong>
                  {transferTarget.current_balance > 0 && (
                    <span style={{ marginLeft: 6, color: '#aaa' }}>· current balance {fmt(transferTarget.current_balance)}</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 5 }}>Amount</div>
                    <div className="admin-popover-input-wrap" style={{ width: 130 }}>
                      <span className="admin-popover-input-prefix">$</span>
                      <input type="number" min="0.01" step="0.01" placeholder="0.00" value={transferAmount} onChange={e => setTransferAmount(e.target.value)} />
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 5 }}>Note (optional)</div>
                    <input type="text" placeholder="e.g. Performance bonus" value={transferComment} onChange={e => setTransferComment(e.target.value)} className="admin-date-input" style={{ width: '100%' }} />
                  </div>
                  <button className="admin-btn admin-btn-primary" onClick={doTransfer} disabled={transferring || !transferAmount}>
                    {transferring ? 'Sending…' : 'Send'}
                  </button>
                </div>
                {transferMsg && (
                  <div style={{ marginTop: 8, fontSize: 12, color: transferMsg.includes('success') ? '#16a34a' : '#c62828' }}>
                    {transferMsg}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Creator earnings table ─────────────────────────────────────────── */}
      <div className="admin-table-wrap">
        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #f0f0f0', gap: 12 }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>Creator Earnings</span>
          {!loadingCreators && (
            <span style={{ fontSize: 11, color: '#bbb', fontWeight: 400 }}>{creators.length} creators</span>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <input
              type="text"
              placeholder="Search…"
              value={earningsSearch}
              onChange={e => setEarningsSearch(e.target.value)}
              className="admin-date-input"
              style={{ width: 180 }}
            />
            <select
              value={earningsSort}
              onChange={e => setEarningsSort(e.target.value as typeof earningsSort)}
              className="admin-date-input"
              style={{ width: 160 }}
            >
              <option value="total_earning">Total Earned ↓</option>
              <option value="current_balance">Balance ↓</option>
              <option value="created_at">Newest First</option>
            </select>
          </div>
        </div>

        <table className="admin-table">
          <thead>
            <tr>
              <th>Creator</th>
              <th style={{ textAlign: 'right' }}>Total Earned</th>
              <th style={{ textAlign: 'right' }}>Balance</th>
              <th style={{ textAlign: 'right' }}>Withdrawn</th>
              <th>Payout</th>
              <th>Joined</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loadingCreators && (
              <tr><td colSpan={7} className="admin-empty" style={{ padding: '32px 0' }}>Loading…</td></tr>
            )}
            {!loadingCreators && creators.length === 0 && (
              <tr><td colSpan={7} className="admin-empty" style={{ padding: '32px 0' }}>No creators found</td></tr>
            )}
            {!loadingCreators && creators.map(c => {
              const isExpanded = expandedCreator === c.id;
              const walletState = walletCache[c.id];
              return (
                <Fragment key={c.id}>
                  <tr
                    className="admin-clickable-row"
                    onClick={() => toggleExpand(c.id)}
                    style={{ background: isExpanded ? '#fafbff' : undefined }}
                  >
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ color: '#bbb', flexShrink: 0 }}>
                          <ChevronRight open={isExpanded} />
                        </span>
                        <span className="admin-user-avatar" style={{ background: '#e8eaed' }}>
                          {displayName(c).slice(0, 2).toUpperCase()}
                        </span>
                        <div>
                          <div style={{ fontWeight: 500 }}>{displayName(c)}</div>
                          {c.email && <div style={{ fontSize: 11, color: '#aaa' }}>{c.email}</div>}
                        </div>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span style={{ fontWeight: 700, color: c.total_earning > 0 ? '#111' : '#ccc' }}>
                        {fmt(c.total_earning)}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {c.current_balance > 0 ? (
                        <span style={{ fontWeight: 700, color: '#e65100' }}>{fmt(c.current_balance)}</span>
                      ) : (
                        <span style={{ color: '#ccc' }}>$0.00</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {c.total_withdraw > 0 ? (
                        <span style={{ color: '#16a34a', fontWeight: 600 }}>{fmt(c.total_withdraw)}</span>
                      ) : (
                        <span style={{ color: '#ccc' }}>$0.00</span>
                      )}
                    </td>
                    <td>
                      {c.is_payout_verified ? (
                        <span className="admin-status admin-status-online">Verified</span>
                      ) : c.is_payout_active ? (
                        <span className="admin-status admin-status-away">Pending</span>
                      ) : (
                        <span className="admin-status admin-status-offline">Not connected</span>
                      )}
                    </td>
                    <td className="admin-cell-muted">{new Date(c.created_at).toLocaleDateString()}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="admin-btn admin-btn-secondary"
                        style={{ fontSize: 11, padding: '3px 10px', height: 'auto', whiteSpace: 'nowrap' }}
                        onClick={e => { e.stopPropagation(); openCreditModal(c); }}
                      >
                        + Payout
                      </button>
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr key={`${c.id}-wallet`}>
                      <td colSpan={7} style={{ padding: 0, background: '#f9fafc', borderBottom: '2px solid #e5e5e5' }}>
                        <div style={{ padding: '16px 20px 16px 56px' }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
                            Transaction History
                          </div>

                          {walletState?.loading && (
                            <div style={{ color: '#bbb', fontSize: 13, padding: '4px 0 8px' }}>Loading transactions…</div>
                          )}

                          {!walletState?.loading && walletState?.entries.length === 0 && (
                            <div style={{ color: '#bbb', fontSize: 13, padding: '4px 0 8px' }}>No transactions yet</div>
                          )}

                          {!walletState?.loading && walletState && walletState.entries.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                              {/* Column headers */}
                              <div style={{ display: 'grid', gridTemplateColumns: '160px 80px 130px 1fr 80px 80px', gap: 8, padding: '0 10px 6px', borderBottom: '1px solid #e8eaed' }}>
                                {['Date', 'Type', 'Code', 'Note', 'Amount', 'Balance'].map(h => (
                                  <div key={h} style={{ fontSize: 10, fontWeight: 600, color: '#bbb', textTransform: 'uppercase', letterSpacing: 0.4, textAlign: h === 'Amount' || h === 'Balance' ? 'right' : 'left' }}>
                                    {h}
                                  </div>
                                ))}
                              </div>
                              {walletState.entries.map(e => (
                                <div
                                  key={e.id}
                                  style={{ display: 'grid', gridTemplateColumns: '160px 80px 130px 1fr 80px 80px', gap: 8, padding: '7px 10px', borderRadius: 6, alignItems: 'center' }}
                                >
                                  <div style={{ fontSize: 12, color: '#555' }}>
                                    {new Date(e.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })}
                                    <span style={{ color: '#bbb', marginLeft: 4, fontSize: 11 }}>
                                      {new Date(e.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  </div>
                                  <div>
                                    <span className={`admin-status ${e.type === 'credit' ? 'admin-status-online' : e.type === 'on_hold' ? 'admin-status-away' : ''}`}
                                      style={e.type === 'debit' ? { background: '#fce4ec', color: '#c62828' } : { fontSize: 11 }}>
                                      {e.type === 'on_hold' ? 'Hold' : e.type.charAt(0).toUpperCase() + e.type.slice(1)}
                                    </span>
                                  </div>
                                  <div style={{ fontSize: 11, color: '#888', fontFamily: 'monospace' }}>
                                    {e.entry_code ?? <span style={{ color: '#ddd' }}>—</span>}
                                  </div>
                                  <div style={{ fontSize: 12, color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {e.comment ?? <span style={{ color: '#ddd' }}>—</span>}
                                  </div>
                                  <div style={{ textAlign: 'right', fontWeight: 700, fontSize: 13, color: e.type === 'credit' ? '#16a34a' : '#c62828' }}>
                                    {e.type === 'credit' ? '+' : '−'}{fmt(Math.abs(e.amount))}
                                  </div>
                                  <div style={{ textAlign: 'right', fontSize: 12, color: '#888' }}>
                                    {fmt(e.current_balance)}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Add Credit modal ──────────────────────────────────────────────── */}
      {creditModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => { if (!crediting) setCreditModal(null); }}
        >
          <div
            style={{ background: '#fff', borderRadius: 14, padding: '28px 28px 24px', width: 400, maxWidth: '92vw', boxShadow: '0 8px 40px rgba(0,0,0,0.18)' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>Add Payout</div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{displayName(creditModal.creator)}</div>
              </div>
              <button
                onClick={() => setCreditModal(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', padding: 4 }}
                disabled={crediting}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>Amount</div>
              <div className="admin-popover-input-wrap">
                <span className="admin-popover-input-prefix">$</span>
                <input
                  type="number" min="0.01" step="0.01" placeholder="0.00"
                  value={creditAmount}
                  onChange={e => setCreditAmount(e.target.value)}
                  autoFocus
                  style={{ fontSize: 16, fontWeight: 600 }}
                />
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>Note <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional)</span></div>
              <input
                type="text" placeholder="e.g. Manual adjustment"
                value={creditNote}
                onChange={e => setCreditNote(e.target.value)}
                className="admin-date-input" style={{ width: '100%' }}
              />
            </div>

            {creditMsg && (
              <div style={{ marginBottom: 14, fontSize: 12, color: '#c62828' }}>{creditMsg}</div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="admin-btn admin-btn-secondary" onClick={() => setCreditModal(null)} disabled={crediting}>Cancel</button>
              <button className="admin-btn admin-btn-primary" onClick={doCredit} disabled={crediting || !creditAmount}>
                {crediting ? 'Adding…' : 'Add Payout'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

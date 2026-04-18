import { useState } from 'react';

type Tab = 'overview' | 'transactions' | 'payouts' | 'invoices';

const stats = [
  { label: 'Gross Revenue (MTD)', value: '$0.00' },
  { label: 'Net Revenue (MTD)', value: '$0.00' },
  { label: 'Pending Payouts', value: '$0.00' },
  { label: 'Platform Fees (MTD)', value: '$0.00' },
  { label: 'Refunds (MTD)', value: '$0.00' },
  { label: 'Creator Earnings (MTD)', value: '$0.00' },
];

export default function AdminFinance() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Finance</h1>
        <p className="admin-page-subtitle">Revenue, payouts, invoices, and platform financials</p>
      </div>

      <div className="admin-stats-grid" style={{ marginBottom: 20 }}>
        {stats.map(s => (
          <div key={s.label} className="admin-stat-card">
            <span className="admin-stat-value">{s.value}</span>
            <span className="admin-stat-label">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="admin-tabs">
        <button
          className={`admin-tab ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          Overview
        </button>
        <button
          className={`admin-tab ${activeTab === 'transactions' ? 'active' : ''}`}
          onClick={() => setActiveTab('transactions')}
        >
          Transactions
        </button>
        <button
          className={`admin-tab ${activeTab === 'payouts' ? 'active' : ''}`}
          onClick={() => setActiveTab('payouts')}
        >
          Payouts
        </button>
        <button
          className={`admin-tab ${activeTab === 'invoices' ? 'active' : ''}`}
          onClick={() => setActiveTab('invoices')}
        >
          Invoices
        </button>
      </div>

      <div className="admin-empty">
        {activeTab === 'overview' && 'No financial activity yet'}
        {activeTab === 'transactions' && 'No transactions yet'}
        {activeTab === 'payouts' && 'No payouts yet'}
        {activeTab === 'invoices' && 'No invoices yet'}
      </div>
    </div>
  );
}

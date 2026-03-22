const orders = [
  { id: '#1042', date: 'Mar 20, 2026', customer: 'Sarah M.', product: 'Atlas Crossbody Bag', qty: 1, total: '$85.00', status: 'Fulfilled' },
  { id: '#1041', date: 'Mar 19, 2026', customer: 'James L.', product: 'Atlas Weekender', qty: 1, total: '$195.00', status: 'Fulfilled' },
  { id: '#1040', date: 'Mar 18, 2026', customer: 'Mia K.', product: 'Canvas Tote - Natural', qty: 2, total: '$130.00', status: 'Processing' },
  { id: '#1039', date: 'Mar 17, 2026', customer: 'David R.', product: 'Leather Wallet', qty: 1, total: '$45.00', status: 'Fulfilled' },
  { id: '#1038', date: 'Mar 15, 2026', customer: 'Emma T.', product: 'Atlas Backpack', qty: 1, total: '$210.00', status: 'Shipped' },
  { id: '#1037', date: 'Mar 14, 2026', customer: 'Noah B.', product: 'Belt Bag', qty: 1, total: '$55.00', status: 'Fulfilled' },
  { id: '#1036', date: 'Mar 12, 2026', customer: 'Olivia S.', product: 'Canvas Tote - Black', qty: 3, total: '$195.00', status: 'Fulfilled' },
  { id: '#1035', date: 'Mar 10, 2026', customer: 'Liam J.', product: 'Atlas Crossbody Bag', qty: 1, total: '$85.00', status: 'Refunded' },
];

export default function PartnersOrders() {
  return (
    <div className="partners-page">
      <div className="partners-page-header">
        <h2 className="partners-page-title">Orders</h2>
        <span className="partners-page-count">{orders.length} orders</span>
      </div>

      <div className="partners-stats-row" style={{ marginBottom: 24 }}>
        <div className="partners-stat-card">
          <span className="partners-stat-label">Total Orders</span>
          <span className="partners-stat-value">8</span>
          <span className="partners-stat-change">+2 this week</span>
        </div>
        <div className="partners-stat-card">
          <span className="partners-stat-label">Revenue</span>
          <span className="partners-stat-value">$1,000</span>
          <span className="partners-stat-change">+$340 this week</span>
        </div>
        <div className="partners-stat-card">
          <span className="partners-stat-label">Avg Order Value</span>
          <span className="partners-stat-value">$125</span>
          <span className="partners-stat-change">+$12 vs last month</span>
        </div>
      </div>

      <div className="partners-campaigns-table-wrap">
        <table className="partners-campaigns-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Date</th>
              <th>Customer</th>
              <th>Product</th>
              <th>Qty</th>
              <th>Total</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {orders.map(o => (
              <tr key={o.id}>
                <td style={{ fontWeight: 600 }}>{o.id}</td>
                <td style={{ color: '#888' }}>{o.date}</td>
                <td>{o.customer}</td>
                <td>{o.product}</td>
                <td>{o.qty}</td>
                <td style={{ fontWeight: 600 }}>{o.total}</td>
                <td>
                  <span className={`partners-status-badge ${o.status.toLowerCase()}`}>{o.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

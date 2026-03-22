import { useSortableTable, SortableTh } from '~/components/SortableTable';

const products = [
  { name: 'Atlas Crossbody Bag', sku: 'ATL-CB-001', price: '$85.00', inventory: 24, status: 'Active', sales: 42 },
  { name: 'Canvas Tote - Natural', sku: 'ATL-CT-002', price: '$65.00', inventory: 18, status: 'Active', sales: 38 },
  { name: 'Leather Wallet', sku: 'ATL-LW-003', price: '$45.00', inventory: 56, status: 'Active', sales: 67 },
  { name: 'Atlas Weekender', sku: 'ATL-WK-004', price: '$195.00', inventory: 8, status: 'Active', sales: 15 },
  { name: 'Belt Bag', sku: 'ATL-BB-005', price: '$55.00', inventory: 31, status: 'Active', sales: 29 },
  { name: 'Atlas Backpack', sku: 'ATL-BP-006', price: '$210.00', inventory: 5, status: 'Active', sales: 11 },
  { name: 'Canvas Tote - Black', sku: 'ATL-CT-007', price: '$65.00', inventory: 22, status: 'Active', sales: 33 },
  { name: 'Mini Crossbody', sku: 'ATL-MC-008', price: '$55.00', inventory: 0, status: 'Out of Stock', sales: 48 },
  { name: 'Travel Organizer', sku: 'ATL-TO-009', price: '$35.00', inventory: 44, status: 'Active', sales: 21 },
  { name: 'Laptop Sleeve', sku: 'ATL-LS-010', price: '$40.00', inventory: 0, status: 'Draft', sales: 0 },
];

export default function PartnersProducts() {
  const table = useSortableTable(products);
  const totalInventory = products.reduce((s, p) => s + p.inventory, 0);
  const totalSales = products.reduce((s, p) => s + p.sales, 0);

  return (
    <div className="partners-page">
      <div className="partners-page-header">
        <h2 className="partners-page-title">Products</h2>
        <button className="partners-create-campaign-btn" style={{ fontSize: 13, padding: '8px 16px' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Product
        </button>
      </div>

      <div className="partners-stats-row" style={{ marginBottom: 24 }}>
        <div className="partners-stat-card">
          <span className="partners-stat-label">Total Products</span>
          <span className="partners-stat-value">{products.length}</span>
        </div>
        <div className="partners-stat-card">
          <span className="partners-stat-label">In Stock</span>
          <span className="partners-stat-value">{totalInventory}</span>
        </div>
        <div className="partners-stat-card">
          <span className="partners-stat-label">Total Sales</span>
          <span className="partners-stat-value">{totalSales}</span>
        </div>
      </div>

      <div className="partners-campaigns-table-wrap">
        <table className="partners-campaigns-table">
          <thead>
            <tr>
              <SortableTh label="Product" sortKey="name" currentSort={table.sort} onSort={table.handleSort} />
              <SortableTh label="SKU" sortKey="sku" currentSort={table.sort} onSort={table.handleSort} />
              <SortableTh label="Price" sortKey="price" currentSort={table.sort} onSort={table.handleSort} />
              <SortableTh label="Inventory" sortKey="inventory" currentSort={table.sort} onSort={table.handleSort} />
              <SortableTh label="Sales" sortKey="sales" currentSort={table.sort} onSort={table.handleSort} />
              <SortableTh label="Status" sortKey="status" currentSort={table.sort} onSort={table.handleSort} />
            </tr>
          </thead>
          <tbody>
            {table.sortedData.map((p, i) => (
              <tr key={i}>
                <td>
                  <div className="partners-campaign-cell">
                    <div className="partners-product-thumb partners-shimmer" />
                    <span style={{ fontWeight: 500 }}>{p.name}</span>
                  </div>
                </td>
                <td style={{ color: '#888', fontFamily: 'monospace', fontSize: 11 }}>{p.sku}</td>
                <td style={{ fontWeight: 600 }}>{p.price}</td>
                <td style={{ color: p.inventory === 0 ? '#ef4444' : undefined, fontWeight: p.inventory === 0 ? 600 : 400 }}>{p.inventory}</td>
                <td>{p.sales}</td>
                <td>
                  <span className={`partners-status-badge ${p.status === 'Out of Stock' ? 'refunded' : p.status.toLowerCase()}`}>{p.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

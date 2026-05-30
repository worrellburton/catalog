// /admin/affiliate-com — comprehensive Affiliate.com integration console.
//
// Tabbed surface over every capability the affiliate-com edge function
// proxies: Overview, Merchants, Products, Deals, Links, Reports, and an
// API Explorer. Tab state is mirrored to the URL (?tab=) so views are
// linkable and survive refresh.

import { useSearchParams } from '@remix-run/react';
import OverviewTab from '~/components/affiliate-com/OverviewTab';
import MerchantsTab from '~/components/affiliate-com/MerchantsTab';
import ProductsTab from '~/components/affiliate-com/ProductsTab';
import DealsTab from '~/components/affiliate-com/DealsTab';
import LinksTab from '~/components/affiliate-com/LinksTab';
import ReportsTab from '~/components/affiliate-com/ReportsTab';
import ExplorerTab from '~/components/affiliate-com/ExplorerTab';

type TabKey = 'overview' | 'merchants' | 'products' | 'deals' | 'links' | 'reports' | 'explorer';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'merchants', label: 'Merchants' },
  { key: 'products', label: 'Products' },
  { key: 'deals', label: 'Deals & Coupons' },
  { key: 'links', label: 'Link Generator' },
  { key: 'reports', label: 'Reports' },
  { key: 'explorer', label: 'API Explorer' },
];

export default function AdminAffiliateCom() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab') as TabKey | null;
  const active: TabKey = TABS.some(t => t.key === raw) ? (raw as TabKey) : 'overview';

  const setTab = (key: TabKey) => {
    const next = new URLSearchParams(params);
    next.set('tab', key);
    setParams(next, { replace: true });
  };

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img
            src="https://cdn.brandfetch.io/affiliate.com/w/80/h/80/fallback/lettermark"
            alt="Affiliate.com"
            style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover' }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
          <div>
            <h1>Affiliate.com</h1>
            <p className="admin-page-subtitle">Browse merchants, search products, generate links, and track commissions.</p>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #e5e7eb', marginBottom: 20, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            style={{
              border: 'none',
              background: 'none',
              padding: '10px 14px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              color: active === t.key ? '#111' : '#94a3b8',
              borderBottom: active === t.key ? '2px solid #111' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {active === 'overview' && <OverviewTab />}
      {active === 'merchants' && <MerchantsTab />}
      {active === 'products' && <ProductsTab />}
      {active === 'deals' && <DealsTab />}
      {active === 'links' && <LinksTab />}
      {active === 'reports' && <ReportsTab />}
      {active === 'explorer' && <ExplorerTab />}
    </div>
  );
}

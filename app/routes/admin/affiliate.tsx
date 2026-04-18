import { useState, useMemo } from 'react';

interface AffiliateNetwork {
  name: string;
  logo: string;
  merchants: string;
  avgCommission: string;
  categories: string[];
  partnerBrands: string[];
  paymentSchedule: string;
  minPayout: string;
  cookieDuration: string;
  hasApi: boolean;
  status: 'available' | 'connected' | 'pending';
}

const networks: AffiliateNetwork[] = [
  {
    name: 'Impact',
    logo: 'https://cdn.brandfetch.io/impact.com/w/80/h/80/fallback/lettermark',
    merchants: '3,500+',
    avgCommission: '8-15%',
    categories: ['Fashion', 'Luxury', 'DTC', 'Beauty'],
    partnerBrands: ['Adidas', 'Levi\'s', 'Uber', 'Airbnb', 'Canva', 'Shopify'],
    paymentSchedule: '1st & 15th monthly',
    minPayout: '$10',
    cookieDuration: '30 days',
    hasApi: true,
    status: 'available',
  },
  {
    name: 'Rakuten Advertising',
    logo: 'https://cdn.brandfetch.io/rakuten.com/w/80/h/80/fallback/lettermark',
    merchants: '1,000+',
    avgCommission: '5-20%',
    categories: ['Luxury', 'Fashion', 'Electronics', 'Travel'],
    partnerBrands: ['Sephora', 'New Balance', 'Macy\'s', 'Virgin Atlantic', 'JetBlue'],
    paymentSchedule: 'Monthly (Net 60)',
    minPayout: '$50',
    cookieDuration: '30 days',
    hasApi: true,
    status: 'available',
  },
  {
    name: 'CJ Affiliate',
    logo: 'https://cdn.brandfetch.io/cj.com/w/80/h/80/fallback/lettermark',
    merchants: '3,800+',
    avgCommission: '5-25%',
    categories: ['Fashion', 'Retail', 'Finance', 'Travel'],
    partnerBrands: ['Nike', 'Puma', 'J.Crew', 'Samsung', 'GoPro', 'Overstock'],
    paymentSchedule: '20th or 28th monthly',
    minPayout: '$50',
    cookieDuration: '45 days',
    hasApi: true,
    status: 'available',
  },
  {
    name: 'ShareASale',
    logo: 'https://cdn.brandfetch.io/shareasale.com/w/80/h/80/fallback/lettermark',
    merchants: '30,000+',
    avgCommission: '5-20%',
    categories: ['Fashion', 'Home', 'Beauty', 'Tech'],
    partnerBrands: ['Reebok', 'Warby Parker', 'Wayfair', 'Sun Basket', 'FreshBooks'],
    paymentSchedule: '20th monthly',
    minPayout: '$50',
    cookieDuration: '30 days',
    hasApi: true,
    status: 'available',
  },
  {
    name: 'Awin',
    logo: 'https://cdn.brandfetch.io/awin.com/w/80/h/80/fallback/lettermark',
    merchants: '30,000+',
    avgCommission: '5-15%',
    categories: ['Fashion', 'Retail', 'Telecom', 'Finance'],
    partnerBrands: ['ASOS', 'Etsy', 'Under Armour', 'Samsung', 'HP', 'AliExpress'],
    paymentSchedule: '1st & 15th monthly',
    minPayout: '$20',
    cookieDuration: '30 days',
    hasApi: true,
    status: 'available',
  },
  {
    name: 'Amazon Associates',
    logo: 'https://cdn.brandfetch.io/amazon.com/w/80/h/80/fallback/lettermark',
    merchants: '12M+ products',
    avgCommission: '1-10%',
    categories: ['Everything', 'Fashion', 'Electronics', 'Home'],
    partnerBrands: ['Amazon Basics', 'Whole Foods', 'Ring', 'Kindle', 'Audible'],
    paymentSchedule: '60 days after month end',
    minPayout: '$10',
    cookieDuration: '24 hours',
    hasApi: true,
    status: 'available',
  },
  {
    name: 'PartnerStack',
    logo: 'https://cdn.brandfetch.io/partnerstack.com/w/80/h/80/fallback/lettermark',
    merchants: '500+',
    avgCommission: '15-30%',
    categories: ['SaaS', 'Tech', 'B2B'],
    partnerBrands: ['Notion', 'Monday.com', 'Webflow', 'Brevo', 'Gorgias'],
    paymentSchedule: '13th monthly',
    minPayout: '$25',
    cookieDuration: '90 days',
    hasApi: true,
    status: 'available',
  },
  {
    name: 'LTK (RewardStyle)',
    logo: 'https://cdn.brandfetch.io/shopltk.com/w/80/h/80/fallback/lettermark',
    merchants: '7,000+',
    avgCommission: '10-25%',
    categories: ['Fashion', 'Beauty', 'Home', 'Lifestyle'],
    partnerBrands: ['Nordstrom', 'Revolve', 'Abercrombie', 'Target', 'Zara', 'H&M'],
    paymentSchedule: 'Monthly',
    minPayout: '$100',
    cookieDuration: '30 days',
    hasApi: false,
    status: 'available',
  },
  {
    name: 'Skimlinks',
    logo: 'https://cdn.brandfetch.io/skimlinks.com/w/80/h/80/fallback/lettermark',
    merchants: '48,500+',
    avgCommission: '5-15%',
    categories: ['Fashion', 'Travel', 'Tech', 'Finance'],
    partnerBrands: ['ASOS', 'John Lewis', 'Booking.com', 'Nike', 'Apple'],
    paymentSchedule: 'Quarterly (Net 90)',
    minPayout: '$65',
    cookieDuration: 'Varies',
    hasApi: true,
    status: 'available',
  },
  {
    name: 'Pepperjam (Partnerize)',
    logo: 'https://cdn.brandfetch.io/partnerize.com/w/80/h/80/fallback/lettermark',
    merchants: '1,600+',
    avgCommission: '8-20%',
    categories: ['Fashion', 'Retail', 'Travel', 'Finance'],
    partnerBrands: ['Puma', 'Fanatics', 'Bonobos', 'L\'Occitane', 'Timberland'],
    paymentSchedule: 'Monthly',
    minPayout: '$25',
    cookieDuration: '30 days',
    hasApi: true,
    status: 'available',
  },
  {
    name: 'FlexOffers',
    logo: 'https://cdn.brandfetch.io/flexoffers.com/w/80/h/80/fallback/lettermark',
    merchants: '10,000+',
    avgCommission: '5-15%',
    categories: ['Retail', 'Finance', 'Health', 'Travel'],
    partnerBrands: ['Walmart', 'Kohl\'s', 'Macy\'s', 'Samsung', 'T-Mobile'],
    paymentSchedule: 'Net 60',
    minPayout: '$50',
    cookieDuration: '30 days',
    hasApi: true,
    status: 'available',
  },
  {
    name: 'Refersion',
    logo: 'https://cdn.brandfetch.io/refersion.com/w/80/h/80/fallback/lettermark',
    merchants: '60,000+',
    avgCommission: '10-20%',
    categories: ['DTC', 'Ecommerce', 'Fashion', 'Beauty'],
    partnerBrands: ['Verb Energy', 'Magic Spoon', 'Pura Vida', 'Mented Cosmetics'],
    paymentSchedule: 'Monthly',
    minPayout: '$0 (PayPal)',
    cookieDuration: 'Custom',
    hasApi: true,
    status: 'available',
  },
];

type ViewMode = 'table' | 'grid';

export default function AdminAffiliate() {
  const [view, setView] = useState<ViewMode>('table');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const allCategories = useMemo(() => {
    const set = new Set<string>();
    networks.forEach(n => n.categories.forEach(c => set.add(c)));
    return ['all', ...Array.from(set).sort()];
  }, []);

  const filtered = useMemo(() => {
    let list = networks;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(n =>
        n.name.toLowerCase().includes(q) ||
        n.partnerBrands.some(b => b.toLowerCase().includes(q))
      );
    }
    if (categoryFilter !== 'all') {
      list = list.filter(n => n.categories.includes(categoryFilter));
    }
    return list;
  }, [search, categoryFilter]);

  const stats = [
    { label: 'Networks', value: String(networks.length) },
    { label: 'With API', value: String(networks.filter(n => n.hasApi).length) },
    { label: 'Fashion Focus', value: String(networks.filter(n => n.categories.includes('Fashion')).length) },
    { label: 'Connected', value: String(networks.filter(n => n.status === 'connected').length) },
  ];

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1>Affiliate Networks</h1>
          <p className="admin-page-subtitle">Browse and connect affiliate link providers</p>
        </div>
      </div>

      <div className="admin-stats-grid">
        {stats.map(s => (
          <div key={s.label} className="admin-stat-card">
            <span className="admin-stat-value">{s.value}</span>
            <span className="admin-stat-label">{s.label}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search networks or brands..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            flex: 1, minWidth: 200, padding: '8px 12px', borderRadius: 8,
            border: '1px solid #e0e0e0', fontSize: 13,
          }}
        />
        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          style={{
            padding: '8px 12px', borderRadius: 8, border: '1px solid #e0e0e0',
            fontSize: 13, background: '#fff',
          }}
        >
          {allCategories.map(c => (
            <option key={c} value={c}>{c === 'all' ? 'All Categories' : c}</option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            className={`admin-btn ${view === 'table' ? 'admin-btn-primary' : 'admin-btn-secondary'}`}
            style={{ fontSize: 12, padding: '6px 12px' }}
            onClick={() => setView('table')}
          >
            Table
          </button>
          <button
            className={`admin-btn ${view === 'grid' ? 'admin-btn-primary' : 'admin-btn-secondary'}`}
            style={{ fontSize: 12, padding: '6px 12px' }}
            onClick={() => setView('grid')}
          >
            Grid
          </button>
        </div>
      </div>

      {view === 'table' ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Network</th>
                <th>Merchants</th>
                <th>Avg Commission</th>
                <th>Categories</th>
                <th style={{ textAlign: 'left' }}>Top Partner Brands</th>
                <th>Cookie</th>
                <th>Min Payout</th>
                <th>API</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(n => (
                <tr key={n.name}>
                  <td style={{ textAlign: 'left' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <img
                        src={n.logo}
                        alt={n.name}
                        style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover' }}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{n.name}</div>
                        <div style={{ fontSize: 11, color: '#999' }}>{n.paymentSchedule}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ fontSize: 13 }}>{n.merchants}</td>
                  <td style={{ fontWeight: 600, fontSize: 13 }}>{n.avgCommission}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
                      {n.categories.slice(0, 3).map(c => (
                        <span key={c} style={{
                          padding: '2px 6px', borderRadius: 4, fontSize: 10,
                          background: '#f3f4f6', color: '#555', fontWeight: 500,
                        }}>
                          {c}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td style={{ textAlign: 'left', fontSize: 12, color: '#666' }}>
                    {n.partnerBrands.slice(0, 4).join(', ')}
                    {n.partnerBrands.length > 4 && <span style={{ color: '#999' }}> +{n.partnerBrands.length - 4}</span>}
                  </td>
                  <td style={{ fontSize: 12 }}>{n.cookieDuration}</td>
                  <td style={{ fontSize: 12 }}>{n.minPayout}</td>
                  <td>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                      fontSize: 11, fontWeight: 600,
                      background: n.hasApi ? '#dcfce7' : '#fee2e2',
                      color: n.hasApi ? '#16a34a' : '#dc2626',
                    }}>
                      {n.hasApi ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td>
                    {n.status === 'connected' ? (
                      <span className="admin-status admin-status-online">connected</span>
                    ) : n.status === 'pending' ? (
                      <span className="admin-status" style={{ color: '#f59e0b' }}>pending</span>
                    ) : (
                      <button
                        className="admin-btn admin-btn-primary"
                        style={{ fontSize: 11, padding: '4px 10px' }}
                      >
                        Connect
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: 16,
        }}>
          {filtered.map(n => (
            <div key={n.name} style={{
              border: '1px solid #e5e5e5', borderRadius: 12, padding: 20,
              background: '#fff',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <img
                    src={n.logo}
                    alt={n.name}
                    style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover' }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{n.name}</div>
                    <div style={{ fontSize: 12, color: '#999' }}>{n.merchants} merchants</div>
                  </div>
                </div>
                <span style={{
                  padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                  background: n.hasApi ? '#dcfce7' : '#fee2e2',
                  color: n.hasApi ? '#16a34a' : '#dc2626',
                }}>
                  API: {n.hasApi ? 'Yes' : 'No'}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', fontSize: 12, marginBottom: 16 }}>
                <div>
                  <div style={{ color: '#999', fontSize: 11 }}>Avg Commission</div>
                  <div style={{ fontWeight: 600 }}>{n.avgCommission}</div>
                </div>
                <div>
                  <div style={{ color: '#999', fontSize: 11 }}>Cookie Duration</div>
                  <div style={{ fontWeight: 600 }}>{n.cookieDuration}</div>
                </div>
                <div>
                  <div style={{ color: '#999', fontSize: 11 }}>Min Payout</div>
                  <div style={{ fontWeight: 600 }}>{n.minPayout}</div>
                </div>
                <div>
                  <div style={{ color: '#999', fontSize: 11 }}>Payment</div>
                  <div style={{ fontWeight: 600 }}>{n.paymentSchedule}</div>
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: '#999', marginBottom: 6 }}>Categories</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {n.categories.map(c => (
                    <span key={c} style={{
                      padding: '2px 8px', borderRadius: 4, fontSize: 11,
                      background: '#f3f4f6', color: '#555',
                    }}>
                      {c}
                    </span>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: '#999', marginBottom: 6 }}>Partner Brands</div>
                <div style={{ fontSize: 12, color: '#333', lineHeight: 1.6 }}>
                  {n.partnerBrands.join(', ')}
                </div>
              </div>

              {n.status === 'connected' ? (
                <span className="admin-status admin-status-online">Connected</span>
              ) : (
                <button
                  className="admin-btn admin-btn-primary"
                  style={{ width: '100%', fontSize: 12 }}
                >
                  Connect
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

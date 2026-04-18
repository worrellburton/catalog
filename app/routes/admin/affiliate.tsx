import { useState, useMemo } from 'react';

type NetworkType =
  | 'Network'           // multi-brand aggregator (Impact, CJ, Rakuten, ShareASale, Awin)
  | 'Retailer'          // single-retailer direct program (Amazon)
  | 'SaaS Platform'     // brands run their own programs through platform (Refersion, PartnerStack)
  | 'Creator Platform'  // influencer/creator-first closed ecosystem (LTK)
  | 'Sub-network'       // aggregates other networks (FlexOffers, Skimlinks)
  | 'Content Monetization'; // auto-link tools (Skimlinks)

interface AffiliateNetwork {
  name: string;
  logo: string;
  type: NetworkType;
  merchants: string;
  avgCommission: string;
  categories: string[];
  partnerBrands: string[];
  paymentSchedule: string;
  minPayout: string;
  cookieDuration: string;
  hasApi: boolean;
  status: 'available' | 'connected' | 'pending';
  apiDocsUrl?: string;
  connectionRequirements?: {
    authType: 'OAuth 2.0' | 'API Key' | 'Bearer Token' | 'Basic Auth' | 'Manual Link';
    fields: { key: string; label: string; description: string; sensitive?: boolean }[];
    prerequisites: string[];
    howToGet: string[];
  };
}

const networks: AffiliateNetwork[] = [
  {
    name: 'Impact',
    logo: 'https://cdn.brandfetch.io/impact.com/w/80/h/80/fallback/lettermark',
    type: 'Network',
    merchants: '3,500+',
    avgCommission: '8-15%',
    categories: ['Fashion', 'Luxury', 'DTC', 'Beauty'],
    partnerBrands: ['Adidas', 'Levi\'s', 'Uber', 'Airbnb', 'Canva', 'Shopify'],
    paymentSchedule: '1st & 15th monthly',
    minPayout: '$10',
    cookieDuration: '30 days',
    hasApi: true,
    status: 'available',
    apiDocsUrl: 'https://developer.impact.com/',
    connectionRequirements: {
      authType: 'Basic Auth',
      fields: [
        { key: 'account_sid', label: 'Account SID', description: 'Your Impact account identifier' },
        { key: 'auth_token', label: 'Auth Token', description: 'Your API auth token', sensitive: true },
      ],
      prerequisites: [
        'Approved Impact partner account',
        'Active program with at least one advertiser',
      ],
      howToGet: [
        'Log in to app.impact.com',
        'Go to Settings → API',
        'Copy your Account SID and generate an Auth Token',
      ],
    },
  },
  {
    name: 'Rakuten Advertising',
    logo: 'https://cdn.brandfetch.io/rakuten.com/w/80/h/80/fallback/lettermark',
    type: 'Network',
    merchants: '1,000+',
    avgCommission: '5-20%',
    categories: ['Luxury', 'Fashion', 'Electronics', 'Travel'],
    partnerBrands: ['Sephora', 'New Balance', 'Macy\'s', 'Virgin Atlantic', 'JetBlue'],
    paymentSchedule: 'Monthly (Net 60)',
    minPayout: '$50',
    cookieDuration: '30 days',
    hasApi: true,
    status: 'available',
    apiDocsUrl: 'https://developers.rakutenadvertising.com/',
    connectionRequirements: {
      authType: 'OAuth 2.0',
      fields: [
        { key: 'client_id', label: 'Client ID', description: 'OAuth app Client ID' },
        { key: 'client_secret', label: 'Client Secret', description: 'OAuth app secret', sensitive: true },
        { key: 'sid', label: 'Publisher SID', description: 'Your publisher site ID' },
      ],
      prerequisites: [
        'Approved Rakuten publisher account',
        'API access enabled for your account (request from account manager)',
      ],
      howToGet: [
        'Log in to rakutenadvertising.com',
        'Navigate to Links → Web Services',
        'Create a new Web Services app to get Client ID and Secret',
        'Your Publisher SID is shown in your account profile',
      ],
    },
  },
  {
    name: 'CJ Affiliate',
    logo: 'https://cdn.brandfetch.io/cj.com/w/80/h/80/fallback/lettermark',
    type: 'Network',
    merchants: '3,800+',
    avgCommission: '5-25%',
    categories: ['Fashion', 'Retail', 'Finance', 'Travel'],
    partnerBrands: ['Nike', 'Puma', 'J.Crew', 'Samsung', 'GoPro', 'Overstock'],
    paymentSchedule: '20th or 28th monthly',
    minPayout: '$50',
    cookieDuration: '45 days',
    hasApi: true,
    status: 'available',
    apiDocsUrl: 'https://developers.cj.com/',
    connectionRequirements: {
      authType: 'Bearer Token',
      fields: [
        { key: 'developer_key', label: 'Developer Key', description: 'Personal Access Token from CJ', sensitive: true },
        { key: 'website_id', label: 'Website ID (CID)', description: 'Your CJ website company ID (7-digit)' },
      ],
      prerequisites: [
        'Approved CJ publisher account',
        'At least one registered property/website',
      ],
      howToGet: [
        'Log in to members.cj.com',
        'Go to Account → Web Services',
        'Generate a Personal Access Token',
        'Your Website ID is in Account → Websites',
      ],
    },
  },
  {
    name: 'ShareASale',
    logo: 'https://cdn.brandfetch.io/shareasale.com/w/80/h/80/fallback/lettermark',
    type: 'Network',
    merchants: '30,000+',
    avgCommission: '5-20%',
    categories: ['Fashion', 'Home', 'Beauty', 'Tech'],
    partnerBrands: ['Reebok', 'Warby Parker', 'Wayfair', 'Sun Basket', 'FreshBooks'],
    paymentSchedule: '20th monthly',
    minPayout: '$50',
    cookieDuration: '30 days',
    hasApi: true,
    status: 'available',
    apiDocsUrl: 'https://apihelp.shareasale.com/',
    connectionRequirements: {
      authType: 'API Key',
      fields: [
        { key: 'api_token', label: 'API Token', description: 'Your ShareASale API Token', sensitive: true },
        { key: 'api_secret', label: 'API Secret Key', description: 'Your API secret key', sensitive: true },
        { key: 'affiliate_id', label: 'Affiliate ID', description: 'Your ShareASale affiliate ID' },
      ],
      prerequisites: [
        'Approved ShareASale affiliate account',
        'API access activated ($0 fee but must be requested)',
      ],
      howToGet: [
        'Log in to account.shareasale.com',
        'Go to Tools → Merchant Tools → API Credentials',
        'Enable API and copy the Token and Secret Key',
      ],
    },
  },
  {
    name: 'Awin',
    logo: 'https://cdn.brandfetch.io/awin.com/w/80/h/80/fallback/lettermark',
    type: 'Network',
    merchants: '30,000+',
    avgCommission: '5-15%',
    categories: ['Fashion', 'Retail', 'Telecom', 'Finance'],
    partnerBrands: ['ASOS', 'Etsy', 'Under Armour', 'Samsung', 'HP', 'AliExpress'],
    paymentSchedule: '1st & 15th monthly',
    minPayout: '$20',
    cookieDuration: '30 days',
    hasApi: true,
    status: 'available',
    apiDocsUrl: 'https://developer.awin.com/',
    connectionRequirements: {
      authType: 'OAuth 2.0',
      fields: [
        { key: 'api_token', label: 'OAuth2 Access Token', description: 'Personal API token', sensitive: true },
        { key: 'publisher_id', label: 'Publisher ID', description: 'Your Awin publisher ID' },
      ],
      prerequisites: [
        'Approved Awin publisher account ($5 refundable signup deposit)',
        'Publisher account in good standing',
      ],
      howToGet: [
        'Log in to ui.awin.com',
        'Go to Toolbox → API Credentials',
        'Create a new OAuth2 token',
        'Publisher ID is shown in your account dashboard URL',
      ],
    },
  },
  {
    name: 'Amazon Associates',
    logo: 'https://cdn.brandfetch.io/amazon.com/w/80/h/80/fallback/lettermark',
    type: 'Retailer',
    merchants: '12M+ products',
    avgCommission: '1-10%',
    categories: ['Everything', 'Fashion', 'Electronics', 'Home'],
    partnerBrands: ['Amazon Basics', 'Whole Foods', 'Ring', 'Kindle', 'Audible'],
    paymentSchedule: '60 days after month end',
    minPayout: '$10',
    cookieDuration: '24 hours',
    hasApi: true,
    status: 'available',
    apiDocsUrl: 'https://webservices.amazon.com/paapi5/documentation/',
    connectionRequirements: {
      authType: 'API Key',
      fields: [
        { key: 'access_key', label: 'PA-API Access Key', description: 'AWS-style access key', sensitive: true },
        { key: 'secret_key', label: 'PA-API Secret Key', description: 'AWS-style secret key', sensitive: true },
        { key: 'associate_tag', label: 'Associate Tag (Tracking ID)', description: 'e.g. yoursite-20' },
      ],
      prerequisites: [
        'Approved Amazon Associates account',
        'Minimum 3 qualified sales in first 180 days to maintain access',
        'PA-API access: must have made at least one sale in past 30 days',
      ],
      howToGet: [
        'Log in to affiliate-program.amazon.com',
        'Go to Tools → Product Advertising API',
        'Click "Join" to request PA-API access',
        'Generate Access Key and Secret in the PA-API console',
      ],
    },
  },
  {
    name: 'PartnerStack',
    logo: 'https://cdn.brandfetch.io/partnerstack.com/w/80/h/80/fallback/lettermark',
    type: 'SaaS Platform',
    merchants: '500+',
    avgCommission: '15-30%',
    categories: ['SaaS', 'Tech', 'B2B'],
    partnerBrands: ['Notion', 'Monday.com', 'Webflow', 'Brevo', 'Gorgias'],
    paymentSchedule: '13th monthly',
    minPayout: '$25',
    cookieDuration: '90 days',
    hasApi: true,
    status: 'available',
    apiDocsUrl: 'https://docs.partnerstack.com/',
    connectionRequirements: {
      authType: 'API Key',
      fields: [
        { key: 'public_key', label: 'Public Key', description: 'Your PartnerStack public key' },
        { key: 'secret_key', label: 'Secret Key', description: 'Your PartnerStack secret key', sensitive: true },
      ],
      prerequisites: [
        'Approved PartnerStack account',
        'API access requires contacting PartnerStack support (typically Enterprise tier)',
      ],
      howToGet: [
        'Log in to app.partnerstack.com',
        'Contact support to enable API access',
        'Navigate to Settings → API Keys to generate credentials',
      ],
    },
  },
  {
    name: 'LTK (RewardStyle)',
    logo: 'https://cdn.brandfetch.io/shopltk.com/w/80/h/80/fallback/lettermark',
    type: 'Creator Platform',
    merchants: '7,000+',
    avgCommission: '10-25%',
    categories: ['Fashion', 'Beauty', 'Home', 'Lifestyle'],
    partnerBrands: ['Nordstrom', 'Revolve', 'Abercrombie', 'Target', 'Zara', 'H&M'],
    paymentSchedule: 'Monthly',
    minPayout: '$100',
    cookieDuration: '30 days',
    hasApi: false,
    status: 'available',
    apiDocsUrl: 'https://company.shopltk.com/',
    connectionRequirements: {
      authType: 'Manual Link',
      fields: [
        { key: 'creator_handle', label: 'Creator Handle', description: 'Your LTK creator username (e.g. @yourhandle)' },
      ],
      prerequisites: [
        'Approved LTK creator account (invite-only / application required)',
        'Active social presence with established following',
        'No public API — links are generated manually through the LTK app',
      ],
      howToGet: [
        'Apply at shopltk.com/creator',
        'Once approved, generate product links via the LTK Creator app',
        'Links must be placed manually — integration is link-level only',
      ],
    },
  },
  {
    name: 'Skimlinks',
    logo: 'https://cdn.brandfetch.io/skimlinks.com/w/80/h/80/fallback/lettermark',
    type: 'Content Monetization',
    merchants: '48,500+',
    avgCommission: '5-15%',
    categories: ['Fashion', 'Travel', 'Tech', 'Finance'],
    partnerBrands: ['ASOS', 'John Lewis', 'Booking.com', 'Nike', 'Apple'],
    paymentSchedule: 'Quarterly (Net 90)',
    minPayout: '$65',
    cookieDuration: 'Varies',
    hasApi: true,
    status: 'available',
    apiDocsUrl: 'https://developers.skimlinks.com/',
    connectionRequirements: {
      authType: 'API Key',
      fields: [
        { key: 'publisher_id', label: 'Publisher ID', description: 'Your Skimlinks publisher ID' },
        { key: 'api_key', label: 'API Key', description: 'Product Search & Link APIs key', sensitive: true },
      ],
      prerequisites: [
        'Approved Skimlinks publisher account',
        'Site added and verified (JS snippet deployed)',
      ],
      howToGet: [
        'Log in to hub.skimlinks.com',
        'Go to Account → API Access',
        'Generate a new API key',
      ],
    },
  },
  {
    name: 'Pepperjam (Partnerize)',
    logo: 'https://cdn.brandfetch.io/partnerize.com/w/80/h/80/fallback/lettermark',
    type: 'Network',
    merchants: '1,600+',
    avgCommission: '8-20%',
    categories: ['Fashion', 'Retail', 'Travel', 'Finance'],
    partnerBrands: ['Puma', 'Fanatics', 'Bonobos', 'L\'Occitane', 'Timberland'],
    paymentSchedule: 'Monthly',
    minPayout: '$25',
    cookieDuration: '30 days',
    hasApi: true,
    status: 'available',
    apiDocsUrl: 'https://api.partnerize.com/docs/',
    connectionRequirements: {
      authType: 'API Key',
      fields: [
        { key: 'application_key', label: 'Application Key', description: 'Your Partnerize app key' },
        { key: 'user_api_key', label: 'User API Key', description: 'Your personal API key', sensitive: true },
      ],
      prerequisites: [
        'Approved Partnerize publisher account',
        'Enterprise-level API access may require account manager contact',
      ],
      howToGet: [
        'Log in to console.partnerize.com',
        'Navigate to User Settings → API Keys',
        'Generate Application Key and User API Key',
      ],
    },
  },
  {
    name: 'FlexOffers',
    logo: 'https://cdn.brandfetch.io/flexoffers.com/w/80/h/80/fallback/lettermark',
    type: 'Sub-network',
    merchants: '10,000+',
    avgCommission: '5-15%',
    categories: ['Retail', 'Finance', 'Health', 'Travel'],
    partnerBrands: ['Walmart', 'Kohl\'s', 'Macy\'s', 'Samsung', 'T-Mobile'],
    paymentSchedule: 'Net 60',
    minPayout: '$50',
    cookieDuration: '30 days',
    hasApi: true,
    status: 'available',
    apiDocsUrl: 'https://www.flexoffers.com/affiliate-resources/affiliate-api-documentation/',
    connectionRequirements: {
      authType: 'API Key',
      fields: [
        { key: 'api_key', label: 'API Key', description: 'FlexOffers publisher API key', sensitive: true },
        { key: 'publisher_id', label: 'Publisher ID', description: 'Your FlexOffers publisher ID' },
      ],
      prerequisites: [
        'Approved FlexOffers publisher account',
        'API access enabled (contact account manager if not auto-enabled)',
      ],
      howToGet: [
        'Log in to publisher.flexoffers.com',
        'Go to Account Settings → API Access',
        'Request API access if not already active, then copy your key',
      ],
    },
  },
  {
    name: 'Refersion',
    logo: 'https://cdn.brandfetch.io/refersion.com/w/80/h/80/fallback/lettermark',
    type: 'SaaS Platform',
    merchants: '60,000+',
    avgCommission: '10-20%',
    categories: ['DTC', 'Ecommerce', 'Fashion', 'Beauty'],
    partnerBrands: ['Verb Energy', 'Magic Spoon', 'Pura Vida', 'Mented Cosmetics'],
    paymentSchedule: 'Monthly',
    minPayout: '$0 (PayPal)',
    cookieDuration: 'Custom',
    hasApi: true,
    status: 'available',
    apiDocsUrl: 'https://developers.refersion.com/',
    connectionRequirements: {
      authType: 'Bearer Token',
      fields: [
        { key: 'account_id', label: 'Account ID', description: 'Your Refersion account ID' },
        { key: 'access_token', label: 'Access Token', description: 'Personal access token', sensitive: true },
      ],
      prerequisites: [
        'Active Refersion account (merchant or affiliate)',
        'API v2 access (Professional plan or above)',
      ],
      howToGet: [
        'Log in to app.refersion.com',
        'Go to Settings → API',
        'Generate a new Access Token',
      ],
    },
  },
];

type ViewMode = 'table' | 'grid';

const TYPE_COLORS: Record<NetworkType, { bg: string; color: string }> = {
  'Network': { bg: '#dbeafe', color: '#1d4ed8' },
  'Retailer': { bg: '#fef3c7', color: '#b45309' },
  'SaaS Platform': { bg: '#e0e7ff', color: '#4338ca' },
  'Creator Platform': { bg: '#fce7f3', color: '#be185d' },
  'Sub-network': { bg: '#ecfccb', color: '#4d7c0f' },
  'Content Monetization': { bg: '#cffafe', color: '#0e7490' },
};

function TypeBadge({ type }: { type: NetworkType }) {
  const c = TYPE_COLORS[type];
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 4,
      fontSize: 11, fontWeight: 600, background: c.bg, color: c.color, whiteSpace: 'nowrap',
    }}>
      {type}
    </span>
  );
}

export default function AdminAffiliate() {
  const [view, setView] = useState<ViewMode>('table');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState<NetworkType | 'all'>('all');
  const [connectTarget, setConnectTarget] = useState<AffiliateNetwork | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});

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
    if (typeFilter !== 'all') {
      list = list.filter(n => n.type === typeFilter);
    }
    return list;
  }, [search, categoryFilter, typeFilter]);

  const openConnect = (n: AffiliateNetwork) => {
    setConnectTarget(n);
    setFormValues({});
  };

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
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value as NetworkType | 'all')}
          style={{
            padding: '8px 12px', borderRadius: 8, border: '1px solid #e0e0e0',
            fontSize: 13, background: '#fff',
          }}
        >
          <option value="all">All Types</option>
          {Object.keys(TYPE_COLORS).map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
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
                <th>Type</th>
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
                  <td><TypeBadge type={n.type} /></td>
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
                        onClick={() => openConnect(n)}
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
                    <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>{n.merchants} merchants</div>
                    <div style={{ marginTop: 6 }}><TypeBadge type={n.type} /></div>
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
                  onClick={() => openConnect(n)}
                >
                  Connect
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Connect Modal */}
      {connectTarget && (
        <div className="admin-modal-overlay" onClick={() => setConnectTarget(null)}>
          <div
            className="admin-modal"
            style={{ width: 560, maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <img
                  src={connectTarget.logo}
                  alt={connectTarget.name}
                  style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover' }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
                <div>
                  <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Connect {connectTarget.name}</h2>
                  <div style={{ marginTop: 4 }}><TypeBadge type={connectTarget.type} /></div>
                </div>
              </div>
              <button
                className="admin-modal-close"
                onClick={() => setConnectTarget(null)}
                style={{ fontSize: 22 }}
              >
                ×
              </button>
            </div>

            <div style={{ padding: '20px 24px', overflow: 'auto', flex: 1 }}>
              {connectTarget.connectionRequirements ? (
                <>
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                      Auth Method
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{connectTarget.connectionRequirements.authType}</div>
                  </div>

                  <div style={{ marginBottom: 20 }}>
                    <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Prerequisites</h3>
                    <ul style={{ paddingLeft: 20, margin: 0, fontSize: 13, lineHeight: 1.7, color: '#555' }}>
                      {connectTarget.connectionRequirements.prerequisites.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </div>

                  <div style={{ marginBottom: 20 }}>
                    <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>How to get credentials</h3>
                    <ol style={{ paddingLeft: 20, margin: 0, fontSize: 13, lineHeight: 1.7, color: '#555' }}>
                      {connectTarget.connectionRequirements.howToGet.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>
                    {connectTarget.apiDocsUrl && (
                      <a
                        href={connectTarget.apiDocsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: 12, color: '#3b82f6', textDecoration: 'none', display: 'inline-block', marginTop: 8 }}
                      >
                        View API docs →
                      </a>
                    )}
                  </div>

                  <div>
                    <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Required fields</h3>
                    {connectTarget.connectionRequirements.fields.map(f => (
                      <div key={f.key} style={{ marginBottom: 14 }}>
                        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                          {f.label}
                          {f.sensitive && <span style={{ marginLeft: 6, fontSize: 10, color: '#dc2626', fontWeight: 500 }}>● sensitive</span>}
                        </label>
                        <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>{f.description}</div>
                        <input
                          type={f.sensitive ? 'password' : 'text'}
                          value={formValues[f.key] || ''}
                          onChange={e => setFormValues(prev => ({ ...prev, [f.key]: e.target.value }))}
                          placeholder={f.label}
                          style={{
                            width: '100%', padding: '8px 12px', borderRadius: 6,
                            border: '1px solid #ddd', fontSize: 13,
                            boxSizing: 'border-box',
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div style={{ padding: 20, textAlign: 'center', color: '#888' }}>
                  Connection instructions coming soon for {connectTarget.name}.
                </div>
              )}
            </div>

            <div style={{
              padding: '16px 24px', borderTop: '1px solid #eee',
              display: 'flex', justifyContent: 'flex-end', gap: 8,
            }}>
              <button
                className="admin-btn admin-btn-secondary"
                onClick={() => setConnectTarget(null)}
              >
                Cancel
              </button>
              <button
                className="admin-btn admin-btn-primary"
                disabled={!connectTarget.connectionRequirements || connectTarget.connectionRequirements.fields.some(f => !formValues[f.key])}
                onClick={() => {
                  console.log('[affiliate] Connect submitted:', connectTarget.name, formValues);
                  setConnectTarget(null);
                }}
              >
                Connect {connectTarget.name}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

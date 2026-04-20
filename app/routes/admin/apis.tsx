import { useMemo, useState } from 'react';

// Status of each external API the platform talks to. Claude can't read
// Supabase secrets from the browser, so this registry is hand-maintained —
// when a new provider is wired up add an entry here so the admin can see
// where the key lives, what it powers, and how to manage it.

type ConnectionStatus = 'connected' | 'not-configured' | 'partial';
type Scope = 'edge-function' | 'worker' | 'client';

interface ApiProvider {
  id: string;
  name: string;
  category: 'ai' | 'data' | 'infra' | 'payments' | 'affiliate';
  scope: Scope;
  secretKey: string;
  envName: string;
  status: ConnectionStatus;
  purpose: string;
  usedBy: string[];
  dashboard: string;
  docs?: string;
  notes?: string;
}

// Update status flags when you set/unset a Supabase secret or a worker env.
const PROVIDERS: ApiProvider[] = [
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    category: 'ai',
    scope: 'edge-function',
    secretKey: 'ANTHROPIC_API_KEY',
    envName: 'Supabase Edge Function secret',
    status: 'connected',
    purpose: 'Catalog brainstorm, product copywriting, moderation assist',
    usedBy: ['catalog-brainstorm (edge)', 'catalog-auto-tag (edge, when deployed)'],
    dashboard: 'https://console.anthropic.com/settings/keys',
    docs: 'https://docs.anthropic.com/',
  },
  {
    id: 'serpapi',
    name: 'SerpAPI',
    category: 'data',
    scope: 'edge-function',
    secretKey: 'SERPAPI_KEY',
    envName: 'Supabase Edge Function secret',
    status: 'connected',
    purpose: 'Live Google Shopping product search',
    usedBy: ['product-search (edge)', 'Suggest Products modal'],
    dashboard: 'https://serpapi.com/manage-api-key',
    docs: 'https://serpapi.com/google-shopping-api',
  },
  {
    id: 'google-genai',
    name: 'Google Generative AI (Veo)',
    category: 'ai',
    scope: 'worker',
    secretKey: 'GOOGLE_API_KEY',
    envName: 'Modal worker env',
    status: 'partial',
    purpose: 'Veo 3.1 video generation (direct, billed via Google Cloud)',
    usedBy: ['agents/video-generator'],
    dashboard: 'https://aistudio.google.com/apikey',
    notes: 'Check Modal secrets for the video-generator app before disabling.',
  },
  {
    id: 'fal',
    name: 'fal.ai',
    category: 'ai',
    scope: 'worker',
    secretKey: 'FAL_KEY',
    envName: 'Modal worker env',
    status: 'partial',
    purpose: 'Seedance, Kling, Sora, PixVerse, Hailuo, Wan, LTX, Vidu (multi-image) video models',
    usedBy: ['agents/video-generator'],
    dashboard: 'https://fal.ai/dashboard/keys',
  },
  {
    id: 'vidu',
    name: 'Vidu (direct)',
    category: 'ai',
    scope: 'worker',
    secretKey: 'VIDU_API_KEY',
    envName: 'Modal worker env (optional — currently routed via fal.ai)',
    status: 'not-configured',
    purpose: 'Direct Vidu API for multi-image reference-to-video (lower margin than via fal)',
    usedBy: [],
    dashboard: 'https://platform.vidu.io/',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    category: 'ai',
    scope: 'edge-function',
    secretKey: 'OPENAI_API_KEY',
    envName: 'Supabase Edge Function secret',
    status: 'not-configured',
    purpose: 'Backup copywriter / embeddings (not wired)',
    usedBy: [],
    dashboard: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'stripe',
    name: 'Stripe',
    category: 'payments',
    scope: 'edge-function',
    secretKey: 'STRIPE_SECRET_KEY',
    envName: 'Supabase Edge Function secret',
    status: 'not-configured',
    purpose: 'Payouts + subscription billing (when brands portal lands)',
    usedBy: [],
    dashboard: 'https://dashboard.stripe.com/apikeys',
  },
  {
    id: 'cloudinary',
    name: 'Cloudinary',
    category: 'infra',
    scope: 'worker',
    secretKey: 'CLOUDINARY_URL',
    envName: 'Modal worker env',
    status: 'not-configured',
    purpose: 'Image CDN + transforms',
    usedBy: [],
    dashboard: 'https://cloudinary.com/console',
  },
  {
    id: 'supabase',
    name: 'Supabase',
    category: 'infra',
    scope: 'client',
    secretKey: 'SUPABASE_ANON_KEY',
    envName: 'app/utils/supabase.ts',
    status: 'connected',
    purpose: 'Primary DB, auth, edge functions, storage',
    usedBy: ['everything'],
    dashboard: 'https://supabase.com/dashboard/project/vtarjrnqvcqbhoclvcur',
  },
  {
    id: 'flexoffers',
    name: 'FlexOffers',
    category: 'affiliate',
    scope: 'client',
    secretKey: 'n/a',
    envName: 'Link builder (no server secret yet)',
    status: 'partial',
    purpose: 'Affiliate network payout rates surfaced in the product links drawer',
    usedBy: ['app/routes/admin/content.tsx'],
    dashboard: 'https://publisher.flexoffers.com/',
  },
  {
    id: 'impact',
    name: 'Impact',
    category: 'affiliate',
    scope: 'client',
    secretKey: 'n/a',
    envName: 'Link builder',
    status: 'partial',
    purpose: 'Affiliate network payout rates',
    usedBy: ['app/routes/admin/content.tsx'],
    dashboard: 'https://app.impact.com/',
  },
  {
    id: 'rakuten',
    name: 'Rakuten Advertising',
    category: 'affiliate',
    scope: 'client',
    secretKey: 'n/a',
    envName: 'Link builder',
    status: 'partial',
    purpose: 'Affiliate network payout rates',
    usedBy: ['app/routes/admin/content.tsx'],
    dashboard: 'https://rakutenadvertising.com/',
  },
];

const CATEGORIES: { value: 'all' | ApiProvider['category']; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'ai', label: 'AI / Video' },
  { value: 'data', label: 'Data' },
  { value: 'infra', label: 'Infra' },
  { value: 'payments', label: 'Payments' },
  { value: 'affiliate', label: 'Affiliate' },
];

const STATUS_STYLES: Record<ConnectionStatus, { bg: string; color: string; label: string }> = {
  'connected': { bg: '#dcfce7', color: '#166534', label: 'Connected' },
  'not-configured': { bg: '#fee2e2', color: '#991b1b', label: 'Not configured' },
  'partial': { bg: '#fef3c7', color: '#92400e', label: 'Partial' },
};

export default function AdminApis() {
  const [filter, setFilter] = useState<'all' | ApiProvider['category']>('all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    let list = PROVIDERS;
    if (filter !== 'all') list = list.filter(p => p.category === filter);
    if (query) {
      const q = query.toLowerCase();
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.purpose.toLowerCase().includes(q) ||
        p.usedBy.some(u => u.toLowerCase().includes(q))
      );
    }
    return list;
  }, [filter, query]);

  const counts = useMemo(() => ({
    connected: PROVIDERS.filter(p => p.status === 'connected').length,
    partial: PROVIDERS.filter(p => p.status === 'partial').length,
    notConfigured: PROVIDERS.filter(p => p.status === 'not-configured').length,
  }), []);

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1>APIs</h1>
          <p className="admin-page-subtitle">
            External services the platform talks to. Manage secrets in the relevant dashboard.
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
        <StatCard title="Connected" value={counts.connected} color="#16a34a" />
        <StatCard title="Partial" value={counts.partial} color="#d97706" />
        <StatCard title="Not configured" value={counts.notConfigured} color="#dc2626" />
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {CATEGORIES.map(c => (
            <button
              key={c.value}
              onClick={() => setFilter(c.value)}
              className={`admin-tab ${filter === c.value ? 'active' : ''}`}
              style={{ fontSize: 12 }}
            >
              {c.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Filter by name, purpose, or consumer…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          style={{
            flex: 1, minWidth: 240, padding: '8px 12px', borderRadius: 6,
            border: '1px solid #ddd', fontSize: 13,
          }}
        />
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Provider</th>
              <th style={{ textAlign: 'left' }}>Status</th>
              <th style={{ textAlign: 'left' }}>Category</th>
              <th style={{ textAlign: 'left' }}>Secret / Env</th>
              <th style={{ textAlign: 'left' }}>Purpose</th>
              <th style={{ textAlign: 'left' }}>Used by</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => {
              const badge = STATUS_STYLES[p.status];
              return (
                <tr key={p.id}>
                  <td style={{ textAlign: 'left', fontWeight: 600 }}>{p.name}</td>
                  <td style={{ textAlign: 'left' }}>
                    <span style={{
                      padding: '3px 8px', borderRadius: 999,
                      background: badge.bg, color: badge.color,
                      fontSize: 11, fontWeight: 600,
                    }}>
                      {badge.label}
                    </span>
                  </td>
                  <td style={{ textAlign: 'left', textTransform: 'capitalize', fontSize: 12, color: '#64748b' }}>{p.category}</td>
                  <td style={{ textAlign: 'left', fontSize: 12 }}>
                    <div style={{ fontFamily: 'ui-monospace, monospace', color: '#0f172a' }}>{p.secretKey}</div>
                    <div style={{ fontSize: 10, color: '#94a3b8' }}>{p.envName}</div>
                  </td>
                  <td style={{ textAlign: 'left', fontSize: 12, color: '#475569' }}>{p.purpose}</td>
                  <td style={{ textAlign: 'left', fontSize: 11, color: '#64748b' }}>
                    {p.usedBy.length === 0 ? (
                      <em style={{ color: '#94a3b8' }}>—</em>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {p.usedBy.map(u => <span key={u}>{u}</span>)}
                      </div>
                    )}
                  </td>
                  <td>
                    <a
                      href={p.dashboard}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="admin-btn admin-btn-secondary"
                      style={{ fontSize: 11, padding: '4px 10px', textDecoration: 'none' }}
                    >
                      Dashboard ↗
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 24, padding: 14, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, color: '#475569' }}>
        <strong>Adding a provider:</strong> drop an entry into <code>PROVIDERS</code> in
        <code> app/routes/admin/apis.tsx</code>, set the matching secret in
        Supabase (<a href="https://supabase.com/dashboard/project/vtarjrnqvcqbhoclvcur/functions/secrets" target="_blank" rel="noopener noreferrer">Functions → Secrets</a>)
        or the Modal worker env, and deploy the consuming edge function.
      </div>
    </div>
  );
}

function StatCard({ title, value, color }: { title: string; value: number; color: string }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
      padding: 16, display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>
        {title}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

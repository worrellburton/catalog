import { useEffect, useMemo, useState } from 'react';
import {
  Outlet, NavLink, useNavigate, useLocation,
  useRouteError, isRouteErrorResponse,
} from '@remix-run/react';
import CatalogLogo from '~/components/CatalogLogo';
import { useAuth } from '~/hooks/useAuth';
import { useBrandMembership, type PartnersContext } from '~/hooks/useBrandMembership';

// The brand portal reuses the admin shell's stylesheet for layout chrome
// (sidebar / main / nav). It's visually distinct via the `partners-layout`
// modifier + a "Brand" badge; a dedicated partners.css can theme it later
// without touching this structure.
// ponytail: reuse admin.css rather than author a second 2.8k-line stylesheet.
import '~/styles/admin.css';

interface NavItem { to: string; label: string; icon: string; end?: boolean }

const navItems: NavItem[] = [
  { to: '/partners', label: 'Dashboard', icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', end: true },
  { to: '/partners/products', label: 'Products', icon: 'M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01' },
  { to: '/partners/creatives', label: 'Creatives', icon: 'M23 7l-7 5 7 5V7zM14 5H3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z' },
  { to: '/partners/store', label: 'Store', icon: 'M3 9l1-5h16l1 5M4 9v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9M3 9h18' },
  { to: '/partners/team', label: 'Team', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8' },
  { to: '/partners/settings', label: 'Settings', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' },
];

function GateScreen({ title, body, cta }: { title: string; body: string; cta?: { label: string; to: string } }) {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24,
      background: '#0b0b0c', color: '#e7e7ea', textAlign: 'center',
      fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
      <div style={{ fontSize: 13, opacity: 0.7, maxWidth: 420 }}>{body}</div>
      {cta && (
        <a href={cta.to} style={{ marginTop: 4, padding: '8px 16px', borderRadius: 8, background: '#e7e7ea', color: '#0b0b0c', fontWeight: 600, fontSize: 13, textDecoration: 'none' }}>
          {cta.label}
        </a>
      )}
    </div>
  );
}

export default function PartnersLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading: authLoading } = useAuth();
  const { loading: memLoading, isPlatformAdmin, memberships } = useBrandMembership();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeBrandId, setActiveBrandId] = useState<string | null>(null);

  // Bounce a signed-out visitor to the consumer app (where the auth gate lives).
  useEffect(() => {
    if (!authLoading && !user) navigate('/', { replace: true });
  }, [authLoading, user, navigate]);

  // Default the active brand to the first membership once resolved.
  useEffect(() => {
    if (!activeBrandId && memberships.length > 0) setActiveBrandId(memberships[0].brandId);
  }, [memberships, activeBrandId]);

  const active = useMemo(
    () => memberships.find(m => m.brandId === activeBrandId) ?? memberships[0] ?? null,
    [memberships, activeBrandId],
  );

  if (authLoading || memLoading) return null;
  if (!user) return null;

  if (!active) {
    return isPlatformAdmin
      ? <GateScreen
          title="No brand to manage"
          body="You're a platform admin. The brand portal is scoped to brand members — add yourself to a brand (brand_members) or provision one from the admin panel to preview it."
          cta={{ label: 'Open admin', to: '/admin/brands' }} />
      : <GateScreen
          title="No brand access"
          body="Your account isn't a member of any brand yet. Ask your brand owner to invite you, or contact the Catalog team."
          cta={{ label: 'Back to catalog', to: '/' }} />;
  }

  const ctx: PartnersContext = { brand: active.brand, role: active.role, isPlatformAdmin, memberships };

  return (
    <div className={`admin-layout admin-light partners-layout ${sidebarOpen ? 'admin-sidebar-open' : ''}`}>
      <div className="admin-sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      <aside className="admin-sidebar">
        <div className="admin-sidebar-header">
          <a href="/" className="admin-logo-link" aria-label="Back to catalog.shop" title="Back to catalog.shop"
             style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none', color: 'inherit' }}>
            <CatalogLogo className="admin-logo" />
            <span className="admin-logo-mark" aria-hidden="true">C</span>
          </a>
          <span className="admin-badge">Brand</span>
        </div>

        {/* Brand identity + switcher (only when the user belongs to >1 brand). */}
        <div style={{ padding: '10px 14px' }}>
          {memberships.length > 1 ? (
            <select
              value={active.brandId}
              onChange={(e) => setActiveBrandId(e.target.value)}
              aria-label="Switch brand"
              style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #e2e2e6', background: '#fff', fontSize: 13, fontWeight: 600 }}
            >
              {memberships.map(m => <option key={m.brandId} value={m.brandId}>{m.brand.name}</option>)}
            </select>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {active.brand.logo_url
                ? <img src={active.brand.logo_url} alt="" style={{ width: 24, height: 24, borderRadius: 6, objectFit: 'cover' }} />
                : <span style={{ width: 24, height: 24, borderRadius: 6, background: '#e7e7ea', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{active.brand.name.slice(0, 2).toUpperCase()}</span>}
              <span style={{ fontSize: 14, fontWeight: 700 }}>{active.brand.name}</span>
            </div>
          )}
          <div style={{ marginTop: 6, fontSize: 11, opacity: 0.6, textTransform: 'capitalize' }}>{active.role}</div>
        </div>

        <nav className="admin-nav">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              prefetch="intent"
              className={({ isActive }) => `admin-nav-item ${isActive ? 'active' : ''}`}
              onClick={() => setSidebarOpen(false)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d={item.icon} />
              </svg>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="admin-sidebar-footer">
          <button className="admin-user-trigger" onClick={() => navigate('/')} title="Back to catalog">
            {user.avatarUrl
              ? <img src={user.avatarUrl} alt="" className="admin-user-avatar-img-sm" />
              : <span className="admin-user-avatar-sm">{(user.displayName || 'U').slice(0, 2).toUpperCase()}</span>}
            <span className="admin-user-name">{user.displayName || user.email || 'User'}</span>
          </button>
        </div>
      </aside>

      <main className="admin-main">
        <div className="admin-topbar">
          <button className="admin-sidebar-toggle" onClick={() => setSidebarOpen(o => !o)} aria-label="Toggle menu">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <div style={{ fontSize: 13, fontWeight: 600, opacity: 0.7 }}>
            {navItems.find(n => n.end ? location.pathname === n.to : location.pathname.startsWith(n.to))?.label ?? 'Brand portal'}
          </div>
        </div>
        <Outlet context={ctx} />
      </main>
    </div>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error ? error.message : 'An unexpected error occurred.';
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24,
      background: '#0b0b0c', color: '#e7e7ea', textAlign: 'center', fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>Something went wrong in the brand portal</div>
      <div style={{ fontSize: 13, opacity: 0.7, maxWidth: 480, wordBreak: 'break-word' }}>{detail}</div>
      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <button onClick={() => window.location.reload()}
          style={{ padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', background: '#e7e7ea', color: '#0b0b0c', fontWeight: 600, fontSize: 13 }}>Reload</button>
        <a href="/partners" style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #333', color: '#e7e7ea', textDecoration: 'none', fontWeight: 600, fontSize: 13 }}>Back to dashboard</a>
      </div>
    </div>
  );
}

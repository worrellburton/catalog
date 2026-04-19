import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Outlet, NavLink, useNavigate } from '@remix-run/react';
import CatalogLogo from '~/components/CatalogLogo';
import { useAuth } from '~/hooks/useAuth';
import { supabase } from '~/utils/supabase';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  badge?: string;
}

const navItems: NavItem[] = [
  { to: '/admin', label: 'Home', icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' },
  { to: '/admin/users', label: 'Users', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8' },
  { to: '/admin/content', label: 'Content', icon: 'M15 10l4.553-2.276A1 1 0 0 1 21 8.618v6.764a1 1 0 0 1-1.447.894L15 14M3 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z' },
  { to: '/admin/catalogs', label: 'Catalogs', icon: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z' },
  { to: '/admin/search', label: 'Search', icon: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35' },
  { to: '/admin/advertisements', label: 'Partnerships', icon: 'M2 7v10M6 5v14M11 4l9 4v12l-9-4z' },
  { to: '/admin/links', label: 'Sign Up Links', icon: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' },
  { to: '/admin/affiliate', label: 'Affiliate', icon: 'M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6zM2 9h4v12H2zM4 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4z' },
  { to: '/admin/earnings', label: 'Earnings', icon: 'M12 1v22M17 5H9.5a3.5 3.5 0 1 0 0 7h5a3.5 3.5 0 1 1 0 7H6' },
  { to: '/admin/finance', label: 'Finance', icon: 'M3 3v18h18M7 14l4-4 4 4 6-6' },
  { to: '/admin/activities', label: 'Engagement', icon: 'M22 12h-4l-3 9L9 3l-3 9H2' },
  { to: '/admin/creative', label: 'Creative', icon: 'M12 19l7-7 3 3-7 7-3-3zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5zM2 2l7.586 7.586M11 11a2 2 0 1 1-4 0 2 2 0 0 1 4 0z' },
  { to: '/admin/agents', label: 'Agents', icon: 'M12 2a3 3 0 0 0-3 3v1a3 3 0 0 0 3 3 3 3 0 0 0 3-3V5a3 3 0 0 0-3-3zM4 22v-1a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v1M9 12h6' },
];

interface SearchItem {
  label: string;
  type: string;
  to: string;
}

const allSearchItems: SearchItem[] = [
  // Pages
  { label: 'Users', type: 'Page', to: '/admin/users' },
  { label: 'Content', type: 'Page', to: '/admin/content' },
  { label: 'Catalogs', type: 'Page', to: '/admin/catalogs' },
  { label: 'Search', type: 'Page', to: '/admin/search' },
  { label: 'Advertisements', type: 'Page', to: '/admin/advertisements' },
  { label: 'Earnings', type: 'Page', to: '/admin/earnings' },
  { label: 'Finance', type: 'Page', to: '/admin/finance' },
  { label: 'Creative', type: 'Page', to: '/admin/creative' },
  { label: 'Activities', type: 'Page', to: '/admin/activities' },
  { label: 'AI Models', type: 'Page', to: '/admin/ai-models' },
  { label: 'Video Generation', type: 'Page', to: '/admin/agents?tab=video-gen&sub=look-videos' },
  { label: 'Product Ads', type: 'Page', to: '/admin/agents?tab=video-gen&sub=product-ads' },
  { label: 'Reports', type: 'Page', to: '/admin/reports' },
  { label: 'Moderation', type: 'Page', to: '/admin/moderation' },
  { label: 'Administrators', type: 'Page', to: '/admin/administrators' },
  { label: 'Agents', type: 'Page', to: '/admin/agents' },
  { label: 'Crawls', type: 'Page', to: '/admin/agents?tab=crawls' },
  { label: 'Full Site Crawls', type: 'Page', to: '/admin/agents?tab=crawls&sub=full-site' },
  { label: 'Collection Crawls', type: 'Page', to: '/admin/agents?tab=crawls&sub=collections' },
  { label: 'Product Scrapes', type: 'Page', to: '/admin/agents?tab=crawls&sub=products' },
  // Shoppers
  { label: 'Carla', type: 'Shopper', to: '/admin/shoppers/Carla' },
  { label: 'alfvaz', type: 'Shopper', to: '/admin/shoppers/alfvaz' },
  { label: 'franky90', type: 'Shopper', to: '/admin/shoppers/franky90' },
  { label: 'D1.barbershop', type: 'Shopper', to: '/admin/shoppers/D1.barbershop' },
  // Creators
  { label: 'applee', type: 'Creator', to: '/admin/creators/applee' },
  { label: 'PrettyHome', type: 'Creator', to: '/admin/creators/PrettyHome' },
  { label: 'testapple', type: 'Creator', to: '/admin/creators/testapple' },
  { label: 'apple', type: 'Creator', to: '/admin/creators/apple' },
];

interface GenNotification {
  id: string;
  productName: string;
  productBrand: string;
  status: 'queued' | 'pending' | 'generating' | 'done' | 'failed';
  createdAt: string;
  completedAt: string | null;
}

const ESTIMATED_GEN_SECONDS = 150;

function GenProgressBar({ n }: { n: GenNotification }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (n.status !== 'generating' && n.status !== 'pending') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [n.status]);

  if (n.status === 'done') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#22c55e' }}>Complete</span>
      </div>
    );
  }
  if (n.status === 'failed') {
    return <span style={{ fontSize: 11, fontWeight: 600, color: '#ef4444' }}>Failed</span>;
  }
  if (n.status === 'queued') {
    return (
      <div style={{ height: 4, borderRadius: 4, background: '#e2e8f0', overflow: 'hidden' }}>
        <div style={{ width: '0%', height: '100%', background: '#94a3b8' }} />
      </div>
    );
  }

  const elapsed = (now - new Date(n.createdAt).getTime()) / 1000;
  const pct = n.status === 'pending'
    ? Math.min(15, (elapsed / 30) * 15)
    : Math.min(95, (elapsed / ESTIMATED_GEN_SECONDS) * 100);
  const remaining = Math.max(0, ESTIMATED_GEN_SECONDS - elapsed);
  const mins = Math.floor(remaining / 60);
  const secs = Math.floor(remaining % 60);
  const timeLabel = n.status === 'pending' ? 'Starting…' : remaining > 0 ? `~${mins}:${String(secs).padStart(2, '0')}` : 'Finishing…';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: n.status === 'pending' ? '#f59e0b' : '#3b82f6', textTransform: 'uppercase' }}>
          {n.status === 'pending' ? 'Pending' : 'Generating'}
        </span>
        <span style={{ fontSize: 10, color: '#888' }}>{timeLabel}</span>
      </div>
      <div style={{ position: 'relative', height: 4, borderRadius: 4, background: '#e2e8f0', overflow: 'hidden' }}>
        <div style={{
          position: 'absolute', inset: 0, width: `${pct}%`,
          background: n.status === 'pending' ? '#f59e0b' : 'linear-gradient(90deg, #3b82f6, #8b5cf6)',
          transition: 'width 1s ease',
        }} />
        {n.status === 'generating' && (
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)',
            animation: 'admin-shimmer 1.4s infinite',
          }} />
        )}
      </div>
    </div>
  );
}

export default function AdminLayout() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [isDark, setIsDark] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Generation notifications
  const [genNotifications, setGenNotifications] = useState<GenNotification[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const prevIdsRef = useRef<Set<string>>(new Set());

  const pollGenerations = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase
      .from('product_ads')
      .select('id, status, created_at, completed_at, product:products(name, brand)')
      .in('status', ['queued', 'pending', 'generating'])
      .order('created_at', { ascending: true });

    if (!data) return;

    const active: GenNotification[] = data.map((r: any) => ({
      id: r.id,
      productName: r.product?.name || 'Unknown',
      productBrand: r.product?.brand || '',
      status: r.status,
      createdAt: r.created_at,
      completedAt: r.completed_at,
    }));

    const currentIds = new Set(active.map(n => n.id));
    const prevIds = prevIdsRef.current;

    // Detect completions: IDs that were in prev but not in current
    const completed: GenNotification[] = [];
    prevIds.forEach(id => {
      if (!currentIds.has(id)) {
        const prev = genNotifications.find(n => n.id === id);
        if (prev && (prev.status === 'generating' || prev.status === 'pending')) {
          completed.push({ ...prev, status: 'done', completedAt: new Date().toISOString() });
        }
      }
    });

    prevIdsRef.current = currentIds;

    if (completed.length > 0) {
      setGenNotifications([...active, ...completed]);
      // Auto-dismiss completed after 5 seconds
      setTimeout(() => {
        setGenNotifications(prev => prev.filter(n => n.status !== 'done'));
      }, 5000);
    } else {
      setGenNotifications(prev => {
        // Keep any 'done' items still showing (they'll be removed by their own timeout)
        const doneItems = prev.filter(n => n.status === 'done');
        return [...active, ...doneItems];
      });
    }
  }, [genNotifications]);

  useEffect(() => {
    pollGenerations();
    const interval = setInterval(pollGenerations, 5000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!notifOpen) return;
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [notifOpen]);

  const generatingCount = genNotifications.filter(n => n.status === 'generating' || n.status === 'pending').length;
  const queuedCount = genNotifications.filter(n => n.status === 'queued').length;
  const completedCount = genNotifications.filter(n => n.status === 'done').length;
  const totalActiveCount = genNotifications.length;

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return allSearchItems.filter(item =>
      item.label.toLowerCase().includes(q) || item.type.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [searchQuery]);

  useEffect(() => {
    if (!loading && !user) {
      navigate('/', { replace: true });
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    if (!searchOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [searchOpen]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
      if (e.key === 'Escape') setSearchOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);

  useEffect(() => {
    if (!userMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [userMenuOpen]);

  if (loading || !user) {
    return null;
  }

  return (
    <div className={`admin-layout ${isDark ? 'admin-dark' : 'admin-light'}`}>
      <aside className="admin-sidebar">
        <div className="admin-sidebar-header">
          <CatalogLogo className="admin-logo" />
          <span className="admin-badge">Admin</span>
        </div>
        <nav className="admin-nav">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/admin'}
              className={({ isActive }) => `admin-nav-item ${isActive ? 'active' : ''}`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d={item.icon} />
              </svg>
              <span>{item.label}</span>
              {item.badge && (
                <span className={`admin-nav-badge ${item.badge === '0' ? 'badge-zero' : ''}`}>
                  {item.badge}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="admin-sidebar-footer" ref={userMenuRef}>
          {userMenuOpen && (
            <div className="admin-user-popup">
              <button className="admin-user-popup-item" onClick={() => { setIsDark(d => !d); setUserMenuOpen(false); }}>
                {isDark ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                )}
                <span>{isDark ? 'Light mode' : 'Dark mode'}</span>
              </button>
              <button className="admin-user-popup-item" onClick={() => { navigate('/admin/settings'); setUserMenuOpen(false); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                <span>Settings</span>
              </button>
              <button className="admin-user-popup-item" onClick={() => { navigate('/admin/appearance'); setUserMenuOpen(false); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>
                <span>Appearance</span>
              </button>
              <div className="admin-user-popup-divider" />
              <button className="admin-user-popup-item" onClick={() => { navigate('/admin/reports'); setUserMenuOpen(false); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
                <span>Reports</span>
              </button>
              <button className="admin-user-popup-item" onClick={() => { navigate('/admin/moderation'); setUserMenuOpen(false); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                <span>Moderation</span>
              </button>
              <button className="admin-user-popup-item" onClick={() => { navigate('/admin/administrators'); setUserMenuOpen(false); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15v2m-6 4h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2zm10-10V7a4 4 0 0 0-8 0v4h8z"/></svg>
                <span>Administrators</span>
              </button>
              <div className="admin-user-popup-divider" />
              <button className="admin-user-popup-item" onClick={() => { navigate('/'); setUserMenuOpen(false); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
                <span>Back to catalog</span>
              </button>
              <button className="admin-user-popup-item admin-user-popup-logout" onClick={async () => { const { signOut } = await import('~/services/auth'); await signOut(); navigate('/', { replace: true }); setUserMenuOpen(false); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                <span>Log out</span>
              </button>
            </div>
          )}
          <button className="admin-user-trigger" onClick={() => setUserMenuOpen(o => !o)}>
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="admin-user-avatar-img-sm" />
            ) : (
              <span className="admin-user-avatar-sm">{(user.displayName || 'U').slice(0, 2).toUpperCase()}</span>
            )}
            <span className="admin-user-name">{user.displayName || user.email || 'User'}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
          </button>
        </div>
      </aside>
      <main className="admin-main">
        <div className="admin-topbar" ref={searchRef}>
          <div className="admin-search-wrap">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              ref={searchInputRef}
              className="admin-search-input"
              type="text"
              placeholder="Search pages, shoppers, creators..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); }}
              onFocus={() => setSearchOpen(true)}
            />
            <span className="admin-search-shortcut">&#8984;K</span>
          </div>
          {searchOpen && searchResults.length > 0 && (
            <div className="admin-search-results">
              {searchResults.map(item => (
                <button
                  key={item.to}
                  className="admin-search-result"
                  onClick={() => { navigate(item.to); setSearchOpen(false); setSearchQuery(''); }}
                >
                  <span className="admin-search-result-type">{item.type}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          )}

          {/* Notifications bell */}
          <div ref={notifRef} style={{ position: 'relative', marginLeft: 'auto' }}>
            <button
              onClick={() => setNotifOpen(o => !o)}
              style={{
                position: 'relative', background: 'none', border: 'none', cursor: 'pointer',
                padding: 8, borderRadius: 8, display: 'flex', alignItems: 'center',
              }}
              aria-label="Notifications"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={totalActiveCount > 0 ? '#111' : '#999'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {totalActiveCount > 0 && (
                <span style={{
                  position: 'absolute', top: 4, right: 4,
                  width: 16, height: 16, borderRadius: '50%',
                  background: completedCount > 0 ? '#22c55e' : '#3b82f6',
                  color: '#fff', fontSize: 10, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  lineHeight: 1,
                }}>
                  {totalActiveCount}
                </span>
              )}
            </button>

            {notifOpen && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, marginTop: 8,
                width: 340, maxHeight: 420, overflowY: 'auto',
                background: '#fff', borderRadius: 12, boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
                border: '1px solid #e5e7eb', zIndex: 100,
              }}>
                <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>Generation Queue</span>
                  <div style={{ display: 'flex', gap: 8, fontSize: 11 }}>
                    {generatingCount > 0 && (
                      <span style={{ color: '#3b82f6', fontWeight: 600 }}>{generatingCount} generating</span>
                    )}
                    {queuedCount > 0 && (
                      <span style={{ color: '#94a3b8', fontWeight: 600 }}>{queuedCount} queued</span>
                    )}
                  </div>
                </div>

                {genNotifications.length === 0 ? (
                  <div style={{ padding: '24px 16px', textAlign: 'center', color: '#999', fontSize: 13 }}>
                    No active generations
                  </div>
                ) : (
                  <div style={{ padding: '8px 0' }}>
                    {genNotifications.map(n => (
                      <div key={n.id} style={{
                        padding: '10px 16px',
                        borderBottom: '1px solid #f5f5f5',
                        opacity: n.status === 'done' ? 0.7 : 1,
                        transition: 'opacity 0.3s',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {n.productName}
                            </div>
                            <div style={{ fontSize: 10, color: '#888' }}>{n.productBrand}</div>
                          </div>
                          {n.status === 'queued' && (
                            <span style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', flexShrink: 0, marginLeft: 8 }}>Queued</span>
                          )}
                        </div>
                        <GenProgressBar n={n} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <Outlet />
      </main>
      <button className="glass-portal-toggle" onClick={() => navigate('/partners')} aria-label="Go to Partners">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
        <span>Partners</span>
      </button>
    </div>
  );
}

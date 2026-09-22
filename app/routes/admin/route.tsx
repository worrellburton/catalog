import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Outlet, NavLink, useNavigate, useSearchParams, useLocation, useRouteError, isRouteErrorResponse } from '@remix-run/react';
import CatalogLogo from '~/components/CatalogLogo';
import { useAuth } from '~/hooks/useAuth';
import { isAdminRole } from '~/types/roles';
import { supabase } from '~/utils/supabase';
import { promoteQueuedAds } from '~/services/product-creative';
import { getAdminNavOrder, saveAdminNavOrder } from '~/services/admin-nav-order';
import AdminSidebarNav from '~/components/admin/AdminSidebarNav';
import { adminNavItems, ADMIN_SEARCH_ITEMS, findAdminNavGroup, type AdminNavItem } from '~/constants/admin-nav';

// Admin styles only ship when an admin route is rendered. Previously
// imported from the global root.tsx where every consumer page paid the
// 2.8k-line CSS cost.
import '~/styles/admin.css';

interface GenNotification {
  id: string;
  productName: string;
  productBrand: string;
  status: 'queued' | 'pending' | 'generating' | 'done' | 'failed';
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  costUsd: number | null;
  error: string | null;
  style: string;
  veoModel: string | null;
}

const ESTIMATED_GEN_SECONDS = 150;
const STUCK_THRESHOLD_SECONDS = 300;
const ESTIMATED_COST_USD = 0.06;

function formatElapsed(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}


// Expanded sidebar groups — per-browser preference, not worth a
// Supabase round-trip. Missing / unreadable storage just means every
// group starts closed (the active page's group opens itself on mount).
const OPEN_GROUPS_KEY = 'catalog:admin-nav-open';

function readOpenGroups(): Set<string> {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(OPEN_GROUPS_KEY) : null;
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeOpenGroups(groups: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify([...groups]));
  } catch {
    // Storage blocked (private mode / quota) — the sidebar still works.
  }
}

// `pickNavMatch` attributes the current location to the longest-prefix
// nav item so /admin/users/abc credits Users, not Home. Pure so it's easy
// to unit-test if we ever want to.
function pickNavMatch(pathname: string, items: AdminNavItem[]): string | null {
  const exact = items.find(i => i.to === pathname);
  if (exact) return exact.to;
  const candidates = items
    .filter(i => pathname === i.to || pathname.startsWith(i.to + '/'))
    .sort((a, b) => b.to.length - a.to.length);
  return candidates[0]?.to ?? null;
}

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, loading } = useAuth();
  const [isDark, setIsDark] = useState(false);
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') || '');
  const [searchOpen, setSearchOpen] = useState(false);

  // MRU sidebar order — persisted per admin on profiles.admin_nav_order.
  // We hydrate once on mount (or when the signed-in user changes), then
  // bubble the matching nav item to the top on every route change and
  // write back to Supabase. The write is fire-and-forget: a failure
  // just means the next session won't carry the latest tap, no UI
  // disruption. mruHydrated gates the very first save so we don't
  // overwrite the row before the read finishes.
  const [mruOrder, setMruOrder] = useState<string[]>([]);
  const [mruHydrated, setMruHydrated] = useState(false);
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    getAdminNavOrder().then(order => {
      if (cancelled) return;
      setMruOrder(order);
      setMruHydrated(true);
    });
    return () => { cancelled = true; };
  }, [user?.id]);
  useEffect(() => {
    if (!mruHydrated) return;
    const matched = pickNavMatch(location.pathname, adminNavItems);
    if (!matched) return;
    setMruOrder(prev => {
      // Already at the head? No-op — avoids a redundant write on
      // initial mount when the user lands on whatever was already
      // their most-recent page.
      if (prev[0] === matched) return prev;
      const next = [matched, ...prev.filter(t => t !== matched)];
      void saveAdminNavOrder(next);
      return next;
    });
  }, [location.pathname, mruHydrated]);

  // The nav item for the page we're on — collapsed sidebar shows just
  // this one icon, centred, until the admin hovers to expand the rail.
  const activeNavItem = useMemo(() => {
    const matchedTo = pickNavMatch(location.pathname, adminNavItems);
    return adminNavItems.find(i => i.to === matchedTo) ?? adminNavItems[0];
  }, [location.pathname]);

  // Which sidebar groups are expanded. Persisted per browser so the
  // sidebar looks the same on reload; the group that owns the current
  // page is always forced open on navigation so the admin can see where
  // they are. AdminSidebarNav renders the accordion from this set.
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => readOpenGroups());
  useEffect(() => { writeOpenGroups(openGroups); }, [openGroups]);
  useEffect(() => {
    const group = findAdminNavGroup(activeNavItem.to);
    if (!group) return;
    setOpenGroups(prev => (prev.has(group.key) ? prev : new Set(prev).add(group.key)));
  }, [activeNavItem]);
  const toggleGroup = useCallback((key: string) => {
    setOpenGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // Sync the topbar query to the URL ?q= so any admin page can read it
  // via useAdminSearch() and live-filter its visible data. Debounced so
  // typing doesn't spam history; replaceState so the back button still
  // works as expected.
  useEffect(() => {
    const t = setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      if (searchQuery) next.set('q', searchQuery);
      else next.delete('q');
      // Only update if changed
      if ((next.get('q') || '') !== (searchParams.get('q') || '')) {
        setSearchParams(next, { replace: true });
      }
    }, 120);
    return () => clearTimeout(t);
  }, [searchQuery]); // eslint-disable-line react-hooks/exhaustive-deps
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Sidebar nav-search query — filters the rendered nav into a flat list.
  const [navSearch, setNavSearch] = useState('');
  const searchRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Background data hygiene for the admin AI ad pipeline.
  // The UI for this stream now lives in the global GenerationQueueHost
  // (floating lower-right circle, Active/History/Failed tabs). The polling
  // call below stays in this layout because it does the SELF-HEAL work the
  // queue UI doesn't: flipping stuck `generating` rows to `failed` and
  // promoting `queued` rows when slots free up. Tracking job rows in local
  // state is no longer needed since nothing in this file renders them.
  const [genNotifications, setGenNotifications] = useState<GenNotification[]>([]);
  const prevIdsRef = useRef<Set<string>>(new Set());

  const pollGenerations = useCallback(async () => {
    if (!supabase) return;
    // Self-heal: flip any 'generating' row that has an error + completed_at to 'failed'.
    // Worker sometimes populates the error but forgets the status flip, leaving items stuck.
    await supabase
      .from('product_creative')
      .update({ status: 'failed' })
      .eq('status', 'generating')
      .not('error', 'is', null)
      .not('completed_at', 'is', null);

    // Auto-promote queued items when slots are free
    await promoteQueuedAds();

    const { data } = await supabase
      .from('product_creative')
      .select('id, status, style, model, created_at, updated_at, completed_at, cost_usd, error, product:products(name, brand)')
      .in('status', ['queued', 'pending', 'generating', 'failed'])
      .order('created_at', { ascending: true });

    if (!data) return;

    const active: GenNotification[] = data.map((r: any) => ({
      id: r.id,
      productName: r.product?.name || 'Unknown',
      productBrand: r.product?.brand || '',
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at || r.created_at,
      completedAt: r.completed_at,
      costUsd: r.cost_usd,
      error: r.error,
      style: r.style || 'unknown',
      veoModel: r.model,
    }));

    const currentIds = new Set(active.map(n => n.id));
    const prevIds = prevIdsRef.current;

    // Detect completions: IDs that were in prev but not in current
    const completed: GenNotification[] = [];
    prevIds.forEach(id => {
      if (!currentIds.has(id)) {
        const prev = genNotifications.find(n => n.id === id);
        if (prev && (prev.status === 'generating' || prev.status === 'pending')) {
          completed.push({ ...prev, status: 'done' as const, completedAt: new Date().toISOString(), costUsd: prev.costUsd ?? ESTIMATED_COST_USD });
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
    // Initial load.
    pollGenerations();

    // Subscribe to product_creative row changes via Supabase Realtime
    // (postgres_changes WebSocket). Replaces the previous setInterval
    // that hit the REST API every 5 seconds whether anything had
    // changed or not — admins keeping the tab open burned ~720 hits
    // an hour just for queue updates. Now we only re-poll when a row
    // actually inserts / updates.
    let channel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null;
    if (supabase) {
      channel = supabase
        .channel('admin-product-creative-changes')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'product_creative' },
          () => { pollGenerations(); },
        )
        .subscribe();
    }

    // Self-heal + promote-queued steps still run on a slow timer
    // (every 30s) — these aren't triggered by row changes, they sweep
    // for stuck rows that the worker forgot to flip.
    const sweepInterval = setInterval(() => {
      pollGenerations();
    }, 30000);

    return () => {
      clearInterval(sweepInterval);
      if (channel && supabase) supabase.removeChannel(channel);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps


  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return ADMIN_SEARCH_ITEMS.filter(item =>
      item.label.toLowerCase().includes(q) || item.type.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [searchQuery]);

  useEffect(() => {
    // Admin panel is admin/super_admin only. A signed-out visitor OR a
    // signed-in non-admin (shopper/creator) is bounced to the consumer app —
    // previously ANY authenticated account could reach every admin surface.
    if (!loading && (!user || !isAdminRole(user.role))) {
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

  if (loading || !user || !isAdminRole(user.role)) {
    return null;
  }

  return (
    <div className={`admin-layout ${isDark ? 'admin-dark' : 'admin-light'} ${sidebarOpen ? 'admin-sidebar-open' : ''}`}>
      <div
        className="admin-sidebar-backdrop"
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />
      <aside className="admin-sidebar">
        <div className="admin-sidebar-header">
          {/* Tap the Catalog wordmark to leave the admin and land
              back on the shopper home (catalog.shop/). Uses a plain
              <a> instead of Remix's Link because we want a hard
              navigation that resets the SPA from any deeply-nested
              admin state. */}
          <a
            href="/"
            className="admin-logo-link"
            aria-label="Back to catalog.shop"
            title="Back to catalog.shop"
            style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
          >
            <CatalogLogo className="admin-logo" />
            {/* Collapsed-rail monogram — the wordmark clips at 64px, so a
                compact "C" mark stands in until the sidebar expands. */}
            <span className="admin-logo-mark" aria-hidden="true">C</span>
          </a>
          <span className="admin-badge">Admin</span>
        </div>
        {/* Sidebar nav search. Filters every page (across all groups) by
            label so an admin can jump to any page by typing it — same
            behaviour as the topbar search but always at hand inside the
            sidebar. Falls through when empty so the grouped accordion
            renders. */}
        <div className="admin-nav-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="admin-nav-search-input"
            placeholder="Search pages…"
            value={navSearch}
            onChange={(e) => setNavSearch(e.target.value)}
            aria-label="Search admin pages"
          />
        </div>
        <AdminSidebarNav
          navSearch={navSearch}
          recentOrder={mruOrder}
          openGroups={openGroups}
          onToggleGroup={toggleGroup}
          onItemClick={() => setSidebarOpen(false)}
        />
        <div className="admin-sidebar-footer" ref={userMenuRef}>
          <NavLink
            to="/admin/whats-new"
            className={({ isActive }) => `admin-nav-item ${isActive ? 'active' : ''}`}
            style={{ marginBottom: 6 }}
            onClick={() => setSidebarOpen(false)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2z" />
            </svg>
            <span>What's New</span>
          </NavLink>
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
        {/* Collapsed rail: when the sidebar is slim (not hovered) the
            whole nav + search fade out and only the current page's icon
            shows, centred. Hovering expands the sidebar, fades this out
            and slides the full nav back in. Desktop-only — mobile keeps
            the slide-over drawer. */}
        <div className="admin-nav-rail" aria-hidden="true">
          <span className="admin-nav-rail-icon" title={activeNavItem.label}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d={activeNavItem.icon} />
            </svg>
          </span>
        </div>
      </aside>
      <main className="admin-main">
        <div className="admin-topbar" ref={searchRef}>
          <button
            className="admin-sidebar-toggle"
            onClick={() => setSidebarOpen(o => !o)}
            aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={sidebarOpen}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {sidebarOpen ? (
                <>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </>
              ) : (
                <>
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </>
              )}
            </svg>
          </button>
          <div className="admin-search-wrap">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              ref={searchInputRef}
              className="admin-search-input"
              type="text"
              placeholder="Search pages or filter this view…"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); }}
              onFocus={() => setSearchOpen(true)}
            />
            <span className="admin-search-shortcut">&#8984;K</span>
          </div>
          {searchOpen && (searchResults.length > 0 || searchQuery.trim()) && (
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
              {/* Searching a brand (or product name) jumps to the Products
                  tab filtered by the query — the products list matches on
                  brand + name. Keeps the query so ?q= filters the view. */}
              {searchQuery.trim() && (
                <button
                  className="admin-search-result"
                  onClick={() => {
                    navigate(`/admin/data?tab=products&q=${encodeURIComponent(searchQuery.trim())}`);
                    setSearchOpen(false);
                  }}
                >
                  <span className="admin-search-result-type">Products</span>
                  <span>Products matching “{searchQuery.trim()}”</span>
                </button>
              )}
            </div>
          )}

        </div>
        <Outlet />
      </main>
    </div>
  );
}

// Catches render/runtime errors anywhere in the admin route tree so a single
// thrown error (e.g. a malformed Supabase row dereferenced during render)
// degrades to a recoverable fallback instead of white-screening the whole
// panel with no way back. Inline styles so it renders even if admin CSS
// hasn't loaded.
export function ErrorBoundary() {
  const error = useRouteError();
  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'An unexpected error occurred.';
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24,
      background: '#0b0b0c', color: '#e7e7ea', textAlign: 'center',
      fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>Something went wrong in the admin panel</div>
      <div style={{ fontSize: 13, opacity: 0.7, maxWidth: 480, wordBreak: 'break-word' }}>{detail}</div>
      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <button
          onClick={() => window.location.reload()}
          style={{ padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', background: '#e7e7ea', color: '#0b0b0c', fontWeight: 600, fontSize: 13 }}
        >Reload</button>
        <a
          href="/admin"
          style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #333', cursor: 'pointer', color: '#e7e7ea', textDecoration: 'none', fontWeight: 600, fontSize: 13 }}
        >Back to dashboard</a>
      </div>
    </div>
  );
}

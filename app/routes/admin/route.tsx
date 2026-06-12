import { useState, useMemo, useRef, useEffect, useCallback, Fragment } from 'react';
import { Outlet, NavLink, useNavigate, useSearchParams, useLocation, useRouteError, isRouteErrorResponse } from '@remix-run/react';
import CatalogLogo from '~/components/CatalogLogo';
import { useAuth } from '~/hooks/useAuth';
import { isAdminRole } from '~/types/roles';
import { supabase } from '~/utils/supabase';
import { promoteQueuedAds } from '~/services/product-creative';
import { getAdminNavOrder, saveAdminNavOrder } from '~/services/admin-nav-order';

// Admin styles only ship when an admin route is rendered. Previously
// imported from the global root.tsx where every consumer page paid the
// 2.8k-line CSS cost.
import '~/styles/admin.css';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  badge?: string;
  section?: string;
}

const navItems: NavItem[] = [
  { to: '/admin', label: 'Home', icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' },
  { to: '/admin/users', label: 'Users', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8' },
  { to: '/admin/data', label: 'Data', icon: 'M15 10l4.553-2.276A1 1 0 0 1 21 8.618v6.764a1 1 0 0 1-1.447.894L15 14M3 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z' },
  { to: '/admin/catalogs', label: 'Catalogs', icon: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z' },
  { to: '/admin/governance', label: 'Governance', icon: 'M12 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM5 16a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 16a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 8v4M12 12l-5.5 4M12 12l5.5 4' },
  { to: '/admin/brands', label: 'Brands', icon: 'M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01' },
  { to: '/admin/pages', label: 'Pages', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8' },
  { to: '/admin/search', label: 'Search', icon: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35' },
  { to: '/admin/advertisements', label: 'Partnerships', icon: 'M2 7v10M6 5v14M11 4l9 4v12l-9-4z' },
  { to: '/admin/links', label: 'Sign Up Links', icon: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' },
  { to: '/admin/affiliate', label: 'Affiliate', icon: 'M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01M14 14l3 3M17 11l-3-3' },
  { to: '/admin/affiliate-com', label: 'Affiliate.com', icon: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' },
  { to: '/admin/earnings', label: 'Earnings', icon: 'M12 1v22M17 5H9.5a3.5 3.5 0 1 0 0 7h5a3.5 3.5 0 1 1 0 7H6' },
  { to: '/admin/finance', label: 'Finance', icon: 'M3 3v18h18M7 14l4-4 4 4 6-6' },
  { to: '/admin/activities', label: 'Engagement', icon: 'M22 12h-4l-3 9L9 3l-3 9H2' },
  { to: '/admin/creative', label: 'Creative', icon: 'M12 19l7-7 3 3-7 7-3-3zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5zM2 2l7.586 7.586M11 11a2 2 0 1 1-4 0 2 2 0 0 1 4 0z' },
  { to: '/admin/categories', label: 'Taxonomy', icon: 'M7 7h.01M7 3h5c.512 0 1 .448 1 1v5c0 .552-.448 1-1 1H7c-.552 0-1-.448-1-1V4c0-.552.448-1 1-1zM17 13h.01M13 13h5c.552 0 1 .448 1 1v5c0 .552-.448 1-1 1h-5c-.552 0-1-.448-1-1v-5c0-.552.448-1 1-1zM7 13h.01M3 13h5c.552 0 1 .448 1 1v5c0 .552-.448 1-1 1H3c-.552 0-1-.448-1-1v-5c0-.552.448-1 1-1z' },
  { to: '/admin/comments', label: 'Comments', icon: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z' },
  { to: '/admin/moderation', label: 'Moderation', icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' },
  { to: '/admin/revenue', label: 'Performance', icon: 'M3 3v18h18M7 14l4-4 4 4 6-6' },
  { to: '/admin/analytics', label: 'Analytics', icon: 'M3 3v18h18M7 17v-5M11 17v-9M15 17v-2M19 17v-7' },
  { to: '/admin/agents', label: 'Agents', icon: 'M12 2a3 3 0 0 0-3 3v1a3 3 0 0 0 3 3 3 3 0 0 0 3-3V5a3 3 0 0 0-3-3zM4 22v-1a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v1M9 12h6' },
  { to: '/admin/prompts', label: 'Prompts', icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' },
  { to: '/admin/ai-usage', label: 'AI Usage', icon: 'M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2v-4M9 21H5a2 2 0 0 0-2-2v-4m0 0h18' },
  { to: '/admin/apis', label: 'APIs', icon: 'M4 6h16M4 12h16M4 18h16' },
  { to: '/admin/branding', label: 'Branding', icon: 'M4 7h16M4 12h10M4 17h16' },
  { to: '/admin/ui', label: 'UI', icon: 'M3 3h18v18H3zM3 9h18M9 21V9' },
  { to: '/admin/splash', label: 'Splash', icon: 'M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83' },
  { to: '/admin/landing', label: 'Landing', icon: 'M3 4h18v12H3zM3 8h18M8 20h8M12 16v4' },
  { to: '/admin/dials', label: 'Dials', icon: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 6v6l4 2' },
  { to: '/admin/decks', label: 'Decks', icon: 'M4 4h16v4H4zM4 10h16v4H4zM4 16h16v4H4z' },
  { to: '/admin/fundraising', label: 'Fundraising', icon: 'M12 1v22M17 5H9.5a3.5 3.5 0 1 0 0 7h5a3.5 3.5 0 1 1 0 7H6' },
  { to: '/admin/model', label: 'Model', icon: 'M3 3v18h18M7 17l5-5 4 4 5-7' },
  { to: '/admin/gtm', label: 'GTM', icon: 'M3 11l19-9-9 19-2-8-8-2z' },
  { to: '/admin/sharing', label: 'Sharing', icon: 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13' },
];

interface SearchItem {
  label: string;
  type: string;
  to: string;
}

const allSearchItems: SearchItem[] = [
  // Pages
  { label: 'Users', type: 'Page', to: '/admin/users' },
  { label: 'AI Users', type: 'Page', to: '/admin/users?tab=ai' },
  { label: 'Waitlist', type: 'Page', to: '/admin/users?tab=waitlist' },
  { label: 'Admins', type: 'Page', to: '/admin/users?tab=admins' },
  { label: 'Super Admins', type: 'Page', to: '/admin/users?tab=admins' },
  { label: 'Data', type: 'Page', to: '/admin/data' },
  // Old name kept in the search index so muscle memory still resolves.
  { label: 'Content', type: 'Page', to: '/admin/data' },
  { label: 'Catalogs', type: 'Page', to: '/admin/catalogs' },
  { label: 'Governance', type: 'Page', to: '/admin/governance' },
  { label: 'Types', type: 'Page', to: '/admin/governance/types' },
  // Working name during build-out — keep resolving in admin search.
  { label: 'Type Brain', type: 'Page', to: '/admin/governance/types' },
  { label: 'Brands', type: 'Page', to: '/admin/brands' },
  { label: 'Search', type: 'Page', to: '/admin/search' },
  { label: 'Advertisements', type: 'Page', to: '/admin/advertisements' },
  { label: 'Affiliate Networks', type: 'Page', to: '/admin/affiliate' },
  { label: 'Affiliate.com', type: 'Page', to: '/admin/affiliate-com' },
  { label: 'Affiliate Networks (.com)', type: 'Page', to: '/admin/affiliate-com?tab=networks' },
  { label: 'Merchants', type: 'Page', to: '/admin/affiliate-com?tab=merchants' },
  { label: 'Affiliate Products', type: 'Page', to: '/admin/affiliate-com?tab=products' },
  { label: 'Identifier Conversion', type: 'Page', to: '/admin/affiliate-com?tab=conversion' },
  { label: 'Earnings', type: 'Page', to: '/admin/earnings' },
  { label: 'Finance', type: 'Page', to: '/admin/finance' },
  { label: 'Creative', type: 'Page', to: '/admin/creative' },
  { label: 'Activities', type: 'Page', to: '/admin/activities' },
  { label: 'AI Models', type: 'Page', to: '/admin/ai-models' },
  { label: 'Video Generation', type: 'Page', to: '/admin/agents?tab=video-gen&sub=look-videos' },
  { label: 'Product Ads', type: 'Page', to: '/admin/agents?tab=video-gen&sub=product-ads' },
  { label: 'Reports', type: 'Page', to: '/admin/reports' },
  { label: 'Taxonomy', type: 'Page', to: '/admin/categories' },
  { label: 'Categories', type: 'Page', to: '/admin/categories' },
  { label: 'Moderation', type: 'Page', to: '/admin/moderation' },
  { label: 'Comments', type: 'Page', to: '/admin/comments' },
  { label: 'Administrators', type: 'Page', to: '/admin/administrators' },
  { label: 'Shoppers Waitlist', type: 'Page', to: '/admin/shoppers-waitlist' },
  { label: 'Waitlist', type: 'Page', to: '/admin/shoppers-waitlist' },
  { label: "What's New", type: 'Page', to: '/admin/whats-new' },
  { label: 'Decks', type: 'Page', to: '/admin/decks' },
  { label: 'Fundraising', type: 'Page', to: '/admin/fundraising' },
  { label: 'Model', type: 'Page', to: '/admin/model' },
  { label: 'Projections', type: 'Page', to: '/admin/model' },
  { label: 'Go to Market', type: 'Page', to: '/admin/model?tab=gtm' },
  { label: 'Monthly OpEx', type: 'Page', to: '/admin/model/opex' },
  { label: 'OpEx', type: 'Page', to: '/admin/model/opex' },
  { label: 'Pitch', type: 'Page', to: '/admin/fundraising?section=pitch' },
  { label: '30 min pitch', type: 'Page', to: '/admin/fundraising?section=pitch&pitch=30' },
  { label: '60 min pitch', type: 'Page', to: '/admin/fundraising?section=pitch&pitch=60' },
  { label: 'UI', type: 'Page', to: '/admin/ui' },
  { label: 'Splash', type: 'Page', to: '/admin/splash' },
  { label: 'Splash screen', type: 'Page', to: '/admin/splash' },
  { label: 'Landing', type: 'Page', to: '/admin/landing' },
  { label: 'Landing page', type: 'Page', to: '/admin/landing' },
  { label: 'Equity', type: 'Page', to: '/admin/model/equity' },
  { label: 'Fundraise', type: 'Page', to: '/admin/model/equity' },
  { label: 'Rounds', type: 'Page', to: '/admin/model/equity' },
  { label: 'Dials', type: 'Page', to: '/admin/dials' },
  { label: 'Video to still ratio', type: 'Page', to: '/admin/dials' },
  { label: 'Brand', type: 'Page', to: '/admin/ui/brand' },
  { label: 'Search bar', type: 'Page', to: '/admin/ui/search-bar' },
  { label: 'Beam', type: 'Page', to: '/admin/ui/search-bar' },
  { label: 'Agents', type: 'Page', to: '/admin/agents' },
  { label: 'Analytics', type: 'Page', to: '/admin/analytics' },
  { label: 'Analytics — Users', type: 'Page', to: '/admin/analytics?tab=users' },
  { label: 'Analytics — Products', type: 'Page', to: '/admin/analytics?tab=products' },
  { label: 'Prompts', type: 'Page', to: '/admin/prompts' },
  { label: 'Style prompt', type: 'Page', to: '/admin/prompts' },
  { label: 'Sharing', type: 'Page', to: '/admin/sharing' },
  { label: 'Link Previews', type: 'Page', to: '/admin/sharing' },
  { label: 'iMessage', type: 'Page', to: '/admin/sharing' },
  { label: 'Open Graph', type: 'Page', to: '/admin/sharing' },
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


// MRU helpers — pure functions so they're easy to unit-test if we
// ever want to. `pickNavMatch` attributes the current location to
// the longest-prefix nav item so /admin/users/abc credits Users,
// not Home. `applyMruOrder` is the "visited-first, original order
// for the rest" sort used by the sidebar.
function pickNavMatch(pathname: string, items: NavItem[]): string | null {
  const exact = items.find(i => i.to === pathname);
  if (exact) return exact.to;
  const candidates = items
    .filter(i => pathname === i.to || pathname.startsWith(i.to + '/'))
    .sort((a, b) => b.to.length - a.to.length);
  return candidates[0]?.to ?? null;
}

// Routes that are PINNED at the top of the sidebar — never reordered
// by the MRU bubble. Home is the user's compass; sliding it down
// every time they click another tab made the sidebar feel rootless.
const NAV_PINNED_TOP = new Set(['/admin']);

function applyMruOrder(items: NavItem[], mru: string[]): NavItem[] {
  const byTo = new Map(items.map(i => [i.to, i]));
  const seen = new Set<string>();
  const out: NavItem[] = [];
  // 1. Pinned items first, in their original declaration order.
  for (const item of items) {
    if (NAV_PINNED_TOP.has(item.to) && !seen.has(item.to)) {
      out.push(item);
      seen.add(item.to);
    }
  }
  // 2. MRU order for everything else.
  for (const to of mru) {
    if (NAV_PINNED_TOP.has(to)) continue;
    const item = byTo.get(to);
    if (item && !seen.has(to)) {
      out.push(item);
      seen.add(to);
    }
  }
  // 3. Remaining items in their original order.
  for (const item of items) {
    if (!seen.has(item.to)) {
      out.push(item);
      seen.add(item.to);
    }
  }
  return out;
}

// Sidebar nav: top 7 + collapsible "Other Pages". With a non-empty search
// query the split collapses into a single flat filtered list so a typed
// match always surfaces, regardless of which bucket it's in. Section
// headers (the original "Content / Operations / Settings" groupings) are
// only shown to brand-new admins who have no MRU history yet, same as
// before.
const TOP_NAV_COUNT = 7;

function AdminNav({
  orderedNavItems,
  mruOrder,
  navSearch,
  otherOpen,
  onToggleOther,
  onItemClick,
}: {
  orderedNavItems: NavItem[];
  mruOrder: string[];
  navSearch: string;
  otherOpen: boolean;
  onToggleOther: () => void;
  onItemClick: () => void;
}) {
  const trimmed = navSearch.trim().toLowerCase();
  const searchActive = trimmed.length > 0;

  // When the admin is searching, run the filter across the FULL nav list
  // and render a single flat group — splitting top vs "Other Pages" would
  // hide matches behind the dropdown.
  const matches = useMemo(() => {
    if (!searchActive) return orderedNavItems;
    return orderedNavItems.filter(it =>
      it.label.toLowerCase().includes(trimmed)
      || it.to.toLowerCase().includes(trimmed),
    );
  }, [orderedNavItems, trimmed, searchActive]);

  const renderItem = (item: NavItem, prev?: NavItem) => {
    // Section headers are only meaningful in the static (non-MRU, non-search)
    // ordering. Once the user has MRU history or is actively searching,
    // grouping breaks down so we suppress them.
    const showSectionHeader = !searchActive
      && mruOrder.length === 0
      && item.section
      && item.section !== prev?.section;
    return (
      <Fragment key={item.to}>
        {showSectionHeader && (
          <div
            style={{
              padding: '12px 14px 4px',
              fontSize: 10,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.6px',
              color: '#94a3b8',
            }}
          >
            {item.section}
          </div>
        )}
        <NavLink
          to={item.to}
          end={item.to === '/admin'}
          prefetch="intent"
          className={({ isActive }) => `admin-nav-item ${isActive ? 'active' : ''}`}
          onClick={onItemClick}
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
      </Fragment>
    );
  };

  // Searching: flat list, no top/other split.
  if (searchActive) {
    return (
      <nav className="admin-nav">
        {matches.length === 0
          ? <div className="admin-nav-empty">No pages match “{navSearch}”.</div>
          : matches.map((it, i) => renderItem(it, matches[i - 1]))}
      </nav>
    );
  }

  // Default split.
  const top = orderedNavItems.slice(0, TOP_NAV_COUNT);
  const other = orderedNavItems.slice(TOP_NAV_COUNT);

  return (
    <nav className="admin-nav">
      {top.map((it, i) => renderItem(it, top[i - 1]))}
      {other.length > 0 && (
        <>
          <button
            type="button"
            className={`admin-nav-other-toggle${otherOpen ? ' is-open' : ''}`}
            onClick={onToggleOther}
            aria-expanded={otherOpen}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="8"  y1="12" x2="8.01"  y2="12" />
              <line x1="12" y1="12" x2="12.01" y2="12" />
              <line x1="16" y1="12" x2="16.01" y2="12" />
            </svg>
            <span>Other Pages</span>
            <span className="admin-nav-other-count">{other.length}</span>
            <svg
              width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ marginLeft: 'auto', transform: otherOpen ? 'rotate(180deg)' : 'none', transition: 'transform 160ms ease' }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {otherOpen && other.map((it, i) => renderItem(it, other[i - 1]))}
        </>
      )}
    </nav>
  );
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
    const matched = pickNavMatch(location.pathname, navItems);
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

  const orderedNavItems = useMemo(
    () => applyMruOrder(navItems, mruOrder),
    [mruOrder],
  );

  // The nav item for the page we're on — collapsed sidebar shows just
  // this one icon, centred, until the admin hovers to expand the rail.
  const activeNavItem = useMemo(() => {
    const matchedTo = pickNavMatch(location.pathname, navItems);
    return navItems.find(i => i.to === matchedTo) ?? navItems[0];
  }, [location.pathname]);

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
  // Sidebar nav-search query (filters the rendered nav list) and the
  // collapsed/expanded state of the "Other Pages" group. The first 7
  // items of orderedNavItems stay always-visible; everything past that
  // tucks under a single click-to-expand row so the sidebar isn't a
  // 30+ item dump on load. AdminNav (below) handles the rendering split.
  const [navSearch, setNavSearch] = useState('');
  const [otherNavOpen, setOtherNavOpen] = useState(false);
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
    return allSearchItems.filter(item =>
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
        {/* Sidebar nav search. Filters the full nav (top 7 + Other) by
            label so an admin can jump to any page by typing it — same
            behaviour as the topbar search but always at hand inside the
            sidebar. Falls through when empty so the default split (top 7
            visible, rest folded under "Other Pages") still renders. */}
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
        <AdminNav
          orderedNavItems={orderedNavItems}
          mruOrder={mruOrder}
          navSearch={navSearch}
          otherOpen={otherNavOpen}
          onToggleOther={() => setOtherNavOpen(o => !o)}
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

/**
 * Admin sidebar navigation — the single source of truth for what the
 * /admin sidebar shows and what the cmd-K page search can jump to.
 *
 * Structure: two PINNED rows (Home, Users) always sit at the top, then
 * every other page lives inside one of ADMIN_NAV_GROUPS. The sidebar
 * renders each group as a click-to-expand accordion row so the default
 * view is ~10 rows instead of a 40-page dump. `adminNavItems` is the
 * flattened list (pinned + every group item, in declaration order) for
 * code that needs the plain page list: active-route matching, the
 * most-recently-visited history, and the nav search.
 *
 * Adding a page: put it in the group it belongs to (or a new group) and
 * add a search alias below. scripts/check-routes.mjs asserts every
 * `to` here resolves to a registered route in vite.config.ts.
 */

export interface AdminNavItem {
  to: string;
  label: string;
  /** SVG path data for a 24x24 stroke icon. */
  icon: string;
  badge?: string;
}

export interface AdminNavGroup {
  key: string;
  label: string;
  icon: string;
  items: AdminNavItem[];
}

export interface AdminSearchItem {
  label: string;
  type: 'Page' | 'Shopper';
  to: string;
}

/** Rows that always show at the top of the sidebar, outside any group. */
export const ADMIN_NAV_PINNED: AdminNavItem[] = [
  { to: '/admin', label: 'Home', icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' },
  { to: '/admin/users', label: 'Users', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8' },
];

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    key: 'catalog',
    label: 'Catalog',
    icon: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',
    items: [
      { to: '/admin/data', label: 'Data', icon: 'M15 10l4.553-2.276A1 1 0 0 1 21 8.618v6.764a1 1 0 0 1-1.447.894L15 14M3 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z' },
      { to: '/admin/catalogs', label: 'Catalogs', icon: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z' },
      { to: '/admin/search', label: 'Search', icon: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35' },
      { to: '/admin/categories', label: 'Taxonomy', icon: 'M7 7h.01M7 3h5c.512 0 1 .448 1 1v5c0 .552-.448 1-1 1H7c-.552 0-1-.448-1-1V4c0-.552.448-1 1-1zM17 13h.01M13 13h5c.552 0 1 .448 1 1v5c0 .552-.448 1-1 1h-5c-.552 0-1-.448-1-1v-5c0-.552.448-1 1-1zM7 13h.01M3 13h5c.552 0 1 .448 1 1v5c0 .552-.448 1-1 1H3c-.552 0-1-.448-1-1v-5c0-.552.448-1 1-1z' },
      { to: '/admin/creative', label: 'Creative', icon: 'M12 19l7-7 3 3-7 7-3-3zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5zM2 2l7.586 7.586M11 11a2 2 0 1 1-4 0 2 2 0 0 1 4 0z' },
      { to: '/admin/pipeline', label: 'Pipeline', icon: 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9' },
      { to: '/admin/pipeline/health', label: 'Pipeline health', icon: 'M22 12h-4l-3 9L9 3l-3 9H2' },
    ],
  },
  {
    key: 'feed',
    label: 'Feed',
    icon: 'M3 4h18v18H3zM3 10h18M8 2v4M16 2v4',
    items: [
      { to: '/admin/daily-feed', label: 'Daily Feed', icon: 'M3 4h18v18H3zM3 10h18M8 2v4M16 2v4' },
      { to: '/admin/dials', label: 'Dials', icon: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 6v6l4 2' },
      { to: '/admin/seeding', label: 'Seeding', icon: 'M12 2v8M12 10c-3 0-5 2-5 5M12 10c3 0 5 2 5 5M5 22h14M12 13v9' },
      { to: '/admin/governance', label: 'Governance', icon: 'M12 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM5 16a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 16a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 8v4M12 12l-5.5 4M12 12l5.5 4' },
    ],
  },
  {
    key: 'stylist',
    label: 'Stylist & AI',
    icon: 'M12 2a3 3 0 0 0-3 3v1a3 3 0 0 0 3 3 3 3 0 0 0 3-3V5a3 3 0 0 0-3-3zM4 22v-1a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v1M9 12h6',
    items: [
      { to: '/admin/style', label: 'Style', icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' },
      { to: '/admin/stylists', label: 'Stylists', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8' },
      { to: '/admin/prompts', label: 'Prompts', icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' },
      { to: '/admin/agents', label: 'Agents', icon: 'M12 2a3 3 0 0 0-3 3v1a3 3 0 0 0 3 3 3 3 0 0 0 3-3V5a3 3 0 0 0-3-3zM4 22v-1a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v1M9 12h6' },
      { to: '/admin/ai-usage', label: 'AI Usage', icon: 'M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2v-4M9 21H5a2 2 0 0 0-2-2v-4m0 0h18' },
      { to: '/admin/apis', label: 'APIs', icon: 'M4 6h16M4 12h16M4 18h16' },
    ],
  },
  {
    key: 'community',
    label: 'Community',
    icon: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z',
    items: [
      { to: '/admin/comments', label: 'Comments', icon: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z' },
      { to: '/admin/moderation', label: 'Moderation', icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' },
      { to: '/admin/activities', label: 'Engagement', icon: 'M22 12h-4l-3 9L9 3l-3 9H2' },
    ],
  },
  {
    key: 'partners',
    label: 'Partners',
    icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
    items: [
      { to: '/admin/brands', label: 'Brands', icon: 'M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01' },
      { to: '/admin/partners', label: 'Brand Partners', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
      { to: '/admin/advertisements', label: 'Partnerships', icon: 'M2 7v10M6 5v14M11 4l9 4v12l-9-4z' },
      { to: '/admin/affiliate', label: 'Affiliate', icon: 'M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01M14 14l3 3M17 11l-3-3' },
      { to: '/admin/affiliate-com', label: 'Affiliate.com', icon: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' },
      { to: '/admin/links', label: 'Sign Up Links', icon: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' },
    ],
  },
  {
    key: 'growth',
    label: 'Growth',
    icon: 'M3 3v18h18M7 17v-5M11 17v-9M15 17v-2M19 17v-7',
    items: [
      { to: '/admin/analytics', label: 'Analytics', icon: 'M3 3v18h18M7 17v-5M11 17v-9M15 17v-2M19 17v-7' },
      { to: '/admin/revenue', label: 'Performance', icon: 'M3 3v18h18M7 14l4-4 4 4 6-6' },
      { to: '/admin/earnings', label: 'Earnings', icon: 'M12 1v22M17 5H9.5a3.5 3.5 0 1 0 0 7h5a3.5 3.5 0 1 1 0 7H6' },
      { to: '/admin/finance', label: 'Finance', icon: 'M3 3v18h18M7 14l4-4 4 4 6-6' },
    ],
  },
  {
    key: 'company',
    label: 'Company',
    icon: 'M3 3v18h18M7 17l5-5 4 4 5-7',
    items: [
      { to: '/admin/model', label: 'Model', icon: 'M3 3v18h18M7 17l5-5 4 4 5-7' },
      { to: '/admin/model/equity', label: 'Equity', icon: 'M12 2a10 10 0 1 0 10 10H12V2zM16 2.5A10 10 0 0 1 21.5 8H16V2.5' },
      { to: '/admin/gtm', label: 'GTM', icon: 'M3 11l19-9-9 19-2-8-8-2z' },
      { to: '/admin/fundraising', label: 'Fundraising', icon: 'M12 1v22M17 5H9.5a3.5 3.5 0 1 0 0 7h5a3.5 3.5 0 1 1 0 7H6' },
      { to: '/admin/decks', label: 'Decks', icon: 'M4 4h16v4H4zM4 10h16v4H4zM4 16h16v4H4z' },
    ],
  },
  {
    key: 'site',
    label: 'Site & Design',
    icon: 'M3 3h18v18H3zM3 9h18M9 21V9',
    items: [
      { to: '/admin/ui', label: 'UI', icon: 'M3 3h18v18H3zM3 9h18M9 21V9' },
      { to: '/admin/branding', label: 'Branding', icon: 'M4 7h16M4 12h10M4 17h16' },
      { to: '/admin/splash', label: 'Splash', icon: 'M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83' },
      { to: '/admin/landing', label: 'Landing', icon: 'M3 4h18v12H3zM3 8h18M8 20h8M12 16v4' },
      { to: '/admin/pages', label: 'Pages', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8' },
      { to: '/admin/sharing', label: 'Sharing', icon: 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13' },
    ],
  },
];

/** Every sidebar page, flattened: pinned rows first, then each group's
 *  items in declaration order. */
export const adminNavItems: AdminNavItem[] = [
  ...ADMIN_NAV_PINNED,
  ...ADMIN_NAV_GROUPS.flatMap(g => g.items),
];

/** Group that owns a given page path, or null for pinned rows. */
export function findAdminNavGroup(to: string): AdminNavGroup | null {
  return ADMIN_NAV_GROUPS.find(g => g.items.some(i => i.to === to)) ?? null;
}

/** cmd-K page search aliases (topbar search). Kept separate from the
 *  sidebar so a page can have several searchable names and so tab-deep
 *  links (`?tab=`) can be reached without cluttering the nav. */
export const ADMIN_SEARCH_ITEMS: AdminSearchItem[] = [
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
  { label: 'Seeding', type: 'Page', to: '/admin/seeding' },
  { label: 'Simulate', type: 'Page', to: '/admin/seeding/simulate' },
  { label: 'Daily Feed', type: 'Page', to: '/admin/daily-feed' },
  { label: 'Style', type: 'Page', to: '/admin/style' },
  { label: 'Stylists', type: 'Page', to: '/admin/stylists' },
  { label: 'Style Chats', type: 'Page', to: '/admin/style' },
  { label: 'Style Generations', type: 'Page', to: '/admin/style?tab=generations' },
  { label: 'StyleUp (consumer)', type: 'Page', to: '/style' },
  { label: 'Stylist', type: 'Page', to: '/admin/style' },
  { label: 'Conversations', type: 'Page', to: '/admin/style' },
  { label: 'Governance', type: 'Page', to: '/admin/governance' },
  { label: 'Types', type: 'Page', to: '/admin/governance/types' },
  // Working name during build-out — keep resolving in admin search.
  { label: 'Type Brain', type: 'Page', to: '/admin/governance/types' },
  { label: 'Brands', type: 'Page', to: '/admin/brands' },
  { label: 'Brand Partners', type: 'Page', to: '/admin/partners' },
  { label: 'Invite brand admin', type: 'Page', to: '/admin/partners' },
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
  { label: 'Live Ledger', type: 'Page', to: '/admin/live-ledger' },
  { label: 'Activity feed', type: 'Page', to: '/admin/live-ledger' },
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
  // Sidebar pages that previously had no search alias.
  { label: 'Home', type: 'Page', to: '/admin' },
  { label: 'Pipeline', type: 'Page', to: '/admin/pipeline' },
  { label: 'Pipeline health', type: 'Page', to: '/admin/pipeline/health' },
  { label: 'AI Usage', type: 'Page', to: '/admin/ai-usage' },
  { label: 'APIs', type: 'Page', to: '/admin/apis' },
  { label: 'Sign Up Links', type: 'Page', to: '/admin/links' },
  { label: 'Performance', type: 'Page', to: '/admin/revenue' },
  { label: 'GTM', type: 'Page', to: '/admin/gtm' },
  { label: 'Branding', type: 'Page', to: '/admin/branding' },
  { label: 'Pages', type: 'Page', to: '/admin/pages' },
  // Shoppers
  { label: 'Carla', type: 'Shopper', to: '/admin/shoppers/Carla' },
  { label: 'alfvaz', type: 'Shopper', to: '/admin/shoppers/alfvaz' },
  { label: 'franky90', type: 'Shopper', to: '/admin/shoppers/franky90' },
  { label: 'D1.barbershop', type: 'Shopper', to: '/admin/shoppers/D1.barbershop' },
];

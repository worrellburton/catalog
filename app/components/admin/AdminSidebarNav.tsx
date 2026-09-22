// imports
import { useMemo } from 'react';
import { NavLink } from '@remix-run/react';
import {
  ADMIN_NAV_PINNED,
  ADMIN_NAV_GROUPS,
  adminNavItems,
  findAdminNavGroup,
  type AdminNavItem,
  type AdminNavGroup,
} from '~/constants/admin-nav';

// types
interface AdminSidebarNavProps {
  /** Live text of the sidebar "Search pages…" box. */
  navSearch: string;
  /** Most-recently-visited page paths, newest first (persisted per admin). */
  recentOrder: string[];
  /** Set of group keys currently expanded. */
  openGroups: ReadonlySet<string>;
  onToggleGroup: (key: string) => void;
  /** Fired on any page link click so the mobile drawer can close. */
  onItemClick: () => void;
}

// constants
/** How many recently-visited pages show in the "Recent" strip. */
const RECENT_COUNT = 3;

// helpers
function NavIcon({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

function NavItemLink({
  item,
  sub = false,
  prefix,
  onClick,
}: {
  item: AdminNavItem;
  /** Indented row inside an expanded group. */
  sub?: boolean;
  /** Group name shown before the label (search results only). */
  prefix?: string;
  onClick: () => void;
}) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/admin'}
      prefetch="intent"
      className={({ isActive }) => `admin-nav-item${sub ? ' admin-nav-subitem' : ''}${isActive ? ' active' : ''}`}
      onClick={onClick}
    >
      <NavIcon d={item.icon} />
      <span>
        {prefix && <span className="admin-nav-item-prefix">{prefix} › </span>}
        {item.label}
      </span>
      {item.badge && (
        <span className={`admin-nav-badge ${item.badge === '0' ? 'badge-zero' : ''}`}>
          {item.badge}
        </span>
      )}
    </NavLink>
  );
}

function NavGroupRow({
  group,
  open,
  onToggle,
  onItemClick,
}: {
  group: AdminNavGroup;
  open: boolean;
  onToggle: () => void;
  onItemClick: () => void;
}) {
  return (
    <div className={`admin-nav-group${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="admin-nav-group-toggle"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`admin-nav-group-${group.key}`}
      >
        <NavIcon d={group.icon} />
        <span className="admin-nav-group-label">{group.label}</span>
        <span className="admin-nav-group-count">{group.items.length}</span>
        <svg
          className="admin-nav-group-chevron"
          width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="admin-nav-group-items" id={`admin-nav-group-${group.key}`}>
          {group.items.map(item => (
            <NavItemLink key={item.to} item={item} sub onClick={onItemClick} />
          ))}
        </div>
      )}
    </div>
  );
}

// main logic
/**
 * Sidebar nav for /admin: pinned rows, a short "Recent" strip, then one
 * click-to-expand accordion row per group. Typing in the nav search box
 * collapses everything into a single flat filtered list (with the group
 * name as a prefix) so a match never hides behind a closed group.
 */
export default function AdminSidebarNav({
  navSearch,
  recentOrder,
  openGroups,
  onToggleGroup,
  onItemClick,
}: AdminSidebarNavProps) {
  const trimmed = navSearch.trim().toLowerCase();
  const searchActive = trimmed.length > 0;

  const matches = useMemo(() => {
    if (!searchActive) return [];
    return adminNavItems
      .map(item => ({ item, group: findAdminNavGroup(item.to) }))
      .filter(({ item, group }) =>
        item.label.toLowerCase().includes(trimmed)
        || item.to.toLowerCase().includes(trimmed)
        || (group?.label.toLowerCase().includes(trimmed) ?? false),
      );
  }, [trimmed, searchActive]);

  const recent = useMemo(() => {
    const pinned = new Set(ADMIN_NAV_PINNED.map(p => p.to));
    const byTo = new Map(adminNavItems.map(i => [i.to, i]));
    const out: AdminNavItem[] = [];
    for (const to of recentOrder) {
      if (pinned.has(to)) continue;
      const item = byTo.get(to);
      if (item) out.push(item);
      if (out.length >= RECENT_COUNT) break;
    }
    return out;
  }, [recentOrder]);

  if (searchActive) {
    return (
      <nav className="admin-nav">
        {matches.length === 0
          ? <div className="admin-nav-empty">No pages match “{navSearch}”.</div>
          : matches.map(({ item, group }) => (
            <NavItemLink key={item.to} item={item} prefix={group?.label} onClick={onItemClick} />
          ))}
      </nav>
    );
  }

  return (
    <nav className="admin-nav">
      {ADMIN_NAV_PINNED.map(item => (
        <NavItemLink key={item.to} item={item} onClick={onItemClick} />
      ))}
      {recent.length > 0 && (
        <div className="admin-nav-recent">
          <div className="admin-nav-recent-label">Recent</div>
          {recent.map(item => (
            <NavItemLink key={item.to} item={item} onClick={onItemClick} />
          ))}
        </div>
      )}
      <div className="admin-nav-groups">
        {ADMIN_NAV_GROUPS.map(group => (
          <NavGroupRow
            key={group.key}
            group={group}
            open={openGroups.has(group.key)}
            onToggle={() => onToggleGroup(group.key)}
            onItemClick={onItemClick}
          />
        ))}
      </div>
    </nav>
  );
}

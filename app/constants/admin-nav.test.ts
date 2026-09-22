import { describe, expect, it } from 'vitest';
import {
  ADMIN_NAV_GROUPS,
  ADMIN_NAV_PINNED,
  ADMIN_SEARCH_ITEMS,
  adminNavItems,
  findAdminNavGroup,
} from './admin-nav';

describe('admin nav data', () => {
  it('lists every page exactly once across pinned rows and groups', () => {
    const seen = new Map<string, number>();
    for (const item of adminNavItems) seen.set(item.to, (seen.get(item.to) ?? 0) + 1);
    const dupes = [...seen].filter(([, n]) => n > 1).map(([to]) => to);
    expect(dupes).toEqual([]);
  });

  it('gives every group a unique key and at least one page', () => {
    const keys = ADMIN_NAV_GROUPS.map(g => g.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const g of ADMIN_NAV_GROUPS) expect(g.items.length).toBeGreaterThan(0);
  });

  it('pins Home first so the sidebar always has a compass', () => {
    expect(ADMIN_NAV_PINNED[0]?.to).toBe('/admin');
  });

  it('resolves a grouped page to its group and a pinned page to none', () => {
    const first = ADMIN_NAV_GROUPS[0];
    expect(findAdminNavGroup(first.items[0].to)?.key).toBe(first.key);
    expect(findAdminNavGroup('/admin')).toBeNull();
  });

  it('keeps every sidebar page reachable from the cmd-K search', () => {
    const searchable = new Set(ADMIN_SEARCH_ITEMS.map(s => s.to.split('?')[0]));
    const missing = adminNavItems.map(i => i.to).filter(to => !searchable.has(to));
    expect(missing).toEqual([]);
  });
});

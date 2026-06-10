import { useEffect, useState } from 'react';
import { supabase } from '~/utils/supabase';

/**
 * Per-page section configuration. Backed by public.page_sections,
 * which the /admin/pages editor writes to. Consumer renderers
 * (ProductPage / LookOverlay) call usePageSections to honour the
 * persisted order + enabled flags without having to query on every
 * render.
 *
 * Caching strategy: module-scope cache keyed by page name, populated
 * once per browser session. The page_sections table is admin-only
 * and rarely changes, so a session-lifetime cache is the right
 * tradeoff (no realtime invalidation — admins refresh after editing).
 *
 * Empty / loading state: returns null to signal "not loaded yet";
 * consumers should treat null as "render everything in source order"
 * so the first paint doesn't blank out the page.
 */

export interface PageSection {
  section_key: string;
  sort_order: number;
  enabled: boolean;
  /** null = section uses its hard-coded default count; positive int
   *  caps the rendered item count. Ignored when infinite=true (the
   *  feed paginates beyond this on its own). */
  item_limit: number | null;
  /** Flips the section from a bounded grid into an infinite scroll.
   *  Renderers should switch to a paginated feed component. */
  infinite: boolean;
}

type Page = 'product' | 'looks';

const cache = new Map<Page, PageSection[]>();
const inflight = new Map<Page, Promise<PageSection[]>>();
const subscribers = new Map<Page, Set<(v: PageSection[]) => void>>();

function notify(page: Page, value: PageSection[]) {
  const set = subscribers.get(page);
  if (!set) return;
  for (const cb of set) cb(value);
}

async function load(page: Page): Promise<PageSection[]> {
  if (cache.has(page)) return cache.get(page)!;
  let promise = inflight.get(page);
  if (!promise) {
    promise = (async () => {
      if (!supabase) return [];
      const { data } = await supabase
        .from('page_sections')
        .select('section_key, sort_order, enabled, item_limit, infinite')
        .eq('page', page)
        .order('sort_order', { ascending: true });
      const rows = (data ?? []) as PageSection[];
      cache.set(page, rows);
      notify(page, rows);
      return rows;
    })().finally(() => { inflight.delete(page); });
    inflight.set(page, promise);
  }
  return promise;
}

export function usePageSections(page: Page): PageSection[] | null {
  const [state, setState] = useState<PageSection[] | null>(() => cache.get(page) ?? null);

  useEffect(() => {
    const set = subscribers.get(page) ?? new Set<(v: PageSection[]) => void>();
    set.add(setState);
    subscribers.set(page, set);
    if (cache.has(page)) {
      setState(cache.get(page)!);
    } else {
      void load(page);
    }
    return () => {
      set.delete(setState);
      if (set.size === 0) subscribers.delete(page);
    };
  }, [page]);

  return state;
}

/**
 * Lookup helper: is the named section currently enabled? Returns
 * true when the config hasn't loaded yet so we don't flash the
 * surface empty on first paint.
 */
export function isSectionEnabled(sections: PageSection[] | null, key: string): boolean {
  if (!sections) return true;
  const row = sections.find(s => s.section_key === key);
  // Sections not in the config table are assumed enabled — the
  // editor seeds the canonical set, but a renderer might add new
  // ones before the migration is run.
  if (!row) return true;
  return row.enabled !== false;
}

/** Per-section render limit. Returns `fallback` for unknown sections
 *  and for sections with a null item_limit so renderers stay
 *  predictable while the editor is empty / not yet migrated. */
export function getSectionLimit(sections: PageSection[] | null, key: string, fallback: number): number {
  if (!sections) return fallback;
  const row = sections.find(s => s.section_key === key);
  if (!row || row.item_limit == null || row.item_limit <= 0) return fallback;
  return row.item_limit;
}

/** Is the named section configured as an infinite scroll? */
export function isSectionInfinite(sections: PageSection[] | null, key: string): boolean {
  if (!sections) return false;
  const row = sections.find(s => s.section_key === key);
  return row?.infinite === true;
}

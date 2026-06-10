// recent-searches — a tiny client-side store of the shopper's recent search
// terms, persisted to localStorage. This is a personalization signal: paired
// with `recentProducts` (what they tapped) it lets us infer what categories a
// shopper leans toward (e.g. lots of "sneakers" / "running shoes" searches →
// a Shoes affinity). See services/user-affinity.ts for the consumer.
//
// Deliberately separate from services/search-log.ts: that logs to the admin
// analytics backend (global query metrics). This is a per-device, per-user
// recency list used only to bias the local feed + name the dynamic section.

const STORAGE_KEY = 'catalog.recentSearches';
const MAX_RECENT = 20;

/** Dispatched after a write so reactive consumers (useUserAffinity) refresh
 *  even within the same tab — the native `storage` event only fires cross-tab. */
export const RECENT_SEARCH_EVENT = 'catalog:recent-searches-changed';

export function getRecentSearches(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((q): q is string => typeof q === 'string') : [];
  } catch {
    return [];
  }
}

/** Record a search term, newest-first, deduped (case-insensitive). No-ops on
 *  blank / very short queries — those carry no category signal. */
export function recordRecentSearch(query: string): void {
  if (typeof window === 'undefined') return;
  const q = query.trim();
  if (q.length < 2) return;
  const lower = q.toLowerCase();
  try {
    const prev = getRecentSearches();
    const next = [q, ...prev.filter(x => x.toLowerCase() !== lower)].slice(0, MAX_RECENT);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(RECENT_SEARCH_EVENT));
  } catch {
    /* quota / private mode — non-fatal, personalization just stays cold */
  }
}

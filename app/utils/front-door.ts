// Front-door routing. StyleUp is the app's front page: a plain open of "/"
// sends the shopper to the stylist picker at /style. The feed still lives at
// "/" — it's revealed the moment the shopper chooses to browse (StyleUp's back
// button / "Browse the catalog", the account menu, or any deep-link).
//
// Two-app split (Phase 1): the Flutter shell can force this decision by
// passing `mode` — the Catalog flavor pins to 'catalog' (feed always wins,
// stylist picker is unreachable from front door) and the Catalog Style
// flavor pins to 'style' (always bounce to /style regardless of session
// flags). Web-only visitors leave `mode` undefined and get the existing
// browse-flag heuristic.
import type { AppMode } from './app-mode';

/** Session flag: this tab has already landed on the feed, so returning to "/"
 *  (Back from /activity, a product page, etc.) stays on the feed instead of
 *  bouncing to the stylist picker. Also set by StyleUp's exit-to-feed. */
export const BROWSE_FEED_KEY = 'catalog:browse-feed';

interface FrontDoorInput {
  /** window.location.search at mount (e.g. "?look=abc"). */
  search: string;
  /** True mid Google/Supabase OAuth callback — never intercept it. */
  isOAuth: boolean;
  /** True if BROWSE_FEED_KEY is set for this session. */
  browseFeed: boolean;
  /** Which of the two apps this bundle is serving. 'catalog' locks the
   *  front door to the feed; 'style' locks it to the stylist picker. */
  mode?: AppMode;
}

/** Should a fresh mount of "/" redirect to the StyleUp landing? Returns false
 *  (stay on the feed) whenever the URL is doing real work the feed must handle:
 *  an OAuth callback, a deep-link/content target, a marketing entry, or an
 *  explicit request to browse the feed. */
export function shouldRedirectToStyle({ search, isOAuth, browseFeed, mode }: FrontDoorInput): boolean {
  if (isOAuth) return false;
  // Two-app split: flavor pins the front door regardless of session flags.
  if (mode === 'catalog') return false;
  if (mode === 'style') return true;
  const params = new URLSearchParams(search);
  // Deep-links + marketing entries the feed route consumes itself.
  if (params.has('look') || params.has('q') || params.has('ref') || params.has('flow')) return false;
  // Explicit "show me the feed" — StyleUp's exit, or a prior feed visit.
  if (params.get('feed') === '1' || browseFeed) return false;
  return true;
}

/** Leave the StyleUp landing for the home feed. Sets the session browse flag
 *  (so a bare "/" won't bounce back to the picker) and navigates with a
 *  ?feed=1 fallback for when sessionStorage is blocked. */
export function browseTheFeed(navigate: (to: string) => void): void {
  try { sessionStorage.setItem(BROWSE_FEED_KEY, '1'); } catch { /* private mode */ }
  navigate('/?feed=1');
}

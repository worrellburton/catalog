import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { prefetchHomeFeed } from '~/services/product-creative';
import { getWaitlistStatus } from '~/services/waitlist';
import type { useAuth } from '~/hooks/useAuth';

export type AppView = 'locked' | 'splash' | 'landing' | 'app' | 'waitlisted';

type AuthUser = ReturnType<typeof useAuth>['user'];

interface UseAppViewArgs {
  user: AuthUser;
  authLoading: boolean;
}

interface UseAppViewResult {
  view: AppView;
  setView: Dispatch<SetStateAction<AppView>>;
  firstVisit: boolean;
  showSplash: boolean;
  setShowSplash: Dispatch<SetStateAction<boolean>>;
  authSplashMounted: boolean;
  authSplashLeaving: boolean;
}

// Owns the top-level view state machine for the consumer app:
//   locked → splash → landing | app | waitlisted
// plus the two splash overlays that wrap it:
//   - firstVisit: branded SplashScreen on a user's first ever visit
//   - authSplash: the gate-side fade while supabase auth is resolving
export function useAppView({ user, authLoading }: UseAppViewArgs): UseAppViewResult {
  const [view, setView] = useState<AppView>('locked');

  // First-visit splash: if the user has never been to catalog on this
  // device, show a branded splash before surfacing the gate / landing.
  // Splash timing is data-aware: hold for at least 800ms (so the brand
  // moment doesn't flash by) and at most 2500ms (so a slow network
  // never hangs the user). In between, dismiss as soon as the feed
  // data lands - so by the time the splash drops, the cards render
  // with real content already in cache.
  const [firstVisit, setFirstVisit] = useState(() => {
    try {
      return typeof window !== 'undefined' && !window.localStorage.getItem('catalog:visited');
    } catch { return false; }
  });
  useEffect(() => {
    if (!firstVisit) return;
    try { window.localStorage.setItem('catalog:visited', '1'); } catch { /* quota */ }

    const SPLASH_MIN_MS = 800;
    const SPLASH_MAX_MS = 2500;
    const startedAt = Date.now();
    let dismissed = false;
    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      setFirstVisit(false);
    };

    const ceiling = window.setTimeout(dismiss, SPLASH_MAX_MS);
    let feedReady = false;
    let floorReached = false;
    const tryDismiss = () => {
      if (feedReady && floorReached) dismiss();
    };
    const floor = window.setTimeout(() => { floorReached = true; tryDismiss(); }, SPLASH_MIN_MS);
    prefetchHomeFeed()
      .then(rows => {
        // Pre-warm posters from the FRESH list while the splash is still
        // up so they're in browser cache by the time the feed renders.
        for (const ad of rows.slice(0, 6)) {
          const url = ad.thumbnail_url
            || ad.product?.image_url
            || (ad.product?.images && ad.product.images[0])
            || '';
          if (!url) continue;
          const img = new Image();
          img.decoding = 'async';
          img.src = url;
        }
      })
      .catch(() => { /* let the ceiling handle it */ })
      .finally(() => {
        const elapsed = Date.now() - startedAt;
        feedReady = true;
        if (elapsed >= SPLASH_MIN_MS) {
          floorReached = true;
          dismiss();
        } else {
          tryDismiss();
        }
      });

    return () => {
      window.clearTimeout(ceiling);
      window.clearTimeout(floor);
    };
  }, [firstVisit]);

  const [showSplash, setShowSplash] = useState(false);

  // Branded auth splash. Show whenever we're in the 'locked' view AND
  // either auth is still resolving OR auth resolved with a user but the
  // auto-route effect below hasn't yet flipped view to 'app' or
  // 'waitlisted'. Keeps the password gate from flashing for users who
  // are about to be signed in.
  const showAuthSplash = view === 'locked' && (authLoading || !!user);
  const [authSplashLeaving, setAuthSplashLeaving] = useState(false);
  const [authSplashMounted, setAuthSplashMounted] = useState(showAuthSplash);
  useEffect(() => {
    if (showAuthSplash) {
      setAuthSplashMounted(true);
      setAuthSplashLeaving(false);
      return;
    }
    if (authSplashMounted) {
      // Auth resolved - start the fade-out, then unmount after the
      // CSS transition completes (240 ms; matching .auth-splash
      // transition duration).
      setAuthSplashLeaving(true);
      const t = window.setTimeout(() => setAuthSplashMounted(false), 280);
      return () => window.clearTimeout(t);
    }
  }, [showAuthSplash, authSplashMounted]);

  // Auto-route on sign-in: approved users enter the app, everyone else
  // goes to the waitlist.
  useEffect(() => {
    if (authLoading) return;
    if (!user) return;
    if (view !== 'locked') return;
    // Clean OAuth artifacts from URL once sign-in is confirmed
    if (
      window.location.hash.includes('access_token') ||
      window.location.search.includes('code=')
    ) {
      window.history.replaceState(null, '', window.location.pathname);
    }

    let cancelled = false;
    (async () => {
      if (user.role === 'admin') {
        if (!cancelled) setView('app');
        return;
      }
      // Wrap the waitlist lookup so a transient network failure (or RLS
      // regression) can't leave the user pinned on 'locked' forever - that
      // path renders an auth splash with no escape. On throw, default to
      // the waitlist view: it's the same destination an unapproved user
      // lands on, has a Retry affordance, and beats a stuck splash.
      let status: Awaited<ReturnType<typeof getWaitlistStatus>> = null;
      try {
        status = await getWaitlistStatus(user.id);
      } catch (err) {
        console.warn('[auto-route] waitlist lookup failed', err);
      }
      if (cancelled) return;
      setView(status?.approved ? 'app' : 'waitlisted');
    })();
    return () => { cancelled = true; };
  }, [user, authLoading, view]);

  // Read hash on mount for deep linking
  useEffect(() => {
    const path = window.location.pathname;
    const hash = window.location.hash.replace('#', '');
    // On deep-link paths (/p/, /l/, /b/) the shell injects #app to bypass
    // the password gate. Honor it by entering the app view, then strip the
    // hash so the URL stays clean (/p/slug not /p/slug#app).
    const isDeepLink = path.startsWith('/p/') || path.startsWith('/l/') || path.startsWith('/b/');
    if (hash === 'app') {
      setView('app');
      if (isDeepLink) {
        window.history.replaceState(null, '', path);
      }
    } else if (hash === 'landing') {
      setView('landing');
    }
  }, []);

  // Sync hash when view changes
  useEffect(() => {
    // Don't clobber Supabase OAuth return URL - let the client parse it
    // first. Both implicit (#access_token=…) and PKCE (?code=…) flows
    // depend on the URL staying intact until supabase-js's async
    // exchange completes.
    if (window.location.hash.includes('access_token')) return;
    if (window.location.search.includes('code=')) return;

    // Deep-link routes (/p/, /l/, /b/) own their own URL — the overlay
    // router keeps them in sync. Don't append #app on top of a product
    // or look path or the address bar shows /p/slug#app after reload.
    const path = window.location.pathname;
    const isDeepLink = path.startsWith('/p/') || path.startsWith('/l/') || path.startsWith('/b/');
    if (isDeepLink) {
      // Strip any stale hash left over from a previous navigation.
      if (window.location.hash) {
        window.history.replaceState(null, '', path);
      }
      return;
    }

    let hash = '';
    if (view === 'app') hash = 'app';
    else if (view === 'landing') hash = 'landing';
    else if (view === 'locked') hash = '';

    if (hash) {
      window.history.replaceState(null, '', `#${hash}`);
    } else {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [view]);

  return {
    view,
    setView,
    firstVisit,
    showSplash,
    setShowSplash,
    authSplashMounted,
    authSplashLeaving,
  };
}

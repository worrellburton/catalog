import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { prefetchHomeFeed } from '~/services/product-creative';
import { getWaitlistStatus } from '~/services/waitlist';
import type { useAuth } from '~/hooks/useAuth';

export type AppView = 'locked' | 'app' | 'waitlisted';

type AuthUser = ReturnType<typeof useAuth>['user'];

interface UseAppViewArgs {
  user: AuthUser;
  authLoading: boolean;
  /** Launch master switch. true = waitlist flow (signing UP queues new
   *  accounts behind approval); false = open flow. Either way guests
   *  land in the feed — the marketing landing page was retired. */
  waitlistMode: boolean;
  /** True while the waitlist_mode dial is still resolving — routing for
   *  signed-out visitors waits on it so we don't flash the wrong flow. */
  waitlistLoading: boolean;
}

interface UseAppViewResult {
  view: AppView;
  setView: Dispatch<SetStateAction<AppView>>;
  firstVisit: boolean;
  authSplashMounted: boolean;
  authSplashLeaving: boolean;
}

// Owns the top-level view state machine for the consumer app:
//   locked → app | waitlisted
// plus the two splash overlays that wrap it:
//   - firstVisit: branded SplashScreen on a user's first ever visit
//   - authSplash: the gate-side fade while supabase auth is resolving
export function useAppView({ user, authLoading, waitlistMode, waitlistLoading }: UseAppViewArgs): UseAppViewResult {
  // A ?look=<uuid> deep-link (e.g. tapping a look in Activity) should land
  // straight on the look — not replay the cold-boot 'locked' → splash beat.
  // Start in 'app' so the auth-splash never covers the feed while the deep-link
  // handler resolves the look. (firstVisit already skips the brand splash for
  // ?look=; this skips the auth-splash too.)
  const [view, setView] = useState<AppView>(() => {
    try {
      if (typeof window !== 'undefined' && /[?&]look=/.test(window.location.search)) return 'app';
    } catch { /* ignore */ }
    return 'locked';
  });

  // "Warm" = this tab already booted the app once this session. Set the
  // moment we first reach 'app' (below). On a warm remount — e.g. the
  // browser/native Back button returning from a standalone route like
  // /activity, which tears down and re-mounts the whole SPA shell — we
  // skip the cold-boot brand beat and the feed-cover splash so the user
  // lands straight back on the feed instead of watching the auth-splash
  // replay. Cold first loads (no flag) keep the full branded sequence.
  const booted = (() => {
    try { return typeof window !== 'undefined' && window.sessionStorage.getItem('catalog:booted') === '1'; }
    catch { return false; }
  })();
  useEffect(() => {
    if (view !== 'app') return;
    try { window.sessionStorage.setItem('catalog:booted', '1'); } catch { /* private mode */ }
  }, [view]);

  // First-visit splash: if the user has never been to catalog on this
  // device, show a branded splash before surfacing the gate / feed.
  // Splash timing is data-aware: hold for at least 800ms (so the brand
  // moment doesn't flash by) and at most 2500ms (so a slow network
  // never hangs the user). In between, dismiss as soon as the feed
  // data lands - so by the time the splash drops, the cards render
  // with real content already in cache.
  const [firstVisit, setFirstVisit] = useState(() => {
    try {
      if (typeof window === 'undefined') return false;
      // Deep links (e.g. opening a specific look from Activity via ?look=…)
      // should land straight on the content — never behind the brand splash.
      if (/[?&]look=/.test(window.location.search)) return false;
      return !window.localStorage.getItem('catalog:visited');
    } catch { return false; }
  });
  useEffect(() => {
    if (!firstVisit) return;
    try { window.localStorage.setItem('catalog:visited', '1'); } catch { /* quota */ }

    // Splash is a brand beat, not a wait screen — and it should feel
    // consistent every cold open. Hold for a FIXED 2000ms regardless of
    // how fast the feed pre-warms. Min == max == 2000ms; the tryDismiss
    // path collapses to "dismiss at 2000ms" because the floor and the
    // ceiling are now the same.
    const SPLASH_MIN_MS = 2000;
    const SPLASH_MAX_MS = 2000;
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

  // Intro brand beat. The auth splash holds for at least this long on a
  // cold open so the wordmark + particle field read as a deliberate moment
  // before we hand off to the feed — even when auth resolves
  // instantly (signed-out visitors). Without it the splash would flash by.
  const [beatDone, setBeatDone] = useState(booted);
  useEffect(() => {
    if (booted) return;
    const t = window.setTimeout(() => setBeatDone(true), 1500);
    return () => window.clearTimeout(t);
  }, [booted]);

  // First-paint signal from the feed. ContinuousFeed dispatches
  // `catalog:feed-ready` on the window after its first non-empty
  // commit (one rAF after data lands). The auth splash listens for
  // it so we never fade away to a blank dark frame before the cards
  // actually paint underneath. Ceiling timer guarantees it flips
  // true within 2.5s even if the network is dead, so the splash
  // can't hang forever.
  const [feedReady, setFeedReady] = useState(booted);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (booted || feedReady) return;
    const onReady = () => setFeedReady(true);
    window.addEventListener('catalog:feed-ready', onReady);
    const ceiling = window.setTimeout(() => setFeedReady(true), 2500);
    return () => {
      window.removeEventListener('catalog:feed-ready', onReady);
      window.clearTimeout(ceiling);
    };
  }, [booted, feedReady]);

  // Branded auth splash. Shown whenever:
  //  - we're still in 'locked' AND auth is resolving (or already has
  //    a user and the auto-route effect below hasn't flipped view
  //    yet) — keeps the password gate from flashing for signed-in
  //    users; OR
  //  - the user has resolved and we've entered 'app' but the feed
  //    hasn't painted its first batch yet — keeps the cards-mount
  //    blank window covered so the fade reveals real content, not
  //    a dark void.
  const showAuthSplash =
    (view === 'locked' && (authLoading || !!user || !beatDone)) ||
    (view === 'app' && !!user && !feedReady);
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
      // Matches the (longer, more elegant) .auth-splash leaving transition.
      const t = window.setTimeout(() => setAuthSplashMounted(false), 640);
      return () => window.clearTimeout(t);
    }
  }, [showAuthSplash, authSplashMounted]);

  // Post-splash entry for signed-OUT visitors: straight into the feed.
  // (The marketing landing was retired — catalog.shop IS the home
  // screen now, in both launch flows. Products are browsable as guest;
  // looks/creators gate in _index.) Waits on waitlistLoading only so a
  // late dial flip can't race the first route. Deep links / hashes have
  // already moved `view` off 'locked', so this only fires for a plain
  // cold open at "/".
  useEffect(() => {
    if (authLoading || waitlistLoading) return;
    if (user) return;
    if (!beatDone) return;
    if (view !== 'locked') return;
    setView('app');
  }, [authLoading, waitlistLoading, user, beatDone, view]);

  // Auto-route on sign-in. OPEN flow: every signed-in user enters the app
  // directly (signing up grants access immediately). WAITLIST flow:
  // approved users + admins enter the app, everyone else goes to the
  // waitlist screen until approved.
  useEffect(() => {
    if (authLoading || waitlistLoading) return;
    if (!user) return;
    if (view !== 'locked') return;
    // Clean OAuth artifacts from URL once sign-in is confirmed
    if (
      window.location.hash.includes('access_token') ||
      window.location.search.includes('code=')
    ) {
      window.history.replaceState(null, '', window.location.pathname);
    }
    if (!waitlistMode) { setView('app'); return; }

    let cancelled = false;
    (async () => {
      if (user.role === 'admin') {
        if (!cancelled) setView('app');
        return;
      }
      // On a lookup failure, default to the waitlist view: same destination
      // an unapproved user lands on, with a Retry affordance — beats a
      // stuck splash if the RLS/network call throws.
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
  }, [user, authLoading, waitlistLoading, view, waitlistMode]);

  // Read hash on mount for deep linking
  useEffect(() => {
    const path = window.location.pathname;
    const hash = window.location.hash.replace('#', '');
    // On deep-link paths (/p/, /l/, /b/) the shell injects #app to bypass
    // the password gate. Honor it by entering the app view, then strip the
    // hash so the URL stays clean (/p/slug not /p/slug#app).
    const isDeepLink = path.startsWith('/p/') || path.startsWith('/l/') || path.startsWith('/b/');
    if (hash === 'app' || hash === 'landing') {
      // #landing is a retired hash (old marketing page) — old links and
      // bookmarks still resolve, into the feed.
      setView('app');
      if (isDeepLink) {
        window.history.replaceState(null, '', path);
      }
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
    authSplashMounted,
    authSplashLeaving,
  };
}

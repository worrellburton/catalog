import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "@remix-run/react";
import { Analytics } from "@vercel/analytics/remix";
import { SpeedInsights } from "@vercel/speed-insights/remix";
import { isRouteErrorResponse, useRouteError } from "@remix-run/react";
import { useEffect, useState } from "react";
import TypeAnywhere from "~/components/TypeAnywhere";
import { initScrollIdleFade } from "~/utils/scroll-idle";
import SessionTrackerHost from "~/components/SessionTrackerHost";
import PresenceHost from "~/components/PresenceHost";
import GenerationQueueHost from "~/components/GenerationQueueHost";
import SwipeMenuGesture from "~/components/SwipeMenuGesture";
import PullDownActivityGesture from "~/components/PullDownActivityGesture";
import CreatorLoginToastHost from "~/components/CreatorLoginToastHost";
import FollowToastHost from "~/components/FollowToastHost";
import { CatalogDialogProvider } from "~/components/CatalogDialog";
import { initSentry, captureException } from "~/utils/sentry";

// Dev-only data-stream waterfall probe. Installs window.__waterfall() and
// __waterfallWatch() for profiling Supabase/asset network waterfalls from the
// console. Guarded by import.meta.env.DEV so the bundler drops it in prod.
if (import.meta.env.DEV) void import("~/utils/perf-waterfall");

/* ── Modular styles ──
 * Only stylesheets needed by the consumer feed (and the locked/landing
 * surfaces every visitor sees) live here. Per-route stylesheets
 * (admin.css, generate.css, deck-view.css, deck-v6.css,
 * deck-selector.css) are imported from inside their respective route
 * files, and per-view sheets (product-page, creator-page, my-looks,
 * comments, profile-page, following-page, saved-screen, landing-page,
 * in-app-browser, share-page, import) are imported from inside their
 * lazy components so they ride along with the chunk instead of
 * render-blocking first paint. Before moving a sheet OUT of here,
 * check that no entry-chunk component renders its classes
 * (bookmarks.css and user-menu.css stay because the always-mounted
 * header does; look-overlay.css/brand-page.css because the feed's
 * InlineLookDetail does) and that light-mode/responsive overrides
 * for it don't rely on load order (.light-mode wins on specificity,
 * responsive.css media blocks do NOT — relocate those into the view
 * sheet, as creator-page.css does).
 */
import "./styles/base.css";
import "./styles/password-gate.css";
import "./styles/guest-gate.css";
import "./styles/waitlist.css";
import "./styles/splash-screen.css";
import "./styles/home-hero.css";
import "./styles/header.css";
import "./styles/bottom-bar.css";
import "./styles/build-catalog.css";
import "./styles/type-anywhere.css";
import "./styles/bookmarks.css";
import "./styles/grid-view.css";
import "./styles/look-overlay.css";
import "./styles/similar-debug.css";
import "./styles/brand-page.css";
import "./styles/user-menu.css";
import "./styles/light-mode.css";
import "./styles/responsive.css";
import "./styles/activity.css";
import "./styles/generation-queue.css";
import "./styles/feed.css";
import "./styles/empty-catalog.css";
import "./styles/creator-toast.css";
import "./styles/confirm-modal.css";
import "./styles/avatar-modal.css";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        {/* Lock zoom on mobile Safari. user-scalable=no + min/max=1
            covers the standard pinch-zoom path; the touch-action +
            JS guard below catches Safari's iOS-10+ override that
            ignores user-scalable. */}
        {/* interactive-widget=resizes-content: when the on-screen keyboard
            opens, shrink the LAYOUT viewport (not just the visual one) so
            position:fixed inset:0 overlays, vh/% units, and env(safe-area)
            collapse to the visible area above the keyboard. Removes most of
            the visual-viewport gap/shrink hacks on supporting browsers;
            iOS Safari still falls back to the visualViewport JS in BottomBar. */}
        <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content" />
        {/* Theme-color drives the iOS Safari toolbar background. Without
            it, Safari paints a default-white bar at the bottom — visible
            as a white strip under our matte-black landing. Setting it
            to the page's own matte black makes the toolbar blend into
            the page so the bottom edge reads as one continuous surface.
            We also set apple-mobile-web-app-status-bar-style so the
            top status zone matches when the page is added to the home
            screen as a PWA. */}
        <meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)" />
        <meta name="theme-color" content="#000000" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <title>catalog</title>
        <meta
          name="description"
          content="A creator-powered shopping platform where you discover products through curated looks."
        />
        {/* Build SHA — surfaced in the 500 ErrorBoundary diagnostic so
            an admin can copy-paste the exact deployed version when
            reporting a bug. Vite inlines VITE_VERCEL_GIT_COMMIT_SHA
            at build time; Vercel sets the underlying env var on
            every production + preview deploy. */}
        <meta
          name="git-commit"
          content={(import.meta as { env?: Record<string, string | undefined> }).env?.VITE_VERCEL_GIT_COMMIT_SHA ?? 'dev'}
        />
        {/* Open Graph + Twitter Card tags drive the rich link preview
            iMessage, Slack, WhatsApp, Twitter, and Facebook show when
            someone shares catalog.shop. Without these, iMessage falls
            back to "<title> + Safari compass icon". The values mirror
            the admin Sharing page (/admin/sharing) so editing there
            and redeploying updates the preview everywhere. */}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="catalog" />
        <meta property="og:title" content="catalog" />
        <meta
          property="og:description"
          content="A creator-powered shopping platform where you discover products through curated looks."
        />
        <meta property="og:url" content="https://catalog.shop" />
        <meta property="og:image" content="https://catalog.shop/og-default.svg" />
        <meta property="og:image:type" content="image/svg+xml" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content="catalog — curated looks" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="catalog" />
        <meta
          name="twitter:description"
          content="A creator-powered shopping platform where you discover products through curated looks."
        />
        <meta name="twitter:image" content="https://catalog.shop/og-default.svg" />
        <link rel="canonical" href="https://catalog.shop" />
        <meta name="apple-mobile-web-app-title" content="catalog" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* Open the TCP/TLS connection to Supabase before the JS bundle even
            parses, so the first auth check, looks fetch, and video stream
            don't pay the ~150 ms handshake cost. crossOrigin is required
            for storage assets (videos/images) to count as primed. */}
        <link rel="preconnect" href="https://vtarjrnqvcqbhoclvcur.supabase.co" crossOrigin="" />
        <link rel="dns-prefetch" href="https://vtarjrnqvcqbhoclvcur.supabase.co" />
        {/* Critical above-the-fold CSS, inlined. The full stylesheet
            (root-*.css, ~336 kB) is render-blocking; while it's in flight
            the user used to see a flash of unstyled text. These ~40 lines
            paint the dark backdrop + password gate immediately so first
            visual matches what the user expects. The full sheet loads
            normally and overrides anything here once it arrives. */}
        <style dangerouslySetInnerHTML={{ __html: `
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
*{scrollbar-width:none;-ms-overflow-style:none}
*::-webkit-scrollbar{display:none}
:root{--bg:#0a0a0a;--text:#fff;--card-bg:#1a1a1a;--header-height:64px;--overlay-bg:rgba(10,10,10,.95)}
html,body{touch-action:manipulation;-webkit-text-size-adjust:100%;-webkit-tap-highlight-color:transparent}
body{font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;overscroll-behavior:none}
.app-root{min-height:100vh}
.password-gate{position:fixed;inset:0;z-index:500;background:radial-gradient(circle at 30% 20%,rgba(80,70,90,.18),transparent 55%),radial-gradient(circle at 75% 80%,rgba(60,80,110,.15),transparent 55%),#000;display:flex;align-items:center;justify-content:center;padding:32px 20px}
.splash-screen{position:fixed;inset:0;z-index:1000;background:#0a0a0a;display:flex;align-items:center;justify-content:center}
        ` }} />
        {/* iOS Safari ignores user-scalable=no on the viewport meta since
            iOS 10. These two listeners are the only reliable way to kill
            pinch-zoom and double-tap-zoom on iPhones. Inlined so they
            arm before any user interaction. */}
        <script
          dangerouslySetInnerHTML={{ __html: `
(function(){
  if(typeof document==='undefined')return;
  // Block pinch (gesturestart/change/end) - Safari-specific events.
  ['gesturestart','gesturechange','gestureend'].forEach(function(evt){
    document.addEventListener(evt,function(e){e.preventDefault();},{passive:false});
  });
  // Block double-tap-zoom by suppressing the second tap inside 350 ms.
  var lastTouchEnd=0;
  document.addEventListener('touchend',function(e){
    var now=Date.now();
    if(now-lastTouchEnd<=350)e.preventDefault();
    lastTouchEnd=now;
  },{passive:false});
})();
          `}}
        />
        {/* Above-the-fold image preload from the previous visit's cache.
            Runs during HTML parse — before the JS bundle even downloads —
            so the browser starts fetching the first few feed thumbnails
            in parallel with the rest of bootstrap. By the time
            ContinuousFeed mounts and reads the same localStorage cache,
            its top tiles are already painted from a hot HTTP cache.
            Keys mirror product-creative.ts (HOME_FEED_LS_KEY + gender
            suffix); read all three and pick the freshest. */}
        <script
          dangerouslySetInnerHTML={{ __html: `
(function(){
  try{
    if(typeof localStorage==='undefined'||typeof document==='undefined')return;
    var ks=['catalog:home-feed-cache:v8','catalog:home-feed-cache:v8:male','catalog:home-feed-cache:v8:female'];
    var best=null;
    for(var i=0;i<ks.length;i++){
      var raw=localStorage.getItem(ks[i]);
      if(!raw)continue;
      try{
        var p=JSON.parse(raw);
        if(p&&typeof p.savedAt==='number'&&Array.isArray(p.rows)){
          if(!best||p.savedAt>best.savedAt)best=p;
        }
      }catch(_){}
    }
    if(!best)return;
    // 7-day TTL — match readHomeFeedFromStorage.
    if(Date.now()-best.savedAt>6.048e8)return;
    var seen={},urls=[];
    for(var j=0;j<best.rows.length&&urls.length<4;j++){
      var r=best.rows[j];
      if(!r)continue;
      var u=r.thumbnail_url||(r.product&&(r.product.image_url||(r.product.images&&r.product.images[0])));
      if(u&&!seen[u]){seen[u]=1;urls.push(u);}
    }
    for(var k=0;k<urls.length;k++){
      var l=document.createElement('link');
      l.rel='preload';
      l.as='image';
      l.href=urls[k];
      // fetchpriority=high tells the browser these are above-the-fold
      // and should jump ahead of other preloads in the queue.
      l.setAttribute('fetchpriority','high');
      document.head.appendChild(l);
    }
  }catch(_){}
})();
          `}}
        />
        {/* Inter (admin chrome) and DM Sans (MyLooks) are the only
            two families actually referenced in the stylesheets. The other
            eight families this request used to pull (Plus Jakarta, Outfit,
            Space Grotesk, Sora, Manrope, Poppins, Nunito Sans, Figtree)
            were never selected by any selector - they were dead bytes on
            every page load. Brand-logo fonts are loaded on demand by
            ensureBrandFont() in app/utils/brandFonts.ts when an admin picks
            one, so they don't belong in the global preload either. */}
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <Meta />
        <Links />
      </head>
      <body>
        {/* Detail-hero video sharpen filter — referenced by
            --hero-video-enhance (base.css) on the ProductPage + LookOverlay
            heroes ONLY. A light unsharp mask (out = src·(1+a) − blur·a, a≈0.5)
            that counteracts the upscale-softness of the ≤834px source clips
            when they fill a full-screen hero. color-interpolation-filters=sRGB
            keeps the overshoot from darkening edges; the small stdDeviation
            keeps it subtle (no crunchy halos on AI footage). Hidden, zero-size,
            no layout/paint cost until something references the filter. The feed
            never references it, so feed playback is untouched. */}
        <svg
          aria-hidden="true"
          focusable="false"
          width="0"
          height="0"
          style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none' }}
        >
          <filter id="catalog-hero-sharpen" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation="0.8" result="heroBlur" />
            <feComposite
              in="SourceGraphic"
              in2="heroBlur"
              operator="arithmetic"
              k1="0"
              k2="1.5"
              k3="-0.5"
              k4="0"
            />
          </filter>
        </svg>
        {children}
        <ScrollRestoration />
        <Scripts />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}

export default function App() {
  // Lazy-init Sentry on first mount. No-op if VITE_SENTRY_DSN isn't
  // set; we don't pay the SDK bundle cost on the cold path either,
  // because the SDK is dynamically imported inside initSentry().
  useEffect(() => { void initSentry(); }, []);
  // Media-first scrolling (founder's call): card chrome fades away while
  // gliding and eases back in when the scroll settles — every viewport.
  useEffect(() => { initScrollIdleFade(); }, []);

  return (
    <>
      {/* Type-anywhere search lives at the app root so a stray
          keystroke on any page (admin, generate, import, brand
          page, anywhere) bounces back to the home grid with the
          query applied. Component is desktop-only and ignores
          keys when focus is in another input. */}
      <TypeAnywhere />
      {/* Per-user session + event tracker for /admin/analytics. No-op
          for unauthenticated visitors; starts/stops with the auth user. */}
      <SessionTrackerHost />
      {/* Joins the realtime presence channel so the user shows online to
          others (powers the FollowingRail's green online ring). */}
      <PresenceHost />
      {/* Global generation queue — any AI job anywhere in the app
          reports here via startGenerationJob(). Renders only when at
          least one job is running. */}
      <GenerationQueueHost />
      {/* Global mobile gesture: swipe LEFT anywhere → opens the Account
          menu. Listens at the window level and dispatches a custom
          event UserMenu picks up. Auto-disables on desktop, in the
          Flutter shell, inside horizontally-scrollable regions, and
          while an input is focused — see SwipeMenuGesture for guards. */}
      <SwipeMenuGesture />
      {/* Global mobile gesture: pull DOWN from the top of the viewport
          → opens /activity (the followed-creator activity feed). Edge-
          gated to the top 24 px so it doesn't collide with the normal
          feed scroll; also requires window.scrollY === 0 so a partial
          scroll-up doesn't accidentally trigger. See
          PullDownActivityGesture for the full guard list. */}
      <PullDownActivityGesture />
      {/* Once-per-session creator engagement toast. Shows "since
          your last visit, your looks earned X impressions / Y
          clicks" when there's something to report; otherwise stays
          silent. Renders nothing for anonymous visitors. */}
      <CreatorLoginToastHost />
      <FollowToastHost />
      {/* Catalog dialog system — the ONLY popup in the product. Provides
          confirm/alert/prompt (glass, centered, brand spring) to every
          surface, consumer and admin alike; native window.* dialogs are
          banned codebase-wide. */}
      <CatalogDialogProvider>
        <Outlet />
      </CatalogDialogProvider>
    </>
  );
}

/**
 * Root error boundary — Remix mounts this whenever a thrown render
 * error or a non-200 route response bubbles up. Without it, an
 * exception anywhere in the tree unmounts the SPA and the user sees
 * a black screen (we hit this earlier when /admin/sharing wasn't
 * registered). Logs the error to console + Vercel Analytics so the
 * incident is at least visible until proper Sentry wiring lands.
 */
export function ErrorBoundary() {
  const error = useRouteError();
  const [copied, setCopied] = useState(false);

  if (typeof window !== 'undefined') {
    captureException(error, { path: window.location.pathname, source: 'ErrorBoundary' });
    // Auto-recover from stale-deploy chunk failures. A client still running
    // an OLD build requests asset chunks whose hashed filenames no longer
    // exist after a new deploy; the SPA fallback returns index.html (HTML),
    // which throws "'text/html' is not a valid JavaScript MIME type" or
    // "Failed to fetch dynamically imported module". One hard reload pulls
    // the fresh index.html + current chunks. Guarded via sessionStorage so a
    // genuine (non-stale) module error can't loop.
    const errMsg = error instanceof Error ? error.message : String(error);
    if (/valid JavaScript MIME type|dynamically imported module|Importing a module script failed|error loading dynamically imported|Unable to preload/i.test(errMsg)) {
      try {
        const KEY = 'catalog:chunk-reload-at';
        const last = parseInt(window.sessionStorage.getItem(KEY) || '0', 10);
        if (Date.now() - last > 10000) {
          window.sessionStorage.setItem(KEY, String(Date.now()));
          window.location.reload();
        }
      } catch { /* sessionStorage blocked — fall through to the error UI */ }
    }
    const w = window as unknown as { va?: (event: string, data: Record<string, unknown>) => void };
    if (w.va) {
      w.va('event', {
        name: 'route-error',
        path: window.location.pathname,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const status = isRouteErrorResponse(error) ? error.status : 500;
  const title = isRouteErrorResponse(error)
    ? (error.statusText || `Error ${error.status}`)
    : 'Something went wrong';
  const message = isRouteErrorResponse(error)
    ? error.data
    : (error instanceof Error ? error.message : 'An unexpected error occurred.');

  // Build a copy-paste diagnostic block. Single triple-backtick block so
  // pasting it into a chat preserves the structure. Includes everything
  // needed to triage a production-only TDZ/chunk-init bug: minified
  // identifier, route, build SHA (if Vercel injected it), user-agent,
  // stack trace truncated to the first 12 frames.
  const buildSha = typeof window !== 'undefined'
    ? ((window as unknown as { __VERCEL_GIT_COMMIT_SHA?: string }).__VERCEL_GIT_COMMIT_SHA
        ?? document.querySelector('meta[name="git-commit"]')?.getAttribute('content')
        ?? 'unknown')
    : 'ssr';
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
  const path = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '';
  const stack = error instanceof Error && error.stack
    ? error.stack.split('\n').slice(0, 13).join('\n')
    : '(no stack)';
  const diagnostic = [
    '```',
    `route:   ${path}`,
    `status:  ${status}`,
    `message: ${typeof message === 'string' ? message : JSON.stringify(message)}`,
    `build:   ${buildSha}`,
    `time:    ${new Date().toISOString()}`,
    `ua:      ${ua}`,
    '',
    'stack:',
    stack,
    '```',
  ].join('\n');

  const copyDiagnostic = async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return false;
    try {
      await navigator.clipboard.writeText(diagnostic);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      return true;
    } catch {
      // Fallback: select the textarea so the user can ⌘C themselves.
      const ta = document.getElementById('error-diag-textarea') as HTMLTextAreaElement | null;
      ta?.select();
      return false;
    }
  };


  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      background: '#0a0a0a',
      color: '#fff',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif',
    }}>
      <div style={{ maxWidth: 560, width: '100%', textAlign: 'center' }}>
        <div style={{ fontSize: 64, fontWeight: 700, color: '#52525b', marginBottom: 8 }}>
          {status}
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 10px' }}>{title}</h1>
        <p style={{ fontSize: 14, color: '#a1a1aa', lineHeight: 1.5, margin: '0 0 18px' }}>
          {typeof message === 'string' ? message : 'An unexpected error occurred.'}
        </p>

        {/* Diagnostic block — pre-formatted so the user can copy + paste
            into a chat with the full context (route, build SHA, stack
            trace) in one click. */}
        <div style={{
          background: '#111113',
          border: '1px solid #27272a',
          borderRadius: 8,
          padding: 12,
          marginBottom: 18,
          textAlign: 'left',
          position: 'relative',
        }}>
          <pre style={{
            margin: 0,
            fontSize: 11,
            lineHeight: 1.5,
            color: '#d4d4d8',
            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 220,
            overflowY: 'auto',
          }}>{diagnostic}</pre>
          <textarea
            id="error-diag-textarea"
            readOnly
            value={diagnostic}
            tabIndex={-1}
            aria-hidden="true"
            style={{ position: 'absolute', left: -9999, top: -9999, opacity: 0, height: 1, width: 1 }}
          />
          <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 6 }}>
            <button
              type="button"
              onClick={copyDiagnostic}
              style={{
                background: copied ? '#16a34a' : '#27272a',
                color: '#fff',
                border: 'none',
                padding: '4px 10px',
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'background 120ms',
              }}
            >
              {copied ? '✓ Copied' : 'Copy details'}
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button
            type="button"
            onClick={() => {
              if (typeof window === 'undefined') return;
              // Hard reload, bypassing the HTTP cache. The earlier
              // "Reload" button used location.reload() which often
              // serves the cached bundle; this version adds a cache-
              // bust query param so the browser fetches fresh JS.
              const u = new URL(window.location.href);
              u.searchParams.set('_r', String(Date.now()));
              window.location.replace(u.toString());
            }}
            style={{
              appearance: 'none',
              background: '#fff',
              color: '#0a0a0a',
              border: 'none',
              padding: '10px 20px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Hard reload
          </button>
          <a
            href="/"
            style={{
              background: 'transparent',
              color: '#a1a1aa',
              border: '1px solid #27272a',
              padding: '10px 20px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              textDecoration: 'none',
              display: 'inline-block',
            }}
          >
            Back to home
          </a>
        </div>
      </div>
    </div>
  );
}

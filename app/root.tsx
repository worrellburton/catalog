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
import { useEffect } from "react";
import TypeAnywhere from "~/components/TypeAnywhere";
import SessionTrackerHost from "~/components/SessionTrackerHost";
import CreatorLoginToastHost from "~/components/CreatorLoginToastHost";
import { initSentry, captureException } from "~/utils/sentry";

/* ── Modular styles ──
 * Only stylesheets needed by the consumer feed (and the locked/landing
 * surfaces every visitor sees) live here. Per-route stylesheets
 * (admin.css, generate.css, deck-view.css, deck-v6.css,
 * deck-selector.css) are imported from inside their respective route
 * files so they only ship to users who actually visit those routes.
 */
import "./styles/base.css";
import "./styles/password-gate.css";
import "./styles/waitlist.css";
import "./styles/splash-screen.css";
import "./styles/header.css";
import "./styles/bottom-bar.css";
import "./styles/type-anywhere.css";
import "./styles/bookmarks.css";
import "./styles/grid-view.css";
import "./styles/look-overlay.css";
import "./styles/product-page.css";
import "./styles/creator-page.css";
import "./styles/brand-page.css";
import "./styles/user-menu.css";
import "./styles/in-app-browser.css";
import "./styles/light-mode.css";
import "./styles/responsive.css";
import "./styles/landing-page.css";
import "./styles/feed.css";
import "./styles/empty-catalog.css";
import "./styles/my-looks.css";
import "./styles/creator-toast.css";
import "./styles/import.css";
import "./styles/share-page.css";
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
        <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
        <title>catalog</title>
        <meta
          name="description"
          content="A creator-powered shopping platform where you discover products through curated looks."
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
      {/* Once-per-session creator engagement toast. Shows "since
          your last visit, your looks earned X impressions / Y
          clicks" when there's something to report; otherwise stays
          silent. Renders nothing for anonymous visitors. */}
      <CreatorLoginToastHost />
      <Outlet />
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

  if (typeof window !== 'undefined') {
    captureException(error, { path: window.location.pathname, source: 'ErrorBoundary' });
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
      <div style={{ maxWidth: 480, textAlign: 'center' }}>
        <div style={{ fontSize: 64, fontWeight: 700, color: '#52525b', marginBottom: 8 }}>
          {status}
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 10px' }}>{title}</h1>
        <p style={{ fontSize: 14, color: '#a1a1aa', lineHeight: 1.5, margin: '0 0 24px' }}>
          {typeof message === 'string' ? message : 'An unexpected error occurred.'}
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button
            type="button"
            onClick={() => { if (typeof window !== 'undefined') window.location.reload(); }}
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
            Reload
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

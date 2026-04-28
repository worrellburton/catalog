import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "@remix-run/react";
import { Analytics } from "@vercel/analytics/remix";

/* ── Modular styles ──
 * Only stylesheets needed by the consumer feed (and the locked/landing
 * surfaces every visitor sees) live here. Per-route stylesheets
 * (admin.css, partners.css, generate.css, deck-view.css, deck-v6.css,
 * deck-selector.css) are imported from inside their respective route
 * files so they only ship to users who actually visit those routes.
 */
import "./styles/base.css";
import "./styles/password-gate.css";
import "./styles/waitlist.css";
import "./styles/splash-screen.css";
import "./styles/header.css";
import "./styles/bottom-bar.css";
import "./styles/bookmarks.css";
import "./styles/grid-view.css";
import "./styles/look-overlay.css";
import "./styles/product-page.css";
import "./styles/creator-page.css";
import "./styles/user-menu.css";
import "./styles/in-app-browser.css";
import "./styles/light-mode.css";
import "./styles/responsive.css";
import "./styles/landing-page.css";
import "./styles/feed.css";
import "./styles/empty-catalog.css";
import "./styles/my-looks.css";

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
  // Block pinch (gesturestart/change/end) — Safari-specific events.
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
        {/* Inter (admin/partners chrome) and DM Sans (MyLooks) are the only
            two families actually referenced in the stylesheets. The other
            eight families this request used to pull (Plus Jakarta, Outfit,
            Space Grotesk, Sora, Manrope, Poppins, Nunito Sans, Figtree)
            were never selected by any selector — they were dead bytes on
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
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

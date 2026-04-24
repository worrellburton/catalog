import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "@remix-run/react";
import { Analytics } from "@vercel/analytics/remix";

/* ── Modular styles (split from globals.css) ── */
import "./styles/base.css";
import "./styles/password-gate.css";
import "./styles/waitlist.css";
import "./styles/deck-selector.css";
import "./styles/deck-v6.css";
import "./styles/splash-screen.css";
import "./styles/deck-view.css";
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
import "./styles/admin.css";
import "./styles/partners.css";
import "./styles/feed.css";
import "./styles/my-looks.css";
import "./styles/generate.css";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>catalog</title>
        <meta
          name="description"
          content="A creator-powered shopping platform where you discover products through curated looks."
        />

        {/* Rich link / iMessage preview. Absolute URLs are required so Apple's
            LPLinkMetadata crawler can fetch the assets. Swap `girl.mp4` and
            `og-cover.jpg` (drop the poster in /public) for a tuned preview. */}
        <meta property="og:type" content="video.other" />
        <meta property="og:site_name" content="Catalog" />
        <meta property="og:title" content="Catalog" />
        <meta
          property="og:description"
          content="A creator-powered shopping platform where you discover products through curated looks."
        />
        <meta property="og:url" content="https://worrellburton.github.io/catalog/" />
        <meta property="og:image" content="https://worrellburton.github.io/catalog/og-cover.jpg" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:video" content="https://worrellburton.github.io/catalog/girl.mp4" />
        <meta property="og:video:secure_url" content="https://worrellburton.github.io/catalog/girl.mp4" />
        <meta property="og:video:type" content="video/mp4" />
        <meta property="og:video:width" content="720" />
        <meta property="og:video:height" content="1280" />
        <meta name="twitter:card" content="player" />
        <meta name="twitter:title" content="Catalog" />
        <meta
          name="twitter:description"
          content="A creator-powered shopping platform where you discover products through curated looks."
        />
        <meta name="twitter:image" content="https://worrellburton.github.io/catalog/og-cover.jpg" />
        <meta name="twitter:player" content="https://worrellburton.github.io/catalog/girl.mp4" />
        <meta name="twitter:player:width" content="720" />
        <meta name="twitter:player:height" content="1280" />
        <meta name="twitter:player:stream" content="https://worrellburton.github.io/catalog/girl.mp4" />
        <meta name="twitter:player:stream:content_type" content="video/mp4" />

        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=DM+Sans:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Outfit:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&family=Sora:wght@400;500;600;700&family=Manrope:wght@400;500;600;700&family=Poppins:wght@400;500;600;700&family=Nunito+Sans:wght@400;500;600;700&family=Figtree:wght@400;500;600;700&display=swap" rel="stylesheet" />
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

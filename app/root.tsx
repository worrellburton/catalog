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

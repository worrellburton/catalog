import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { remixDevTools } from "remix-development-tools";
import { copyFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const isProduction = process.env.NODE_ENV === "production";
const rawBase = process.env.NEXT_PUBLIC_BASE_PATH || "";
const basePath = rawBase ? `${rawBase}/` : "/";

// Surface the deployed git SHA into the bundle so the ErrorBoundary
// diagnostic can show the exact commit when a user reports a bug.
// Vercel sets VERCEL_GIT_COMMIT_SHA at build time. Without re-export,
// Vite's envPrefix gate would hide it from the client bundle.
const COMMIT_SHA =
  process.env.VITE_VERCEL_GIT_COMMIT_SHA
  ?? process.env.VERCEL_GIT_COMMIT_SHA
  ?? "dev";

export default defineConfig({
  base: basePath,
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  define: {
    "import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA": JSON.stringify(COMMIT_SHA),
  },
  // ESBuild minification config — preserves function names and avoids
  // the transformation that breaks function-declaration hoisting in
  // production. Without these, large route files (e.g. admin/catalogs.tsx,
  // admin/data.tsx) where the default export references helper
  // components defined later in the same file would convert into a
  // chunk that initialises components in declaration order and throws
  // "Cannot access 'X' before initialization" (TDZ) when React tries
  // to render the default export before the helpers have initialised.
  esbuild: {
    keepNames: true,
  },
  build: {
    // Switch minifier from esbuild's aggressive default to terser with
    // hoist_funs enabled. Terser hoists function declarations BACK to
    // the top of their scope after minification, preserving the
    // semantics dev mode relies on.
    minify: "terser",
    terserOptions: {
      compress: {
        hoist_funs: true,
        inline: 1,
        // Strip console.* and debugger calls from production bundles.
        // Dev-only logs in services + a handful of console.warn fallbacks
        // were shipping to every visitor; gone now.
        drop_console: ["log", "debug", "info"],
        drop_debugger: true,
      },
      mangle: {
        // Preserve function names so error stacks are readable AND so
        // the React DevTools / profiler can identify components.
        keep_fnames: true,
      },
      format: {
        comments: false,
      },
    },
    rollupOptions: {
      output: {
        // Hoisting transitive imports into the entry chunk can cause
        // the same TDZ class: a transitive dep referenced before its
        // chunk has initialised. Disabling guarantees a chunk only
        // sees bindings from chunks it has DIRECTLY imported, which
        // load first.
        hoistTransitiveImports: false,
        // Tighter chunking — without this the server-build chunk was
        // shipping ~1.6 MB because admin / deck / wallet code rolled
        // into the shared graph. Lifting each heavy surface into its
        // own chunk means the consumer first-paint only pulls the
        // bare app shell + whichever lazy() route the user opened.
        manualChunks(id: string) {
          // Pin React + ReactDOM + scheduler into one stable vendor chunk.
          // Without this, Rollup floats them into whichever feature chunk
          // (admin / deck / …) its shared-dependency math picks, and adding a
          // route that bridges chunks (e.g. a public deck link) re-splits
          // them across the admin/deck boundary — the admin chunk then
          // requires React from a not-yet-loaded lazy chunk and the whole
          // SPA fails to mount. A dedicated vendor chunk keeps React in one
          // place that always loads first, regardless of route changes.
          if (id.includes('node_modules/react/')
              || id.includes('node_modules/react-dom/')
              || id.includes('node_modules/scheduler/')) return 'react-vendor';
          if (id.includes('/routes/admin/')) return 'admin';
          if (id.includes('/components/DeckView') || id.includes('/components/deck')) return 'deck';
          if (id.includes('/components/CreatorWallet')) return 'wallet';
          if (id.includes('/components/MyLooks')
              || id.includes('/components/CreateLookV2')
              || id.includes('/components/AddProductV2')) return 'creator-studio';
          return undefined;
        },
      },
    },
  },
  plugins: [
    // Dev-only Remix DevTools panel. Guarded by isProduction so it can
    // never participate in the Vercel build; must precede remix().
    ...(isProduction ? [] : [remixDevTools({ suppressDeprecationWarning: true })]),
    remix({
      ssr: false,
      basename: basePath,
      ignoredRouteFiles: ["routes/admin/**"],
      routes(defineRoutes) {
        return defineRoutes((route) => {
          // Root index
          route("", "routes/_index.tsx", { index: true });

          // Shareable deep-links. All three re-export _index so the
          // home component mounts; Index reads useParams() to decide
          // whether to open a product / look / brand modal on top.
          route("p/:slug", "routes/p.$slug.tsx");
          route("l/:slug", "routes/l.$slug.tsx");
          route("b/:slug", "routes/b.$slug.tsx");
          // Comment thread page: /comments/p/<slug> or /comments/l/<slug>.
          route("comments/:type/:slug", "routes/comments.$type.$slug.tsx");
          // Insights / earnings deep-link. Re-exports _index so the
          // home feed mounts; _index detects /earnings and opens the
          // wallet overlay. Real history entry → browser back returns
          // to the user's prior in-app screen, not an external page.
          route("earnings", "routes/earnings.tsx");

          // Public, unguessable share link for the short deck (deck is lazy;
          // React is pinned to react-vendor so this can't re-split React).
          route("deck-9f4k2x7m3q8", "routes/deck-public.tsx");

          // Admin routes
          route("admin", "routes/admin/route.tsx", () => {
            route("", "routes/admin/_index.tsx", { index: true });
            route("activities", "routes/admin/activities.tsx");
            route("administrators", "routes/admin/administrators.tsx");
            route("advertisements", "routes/admin/advertisements.tsx");
            route("agents", "routes/admin/agents.tsx");
            route("analytics", "routes/admin/analytics.tsx");
            route("apis", "routes/admin/apis.tsx");
            route("appearance", "routes/admin/appearance.tsx");
            route("audiences", "routes/admin/audiences.tsx");
            route("brands", "routes/admin/brands.tsx");
            route("campaigns", "routes/admin/campaigns.tsx");
            route("categories", "routes/admin/categories.tsx");
            route("clickouts", "routes/admin/clickouts.tsx");
            route("comments", "routes/admin/comments.tsx");
            // /admin/content renamed to /admin/data — file moved with
            // git mv, but the legacy URL still resolves so bookmarks
            // / muscle memory / old cmd-K hits don't 404. Remix
            // requires a unique route id when two paths share a file,
            // hence the explicit id on the alias.
            route("content", "routes/admin/data.tsx", { id: "admin/content-legacy" });
            route("data", "routes/admin/data.tsx");
            route("ai-users", "routes/admin/ai-users.tsx");
            route("dials", "routes/admin/dials.tsx");
            route("creators", "routes/admin/creators.tsx");
            route("creators/:name", "routes/admin/creators.$name.tsx");
            route("earnings", "routes/admin/earnings.tsx");
            route("finance", "routes/admin/finance.tsx");
            route("fundraising", "routes/admin/fundraising.tsx");
            route("model", "routes/admin/model.tsx");
            route("model/opex", "routes/admin/model.opex.tsx");
            route("metrics/:id", "routes/admin/metrics.$id.tsx");
            route("projections", "routes/admin/projections.tsx");
            route("creative", "routes/admin/creative.tsx");
            route("catalogs", "routes/admin/catalogs.tsx");
            route("catalogs/:slug", "routes/admin/catalogs.$slug.tsx");
            route("branding", "routes/admin/branding.tsx");
            route("ui", "routes/admin/ui.tsx", () => {
              route("", "routes/admin/ui._index.tsx", { index: true });
              route("brand", "routes/admin/ui.brand.tsx");
              route("search-bar", "routes/admin/ui.search-bar.tsx");
            });
            route("decks", "routes/admin/decks.tsx", () => {
              route("", "routes/admin/decks._index.tsx", { index: true });
              route(":version", "routes/admin/decks.$version.tsx");
            });
            route("incoming-creators", "routes/admin/incoming-creators.tsx");
            route("incoming-looks", "routes/admin/incoming-looks.tsx");
            route("links", "routes/admin/links.tsx");
            route("affiliate", "routes/admin/affiliate.tsx");
            route("affiliate-com", "routes/admin/affiliate-com.tsx");
            route("looks", "routes/admin/looks.tsx");
            route("publish/:id", "routes/admin/publish.$id.tsx");
            route("moderation", "routes/admin/moderation.tsx");
            route("musics", "routes/admin/musics.tsx");
            route("pages", "routes/admin/pages.tsx");
            route("places", "routes/admin/places.tsx");
            route("products", "routes/admin/products.tsx");
            route("prompts", "routes/admin/prompts.tsx");
            route("reports", "routes/admin/reports.tsx");
            route("revenue", "routes/admin/revenue.tsx");
            route("ai-models", "routes/admin/ai-models.tsx");
            route("ai-usage", "routes/admin/ai-usage.tsx");
            route("product-ads", "routes/admin/product-ads.tsx");
            route("search", "routes/admin/search.tsx");
            route("settings", "routes/admin/settings.tsx");
            route("sharing", "routes/admin/sharing.tsx");
            route("splash", "routes/admin/splash.tsx");
            route("shoppers", "routes/admin/shoppers.tsx");
            route("video-generation", "routes/admin/video-generation.tsx");
            route("whats-new", "routes/admin/whats-new.tsx");
            route("shoppers/:name", "routes/admin/shoppers.$name.tsx");
            route("shoppers-waitlist", "routes/admin/shoppers-waitlist.tsx");
            route("signup-links", "routes/admin/signup-links.tsx");
            route("site-crawls", "routes/admin/site-crawls.tsx");
            route("users", "routes/admin/users.tsx");
            route("user/:name", "routes/admin/user.$name.tsx");
            route("brand/:name", "routes/admin/brand.$name.tsx");
          });
        });
      },
      buildEnd(args) {
        if (!isProduction) return;
        const clientDir = args.remixConfig.buildDirectory + "/client";
        copyFileSync(
          join(clientDir, "index.html"),
          join(clientDir, "404.html")
        );
        writeFileSync(join(clientDir, ".nojekyll"), "");
      },
    }),
    tsconfigPaths(),
  ],
});

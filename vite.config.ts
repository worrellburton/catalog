import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { copyFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const isProduction = process.env.NODE_ENV === "production";
const rawBase = process.env.NEXT_PUBLIC_BASE_PATH || "";
const basePath = rawBase ? `${rawBase}/` : "/";

export default defineConfig({
  base: basePath,
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  plugins: [
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
            route("looks", "routes/admin/looks.tsx");
            route("publish/:id", "routes/admin/publish.$id.tsx");
            route("moderation", "routes/admin/moderation.tsx");
            route("musics", "routes/admin/musics.tsx");
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
            route("shoppers", "routes/admin/shoppers.tsx");
            route("video-generation", "routes/admin/video-generation.tsx");
            route("whats-new", "routes/admin/whats-new.tsx");
            route("shoppers/:name", "routes/admin/shoppers.$name.tsx");
            route("shoppers-waitlist", "routes/admin/shoppers-waitlist.tsx");
            route("signup-links", "routes/admin/signup-links.tsx");
            route("site-crawls", "routes/admin/site-crawls.tsx");
            route("users", "routes/admin/users.tsx");
            route("user/:name", "routes/admin/user.$name.tsx");
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

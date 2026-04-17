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
      ignoredRouteFiles: ["routes/admin/**", "routes/partners/**"],
      routes(defineRoutes) {
        return defineRoutes((route) => {
          // Root index
          route("", "routes/_index.tsx", { index: true });

          // Admin routes
          route("admin", "routes/admin/route.tsx", () => {
            route("", "routes/admin/_index.tsx", { index: true });
            route("activities", "routes/admin/activities.tsx");
            route("administrators", "routes/admin/administrators.tsx");
            route("advertisements", "routes/admin/advertisements.tsx");
            route("appearance", "routes/admin/appearance.tsx");
            route("audiences", "routes/admin/audiences.tsx");
            route("brands", "routes/admin/brands.tsx");
            route("campaigns", "routes/admin/campaigns.tsx");
            route("categories", "routes/admin/categories.tsx");
            route("clickouts", "routes/admin/clickouts.tsx");
            route("content", "routes/admin/content.tsx");
            route("creators", "routes/admin/creators.tsx");
            route("creators/:name", "routes/admin/creators.$name.tsx");
            route("earnings", "routes/admin/earnings.tsx");
            route("incoming-creators", "routes/admin/incoming-creators.tsx");
            route("incoming-looks", "routes/admin/incoming-looks.tsx");
            route("links", "routes/admin/links.tsx");
            route("looks", "routes/admin/looks.tsx");
            route("moderation", "routes/admin/moderation.tsx");
            route("musics", "routes/admin/musics.tsx");
            route("places", "routes/admin/places.tsx");
            route("products", "routes/admin/products.tsx");
            route("reports", "routes/admin/reports.tsx");
            route("revenue", "routes/admin/revenue.tsx");
            route("ai-models", "routes/admin/ai-models.tsx");
            route("product-ads", "routes/admin/product-ads.tsx");
            route("search", "routes/admin/search.tsx");
            route("settings", "routes/admin/settings.tsx");
            route("shoppers", "routes/admin/shoppers.tsx");
            route("video-generation", "routes/admin/video-generation.tsx");
            route("shoppers/:name", "routes/admin/shoppers.$name.tsx");
            route("shoppers-waitlist", "routes/admin/shoppers-waitlist.tsx");
            route("signup-links", "routes/admin/signup-links.tsx");
            route("site-crawls", "routes/admin/site-crawls.tsx");
            route("users", "routes/admin/users.tsx");
            route("user/:name", "routes/admin/user.$name.tsx");
          });

          // Partners routes
          route("partners", "routes/partners/route.tsx", () => {
            route("", "routes/partners/_index.tsx", { index: true });
            route("appearance", "routes/partners/appearance.tsx");
            route("audience", "routes/partners/audience.tsx");
            route("campaigns", "routes/partners/campaigns.tsx");
            route("collections", "routes/partners/collections.tsx");
            route("creative", "routes/partners/creative.tsx");
            route("growth", "routes/partners/growth.tsx");
            route("orders", "routes/partners/orders.tsx");
            route("products", "routes/partners/products.tsx");
            route("store", "routes/partners/store.tsx");
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

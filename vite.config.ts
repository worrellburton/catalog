import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { copyFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const isProduction = process.env.NODE_ENV === "production";

export default defineConfig({
  base: "/catalog/",
  plugins: [
    remix({
      ssr: false,
      basename: "/catalog/",
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

# HANDOFF — catalog work session

> Paste-ready context to continue a long in-progress session. Read this top to
> bottom, then check `git log` on `dev` for specifics.

## Where things stand
- **All work is merged to `dev`** (tip `652969e` at handoff). The session branch
  `claude/focused-pasteur-n2ltvi` == `dev`.
- Branch model: `dev` → `staging` → `main`. `main` / `catalog.shop` is
  production and does **not** yet have most of this work.
- Stack: **Remix v2 in SPA mode (`ssr:false`)** + Vite, React 19, Supabase,
  Vercel.

## Shipped & merged to `dev` this session
- `fix(feed)` mobile video pool sized from the *measured* live tile (creator
  catalog tiles were stuck on poster at 3 columns) — `video-playback-director.ts`.
- Product **"Similar" rail snaps to exactly 6 or 8** (tops up from popular when
  the similarity RPC is sparse) — `ProductPage.tsx`.
- Look overlay desktop **info panel centered as one balanced group** — `look-overlay.css`.
- **Architecture-shaped loading skeletons** for the product page and look overlay
  (mirror the page's sections; the look one is cold-open-only so it never dulls
  the warm feed→look hero morph).
- **Hero search bar** (desktop = TypeAnywhere `.ai-bar-wrap`, NOT BottomBar):
  fixed a 2px headline overlap → even spacing, + glassier pill (`home-hero.css`,
  `type-anywhere.css`).
- **Search ceremony "Option 1"**: catalog picks render as an in-flow strip ABOVE
  the continuous results feed (one scroll); "Continue with <query>" is a matching
  pill (`SearchCeremony.tsx`, new `SearchCatalogStrip.tsx`, `_index.tsx`).
- **Particle fields → 3D depth + load fade-in everywhere**, then a denser/finer
  **"Mercury starfield"** density tune (`ParticleBackground.tsx`,
  `home/FeedParticles.tsx`, `CommentParticles.tsx`).
- **Barcode** (ASIN/UPC/GTIN): `products.barcode` + `barcode_type` migration,
  scraper extraction (`agents/product-scraper/agent.py` schema + `modal_app.py`
  ASIN-from-URL fallback), admin Data-table column.
- **Haiku-context recurring backfill cron** migration (so `haiku_context` stops
  stalling on "pending").
- **Clerk auth migration scaffolding**, flag-gated and **fully inert until
  `VITE_CLERK_PUBLISHABLE_KEY` is set** (tree-shaken when unset). Uses
  `@clerk/clerk-react` (NOT `@clerk/remix`, because the app is an SPA):
  - Phase 0 `ClerkGate` (root provider), Phase 1 `/sign-in` + `/sign-up` +
    `ClerkSignInGate` gate cutover, Phase 3 user export/import toolkit
    (`scripts/clerk-migration/`), Phase 4 `supabase/functions/clerk-webhook` +
    `clerk_auth_profiles` migration, Phase 5 catalog-server spec
    (`scripts/clerk-migration/PHASE-5-catalog-server.md`).

## OUTSTANDING (needs the user / not doable from the agent sandbox)
1. **Apply 2 migrations** — ✅ DONE (2026-06-18) via the pre-authed
   `Supabase_Catalog` MCP `apply_migration` (the OAuth `supabase` server still
   doesn't persist here, but `Supabase_Catalog` is token-authed). Applied +
   verified live: `20260618010000_products_barcode.sql` (products.barcode /
   barcode_type / products_barcode_idx) and `20260618000000_haiku_context_
   backfill_cron.sql` (run_haiku_context_backfill + cron `*/10 * * * *`).
   `20260617000000_clerk_auth_profiles.sql` was correctly NOT applied (still
   Clerk-cutover-gated). NOTE: the haiku cron now spends Haiku-vision $ every
   10 min while products lack context — throttle the cadence/batch in that
   migration if spend is a concern.
2. **Redeploy the Modal scraper** (`agents/product-scraper`) so barcodes populate.
3. **Clerk Phase 2** (Supabase third-party auth + RLS): enable Clerk as a
   Supabase third-party provider; add session-token claims
   `app_uid = {{user.external_id}}` + `role:"authenticated"`; rewrite the ~180
   `auth.uid()` RLS policies → `auth.jwt()->>'app_uid'`. **Linchpin:** Clerk
   `external_id` = the user's existing Supabase UUID, so RLS / profiles / FKs
   keep matching with no re-key. Cutover-coordinated — applying RLS early breaks
   live Supabase sessions.
4. **Clerk Phase 6**: Flutter shell session bridge (separate `catalog-flutter` repo).
5. Turn Clerk on: set `VITE_CLERK_PUBLISHABLE_KEY` (dev first); dashboard enable
   Google + phone, account linking, Paths `/sign-in` + `/sign-up`; prod Google
   OAuth creds; DNS for `clerk.catalog.shop` (catalog.shop DNS is Vercel-hosted →
   add CNAMEs at Vercel **team** Domains, not the project tab).

## CRITICAL environment gotchas
- **WebGL does not render in the agent sandbox** — particle fields can't be
  visually verified there (hero renders gray). Verify particle look on dev.
- **Supabase MCP OAuth does not persist across turns** in the web/remote agent —
  `authenticate`→`complete_authentication` fails "no OAuth flow in progress".
  Apply migrations via the SQL Editor instead.
- The agent **can't play video files** (no decoder / no ffmpeg). Share visual
  references as **still images / screenshots**.
- Repo has **both `package-lock.json` and `yarn.lock`**; a lint-staged hook
  rewrites `yarn.lock` on package.json changes — discard that churn (builds use npm).
- Desktop hero search bar = `.ai-bar-wrap` (TypeAnywhere); `.bottom-bar` is
  `display:none` on desktop. Particle components: `ParticleBackground` (shared
  AI-diamond field), `FeedParticles` (2D popup), `CommentParticles` (avatars).

## Possible next polish
- Verify particles on dev; may want milky-way **clustering** to match the Mercury
  reference more closely.
- ~~Optionally bump the mobile BottomBar glass to match the desktop bar.~~
  ✅ DONE (2026-06-18) — `.bottom-bar` now mirrors the desktop `.ai-bar` glass
  recipe (sheen over tinted dark base, blur(30) saturate(1.8), deeper shadow +
  brighter top rim); `:focus-within` bumped to stay an escalation. Centering
  GUARD block untouched. Verify the look on dev/mobile.

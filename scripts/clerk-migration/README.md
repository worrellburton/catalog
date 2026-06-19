# Clerk user migration (Phase 3)

Moves existing **Supabase auth users → Clerk** while keeping every user visible
in the admin panel and every existing row tied to its owner.

## The one idea that makes this safe

Everything in the app is keyed by the **Supabase user UUID** — `profiles.id`,
`looks.user_id`, `user_generations`, `creator_follows`, `earnings`, and RLS via
`auth.uid()`. We do **not** re-key any of that. Instead:

1. Each Clerk user is created with **`external_id` = the old Supabase UUID**.
2. The Clerk → Supabase JWT (Phase 2) is configured so the token subject
   resolves back to that UUID.

So `auth.uid()` is unchanged after cutover: existing data keeps matching, and the
admin user list (which reads `profiles`) keeps working with **zero data
migration**.

## Prerequisites

- `.env.local` at the repo root with `CLERK_SECRET_KEY` (the `sk_…` secret — the
  **server** key, never the publishable key).
- Node 18+ (repo runs 22). No `npm install` needed — the import uses built-in
  `fetch`.

## Steps

### 1. Export Supabase users
Run [`01-export-users.sql`](./01-export-users.sql) in the Supabase SQL editor (or
via the Supabase MCP `execute_sql`). Save the single JSON value from the result
to `scripts/clerk-migration/users-export.json`.

> This file contains emails and bcrypt password digests. It is git-ignored —
> keep it off any shared drive and delete it once the import is verified.

### 2. Dry-run the import
```bash
node scripts/clerk-migration/02-import-to-clerk.mjs --dry-run --limit 5
```
Confirms the payloads look right (passwords show as `<bcrypt>`, never printed).

### 3. Import for real
```bash
node scripts/clerk-migration/02-import-to-clerk.mjs --limit 25   # canary batch
node scripts/clerk-migration/02-import-to-clerk.mjs              # the rest
```
- **Idempotent / resumable.** Progress is written to `import-results.json`;
  re-running skips users already created (matched by `external_id`, locally or by
  querying Clerk).
- **Passwords carry over.** Supabase bcrypt digests import as-is
  (`password_hasher: bcrypt`), so password users never reset.
- **OAuth users** (Google, etc.) are created passwordless. On first sign-in Clerk
  links the provider by matching the email, and `external_id` keeps them tied to
  all their existing data.

### 4. Verify
- `created + skipped` ≈ exported row count; investigate any `failed` (reasons are
  in `import-results.json`).
- Spot-check a few users in the Clerk Dashboard and confirm **External ID**
  equals the Supabase UUID.

## Clerk dashboard settings to check

- **Account linking:** enable "merge/link accounts with the same email" so an
  imported password user and their Google sign-in resolve to one account.
- **Email verification:** Backend-API-created emails may import unverified.
  OAuth sign-in verifies via the provider; for password users decide whether to
  require verification or trust the migrated `email_verified` flag.

## What this does NOT do (other phases)

- **Phase 2 — Supabase third-party auth:** make Supabase accept Clerk's JWT (so
  the `external_id`→`auth.uid()` mapping is live). Without it the imported
  `external_id` isn't yet wired to RLS.
- **Phase 4 — admin stays current (built):**
  [`supabase/functions/clerk-webhook`](../../supabase/functions/clerk-webhook/index.ts)
  upserts `profiles` on `user.created/updated/deleted` (so new signups appear in
  admin), keyed by `id` = `external_id`. Its schema prep is
  [`20260617000000_clerk_auth_profiles.sql`](../../supabase/migrations/20260617000000_clerk_auth_profiles.sql)
  (drops the `profiles.id → auth.users` FK, adds `clerk_user_id`). Deploy the
  function with `--no-verify-jwt` and set `CLERK_WEBHOOK_SECRET` +
  `CLERK_SECRET_KEY`.
- **Phase 2 — Supabase third-party auth (not built):** add the custom
  `app_uid = {{user.external_id}}` + `role: "authenticated"` session-token
  claims in Clerk, register Clerk as a Supabase third-party provider, and swap
  RLS from `auth.uid()` to `auth.jwt()->>'app_uid'`. Ships **at cutover** —
  changing RLS earlier breaks live Supabase sessions.
- **Phases 5–6:** catalog-server (Auth0/JWT → Clerk verify) and the Flutter
  shell session bridge live in other repos.

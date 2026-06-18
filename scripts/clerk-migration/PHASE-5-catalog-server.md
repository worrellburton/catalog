# Phase 5 — catalog-server: Auth0/JWT → Clerk

Migrates the Express + Sequelize + MySQL backend (`catalog-server`,
`/api` + `/api/campaigns`) off Auth0/JWT bearer auth onto Clerk session-token
verification, while keeping the existing role model and every `user_id`
relationship intact.

> This repo (`catalog`) does not contain catalog-server — apply these changes
> there. Same invariant as the rest of the migration: a user's identity key
> never changes, so all existing rows keep matching.

## The invariant (same as Phases 3–4)

Clerk users carry `external_id` = the user's **existing id** (the Supabase UUID
for shared accounts; or the legacy MySQL `User.id`). The backend looks users up
by that mapping, so no FK or row needs re-keying.

## Steps

### 1. Dependencies + env
```bash
npm i @clerk/backend
```
Env (alongside the existing `JWT_SECRET`, Auth0 vars):
```
CLERK_SECRET_KEY=sk_live_…          # server secret
CLERK_PUBLISHABLE_KEY=pk_live_…
CLERK_JWT_KEY=…                     # PEM for networkless verifyToken (Clerk dashboard → API keys)
CLERK_AUTHORIZED_PARTIES=https://catalog.shop,https://api.shopcatalog.app
```

### 2. Schema — map Clerk → MySQL `User`
Add a nullable, unique `clerk_user_id` (and `external_id` if not already the PK)
so the webhook + verify can resolve a Clerk token to a row:
```sql
ALTER TABLE User ADD COLUMN clerk_user_id VARCHAR(64) NULL,
  ADD UNIQUE INDEX user_clerk_user_id_uniq (clerk_user_id);
-- external_id holds the user's canonical id (Supabase UUID / legacy id) so
-- Clerk's external_id claim resolves here. If User.id already IS that id, skip.
ALTER TABLE User ADD COLUMN external_id VARCHAR(64) NULL,
  ADD INDEX user_external_id_idx (external_id);
```
Backfill `external_id` from the existing id, and `clerk_user_id` from the Clerk
import results (`scripts/clerk-migration/import-results.json` maps
supabase_id → clerk_id; for MySQL-origin users, map by email).

### 3. Auth middleware — verify Clerk, map to `User`
Replace the token check in `src/server/auth.ts` (`authorizeRequest`). Verify the
Clerk session token, then resolve the local user by `external_id` (the claim),
falling back to `clerk_user_id` (= token `sub`):
```ts
import { verifyToken } from '@clerk/backend';

async function resolveClerkUser(req): Promise<User | null> {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!token) return null;
  const claims = await verifyToken(token, {
    secretKey: process.env.CLERK_SECRET_KEY,
    authorizedParties: (process.env.CLERK_AUTHORIZED_PARTIES || '').split(','),
  });
  // app_uid = {{user.external_id}} custom claim (set in the Clerk dashboard,
  // same claim Phase 2 adds for Supabase). sub = clerk user id.
  const externalId = (claims as any).app_uid as string | undefined;
  const clerkId = claims.sub;
  return (externalId && await User.findOne({ where: { external_id: externalId } }))
      || (await User.findOne({ where: { clerk_user_id: clerkId } }))
      || null;
}
```
- Keep the **role model unchanged** (`authorizeAdminRequest`,
  `authorizeSuperAdminOrBrandAdminRequest`, `authorizeBrandUserRequest`, …):
  they just read the role off the `User` row `resolveClerkUser` returns.
- `authorizeBrandUserRequest`: same flow; brand membership still comes from
  `BrandUser` keyed by the resolved `User.id`.

### 4. Dual-auth during cutover (zero-downtime)
Verify **Clerk first, fall back to the legacy Auth0/JWT path** so old tokens
keep working until clients ship Clerk:
```ts
const user = await resolveClerkUser(req) ?? await legacyVerify(req);
if (!user) return res.status(401).json({ success:false, error:'Unauthorized' });
req.user = user;
```
Remove `legacyVerify` once all clients (partners portal, mobile, admin) send
Clerk tokens.

### 5. Keep `User` in sync — Clerk webhook
Mirror the Supabase `clerk-webhook` (Phase 4) with an Express route
(`POST /api/internal/clerk-webhook`, svix-verified) that upserts/deletes the
MySQL `User` on `user.created/updated/deleted`, setting `clerk_user_id` and
`external_id`. For native signups with no `external_id`, mint one (or reuse the
new `User.id`) and PATCH it back to Clerk — identical to the Supabase webhook.

### 6. Token source on the clients
The partners portal currently stores its own JWT and sends
`Authorization: Bearer <jwt>`. Switch it to Clerk's session token
(`getToken()`), sent on the same header. The login endpoints under
`/api/campaigns/auth/*` are replaced by Clerk's sign-in.

## Files to touch (per CLAUDE.md §4)
- `src/server/auth.ts` — `authorizeRequest` + the role middlewares.
- `src/server/middlewares/` — any token-extraction helper.
- `src/server/models/sequelize/` — `User` (+ migration).
- `src/server/routes/` — add the internal Clerk webhook route.
- Brand auth path (`authorizeBrandUserRequest`) — same `resolveClerkUser`.

## Order of operations
1. Add `clerk_user_id` / `external_id` columns + backfill.
2. Ship dual-auth (Clerk + legacy).
3. Stand up the Clerk webhook.
4. Flip clients to Clerk tokens.
5. Remove the legacy Auth0/JWT path + `/auth/*` login endpoints.

-- scripts/clerk-migration/01-export-users.sql
--
-- Phase 3, step 1 — export every Supabase auth user into the shape Clerk's
-- import expects. Run this in Supabase (SQL editor, or the MCP execute_sql)
-- and save the single JSON value in the result to:
--     scripts/clerk-migration/users-export.json
--
-- THE LINCHPIN: each user's Supabase UUID is exported as `supabase_id` and the
-- import script feeds it to Clerk as `external_id`. The Clerk->Supabase JWT is
-- then configured so the token subject resolves back to that same UUID, so
-- `auth.uid()` is unchanged after cutover — every existing row (profiles.id,
-- looks.user_id, user_generations, creator_follows, earnings, …) keeps matching
-- its owner and the admin user list keeps working with ZERO data migration.
--
-- Password hashes (encrypted_password) are only readable via SQL like this, not
-- the admin REST API — which is why export is a query, not a script. The output
-- contains PII + bcrypt digests: keep users-export.json out of git (see
-- .gitignore) and delete it once the import is verified.

select coalesce(jsonb_agg(to_jsonb(u) order by u.created_at), '[]'::jsonb) as users
from (
  select
    au.id::text                              as supabase_id,
    lower(au.email)                          as email,
    (au.email_confirmed_at is not null)      as email_verified,
    -- bcrypt digest for password users; null for OAuth-only accounts.
    nullif(au.encrypted_password, '')        as password_bcrypt,
    -- e.g. ["google"], ["email"], ["google","email"] — drives how the import
    -- treats the account (password vs. passwordless/OAuth-linked-on-first-login).
    coalesce(
      (select array_agg(distinct i.provider order by i.provider)
         from auth.identities i
        where i.user_id = au.id),
      array[]::text[]
    )                                        as providers,
    au.created_at,
    au.last_sign_in_at,
    (au.banned_until is not null and au.banned_until > now()) as banned
  from auth.users au
  where au.deleted_at is null
) u;

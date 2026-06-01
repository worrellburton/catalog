-- Bug: re-logging in (especially via OAuth) erased a user's uploaded avatar.
-- handle_auth_user_change fires on auth.users insert/update and runs
-- ON CONFLICT (id) DO UPDATE SET avatar_url = excluded.avatar_url,
-- which overwrote profiles.avatar_url with the OAuth provider's stale
-- picture URL (or NULL when the provider didn't return one) on every
-- re-login. Fix: only backfill avatar_url when profiles.avatar_url is
-- currently NULL — preserve any custom upload from then on. Same pattern
-- the function already uses for `gender`.
create or replace function public.handle_auth_user_change()
returns trigger language plpgsql security definer as $$
declare
  v_full_name text;
begin
  v_full_name := coalesce(
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    new.email
  );
  insert into public.profiles (id, email, full_name, avatar_url, provider, gender, created_at, last_sign_in_at)
  values (
    new.id,
    new.email,
    v_full_name,
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture'),
    coalesce(new.raw_app_meta_data->>'provider', 'email'),
    public.infer_user_gender_from_name(v_full_name),
    new.created_at,
    new.last_sign_in_at
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    -- Preserve user-uploaded avatars across re-logins. Only the very first
    -- backfill (when profiles.avatar_url is NULL) accepts the OAuth-provider
    -- value; subsequent re-logins keep whatever the user set.
    avatar_url = case
      when public.profiles.avatar_url is null then excluded.avatar_url
      else public.profiles.avatar_url
    end,
    provider = excluded.provider,
    last_sign_in_at = excluded.last_sign_in_at,
    gender = case
      when public.profiles.gender is null or public.profiles.gender = 'unknown'
        then public.infer_user_gender_from_name(excluded.full_name)
      else public.profiles.gender
    end;
  return new;
end;
$$;

-- Instagram / TikTok handles on the user profile. Shown on the creator's
-- public catalog (as linked icons) only when set. Edited from the Profile
-- page. RLS: the existing profiles_self_update policy (auth.uid() = id)
-- already lets a user write their own handles.
alter table public.profiles add column if not exists instagram_handle text;
alter table public.profiles add column if not exists tiktok_handle text;

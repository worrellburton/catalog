-- A user-defined "your style" descriptor (free text) that carries into
-- the Seedance video-generation prompt. Set on the Style page; read by
-- the /generate flow's buildGenerationPrompt so generated looks reflect
-- the user's personal aesthetic.
alter table public.profiles
  add column if not exists custom_style_prompt text;

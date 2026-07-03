-- Tap-to-answer suggestions attached to a stylist message: when the stylist's
-- brain asks a question it now also supplies 2-4 short answer options, so the
-- quick-reply chips are always relevant to the actual question.
alter table public.style_up_messages
  add column if not exists quick_replies jsonb;

-- The look_video_duration dial (dials.ts parseLookDuration) accepts any integer
-- in [LOOK_VIDEO_DURATION_MIN=4, LOOK_VIDEO_DURATION_MAX=12], but this CHECK only
-- allowed exactly {5,10}. Setting the dial to 6/7/8/9/11/12 therefore made every
-- StyleUp / generate render fail on INSERT
-- ("user_generations_duration_seconds_check"). Reconcile the constraint to the
-- dial's real range. All model paths in generate-look already clamp arbitrary
-- durations per model, and Seedance (5-12s) / Gemini (3-10s) accept this range.
alter table public.user_generations
  drop constraint if exists user_generations_duration_seconds_check;
alter table public.user_generations
  add constraint user_generations_duration_seconds_check
  check (duration_seconds is null or (duration_seconds >= 4 and duration_seconds <= 12));

-- Host edits of a huddle (PATCH /api/huddles/:id).
-- edited_at: last time the host changed title, description, intents or time.
-- rescheduled_at: last time the start time or length changed after the huddle was created;
-- cards show a "Rescheduled" badge while this is set.
alter table public.huddles
  add column if not exists edited_at timestamptz,
  add column if not exists rescheduled_at timestamptz;

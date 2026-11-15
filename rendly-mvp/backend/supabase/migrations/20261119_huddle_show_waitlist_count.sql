-- Host option: show how many people are on a huddle's waiting list to everyone (hosts always see it).
-- Apply in the Supabase SQL editor, then run: NOTIFY pgrst, 'reload schema';
ALTER TABLE huddles ADD COLUMN IF NOT EXISTS show_waitlist_count BOOLEAN NOT NULL DEFAULT false;

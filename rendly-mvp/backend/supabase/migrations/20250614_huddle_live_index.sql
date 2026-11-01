-- Partial index for list_live_huddles (20250614_huddle_lifecycle.sql).
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block. Run this file
-- on its own, outside any BEGIN/COMMIT, or the statement will fail.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_huddles_live_started_at
  ON huddles (started_at DESC)
  WHERE is_active AND started_at IS NOT NULL;

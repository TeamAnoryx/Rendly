-- Index 2 of 3 for 20250617_notifications_points_huddle_extras.sql.
-- Run as its own query (CONCURRENTLY cannot run inside a transaction block).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_points_ledger_user ON points_ledger (user_id, created_at DESC);

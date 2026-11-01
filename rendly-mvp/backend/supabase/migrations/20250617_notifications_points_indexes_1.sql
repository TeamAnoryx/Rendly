-- Index 1 of 3 for 20250617_notifications_points_huddle_extras.sql.
-- Run as its own query (CONCURRENTLY cannot run inside a transaction block).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_recent ON notifications (user_id, created_at DESC);

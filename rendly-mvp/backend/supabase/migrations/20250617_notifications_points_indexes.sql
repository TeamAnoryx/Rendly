-- Indexes for 20250617_notifications_points_huddle_extras.sql.
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block. Run this file
-- on its own, outside any BEGIN/COMMIT, after the extras migration.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_recent
  ON notifications (user_id, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_points_ledger_user
  ON points_ledger (user_id, created_at DESC);
-- One signup bonus per user, ever.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_points_signup_bonus
  ON points_ledger (user_id) WHERE reason = 'signup_bonus';

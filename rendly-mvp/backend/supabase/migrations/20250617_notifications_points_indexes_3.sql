-- Index 3 of 3 for 20250617_notifications_points_huddle_extras.sql: one signup bonus per user, ever.
-- Run as its own query (CONCURRENTLY cannot run inside a transaction block).
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_points_signup_bonus ON points_ledger (user_id) WHERE reason = 'signup_bonus';

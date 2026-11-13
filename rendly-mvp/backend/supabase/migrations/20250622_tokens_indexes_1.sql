-- Index 1 of 4 for the Rendly Tokens migrations (20250619 to 20250622). Run after 20250620_intents.sql.
-- Run as its own query (CONCURRENTLY cannot run inside a transaction block).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_intents_user_expires ON user_intents (user_id, expires_at);

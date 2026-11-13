-- Index 3 of 4 for the Rendly Tokens migrations (20250619 to 20250622): active seats per huddle (hot_huddles, award and send checks).
-- Run as its own query (CONCURRENTLY cannot run inside a transaction block).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_huddle_participants_active ON huddle_participants (huddle_id) WHERE left_at IS NULL;

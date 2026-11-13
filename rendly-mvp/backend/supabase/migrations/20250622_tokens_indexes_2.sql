-- Index 2 of 4 for the Rendly Tokens migrations (20250619 to 20250622): history lookups by counterparty.
-- Run as its own query (CONCURRENTLY cannot run inside a transaction block).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_points_ledger_counterparty ON points_ledger (counterparty_id) WHERE counterparty_id IS NOT NULL;

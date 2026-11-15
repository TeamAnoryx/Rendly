-- Spark deferred charge: per-user lookup of recent matches (rolling-window match limit and
-- spark_settle_pairing's latest-match read). Run alone, after 20261116_spark_deferred_charge.sql
-- (CREATE INDEX CONCURRENTLY cannot run inside a transaction or next to other statements).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_match_queue_user_matched_at
  ON match_queue (user_id, matched_at DESC) WHERE status = 'matched';

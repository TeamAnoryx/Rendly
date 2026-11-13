-- Spark v2: GIN index over the waiting rows' intents. Run alone, after 20250625_spark_v2.sql
-- (CREATE INDEX CONCURRENTLY cannot run inside a transaction or next to other statements).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_match_queue_waiting_intents
  ON match_queue USING gin (intents) WHERE status = 'waiting';

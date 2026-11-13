-- Spark v2: per-user lookup for the location-intent daily limit. Run alone, after
-- 20250625_spark_v2_index.sql (CREATE INDEX CONCURRENTLY cannot share a transaction).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_location_intent_creations_user
  ON location_intent_creations (user_id, created_at DESC);

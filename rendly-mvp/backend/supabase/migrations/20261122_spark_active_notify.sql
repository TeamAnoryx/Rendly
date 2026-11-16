-- Spark: live "N people on Spark now" count, and "notify me" requests for a push when Spark
-- gets busy. Run after 20261120_spark_default_match.sql. Safe to run more than once.
-- Then run: NOTIFY pgrst, 'reload schema';
-- Only the auth service (service role) calls the function or touches the table.

-- ---------------------------------------------------------------------------
-- spark_active_count: distinct users waiting in the queue (enqueued in the last 10 minutes)
-- plus users in a live pairing (matched in the last 30 minutes and not ended).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION spark_active_count()
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT count(DISTINCT user_id)::INTEGER FROM (
    SELECT user_id FROM match_queue
    WHERE status = 'waiting' AND enqueued_at > now() - interval '10 minutes'
    UNION
    SELECT user_id FROM match_queue
    WHERE status = 'matched' AND ended_at IS NULL
      AND matched_at > now() - interval '30 minutes'
  ) AS active;
$$;

REVOKE ALL ON FUNCTION spark_active_count() FROM PUBLIC;
REVOKE ALL ON FUNCTION spark_active_count() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION spark_active_count() TO service_role;

-- ---------------------------------------------------------------------------
-- spark_notify_requests: users who asked for a push once people are on Spark.
-- notified_at is set when a push is claimed for them; the row is then deleted.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS spark_notify_requests (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at TIMESTAMPTZ
);

ALTER TABLE spark_notify_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON spark_notify_requests FROM anon, authenticated;

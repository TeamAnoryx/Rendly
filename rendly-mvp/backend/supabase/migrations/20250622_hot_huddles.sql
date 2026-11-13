-- Hot huddles for the dashboard: live rooms first, then upcoming ones ranked by interest.
-- Run after 20250621_spark_custom_intents.sql. Safe to run more than once.

-- Upcoming scheduled huddles are a small, hot subset: index only them.
CREATE INDEX IF NOT EXISTS idx_huddles_upcoming ON huddles (scheduled_at)
  WHERE is_active AND started_at IS NULL AND cancelled_at IS NULL;

-- ---------------------------------------------------------------------------
-- hot_huddles: the viewer's top huddles.
-- Candidates: live huddles (same predicate and private-visibility rule as list_live_huddles,
-- plus cancelled_at IS NULL) and upcoming huddles (not started, not cancelled, scheduled within
-- the next 7 days). A private huddle is visible to its creator, to admitted participants and
-- to invitees only.
-- score = 100*live + 10*participants + 5*invites + 3*visits_24h + 2*joins_24h
--       + (upcoming ? 40 * (1 - seconds_until_start / 604800) : 0)
-- Ordered by score DESC, live first, soonest start first. Limit clamped to 1..20 (default 5).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hot_huddles(p_viewer_id UUID, p_limit INT)
RETURNS TABLE (
  id UUID, score NUMERIC, is_live BOOLEAN, participants_count INT, invites_count INT,
  visits_24h INT, joins_24h INT, starts_in_seconds INT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH candidates AS (
    SELECT h.id,
           (h.started_at IS NOT NULL) AS is_live,
           CASE WHEN h.started_at IS NULL
                THEN GREATEST(0, EXTRACT(EPOCH FROM (h.scheduled_at - now())))::INT
           END AS starts_in_seconds
    FROM huddles h
    WHERE h.is_active
      AND h.cancelled_at IS NULL
      AND (
        -- live: started and not yet over
        (h.started_at IS NOT NULL
         AND (h.ended_at IS NULL OR h.ended_at > now())
         AND (h.duration_minutes IS NULL
              OR h.started_at + make_interval(mins => h.duration_minutes) > now()))
        OR
        -- upcoming: scheduled within the next 7 days, not started
        (h.started_at IS NULL
         AND h.scheduled_at IS NOT NULL
         AND h.scheduled_at > now()
         AND h.scheduled_at <= now() + interval '7 days')
      )
      AND (
        h.type <> 'private'
        OR h.created_by = p_viewer_id
        OR EXISTS (SELECT 1 FROM huddle_invites i WHERE i.huddle_id = h.id AND i.invitee_id = p_viewer_id)
        OR EXISTS (SELECT 1 FROM huddle_participants p
                   WHERE p.huddle_id = h.id AND p.user_id = p_viewer_id AND p.left_at IS NULL AND p.admitted)
      )
  ),
  scored AS (
    SELECT c.id, c.is_live, c.starts_in_seconds,
           (SELECT count(*) FROM huddle_participants p
            WHERE p.huddle_id = c.id AND p.left_at IS NULL AND p.admitted)::INT AS participants_count,
           (SELECT count(*) FROM huddle_invites i WHERE i.huddle_id = c.id)::INT AS invites_count,
           (SELECT count(*) FROM huddle_events e
            WHERE e.huddle_id = c.id AND e.kind = 'visit' AND e.created_at > now() - interval '24 hours')::INT AS visits_24h,
           (SELECT count(*) FROM huddle_events e
            WHERE e.huddle_id = c.id AND e.kind = 'join' AND e.created_at > now() - interval '24 hours')::INT AS joins_24h
    FROM candidates c
  )
  SELECT s.id,
         round((
           (CASE WHEN s.is_live THEN 100 ELSE 0 END)
           + 10 * s.participants_count
           + 5 * s.invites_count
           + 3 * s.visits_24h
           + 2 * s.joins_24h
           + (CASE WHEN s.is_live THEN 0
                   ELSE 40 * (1 - LEAST(s.starts_in_seconds, 604800)::numeric / 604800) END)
         )::numeric, 3) AS score,
         s.is_live, s.participants_count, s.invites_count, s.visits_24h, s.joins_24h, s.starts_in_seconds
  FROM scored s
  ORDER BY score DESC, s.is_live DESC, s.starts_in_seconds ASC NULLS LAST, s.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 5), 1), 20);
$$;

REVOKE ALL ON FUNCTION hot_huddles(UUID, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION hot_huddles(UUID, INT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION hot_huddles(UUID, INT) TO service_role;

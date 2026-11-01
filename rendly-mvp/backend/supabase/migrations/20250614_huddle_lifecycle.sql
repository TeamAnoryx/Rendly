-- Huddle lifecycle: start on first join, enforce duration, free seats on leave,
-- and list live huddles in SQL so the live set is never cut off by a row limit.
-- Run after 20250613_huddle_join_and_rls.sql.
--
-- A huddle is live from its first join (started_at) until the earlier of
--   started_at + duration_minutes  (when duration_minutes is set), and
--   ended_at                       (when set).
-- A huddle with no duration and no ended_at stays live until it is closed.

-- ---------------------------------------------------------------------------
-- join_huddle: replaces the 20250613 version.
-- The first successful join sets started_at. Joins after the end time are refused.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION join_huddle(p_huddle_id UUID, p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_huddle huddles%ROWTYPE;
  v_active_count INT;
  v_now TIMESTAMPTZ := now();
BEGIN
  -- Row lock: the end-time check, the capacity check, the start and the insert
  -- cannot interleave with another join or leave on the same huddle.
  SELECT * INTO v_huddle FROM huddles WHERE id = p_huddle_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  IF NOT v_huddle.is_active THEN
    RETURN 'ended';
  END IF;
  IF v_huddle.ended_at IS NOT NULL AND v_huddle.ended_at <= v_now THEN
    RETURN 'ended';
  END IF;
  IF v_huddle.started_at IS NOT NULL
     AND v_huddle.duration_minutes IS NOT NULL
     AND v_now >= v_huddle.started_at + make_interval(mins => v_huddle.duration_minutes) THEN
    RETURN 'ended';
  END IF;

  IF EXISTS (
    SELECT 1 FROM huddle_participants
    WHERE huddle_id = p_huddle_id AND user_id = p_user_id AND left_at IS NULL
  ) THEN
    RETURN 'ok';
  END IF;

  SELECT count(*) INTO v_active_count
  FROM huddle_participants
  WHERE huddle_id = p_huddle_id AND left_at IS NULL;

  IF v_active_count >= v_huddle.max_participants THEN
    RETURN 'full';
  END IF;

  IF v_huddle.started_at IS NULL THEN
    UPDATE huddles SET started_at = v_now WHERE id = p_huddle_id;
  END IF;

  INSERT INTO huddle_participants (huddle_id, user_id, joined_at, left_at)
  VALUES (p_huddle_id, p_user_id, v_now, NULL)
  ON CONFLICT (huddle_id, user_id)
  DO UPDATE SET joined_at = v_now, left_at = NULL, duration_seconds = NULL;

  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION join_huddle(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION join_huddle(UUID, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION join_huddle(UUID, UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- leave_huddle: sets left_at on the caller's active seat and records the time spent.
-- Returns: ok | not_found | not_participant.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION leave_huddle(p_huddle_id UUID, p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM huddles WHERE id = p_huddle_id) THEN
    RETURN 'not_found';
  END IF;

  UPDATE huddle_participants
  SET left_at = v_now,
      duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (v_now - joined_at))::INT)
  WHERE huddle_id = p_huddle_id AND user_id = p_user_id AND left_at IS NULL;

  IF NOT FOUND THEN
    RETURN 'not_participant';
  END IF;

  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION leave_huddle(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION leave_huddle(UUID, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION leave_huddle(UUID, UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- list_live_huddles: live huddles visible to the viewer, newest start first.
-- The duration check runs here, in SQL, before the limit is applied.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_live_huddles(p_viewer_id UUID, p_limit INT)
RETURNS SETOF huddles
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT h.*
  FROM huddles h
  WHERE h.is_active
    AND h.started_at IS NOT NULL
    AND (h.ended_at IS NULL OR h.ended_at > now())
    AND (h.duration_minutes IS NULL
         OR h.started_at + make_interval(mins => h.duration_minutes) > now())
    AND (h.type <> 'private' OR h.created_by = p_viewer_id)
  ORDER BY h.started_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;

REVOKE ALL ON FUNCTION list_live_huddles(UUID, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION list_live_huddles(UUID, INT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION list_live_huddles(UUID, INT) TO service_role;

-- Waiting-room huddles: let guests join the waiting list before the scheduled start.
-- Replaces join_huddle from 20250616_huddle_rooms.sql; only the not_started check changes.
-- Apply in the Supabase SQL editor, then run: NOTIFY pgrst, 'reload schema';

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
  v_is_host BOOLEAN;
  v_admit BOOLEAN;
  v_existing huddle_participants%ROWTYPE;
BEGIN
  -- Row lock: the checks, the start and the insert cannot interleave with another join or leave.
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
  -- Before the start time only the waiting list is open: guests of a waiting-room huddle may
  -- queue early (they are admitted later), everyone else waits for the start.
  IF v_huddle.scheduled_at IS NOT NULL AND v_now < v_huddle.scheduled_at
     AND NOT (v_huddle.waiting_room AND v_huddle.created_by <> p_user_id) THEN
    RETURN 'not_started';
  END IF;

  SELECT * INTO v_existing FROM huddle_participants
  WHERE huddle_id = p_huddle_id AND user_id = p_user_id;
  IF FOUND AND v_existing.left_at IS NULL AND v_existing.admitted THEN
    RETURN 'ok';
  END IF;
  IF FOUND AND v_existing.left_at IS NULL AND NOT v_existing.admitted THEN
    RETURN 'waiting';
  END IF;

  v_is_host := v_huddle.created_by = p_user_id;
  v_admit := v_is_host OR NOT v_huddle.waiting_room;

  IF v_admit THEN
    SELECT count(*) INTO v_active_count FROM huddle_participants
    WHERE huddle_id = p_huddle_id AND left_at IS NULL AND admitted;
    IF v_active_count >= v_huddle.max_participants THEN
      RETURN 'full';
    END IF;
    IF v_huddle.started_at IS NULL THEN
      UPDATE huddles SET started_at = v_now WHERE id = p_huddle_id;
    END IF;
  END IF;

  INSERT INTO huddle_participants
    (huddle_id, user_id, joined_at, left_at, role, admitted, can_speak, can_share_screen, is_muted)
  VALUES (
    p_huddle_id, p_user_id, v_now, NULL,
    CASE WHEN v_is_host THEN 'host' ELSE 'participant' END,
    v_admit,
    -- Seminar and launch audiences watch until the host gives them the floor.
    NOT (v_huddle.mode IN ('seminar', 'launch') AND NOT v_is_host),
    v_is_host,
    false
  )
  ON CONFLICT (huddle_id, user_id)
  DO UPDATE SET joined_at = v_now, left_at = NULL, duration_seconds = NULL, admitted = EXCLUDED.admitted;

  IF v_admit THEN
    RETURN 'ok';
  END IF;
  RETURN 'waiting';
END;
$$;

REVOKE ALL ON FUNCTION join_huddle(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION join_huddle(UUID, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION join_huddle(UUID, UUID) TO service_role;

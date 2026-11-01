-- Atomic huddle join + lock down direct table access.
-- Run after 20250612_huddles.sql.

-- join_huddle locks the huddle row, so the capacity check and the insert
-- cannot interleave with another join. Returns: ok | not_found | ended | full.
CREATE OR REPLACE FUNCTION join_huddle(p_huddle_id UUID, p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_huddle huddles%ROWTYPE;
  v_active_count INT;
BEGIN
  SELECT * INTO v_huddle FROM huddles WHERE id = p_huddle_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  IF v_huddle.ended_at IS NOT NULL AND v_huddle.ended_at <= now() THEN
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

  INSERT INTO huddle_participants (huddle_id, user_id, joined_at, left_at)
  VALUES (p_huddle_id, p_user_id, now(), NULL)
  ON CONFLICT (huddle_id, user_id)
  DO UPDATE SET joined_at = now(), left_at = NULL, duration_seconds = NULL;

  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION join_huddle(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION join_huddle(UUID, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION join_huddle(UUID, UUID) TO service_role;

-- The auth-service talks to these tables with the service role, which bypasses RLS.
-- Enabling RLS with no policies blocks the public anon key from reading invite codes.
ALTER TABLE huddles ENABLE ROW LEVEL SECURITY;
ALTER TABLE huddle_participants ENABLE ROW LEVEL SECURITY;
-- Participant lookups use idx_huddle_participants_huddle_id from 20250612_huddles.sql.

-- Huddle rooms: modes, intent tags, invites, host roles and permissions, waiting room,
-- and promotion media. Run after 20250615_spark_presence_trending.sql.

-- ---------------------------------------------------------------------------
-- Huddle columns
-- ---------------------------------------------------------------------------
ALTER TABLE huddles ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'open'
  CHECK (mode IN ('open', 'seminar', 'hackathon', 'launch'));
ALTER TABLE huddles ADD COLUMN IF NOT EXISTS waiting_room BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE huddles ADD COLUMN IF NOT EXISTS media_path TEXT;
ALTER TABLE huddles ADD COLUMN IF NOT EXISTS media_type TEXT CHECK (media_type IN ('image', 'video', 'audio'));

-- ---------------------------------------------------------------------------
-- Intent tags: hashtags that drive the trending list.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS huddle_intents (
  huddle_id UUID NOT NULL REFERENCES huddles(id) ON DELETE CASCADE,
  tag TEXT NOT NULL CHECK (tag ~ '^[a-z0-9][a-z0-9-]{0,29}$'),
  PRIMARY KEY (huddle_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_huddle_intents_tag ON huddle_intents(tag);
ALTER TABLE huddle_intents ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Invites: only the host or a co-host can invite, and only people they are connected to.
-- The application enforces the connection rule; this table records the result.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS huddle_invites (
  huddle_id UUID NOT NULL REFERENCES huddles(id) ON DELETE CASCADE,
  invitee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (huddle_id, invitee_id)
);
CREATE INDEX IF NOT EXISTS idx_huddle_invites_invitee ON huddle_invites(invitee_id);
ALTER TABLE huddle_invites ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Participant roles and permissions.
-- admitted = false means the person is waiting in the waiting room.
-- ---------------------------------------------------------------------------
ALTER TABLE huddle_participants ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'participant'
  CHECK (role IN ('host', 'co_host', 'participant'));
ALTER TABLE huddle_participants ADD COLUMN IF NOT EXISTS admitted BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE huddle_participants ADD COLUMN IF NOT EXISTS can_speak BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE huddle_participants ADD COLUMN IF NOT EXISTS can_share_screen BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE huddle_participants ADD COLUMN IF NOT EXISTS is_muted BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- join_huddle, replacing the 20250614 version.
-- Returns: ok | waiting | not_found | ended | not_started | full.
-- - The creator joins as host and is always admitted.
-- - With the waiting room on, everyone else waits until a host admits them ('waiting').
-- - In seminar and launch mode, participants start without speaking rights.
-- - Only admitted, active participants count toward capacity and start the huddle.
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
  IF v_huddle.scheduled_at IS NOT NULL AND v_now < v_huddle.scheduled_at THEN
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

-- ---------------------------------------------------------------------------
-- Promotion media: the bucket is public to read; uploads go through the auth service
-- with the service role.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('huddle-media', 'huddle-media', true)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- list_live_huddles, replacing the 20250614 version: a private live huddle is visible to its
-- creator, to people already in it, and to people the host invited.
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
    AND (
      h.type <> 'private'
      OR h.created_by = p_viewer_id
      OR EXISTS (SELECT 1 FROM huddle_invites i WHERE i.huddle_id = h.id AND i.invitee_id = p_viewer_id)
      OR EXISTS (SELECT 1 FROM huddle_participants p
                 WHERE p.huddle_id = h.id AND p.user_id = p_viewer_id AND p.left_at IS NULL AND p.admitted)
    )
  ORDER BY h.started_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;

REVOKE ALL ON FUNCTION list_live_huddles(UUID, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION list_live_huddles(UUID, INT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION list_live_huddles(UUID, INT) TO service_role;

-- Presence, Spark matching, huddle events and real dashboard stats.
-- Run after 20250614_huddle_lifecycle.sql. Idempotent where possible.

-- ---------------------------------------------------------------------------
-- Presence: one row per user, refreshed by a heartbeat from the dashboard.
-- A user counts as online if last_seen_at is within the last 60 seconds.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_presence (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_presence_last_seen ON user_presence(last_seen_at);
ALTER TABLE user_presence ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Spark match queue. A row is 'waiting' until it is paired, then 'matched'.
-- Each matched pair has one row per user, linked through partner_user_id.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS match_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('text', 'video')),
  intent TEXT NOT NULL CHECK (intent IN ('Light chat', 'Brainstorm', 'Motivation', 'Collaborate')),
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'matched', 'cancelled')),
  enqueued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  matched_at TIMESTAMPTZ,
  partner_user_id UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_match_queue_waiting ON match_queue(mode, intent, enqueued_at) WHERE status = 'waiting';
CREATE INDEX IF NOT EXISTS idx_match_queue_user ON match_queue(user_id, enqueued_at DESC);
ALTER TABLE match_queue ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- match_waiting_user: if the user is waiting, pair them with the oldest compatible
-- waiting user (same mode and intent, not themselves). Both rows are locked, so
-- two concurrent calls cannot pair the same person twice.
-- Returns jsonb: {status: 'waiting'} | {status: 'matched', partner_user_id, mode, intent, matched_at}
--                | {status: 'none'} when the user has no waiting entry.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION match_waiting_user(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_self match_queue%ROWTYPE;
  v_partner match_queue%ROWTYPE;
  v_now TIMESTAMPTZ := now();
BEGIN
  SELECT * INTO v_self FROM match_queue
  WHERE user_id = p_user_id AND status = 'waiting'
  ORDER BY enqueued_at DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'none');
  END IF;

  SELECT * INTO v_partner FROM match_queue
  WHERE status = 'waiting'
    AND mode = v_self.mode
    AND intent = v_self.intent
    AND user_id <> p_user_id
  ORDER BY enqueued_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'waiting', 'queue_id', v_self.id);
  END IF;

  UPDATE match_queue
  SET status = 'matched', matched_at = v_now, partner_user_id = p_user_id
  WHERE id = v_partner.id;

  UPDATE match_queue
  SET status = 'matched', matched_at = v_now, partner_user_id = v_partner.user_id
  WHERE id = v_self.id;

  RETURN jsonb_build_object(
    'status', 'matched',
    'queue_id', v_self.id,
    'partner_user_id', v_partner.user_id,
    'mode', v_self.mode,
    'intent', v_self.intent,
    'matched_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION match_waiting_user(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION match_waiting_user(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION match_waiting_user(UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- Huddle events: visits, joins and leaves. The trending list is built from these.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS huddle_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  huddle_id UUID NOT NULL REFERENCES huddles(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('visit', 'join', 'leave')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_huddle_events_recent ON huddle_events(created_at DESC, huddle_id);
ALTER TABLE huddle_events ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- dashboard_match_stats: live numbers for the dashboard, computed from real rows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION dashboard_match_stats()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'online_users',
      (SELECT count(*) FROM user_presence WHERE last_seen_at > now() - interval '60 seconds'),
    'looking_for_match',
      (SELECT count(*) FROM match_queue WHERE status = 'waiting' AND enqueued_at > now() - interval '10 minutes'),
    'avg_match_time_minutes',
      (SELECT round((avg(EXTRACT(EPOCH FROM (matched_at - enqueued_at))) / 60.0)::numeric, 1)
       FROM match_queue
       WHERE status = 'matched' AND matched_at > now() - interval '24 hours')
  );
$$;

REVOKE ALL ON FUNCTION dashboard_match_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION dashboard_match_stats() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION dashboard_match_stats() TO service_role;

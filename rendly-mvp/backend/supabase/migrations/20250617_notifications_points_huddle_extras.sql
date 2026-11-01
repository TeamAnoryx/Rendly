-- Notifications, the points ledger, and extra huddle settings.
-- Run after 20250616_huddle_rooms.sql. Safe to run more than once.
-- Indexes are in 20250617_notifications_points_indexes.sql (CONCURRENTLY, run on its own).

-- ---------------------------------------------------------------------------
-- Notifications: one row per event for one user. read_at NULL means unread,
-- so anything unseen is still there the next time the user signs in.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (char_length(type) BETWEEN 1 AND 48),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  body TEXT CHECK (body IS NULL OR char_length(body) <= 500),
  payload JSONB NOT NULL DEFAULT '{}',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Points ledger: every change is a row; a user's balance is the sum.
-- No transfers between users yet: points come from the signup bonus or a host award.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS points_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INT NOT NULL CHECK (amount <> 0 AND amount BETWEEN -100000 AND 100000),
  reason TEXT NOT NULL CHECK (reason IN ('signup_bonus', 'huddle_award')),
  huddle_id UUID REFERENCES huddles(id) ON DELETE SET NULL,
  awarded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  note TEXT CHECK (note IS NULL OR char_length(note) <= 140),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE points_ledger ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE VIEW user_points_totals AS
  SELECT user_id, SUM(amount)::INT AS total
  FROM points_ledger
  GROUP BY user_id;

-- New users get the 500-point signup bonus and a welcome notification.
CREATE OR REPLACE FUNCTION on_user_created_welcome()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  INSERT INTO points_ledger (user_id, amount, reason, note)
  SELECT NEW.id, 500, 'signup_bonus', 'Welcome to Rendly'
  WHERE NOT EXISTS (SELECT 1 FROM points_ledger WHERE user_id = NEW.id AND reason = 'signup_bonus');
  INSERT INTO notifications (user_id, type, title, body)
  VALUES (NEW.id, 'welcome', 'Welcome to Rendly', 'You start with 500 points. Spark a match or join a huddle to get going.');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_created_welcome ON users;
CREATE TRIGGER trg_user_created_welcome
  AFTER INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION on_user_created_welcome();

-- Existing users get the signup bonus once. NOT EXISTS keeps this safe to re-run;
-- the unique index in 20250617_notifications_points_indexes.sql also enforces it.
INSERT INTO points_ledger (user_id, amount, reason, note)
SELECT u.id, 500, 'signup_bonus', 'Welcome to Rendly'
FROM users u
WHERE NOT EXISTS (SELECT 1 FROM points_ledger p WHERE p.user_id = u.id AND p.reason = 'signup_bonus');

-- ---------------------------------------------------------------------------
-- Huddle extras
-- ---------------------------------------------------------------------------
ALTER TABLE huddles ADD COLUMN IF NOT EXISTS thumbnail_path TEXT;
ALTER TABLE huddles ADD COLUMN IF NOT EXISTS thumbnail_type TEXT CHECK (thumbnail_type IN ('image', 'video'));
-- false = the host controls exits too: participants cannot leave on their own.
ALTER TABLE huddles ADD COLUMN IF NOT EXISTS allow_self_exit BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE huddles ADD COLUMN IF NOT EXISTS rewards_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE huddles ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

-- The name a participant uses in this huddle (defaults to their username in the app).
ALTER TABLE huddle_participants ADD COLUMN IF NOT EXISTS display_name TEXT
  CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 40);

-- ---------------------------------------------------------------------------
-- leave_huddle, replacing the 20250614 version: when the host has turned off
-- self-exit, participants cannot leave on their own ('locked'). The host can always leave.
-- Returns: ok | not_found | not_participant | locked.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION leave_huddle(p_huddle_id UUID, p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_huddle huddles%ROWTYPE;
BEGIN
  SELECT * INTO v_huddle FROM huddles WHERE id = p_huddle_id;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  IF NOT v_huddle.allow_self_exit
     AND v_huddle.created_by <> p_user_id
     AND v_huddle.is_active
     AND v_huddle.cancelled_at IS NULL THEN
    IF EXISTS (SELECT 1 FROM huddle_participants
               WHERE huddle_id = p_huddle_id AND user_id = p_user_id AND left_at IS NULL AND admitted) THEN
      RETURN 'locked';
    END IF;
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
-- award_huddle_points: the host gives points to someone in the room.
-- Returns: ok | not_found | not_host | rewards_off | not_in_room | bad_amount.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION award_huddle_points(
  p_huddle_id UUID, p_host_id UUID, p_user_id UUID, p_amount INT, p_note TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_huddle huddles%ROWTYPE;
BEGIN
  SELECT * INTO v_huddle FROM huddles WHERE id = p_huddle_id;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  IF v_huddle.created_by <> p_host_id THEN
    RETURN 'not_host';
  END IF;
  IF NOT v_huddle.rewards_enabled THEN
    RETURN 'rewards_off';
  END IF;
  IF p_amount IS NULL OR p_amount < 1 OR p_amount > 1000 THEN
    RETURN 'bad_amount';
  END IF;
  IF p_user_id = p_host_id OR NOT EXISTS (
    SELECT 1 FROM huddle_participants
    WHERE huddle_id = p_huddle_id AND user_id = p_user_id AND left_at IS NULL AND admitted
  ) THEN
    RETURN 'not_in_room';
  END IF;

  INSERT INTO points_ledger (user_id, amount, reason, huddle_id, awarded_by, note)
  VALUES (p_user_id, p_amount, 'huddle_award', p_huddle_id, p_host_id, NULLIF(trim(p_note), ''));
  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION award_huddle_points(UUID, UUID, UUID, INT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION award_huddle_points(UUID, UUID, UUID, INT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION award_huddle_points(UUID, UUID, UUID, INT, TEXT) TO service_role;

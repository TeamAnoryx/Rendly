-- Assertions for notifications, the points ledger, self-exit lock and host awards.
-- Runs in a transaction and rolls back. Requires migrations up to 20250617.
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/tests/sql/notifications_points_test.sql

BEGIN;

DO $$
DECLARE
  v_host UUID := gen_random_uuid();
  v_guest UUID := gen_random_uuid();
  v_outsider UUID := gen_random_uuid();
  v_h UUID;
  v_r TEXT;
  v_total INT;
  v_count INT;
BEGIN
  -- 1. A new user gets exactly one 500-point bonus and a welcome notification.
  INSERT INTO users (id) VALUES (v_host), (v_guest), (v_outsider);
  SELECT total INTO v_total FROM user_points_totals WHERE user_id = v_guest;
  IF v_total <> 500 THEN RAISE EXCEPTION 'FAIL 1: bonus total %', v_total; END IF;
  SELECT count(*) INTO v_count FROM notifications WHERE user_id = v_guest AND type = 'welcome';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL 1: welcome notifications %', v_count; END IF;

  -- 2. A second bonus is refused by the unique index.
  BEGIN
    INSERT INTO points_ledger (user_id, amount, reason) VALUES (v_guest, 500, 'signup_bonus');
    RAISE EXCEPTION 'FAIL 2: duplicate bonus accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- 3. Self-exit off: a participant cannot leave, the host can.
  INSERT INTO huddles (created_by, title, max_participants, duration_minutes, allow_self_exit, rewards_enabled)
  VALUES (v_host, 'quiz', 10, 30, false, true) RETURNING id INTO v_h;
  PERFORM join_huddle(v_h, v_host);
  PERFORM join_huddle(v_h, v_guest);
  v_r := leave_huddle(v_h, v_guest);
  IF v_r <> 'locked' THEN RAISE EXCEPTION 'FAIL 3: guest leave returned %', v_r; END IF;

  -- 4. Awards: host to a participant works; wrong caller, outsider and bad amounts are refused.
  v_r := award_huddle_points(v_h, v_host, v_guest, 50, 'Correct answer');
  IF v_r <> 'ok' THEN RAISE EXCEPTION 'FAIL 4: award returned %', v_r; END IF;
  SELECT total INTO v_total FROM user_points_totals WHERE user_id = v_guest;
  IF v_total <> 550 THEN RAISE EXCEPTION 'FAIL 4: total after award %', v_total; END IF;
  IF award_huddle_points(v_h, v_guest, v_host, 10, NULL) <> 'not_host' THEN RAISE EXCEPTION 'FAIL 4: non-host award'; END IF;
  IF award_huddle_points(v_h, v_host, v_outsider, 10, NULL) <> 'not_in_room' THEN RAISE EXCEPTION 'FAIL 4: outsider award'; END IF;
  IF award_huddle_points(v_h, v_host, v_host, 10, NULL) <> 'not_in_room' THEN RAISE EXCEPTION 'FAIL 4: self award'; END IF;
  IF award_huddle_points(v_h, v_host, v_guest, 0, NULL) <> 'bad_amount' THEN RAISE EXCEPTION 'FAIL 4: zero award'; END IF;
  IF award_huddle_points(v_h, v_host, v_guest, 1001, NULL) <> 'bad_amount' THEN RAISE EXCEPTION 'FAIL 4: huge award'; END IF;

  -- 5. Rewards off: awards are refused.
  UPDATE huddles SET rewards_enabled = false WHERE id = v_h;
  IF award_huddle_points(v_h, v_host, v_guest, 10, NULL) <> 'rewards_off' THEN RAISE EXCEPTION 'FAIL 5: rewards off'; END IF;

  -- 6. Self-exit on: the participant can leave.
  UPDATE huddles SET allow_self_exit = true WHERE id = v_h;
  v_r := leave_huddle(v_h, v_guest);
  IF v_r <> 'ok' THEN RAISE EXCEPTION 'FAIL 6: leave with self-exit on returned %', v_r; END IF;

  RAISE NOTICE 'notifications and points tests passed';
END $$;

ROLLBACK;

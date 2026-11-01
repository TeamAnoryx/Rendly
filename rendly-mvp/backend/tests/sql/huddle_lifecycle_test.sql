-- Assertions for the huddle lifecycle RPCs. Runs inside a transaction and rolls back,
-- so it leaves no rows behind.
-- Requires: 20250612_huddles.sql, 20250613_huddle_join_and_rls.sql and
-- 20250614_huddle_lifecycle.sql applied, and a users(id UUID) table.
-- Run:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/supabase/tests/huddle_lifecycle_test.sql

BEGIN;

DO $$
DECLARE
  v_owner UUID := gen_random_uuid();
  v_stranger UUID := gen_random_uuid();
  v_users UUID[] := ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 12));
  v_h UUID;
  v_private UUID;
  v_expired UUID;
  v_result TEXT;
  v_left_at TIMESTAMPTZ;
  v_started_at TIMESTAMPTZ;
  v_count INT;
BEGIN
  INSERT INTO users (id) VALUES (v_owner), (v_stranger);
  INSERT INTO users (id) SELECT unnest(v_users);

  -- 1. An unstarted huddle is not live.
  INSERT INTO huddles (created_by, title, max_participants, duration_minutes)
  VALUES (v_owner, 'lifecycle', 10, 30) RETURNING id INTO v_h;
  SELECT count(*) INTO v_count FROM list_live_huddles(v_owner, 100) WHERE id = v_h;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL 1: unstarted huddle listed as live'; END IF;

  -- 2. The first join sets started_at and makes the huddle live.
  v_result := join_huddle(v_h, v_users[1]);
  IF v_result <> 'ok' THEN RAISE EXCEPTION 'FAIL 2: first join returned %', v_result; END IF;
  SELECT started_at INTO v_started_at FROM huddles WHERE id = v_h;
  IF v_started_at IS NULL THEN RAISE EXCEPTION 'FAIL 2: started_at not set by first join'; END IF;
  SELECT count(*) INTO v_count FROM list_live_huddles(v_owner, 100) WHERE id = v_h;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL 2: started huddle not listed as live'; END IF;

  -- A second join does not move started_at.
  PERFORM join_huddle(v_h, v_users[2]);
  IF (SELECT started_at FROM huddles WHERE id = v_h) <> v_started_at THEN
    RAISE EXCEPTION 'FAIL 2: later join changed started_at';
  END IF;

  -- 3. Leave sets left_at and frees the seat.
  v_result := leave_huddle(v_h, v_users[1]);
  IF v_result <> 'ok' THEN RAISE EXCEPTION 'FAIL 3: leave returned %', v_result; END IF;
  SELECT left_at INTO v_left_at FROM huddle_participants WHERE huddle_id = v_h AND user_id = v_users[1];
  IF v_left_at IS NULL THEN RAISE EXCEPTION 'FAIL 3: left_at not set'; END IF;
  v_result := leave_huddle(v_h, v_users[1]);
  IF v_result <> 'not_participant' THEN RAISE EXCEPTION 'FAIL 3: second leave returned %', v_result; END IF;
  v_result := leave_huddle(gen_random_uuid(), v_users[1]);
  IF v_result <> 'not_found' THEN RAISE EXCEPTION 'FAIL 3: leave on missing huddle returned %', v_result; END IF;

  -- 4. Capacity is counted over active seats only, so a freed seat can be reused.
  -- Users 2..11 are the 10 active seats (user 1 left), so the room is now full.
  FOR i IN 3..11 LOOP
    v_result := join_huddle(v_h, v_users[i]);
    IF v_result <> 'ok' THEN RAISE EXCEPTION 'FAIL 4: join of user % returned %', i, v_result; END IF;
  END LOOP;
  v_result := join_huddle(v_h, v_users[12]);
  IF v_result <> 'full' THEN RAISE EXCEPTION 'FAIL 4: join into full huddle returned %, expected full', v_result; END IF;
  PERFORM leave_huddle(v_h, v_users[3]);
  v_result := join_huddle(v_h, v_users[12]);
  IF v_result <> 'ok' THEN RAISE EXCEPTION 'FAIL 4: join after a leave returned %', v_result; END IF;

  -- 5. Duration is enforced: a huddle past started_at + duration refuses joins and is not live.
  INSERT INTO huddles (created_by, title, max_participants, duration_minutes, started_at)
  VALUES (v_owner, 'expired', 10, 1, now() - interval '2 minutes') RETURNING id INTO v_expired;
  v_result := join_huddle(v_expired, v_users[1]);
  IF v_result <> 'ended' THEN RAISE EXCEPTION 'FAIL 5: join after duration returned %', v_result; END IF;
  SELECT count(*) INTO v_count FROM list_live_huddles(v_owner, 100) WHERE id = v_expired;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL 5: expired huddle listed as live'; END IF;

  -- 6. Privacy: a private huddle is live for its creator only.
  INSERT INTO huddles (created_by, title, type, max_participants, started_at)
  VALUES (v_owner, 'secret', 'private', 10, now()) RETURNING id INTO v_private;
  SELECT count(*) INTO v_count FROM list_live_huddles(v_stranger, 100) WHERE id = v_private;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL 6: private huddle listed to a stranger'; END IF;
  SELECT count(*) INTO v_count FROM list_live_huddles(v_owner, 100) WHERE id = v_private;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL 6: private huddle not listed to its creator'; END IF;

  -- 7. The live list is not cut off by the row limit: 3 live huddles, limit 2 returns 2 newest.
  FOR i IN 1..3 LOOP
    INSERT INTO huddles (created_by, title, max_participants, started_at)
    VALUES (v_owner, 'bulk ' || i, 10, now() - make_interval(mins => i));
  END LOOP;
  SELECT count(*) INTO v_count FROM list_live_huddles(v_owner, 2);
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL 7: limit 2 returned %', v_count; END IF;

  RAISE NOTICE 'huddle lifecycle tests passed';
END $$;

ROLLBACK;

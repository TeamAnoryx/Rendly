-- Assertions for huddle rooms: host role, waiting room, seminar audience rights and capacity
-- with admitted seats. Runs in a transaction and rolls back.
-- Requires the migrations up to 20250616_huddle_rooms.sql and a users(id) table.
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/tests/sql/huddle_rooms_test.sql

BEGIN;

DO $$
DECLARE
  v_host UUID := gen_random_uuid();
  v_guest UUID := gen_random_uuid();
  v_guest2 UUID := gen_random_uuid();
  v_huddle UUID;
  v_seminar UUID;
  v_result TEXT;
  v_role TEXT;
  v_admitted BOOLEAN;
  v_speak BOOLEAN;
  v_count INT;
BEGIN
  INSERT INTO users (id) VALUES (v_host), (v_guest), (v_guest2);

  -- 1. The creator joins as host, admitted, with speaking and screen-share rights.
  INSERT INTO huddles (created_by, title, max_participants, duration_minutes)
  VALUES (v_host, 'room', 10, 30) RETURNING id INTO v_huddle;
  v_result := join_huddle(v_huddle, v_host);
  IF v_result <> 'ok' THEN RAISE EXCEPTION 'FAIL 1: host join returned %', v_result; END IF;
  SELECT role, admitted INTO v_role, v_admitted FROM huddle_participants WHERE huddle_id = v_huddle AND user_id = v_host;
  IF v_role <> 'host' OR NOT v_admitted THEN RAISE EXCEPTION 'FAIL 1: host row is role % admitted %', v_role, v_admitted; END IF;

  -- 2. Waiting room on: a guest waits and is not counted as a participant.
  UPDATE huddles SET waiting_room = true WHERE id = v_huddle;
  v_result := join_huddle(v_huddle, v_guest);
  IF v_result <> 'waiting' THEN RAISE EXCEPTION 'FAIL 2: guest with waiting room returned %', v_result; END IF;
  SELECT count(*) INTO v_count FROM huddle_participants WHERE huddle_id = v_huddle AND admitted AND left_at IS NULL;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL 2: waiting guest counted as active (%)', v_count; END IF;
  -- Retrying while waiting still reports waiting.
  v_result := join_huddle(v_huddle, v_guest);
  IF v_result <> 'waiting' THEN RAISE EXCEPTION 'FAIL 2: repeat join while waiting returned %', v_result; END IF;

  -- 3. Host admits the guest (the auth service sets admitted = true), then the guest can join.
  UPDATE huddle_participants SET admitted = true WHERE huddle_id = v_huddle AND user_id = v_guest;
  v_result := join_huddle(v_huddle, v_guest);
  IF v_result <> 'ok' THEN RAISE EXCEPTION 'FAIL 3: admitted guest join returned %', v_result; END IF;

  -- 4. Seminar: an audience member starts without speaking rights; the host keeps them.
  INSERT INTO huddles (created_by, title, max_participants, duration_minutes, mode)
  VALUES (v_host, 'seminar', 10, 30, 'seminar') RETURNING id INTO v_seminar;
  PERFORM join_huddle(v_seminar, v_host);
  PERFORM join_huddle(v_seminar, v_guest);
  SELECT can_speak INTO v_speak FROM huddle_participants WHERE huddle_id = v_seminar AND user_id = v_guest;
  IF v_speak THEN RAISE EXCEPTION 'FAIL 4: seminar audience can speak by default'; END IF;
  SELECT can_speak INTO v_speak FROM huddle_participants WHERE huddle_id = v_seminar AND user_id = v_host;
  IF NOT v_speak THEN RAISE EXCEPTION 'FAIL 4: seminar host cannot speak'; END IF;

  -- 5. Capacity counts admitted seats only: a full room refuses a new admitted join,
  --    but a waiting user does not take a seat.
  INSERT INTO huddles (created_by, title, max_participants, duration_minutes)
  VALUES (v_host, 'small', 10, 30) RETURNING id INTO v_huddle;
  PERFORM join_huddle(v_huddle, v_host);
  -- Capacity with admitted seats is covered by the 20250614 test. Here: a waiting user takes no seat.
  UPDATE huddles SET waiting_room = true WHERE id = v_huddle;
  v_result := join_huddle(v_huddle, v_guest2);
  IF v_result <> 'waiting' THEN RAISE EXCEPTION 'FAIL 5: expected waiting, got %', v_result; END IF;
  SELECT count(*) INTO v_count FROM huddle_participants WHERE huddle_id = v_huddle AND admitted AND left_at IS NULL;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL 5: admitted count is % (expected 1)', v_count; END IF;

  RAISE NOTICE 'huddle rooms tests passed';
END $$;

ROLLBACK;

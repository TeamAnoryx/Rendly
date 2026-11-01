-- Assertions for Spark matching, presence and dashboard stats.
-- Runs in a transaction and rolls back. Requires users(id) and the migrations
-- up to 20250615_spark_presence_trending.sql applied.
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/tests/sql/spark_presence_trending_test.sql

BEGIN;

DO $$
DECLARE
  v_a UUID := gen_random_uuid();
  v_b UUID := gen_random_uuid();
  v_c UUID := gen_random_uuid();
  v_d UUID := gen_random_uuid();
  v_res JSONB;
  v_stats JSONB;
  v_count INT;
  v_before INT;
BEGIN
  INSERT INTO users (id) VALUES (v_a), (v_b), (v_c), (v_d);

  -- 1. A lone waiting user stays waiting.
  INSERT INTO match_queue (user_id, mode, intent) VALUES (v_a, 'text', 'Brainstorm');
  v_res := match_waiting_user(v_a);
  IF v_res->>'status' <> 'waiting' THEN RAISE EXCEPTION 'FAIL 1: lone user returned %', v_res; END IF;

  -- 2. A user with no waiting entry gets 'none'.
  v_res := match_waiting_user(v_d);
  IF v_res->>'status' <> 'none' THEN RAISE EXCEPTION 'FAIL 2: user without entry returned %', v_res; END IF;

  -- 3. Different intent does not pair.
  INSERT INTO match_queue (user_id, mode, intent) VALUES (v_b, 'text', 'Motivation');
  v_res := match_waiting_user(v_b);
  IF v_res->>'status' <> 'waiting' THEN RAISE EXCEPTION 'FAIL 3: different intent paired: %', v_res; END IF;

  -- 4. Different mode does not pair (video user with text waiter).
  INSERT INTO match_queue (user_id, mode, intent) VALUES (v_c, 'video', 'Brainstorm');
  v_res := match_waiting_user(v_c);
  IF v_res->>'status' <> 'waiting' THEN RAISE EXCEPTION 'FAIL 4: different mode paired: %', v_res; END IF;

  -- 5. Same mode and intent pairs with the oldest waiting user.
  INSERT INTO match_queue (user_id, mode, intent) VALUES (v_d, 'text', 'Brainstorm');
  v_res := match_waiting_user(v_d);
  IF v_res->>'status' <> 'matched' OR (v_res->>'partner_user_id')::uuid <> v_a THEN
    RAISE EXCEPTION 'FAIL 5: expected match with A, got %', v_res;
  END IF;
  SELECT count(*) INTO v_count FROM match_queue WHERE user_id IN (v_a, v_d) AND status = 'matched' AND partner_user_id IS NOT NULL;
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL 5: expected 2 matched rows, found %', v_count; END IF;

  -- 6. A matched user no longer has a waiting entry, so polling returns 'none'.
  v_res := match_waiting_user(v_a);
  IF v_res->>'status' <> 'none' THEN RAISE EXCEPTION 'FAIL 6: matched user still waiting: %', v_res; END IF;

  -- 7. Polling from the first user resolves a race: a waiter whose partner was
  --    unavailable at enqueue time is matched on the next call.
  INSERT INTO match_queue (user_id, mode, intent) VALUES (v_a, 'video', 'Collaborate');
  v_res := match_waiting_user(v_a);
  IF v_res->>'status' <> 'waiting' THEN RAISE EXCEPTION 'FAIL 7: setup returned %', v_res; END IF;
  INSERT INTO match_queue (user_id, mode, intent) VALUES (v_b, 'video', 'Collaborate');
  v_res := match_waiting_user(v_a);
  IF v_res->>'status' <> 'matched' OR (v_res->>'partner_user_id')::uuid <> v_b THEN
    RAISE EXCEPTION 'FAIL 7: poll did not match A with B: %', v_res;
  END IF;

  -- 8. Presence: fresh heartbeat counts as online, a stale one does not.
  INSERT INTO user_presence (user_id, last_seen_at) VALUES (v_a, now()), (v_b, now() - interval '5 minutes');
  v_stats := dashboard_match_stats();
  IF (v_stats->>'online_users')::int <> 1 THEN
    RAISE EXCEPTION 'FAIL 8: online_users expected 1, got %', v_stats;
  END IF;

  -- 9. Stats: looking_for_match counts waiting rows only.
  v_before := (dashboard_match_stats()->>'looking_for_match')::int;
  INSERT INTO match_queue (user_id, mode, intent) VALUES (v_c, 'text', 'Light chat');
  v_stats := dashboard_match_stats();
  IF (v_stats->>'looking_for_match')::int <> v_before + 1 THEN
    RAISE EXCEPTION 'FAIL 9: looking_for_match expected %, got %', v_before + 1, v_stats;
  END IF;

  RAISE NOTICE 'spark presence trending tests passed';
END $$;

ROLLBACK;

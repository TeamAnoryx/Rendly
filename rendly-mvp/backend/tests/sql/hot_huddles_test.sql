-- Assertions for hot_huddles: live outranks upcoming, sooner outranks later, cancelled /
-- ended / far-future huddles are excluded, private huddles are visible to invitees only,
-- and the limit is clamped. Runs in a transaction and rolls back.
-- Requires migrations up to 20250622_hot_huddles.sql.
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/tests/sql/hot_huddles_test.sql

BEGIN;

DO $$
DECLARE
  v_host UUID := gen_random_uuid();
  v_viewer UUID := gen_random_uuid();
  v_invitee UUID := gen_random_uuid();
  v_member UUID := gen_random_uuid();
  v_live UUID;
  v_soon UUID;
  v_later UUID;
  v_cancelled UUID;
  v_ended UUID;
  v_inactive UUID;
  v_far UUID;
  v_private UUID;
  v_order UUID[];
  v_count INT;
  v_bool BOOLEAN;
  v_secs INT;
BEGIN
  INSERT INTO users (id) VALUES (v_host), (v_viewer), (v_invitee), (v_member);

  -- Live: started by the host's join, one more participant.
  INSERT INTO huddles (created_by, title, max_participants, duration_minutes)
  VALUES (v_host, 'live', 10, 30) RETURNING id INTO v_live;
  PERFORM join_huddle(v_live, v_host);
  PERFORM join_huddle(v_live, v_member);
  -- Upcoming in 1 day and in 3 days; the later one even has an invite and a visit.
  INSERT INTO huddles (created_by, title, max_participants, duration_minutes, scheduled_at)
  VALUES (v_host, 'soon', 10, 30, now() + interval '1 day') RETURNING id INTO v_soon;
  INSERT INTO huddles (created_by, title, max_participants, duration_minutes, scheduled_at)
  VALUES (v_host, 'later', 10, 30, now() + interval '3 days') RETURNING id INTO v_later;
  INSERT INTO huddle_invites (huddle_id, invitee_id, invited_by) VALUES (v_later, v_member, v_host);
  INSERT INTO huddle_events (huddle_id, user_id, kind) VALUES (v_later, v_member, 'visit');
  -- Excluded: cancelled, ended by duration, deactivated, more than 7 days away.
  INSERT INTO huddles (created_by, title, max_participants, duration_minutes, scheduled_at, cancelled_at)
  VALUES (v_host, 'cancelled', 10, 30, now() + interval '1 hour', now()) RETURNING id INTO v_cancelled;
  INSERT INTO huddles (created_by, title, max_participants, duration_minutes, started_at)
  VALUES (v_host, 'ended', 10, 30, now() - interval '2 hours') RETURNING id INTO v_ended;
  INSERT INTO huddles (created_by, title, max_participants, duration_minutes, started_at, is_active)
  VALUES (v_host, 'inactive', 10, 30, now(), false) RETURNING id INTO v_inactive;
  INSERT INTO huddles (created_by, title, max_participants, duration_minutes, scheduled_at)
  VALUES (v_host, 'far', 10, 30, now() + interval '10 days') RETURNING id INTO v_far;
  -- Private upcoming, invitee only.
  INSERT INTO huddles (created_by, title, max_participants, duration_minutes, scheduled_at, type)
  VALUES (v_host, 'private', 10, 30, now() + interval '2 days', 'private') RETURNING id INTO v_private;
  INSERT INTO huddle_invites (huddle_id, invitee_id, invited_by) VALUES (v_private, v_invitee, v_host);

  -- 1. Order for an outsider: live, then soonest, then later (invite + visit do not beat 2 days sooner).
  SELECT array_agg(r.id ORDER BY r.ordinality) INTO v_order
  FROM hot_huddles(v_viewer, 20) WITH ORDINALITY AS r
  WHERE r.id IN (v_live, v_soon, v_later);
  IF v_order IS DISTINCT FROM ARRAY[v_live, v_soon, v_later] THEN
    RAISE EXCEPTION 'FAIL 1: order was % (expected live, soon, later)', v_order;
  END IF;

  -- 2. Live rows are flagged and have no start countdown; upcoming rows count down.
  SELECT r.is_live, r.starts_in_seconds INTO v_bool, v_secs FROM hot_huddles(v_viewer, 20) r WHERE r.id = v_live;
  IF NOT v_bool OR v_secs IS NOT NULL THEN RAISE EXCEPTION 'FAIL 2: live row is_live % starts_in %', v_bool, v_secs; END IF;
  SELECT r.is_live, r.starts_in_seconds INTO v_bool, v_secs FROM hot_huddles(v_viewer, 20) r WHERE r.id = v_soon;
  IF v_bool OR v_secs < 86000 OR v_secs > 86400 THEN RAISE EXCEPTION 'FAIL 2: soon row is_live % starts_in %', v_bool, v_secs; END IF;
  SELECT r.participants_count INTO v_count FROM hot_huddles(v_viewer, 20) r WHERE r.id = v_live;
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL 2: live participants %', v_count; END IF;
  SELECT r.invites_count, r.visits_24h INTO v_count, v_secs FROM hot_huddles(v_viewer, 20) r WHERE r.id = v_later;
  IF v_count <> 1 OR v_secs <> 1 THEN RAISE EXCEPTION 'FAIL 2: later invites % visits %', v_count, v_secs; END IF;

  -- 3. Cancelled, ended, inactive, far-future and (for an outsider) private huddles are excluded.
  SELECT count(*) INTO v_count FROM hot_huddles(v_viewer, 20) r
  WHERE r.id IN (v_cancelled, v_ended, v_inactive, v_far, v_private);
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL 3: % excluded huddles listed', v_count; END IF;

  -- 4. The private huddle is visible to its invitee and its host.
  SELECT count(*) INTO v_count FROM hot_huddles(v_invitee, 20) r WHERE r.id = v_private;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL 4: invitee cannot see private huddle'; END IF;
  SELECT count(*) INTO v_count FROM hot_huddles(v_host, 20) r WHERE r.id = v_private;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL 4: host cannot see private huddle'; END IF;
  SELECT count(*) INTO v_count FROM hot_huddles(v_member, 20) r WHERE r.id = v_private;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL 4: uninvited participant of another room sees private huddle'; END IF;

  -- 5. Limit clamped to 1..20.
  SELECT count(*) INTO v_count FROM hot_huddles(v_viewer, 1);
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL 5: limit 1 returned %', v_count; END IF;
  SELECT count(*) INTO v_count FROM hot_huddles(v_viewer, 0);
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL 5: limit 0 returned %', v_count; END IF;
  SELECT count(*) INTO v_count FROM hot_huddles(v_viewer, 1000);
  IF v_count > 20 THEN RAISE EXCEPTION 'FAIL 5: limit not capped at 20 (%)', v_count; END IF;
  SELECT count(*) INTO v_count FROM hot_huddles(v_viewer, NULL);
  IF v_count > 5 THEN RAISE EXCEPTION 'FAIL 5: default limit returned %', v_count; END IF;

  RAISE NOTICE 'hot huddles tests passed';
END $$;

ROLLBACK;

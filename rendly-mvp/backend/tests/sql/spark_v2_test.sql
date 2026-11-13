-- Assertions for Spark v2: multi-intent overlap matching, per-side charging, insufficient
-- candidates, retry safety, anonymous matching, free location intents, one waiting row per
-- user (spark_enqueue) and ended pairings.
-- Runs in a transaction and rolls back. Requires migrations up to 20250625_spark_v2.sql;
-- the unique-index check in 14 also runs when 20250625_spark_v2_index_3.sql is applied.
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/tests/sql/spark_v2_test.sql

BEGIN;

DO $$
DECLARE
  v_a UUID := gen_random_uuid();
  v_b UUID := gen_random_uuid();
  v_c UUID := gen_random_uuid();
  v_d UUID := gen_random_uuid();   -- broke
  v_e UUID := gen_random_uuid();
  v_f UUID := gen_random_uuid();
  v_g UUID := gen_random_uuid();
  v_h UUID := gen_random_uuid();
  v_q1 UUID;
  v_q2 UUID;
  v_res JSONB;
  v_qa UUID;
  v_qb UUID;
  v_total INT;
  v_count INT;
  v_cost INT;
  v_i INT;
BEGIN
  INSERT INTO users (id, username) VALUES
    (v_a, 'spark_a_' || substr(v_a::text, 1, 8)),
    (v_b, 'spark_b_' || substr(v_b::text, 1, 8)),
    (v_c, 'spark_c_' || substr(v_c::text, 1, 8)),
    (v_d, 'spark_d_' || substr(v_d::text, 1, 8)),
    (v_e, 'spark_e_' || substr(v_e::text, 1, 8)),
    (v_f, 'spark_f_' || substr(v_f::text, 1, 8)),
    (v_g, 'spark_g_' || substr(v_g::text, 1, 8)),
    (v_h, 'spark_h_' || substr(v_h::text, 1, 8));

  -- 1. Pricing: presets 5 (any case), anything else 10; cost is fixed by the trigger.
  IF spark_intent_price('BRAINSTORM') <> 5 OR spark_intent_price('Light chat') <> 5 OR spark_intent_price('Networking') <> 10 THEN
    RAISE EXCEPTION 'FAIL 1: prices';
  END IF;
  INSERT INTO match_queue (user_id, mode, intent, intents, cost, note, anonymous)
  VALUES (v_a, 'text', 'x', ARRAY['Brainstorm', 'Motivation'], 0, 'hi there', false)
  RETURNING id, cost INTO v_qa, v_cost;
  IF v_cost <> 10 THEN RAISE EXCEPTION 'FAIL 1: client cost was not overridden: %', v_cost; END IF;
  IF (SELECT intent FROM match_queue WHERE id = v_qa) <> 'Brainstorm' THEN RAISE EXCEPTION 'FAIL 1: intent <> intents[1]'; END IF;

  -- 2. More than 5 intents is refused.
  BEGIN
    INSERT INTO match_queue (user_id, mode, intent, intents) VALUES (v_c, 'text', 'a', ARRAY['aa','bb','cc','dd','ee','ff']);
    RAISE EXCEPTION 'FAIL 2: six intents accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 3. No overlap: still waiting.
  INSERT INTO match_queue (user_id, mode, intent, intents) VALUES (v_b, 'text', 'x', ARRAY['Collaborate']) RETURNING id INTO v_qb;
  v_res := match_waiting_user(v_a);
  IF v_res->>'status' <> 'waiting' THEN RAISE EXCEPTION 'FAIL 3: matched without overlap: %', v_res; END IF;
  UPDATE match_queue SET status = 'cancelled' WHERE id = v_qb;

  -- 4. Overlap (case-insensitive): matched, both charged once, caller spelling kept.
  INSERT INTO match_queue (user_id, mode, intent, intents, note, anonymous)
  VALUES (v_b, 'text', 'x', ARRAY['motivation', 'Collaborate'], 'hey', true) RETURNING id INTO v_qb;
  v_res := match_waiting_user(v_a);
  IF v_res->>'status' <> 'matched' OR (v_res->>'partner_user_id')::uuid <> v_b THEN RAISE EXCEPTION 'FAIL 4: %', v_res; END IF;
  IF v_res->'shared_intents' <> '["Motivation"]'::jsonb THEN RAISE EXCEPTION 'FAIL 4: shared %', v_res->'shared_intents'; END IF;
  IF (v_res->>'cost_charged')::int <> 10 THEN RAISE EXCEPTION 'FAIL 4: cost_charged %', v_res; END IF;
  -- 6. Anonymous partner hides the username.
  IF v_res->>'partner_username' IS NOT NULL OR (v_res->>'partner_anonymous')::boolean IS DISTINCT FROM true
     OR v_res->>'partner_note' <> 'hey' THEN
    RAISE EXCEPTION 'FAIL 6: anonymous partner leaked: %', v_res;
  END IF;
  SELECT total INTO v_total FROM user_points_totals WHERE user_id = v_a;
  IF v_total <> 490 THEN RAISE EXCEPTION 'FAIL 4: A total %', v_total; END IF;
  SELECT total INTO v_total FROM user_points_totals WHERE user_id = v_b;
  IF v_total <> 490 THEN RAISE EXCEPTION 'FAIL 4: B total %', v_total; END IF;
  SELECT count(*) INTO v_count FROM points_ledger
  WHERE reason = 'spark_match' AND category = 'spark_match' AND transfer_id IN (v_qa, v_qb) AND counterparty_id IS NULL;
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL 4: ledger rows %', v_count; END IF;

  -- 5. Retry: no second charge, by function call or by direct insert.
  v_res := match_waiting_user(v_a);
  IF v_res->>'status' <> 'none' THEN RAISE EXCEPTION 'FAIL 5: retry returned %', v_res; END IF;
  v_res := match_waiting_user(v_b);
  IF v_res->>'status' <> 'none' THEN RAISE EXCEPTION 'FAIL 5: partner retry returned %', v_res; END IF;
  BEGIN
    INSERT INTO points_ledger (user_id, amount, reason, category, transfer_id, note)
    VALUES (v_a, -10, 'spark_match', 'spark_match', v_qa, 'Spark match');
    RAISE EXCEPTION 'FAIL 5: second debit for one row accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  SELECT total INTO v_total FROM user_points_totals WHERE user_id = v_a;
  IF v_total <> 490 THEN RAISE EXCEPTION 'FAIL 5: A total after retry %', v_total; END IF;
  -- A matched row's cost cannot be rewritten.
  UPDATE match_queue SET cost = 0, charged = false WHERE id = v_qa;
  IF (SELECT cost FROM match_queue WHERE id = v_qa) <> 10 OR NOT (SELECT charged FROM match_queue WHERE id = v_qa) THEN
    RAISE EXCEPTION 'FAIL 5: cost/charged were rewritten';
  END IF;

  -- 7. Non-anonymous partner shows the username.
  INSERT INTO match_queue (user_id, mode, intent, intents, anonymous) VALUES (v_e, 'video', 'x', ARRAY['Light chat'], false);
  INSERT INTO match_queue (user_id, mode, intent, intents) VALUES (v_f, 'video', 'x', ARRAY['light chat']);
  v_res := match_waiting_user(v_f);
  IF v_res->>'status' <> 'matched' OR v_res->>'partner_username' IS NULL
     OR v_res->>'partner_username' <> (SELECT username FROM users WHERE id = v_e) THEN
    RAISE EXCEPTION 'FAIL 7: %', v_res;
  END IF;

  -- 8. Insufficient candidate is cancelled and skipped; a solvent one is matched.
  INSERT INTO points_ledger (user_id, amount, reason, category, transfer_id, note)
  VALUES (v_d, -498, 'transfer', 'transfer', gen_random_uuid(), 'drain');
  INSERT INTO match_queue (user_id, mode, intent, intents) VALUES (v_d, 'text', 'x', ARRAY['Brainstorm']);
  UPDATE match_queue SET enqueued_at = now() - interval '5 minutes' WHERE user_id = v_d AND status = 'waiting';
  INSERT INTO match_queue (user_id, mode, intent, intents) VALUES (v_e, 'text', 'x', ARRAY['Brainstorm']);
  UPDATE match_queue SET enqueued_at = now() - interval '1 minute' WHERE user_id = v_e AND status = 'waiting';
  INSERT INTO match_queue (user_id, mode, intent, intents) VALUES (v_c, 'text', 'x', ARRAY['Brainstorm']);
  v_res := match_waiting_user(v_c);
  IF v_res->>'status' <> 'matched' OR (v_res->>'partner_user_id')::uuid <> v_e THEN RAISE EXCEPTION 'FAIL 8: %', v_res; END IF;
  IF NOT EXISTS (SELECT 1 FROM match_queue WHERE user_id = v_d AND status = 'cancelled' AND cancel_reason = 'insufficient') THEN
    RAISE EXCEPTION 'FAIL 8: broke candidate not cancelled';
  END IF;
  SELECT total INTO v_total FROM user_points_totals WHERE user_id = v_d;
  IF v_total <> 2 THEN RAISE EXCEPTION 'FAIL 8: broke user charged: %', v_total; END IF;

  -- 9. Insufficient caller: refused, row cancelled, nothing charged.
  INSERT INTO match_queue (user_id, mode, intent, intents) VALUES (v_f, 'text', 'x', ARRAY['Motivation']);
  INSERT INTO match_queue (user_id, mode, intent, intents) VALUES (v_d, 'text', 'x', ARRAY['Motivation']);
  v_res := match_waiting_user(v_d);
  IF v_res->>'status' <> 'insufficient' OR (v_res->>'cost')::int <> 5 OR (v_res->>'balance')::int <> 2 THEN
    RAISE EXCEPTION 'FAIL 9: %', v_res;
  END IF;
  IF EXISTS (SELECT 1 FROM match_queue WHERE user_id = v_d AND status = 'waiting') THEN RAISE EXCEPTION 'FAIL 9: row still waiting'; END IF;
  UPDATE match_queue SET status = 'cancelled' WHERE user_id = v_f AND status = 'waiting';

  -- 10. A custom intent that is not held does not match; once held it does.
  INSERT INTO match_queue (user_id, mode, intent, intents) VALUES (v_a, 'text', 'x', ARRAY['Deep Work']);
  INSERT INTO match_queue (user_id, mode, intent, intents) VALUES (v_b, 'text', 'x', ARRAY['deep work']);
  v_res := match_waiting_user(v_a);
  IF v_res->>'status' <> 'waiting' THEN RAISE EXCEPTION 'FAIL 10: unheld intent matched: %', v_res; END IF;
  IF (create_intent(v_a, 'Deep Work', 'public'))->>'status' <> 'ok' THEN RAISE EXCEPTION 'FAIL 10: create_intent'; END IF;
  INSERT INTO user_intents (user_id, intent_id, source, expires_at)
  SELECT v_b, id, 'search', now() + interval '1 day' FROM intents WHERE visibility = 'public' AND slug = 'deep-work';
  v_res := match_waiting_user(v_a);
  IF v_res->>'status' <> 'matched' OR (v_res->>'cost_charged')::int <> 10 THEN RAISE EXCEPTION 'FAIL 10: held intent: %', v_res; END IF;

  -- 11. Blocked pairs never match.
  INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (v_e, v_f);
  INSERT INTO match_queue (user_id, mode, intent, intents) VALUES (v_e, 'text', 'x', ARRAY['Collaborate']);
  INSERT INTO match_queue (user_id, mode, intent, intents) VALUES (v_f, 'text', 'x', ARRAY['Collaborate']);
  v_res := match_waiting_user(v_f);
  IF v_res->>'status' <> 'waiting' THEN RAISE EXCEPTION 'FAIL 11: blocked pair matched: %', v_res; END IF;

  -- 12. Location intents: created free, held 28 days, name normalised, bad names refused.
  SELECT total INTO v_total FROM user_points_totals WHERE user_id = v_c;
  v_res := create_location_intent(v_c, 'city', '  porto   alegre ');
  IF v_res->>'status' <> 'ok' OR v_res->'intent'->>'name' <> 'Porto Alegre' OR v_res->'intent'->>'slug' <> 'loc-city-porto-alegre'
     OR v_res->'intent'->>'kind' <> 'location' OR v_res->'intent'->>'city' <> 'Porto Alegre'
     OR (v_res->'intent'->>'is_mine')::boolean THEN
    RAISE EXCEPTION 'FAIL 12: %', v_res;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM active_user_intents a JOIN intents i ON i.id = a.intent_id
    WHERE a.user_id = v_c AND i.slug = 'loc-city-porto-alegre' AND a.source = 'location'
      AND a.expires_at > now() + interval '27 days'
  ) THEN RAISE EXCEPTION 'FAIL 12: not held'; END IF;
  IF (SELECT total FROM user_points_totals WHERE user_id = v_c) <> v_total THEN RAISE EXCEPTION 'FAIL 12: location intent was charged'; END IF;
  v_res := create_location_intent(v_c, 'country', 'Portugal');
  IF v_res->>'status' <> 'ok' OR v_res->'intent'->>'country' <> 'Portugal' OR v_res->'intent'->>'city' IS NOT NULL THEN RAISE EXCEPTION 'FAIL 12: country %', v_res; END IF;
  IF (create_location_intent(v_c, 'city', 'Rio2'))->>'status' <> 'bad_name' THEN RAISE EXCEPTION 'FAIL 12: digits accepted'; END IF;
  IF (create_location_intent(v_c, 'planet', 'Mars'))->>'status' <> 'bad_input' THEN RAISE EXCEPTION 'FAIL 12: bad scope accepted'; END IF;
  -- A custom intent with a colliding slug cannot be claimed for free.
  PERFORM create_intent(v_a, 'loc city Faro', 'public');
  IF (create_location_intent(v_c, 'city', 'Faro'))->>'status' <> 'bad_name' THEN RAISE EXCEPTION 'FAIL 12: custom slug claimed'; END IF;

  -- 13. Limit: 10 calls per 24 hours (2 used above).
  FOR v_i IN 1..8 LOOP
    v_res := create_location_intent(v_c, 'city', 'Town ' || chr(64 + v_i));
    IF v_res->>'status' <> 'ok' THEN RAISE EXCEPTION 'FAIL 13: call % returned %', v_i, v_res; END IF;
  END LOOP;
  IF (create_location_intent(v_c, 'city', 'One More'))->>'status' <> 'limit_reached' THEN RAISE EXCEPTION 'FAIL 13: limit not reached'; END IF;

  -- 14. One waiting row per user: spark_enqueue cancels the previous one and prices the new.
  v_q1 := spark_enqueue(v_g, 'video', ARRAY['Collaborate'], 'first', true);
  v_q2 := spark_enqueue(v_g, 'video', ARRAY['Collaborate', 'Brainstorm'], 'second', false);
  IF v_q1 = v_q2 THEN RAISE EXCEPTION 'FAIL 14: same row returned'; END IF;
  SELECT count(*) INTO v_count FROM match_queue WHERE user_id = v_g AND status = 'waiting';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL 14: % waiting rows', v_count; END IF;
  IF (SELECT status FROM match_queue WHERE id = v_q1) <> 'cancelled' THEN RAISE EXCEPTION 'FAIL 14: old row not cancelled'; END IF;
  IF (SELECT cost FROM match_queue WHERE id = v_q2) <> 10 OR (SELECT anonymous FROM match_queue WHERE id = v_q2) THEN
    RAISE EXCEPTION 'FAIL 14: new row not priced or flags lost';
  END IF;
  IF to_regclass('public.uq_match_queue_one_waiting') IS NOT NULL THEN
    BEGIN
      INSERT INTO match_queue (user_id, mode, intent, intents) VALUES (v_g, 'video', 'x', ARRAY['Collaborate']);
      RAISE EXCEPTION 'FAIL 14: second waiting row accepted';
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END IF;

  -- 15. Matching uses the newest waiting row and charges it once; ending a pairing keeps
  -- status / charge and leaves nothing to match.
  v_q1 := spark_enqueue(v_h, 'video', ARRAY['brainstorm'], NULL, true);
  v_res := match_waiting_user(v_h);
  IF v_res->>'status' <> 'matched' OR (v_res->>'partner_queue_id')::uuid <> v_q2 THEN RAISE EXCEPTION 'FAIL 15: %', v_res; END IF;
  SELECT count(*) INTO v_count FROM points_ledger WHERE transfer_id IN (v_q1, v_q2);
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL 15: % debits', v_count; END IF;
  UPDATE match_queue SET ended_at = now() WHERE id IN (v_q1, v_q2) AND ended_at IS NULL;
  SELECT count(*) INTO v_count FROM match_queue
  WHERE id IN (v_q1, v_q2) AND ended_at IS NOT NULL AND status = 'matched' AND charged;
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL 15: ended pairing lost its state'; END IF;
  IF (match_waiting_user(v_g))->>'status' <> 'none' OR (match_waiting_user(v_h))->>'status' <> 'none' THEN
    RAISE EXCEPTION 'FAIL 15: ended pairing still matchable';
  END IF;

  RAISE NOTICE 'spark v2 tests passed';
END $$;

ROLLBACK;

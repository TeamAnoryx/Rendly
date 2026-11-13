-- Assertions for Rendly Tokens: peer transfers, host-paid huddle sends, minted awards,
-- intent purchases with royalties, search, near-by, rank ties and the Spark fallback.
-- Runs in a transaction and rolls back. Requires migrations up to 20250621 (indexes optional).
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/tests/sql/tokens_intents_test.sql

BEGIN;

DO $$
DECLARE
  v_a UUID := gen_random_uuid();
  v_b UUID := gen_random_uuid();
  v_c UUID := gen_random_uuid();   -- intent creator
  v_d UUID := gen_random_uuid();   -- nearly broke
  v_e UUID := gen_random_uuid();   -- rank tie
  v_f UUID := gen_random_uuid();   -- rank tie
  v_host UUID := gen_random_uuid();
  v_guest UUID := gen_random_uuid();
  v_outsider UUID := gen_random_uuid();
  v_h UUID;
  v_pub UUID;
  v_priv UUID;
  v_preset UUID;
  v_tid1 UUID := gen_random_uuid();
  v_tid2 UUID := gen_random_uuid();
  v_tid3 UUID := gen_random_uuid();
  v_tid4 UUID := gen_random_uuid();
  v_tid5 UUID := gen_random_uuid();
  v_tid6 UUID := gen_random_uuid();
  v_tid7 UUID := gen_random_uuid();
  v_tid8 UUID := gen_random_uuid();
  v_tid9 UUID := gen_random_uuid();
  v_tid10 UUID := gen_random_uuid();
  v_tid11 UUID := gen_random_uuid();
  v_res JSONB;
  v_r TEXT;
  v_total INT;
  v_count INT;
  v_bool BOOLEAN;
  v_active BOOLEAN;
  v_ts TIMESTAMPTZ;
  v_num NUMERIC;
BEGIN
  INSERT INTO users (id) VALUES (v_a), (v_b), (v_c), (v_d), (v_e), (v_f), (v_host), (v_guest), (v_outsider);

  -- 1. Transfer 50: 450 / 550, two rows sharing the transfer_id, one debit and one credit.
  v_res := transfer_tokens(v_a, v_b, 50, 'thanks', 'whisper:test', v_tid1);
  IF v_res->>'status' <> 'ok' OR (v_res->>'balance')::int <> 450 THEN RAISE EXCEPTION 'FAIL 1: transfer returned %', v_res; END IF;
  SELECT total INTO v_total FROM user_points_totals WHERE user_id = v_a;
  IF v_total <> 450 THEN RAISE EXCEPTION 'FAIL 1: sender total %', v_total; END IF;
  SELECT total INTO v_total FROM user_points_totals WHERE user_id = v_b;
  IF v_total <> 550 THEN RAISE EXCEPTION 'FAIL 1: receiver total %', v_total; END IF;
  SELECT count(*) INTO v_count FROM points_ledger WHERE transfer_id = v_tid1;
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL 1: rows with transfer_id %', v_count; END IF;
  SELECT count(*) INTO v_count FROM points_ledger
  WHERE transfer_id = v_tid1 AND user_id = v_a AND amount = -50 AND counterparty_id = v_b
    AND category = 'transfer' AND conversation_id = 'whisper:test' AND note = 'thanks';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL 1: debit row missing'; END IF;
  SELECT count(*) INTO v_count FROM points_ledger
  WHERE transfer_id = v_tid1 AND user_id = v_b AND amount = 50 AND counterparty_id = v_a;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL 1: credit row missing'; END IF;

  -- 2. Insufficient balance: refused, nothing written.
  v_res := transfer_tokens(v_a, v_b, 1000, NULL, NULL, v_tid2);
  IF v_res->>'status' <> 'insufficient' THEN RAISE EXCEPTION 'FAIL 2: returned %', v_res; END IF;
  SELECT count(*) INTO v_count FROM points_ledger WHERE transfer_id = v_tid2;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL 2: rows written %', v_count; END IF;

  -- 3. Duplicate transfer_id: refused, totals unchanged.
  v_res := transfer_tokens(v_a, v_b, 50, NULL, NULL, v_tid1);
  IF v_res->>'status' <> 'duplicate' THEN RAISE EXCEPTION 'FAIL 3: returned %', v_res; END IF;
  SELECT total INTO v_total FROM user_points_totals WHERE user_id = v_a;
  IF v_total <> 450 THEN RAISE EXCEPTION 'FAIL 3: total after duplicate %', v_total; END IF;

  -- 4. Self, zero amount and unknown recipient.
  IF (transfer_tokens(v_a, v_a, 10, NULL, NULL, gen_random_uuid()))->>'status' <> 'self' THEN RAISE EXCEPTION 'FAIL 4: self'; END IF;
  IF (transfer_tokens(v_a, v_b, 0, NULL, NULL, gen_random_uuid()))->>'status' <> 'bad_amount' THEN RAISE EXCEPTION 'FAIL 4: zero'; END IF;
  IF (transfer_tokens(v_a, gen_random_uuid(), 10, NULL, NULL, gen_random_uuid()))->>'status' <> 'no_user' THEN RAISE EXCEPTION 'FAIL 4: no_user'; END IF;

  -- 5. Huddle send gates: receive flag, host only, purpose enum, note for other, room membership.
  INSERT INTO huddles (created_by, title, max_participants, duration_minutes, rewards_enabled, rewards_receive_enabled)
  VALUES (v_host, 'quiz', 10, 30, true, false) RETURNING id INTO v_h;
  PERFORM join_huddle(v_h, v_host);
  PERFORM join_huddle(v_h, v_guest);
  IF huddle_send_tokens(v_h, v_host, v_guest, 30, 'winner', NULL, v_tid3) <> 'rewards_off' THEN RAISE EXCEPTION 'FAIL 5: receive flag off'; END IF;
  UPDATE huddles SET rewards_receive_enabled = true WHERE id = v_h;
  IF huddle_send_tokens(v_h, v_guest, v_host, 30, 'winner', NULL, v_tid3) <> 'not_host' THEN RAISE EXCEPTION 'FAIL 5: non-host send'; END IF;
  IF huddle_send_tokens(v_h, v_host, v_guest, 30, 'bogus', NULL, v_tid3) <> 'bad_purpose' THEN RAISE EXCEPTION 'FAIL 5: bad purpose'; END IF;
  IF huddle_send_tokens(v_h, v_host, v_guest, 30, 'other', '  ', v_tid3) <> 'note_required' THEN RAISE EXCEPTION 'FAIL 5: other without note'; END IF;
  IF huddle_send_tokens(v_h, v_host, v_outsider, 30, 'winner', NULL, v_tid3) <> 'not_in_room' THEN RAISE EXCEPTION 'FAIL 5: outsider'; END IF;
  IF huddle_send_tokens(v_h, v_host, v_host, 30, 'winner', NULL, v_tid3) <> 'not_in_room' THEN RAISE EXCEPTION 'FAIL 5: self'; END IF;
  IF huddle_send_tokens(v_h, v_host, v_guest, 0, 'winner', NULL, v_tid3) <> 'bad_amount' THEN RAISE EXCEPTION 'FAIL 5: zero'; END IF;
  IF huddle_send_tokens(v_h, v_host, v_guest, 30, 'winner', NULL, NULL) <> 'bad_input' THEN RAISE EXCEPTION 'FAIL 5: null transfer_id'; END IF;

  -- 6. Huddle send debits the host and credits the participant; duplicate and insufficient refused.
  v_r := huddle_send_tokens(v_h, v_host, v_guest, 30, 'winner', NULL, v_tid3);
  IF v_r <> 'ok' THEN RAISE EXCEPTION 'FAIL 6: send returned %', v_r; END IF;
  SELECT total INTO v_total FROM user_points_totals WHERE user_id = v_host;
  IF v_total <> 470 THEN RAISE EXCEPTION 'FAIL 6: host total %', v_total; END IF;
  SELECT total INTO v_total FROM user_points_totals WHERE user_id = v_guest;
  IF v_total <> 530 THEN RAISE EXCEPTION 'FAIL 6: guest total %', v_total; END IF;
  SELECT count(*) INTO v_count FROM points_ledger
  WHERE transfer_id = v_tid3 AND category = 'huddle_send' AND purpose = 'winner' AND huddle_id = v_h;
  IF v_count <> 2 THEN RAISE EXCEPTION 'FAIL 6: send rows %', v_count; END IF;
  IF huddle_send_tokens(v_h, v_host, v_guest, 30, 'winner', NULL, v_tid3) <> 'duplicate' THEN RAISE EXCEPTION 'FAIL 6: duplicate send'; END IF;
  IF huddle_send_tokens(v_h, v_host, v_guest, 1000, 'bounty', NULL, v_tid4) <> 'insufficient' THEN RAISE EXCEPTION 'FAIL 6: insufficient send'; END IF;
  IF huddle_send_tokens(v_h, v_host, v_guest, 5, 'other', 'Great question', v_tid4) <> 'ok' THEN RAISE EXCEPTION 'FAIL 6: other with note'; END IF;

  -- 7. Awards still mint: the participant gains, the host is not debited.
  v_r := award_huddle_points(v_h, v_host, v_guest, 50, 'nice');
  IF v_r <> 'ok' THEN RAISE EXCEPTION 'FAIL 7: award returned %', v_r; END IF;
  SELECT total INTO v_total FROM user_points_totals WHERE user_id = v_guest;
  IF v_total <> 585 THEN RAISE EXCEPTION 'FAIL 7: guest total %', v_total; END IF;
  SELECT total INTO v_total FROM user_points_totals WHERE user_id = v_host;
  IF v_total <> 465 THEN RAISE EXCEPTION 'FAIL 7: host total %', v_total; END IF;
  SELECT count(*) INTO v_count FROM points_ledger
  WHERE user_id = v_guest AND reason = 'huddle_award' AND category = 'huddle_award' AND counterparty_id = v_host AND amount = 50;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL 7: award row'; END IF;
  v_res := profile_huddle_stats(v_guest);
  IF (v_res->>'public_joined')::int <> 1 OR (v_res->>'hosted')::int <> 0 THEN RAISE EXCEPTION 'FAIL 7: guest stats %', v_res; END IF;
  v_res := profile_huddle_stats(v_host);
  IF (v_res->>'hosted')::int <> 1 OR (v_res->>'public_joined')::int <> 0 THEN RAISE EXCEPTION 'FAIL 7: host stats %', v_res; END IF;

  -- 8. Create intents: slug rule, taken, bad names, private 7 days.
  v_res := create_intent(v_c, '  Deep   Work ', 'public');
  IF v_res->>'status' <> 'ok' THEN RAISE EXCEPTION 'FAIL 8: create returned %', v_res; END IF;
  v_pub := (v_res->'intent'->>'id')::uuid;
  IF v_res->'intent'->>'slug' <> 'deep-work' OR v_res->'intent'->>'name' <> 'Deep Work' THEN RAISE EXCEPTION 'FAIL 8: slug/name %', v_res; END IF;
  IF intent_slug('  Café & Co--Working!  ') <> 'caf-co-working' THEN RAISE EXCEPTION 'FAIL 8: intent_slug %', intent_slug('  Café & Co--Working!  '); END IF;
  SELECT count(*) INTO v_count FROM active_user_intents WHERE user_id = v_c AND intent_id = v_pub AND source = 'created' AND expires_at IS NULL;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL 8: creator does not hold the intent'; END IF;
  IF (create_intent(v_a, 'deep work', 'public'))->>'status' <> 'taken' THEN RAISE EXCEPTION 'FAIL 8: taken'; END IF;
  IF (create_intent(v_a, 'x', 'public'))->>'status' <> 'bad_name' THEN RAISE EXCEPTION 'FAIL 8: short name'; END IF;
  IF (create_intent(v_a, '!!!', 'public'))->>'status' <> 'bad_name' THEN RAISE EXCEPTION 'FAIL 8: symbols'; END IF;
  IF (create_intent(v_a, 'Deep Work', 'bogus'))->>'status' <> 'bad_input' THEN RAISE EXCEPTION 'FAIL 8: visibility'; END IF;
  v_res := create_intent(v_c, 'Secret plan', 'private');
  IF v_res->>'status' <> 'ok' THEN RAISE EXCEPTION 'FAIL 8: private create %', v_res; END IF;
  v_priv := (v_res->'intent'->>'id')::uuid;
  SELECT expires_at INTO v_ts FROM user_intents WHERE user_id = v_c AND intent_id = v_priv;
  IF v_ts IS NULL OR v_ts < now() + interval '6 days' OR v_ts > now() + interval '8 days' THEN RAISE EXCEPTION 'FAIL 8: private expiry %', v_ts; END IF;
  SELECT count(*) INTO v_count FROM points_ledger WHERE intent_id IN (v_pub, v_priv);
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL 8: create wrote ledger rows'; END IF;

  -- 9. Purchase prices: search 10, hot 20; royalty +10 to the creator; 28-day expiry.
  v_res := purchase_intent(v_a, v_pub, 'search', v_tid5);
  IF v_res->>'status' <> 'ok' OR (v_res->>'price')::int <> 10 OR (v_res->>'balance')::int <> 440 THEN RAISE EXCEPTION 'FAIL 9: search purchase %', v_res; END IF;
  v_ts := (v_res->>'expires_at')::timestamptz;
  IF v_ts < now() + interval '27 days' OR v_ts > now() + interval '29 days' THEN RAISE EXCEPTION 'FAIL 9: expiry %', v_ts; END IF;
  SELECT total INTO v_total FROM user_points_totals WHERE user_id = v_c;
  IF v_total <> 510 THEN RAISE EXCEPTION 'FAIL 9: creator total after royalty %', v_total; END IF;
  SELECT count(*) INTO v_count FROM points_ledger WHERE transfer_id = v_tid5 AND reason = 'intent_royalty' AND user_id = v_c AND amount = 10 AND counterparty_id = v_a;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL 9: royalty row'; END IF;
  SELECT count(*) INTO v_count FROM points_ledger WHERE transfer_id = v_tid5 AND reason = 'intent_purchase' AND user_id = v_a AND amount = -10 AND intent_id = v_pub;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL 9: purchase row'; END IF;
  v_res := purchase_intent(v_b, v_pub, 'hot', v_tid6);
  IF v_res->>'status' <> 'ok' OR (v_res->>'price')::int <> 20 OR (v_res->>'balance')::int <> 530 THEN RAISE EXCEPTION 'FAIL 9: hot purchase %', v_res; END IF;
  SELECT total INTO v_total FROM user_points_totals WHERE user_id = v_c;
  IF v_total <> 520 THEN RAISE EXCEPTION 'FAIL 9: creator total after second royalty %', v_total; END IF;
  IF (purchase_intent(v_a, v_pub, 'search', v_tid5))->>'status' <> 'duplicate' THEN RAISE EXCEPTION 'FAIL 9: duplicate purchase'; END IF;

  -- 10. Own public free (no ledger rows, never expires); own private free, 7 days; preset free.
  v_res := purchase_intent(v_c, v_pub, 'search', v_tid7);
  IF v_res->>'status' <> 'ok' OR (v_res->>'price')::int <> 0 OR v_res->'expires_at' <> 'null'::jsonb THEN RAISE EXCEPTION 'FAIL 10: own public %', v_res; END IF;
  SELECT count(*) INTO v_count FROM points_ledger WHERE transfer_id = v_tid7;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL 10: own purchase wrote ledger rows'; END IF;
  v_res := purchase_intent(v_c, v_priv, 'created', NULL);
  IF v_res->>'status' <> 'ok' OR (v_res->>'price')::int <> 0 THEN RAISE EXCEPTION 'FAIL 10: own private %', v_res; END IF;
  v_ts := (v_res->>'expires_at')::timestamptz;
  IF v_ts < now() + interval '6 days' OR v_ts > now() + interval '8 days' THEN RAISE EXCEPTION 'FAIL 10: private expiry %', v_ts; END IF;
  SELECT id INTO v_preset FROM intents WHERE kind = 'preset' AND visibility = 'public' AND slug = 'light-chat';
  IF v_preset IS NULL THEN RAISE EXCEPTION 'FAIL 10: preset light-chat not seeded'; END IF;
  v_res := purchase_intent(v_a, v_preset, 'preset', NULL);
  IF v_res->>'status' <> 'ok' OR (v_res->>'price')::int <> 0 OR v_res->'expires_at' <> 'null'::jsonb THEN RAISE EXCEPTION 'FAIL 10: preset %', v_res; END IF;

  -- 11. Refusals: private intent of someone else, free sources on a paid intent, unknown, no transfer_id.
  IF (purchase_intent(v_a, v_priv, 'search', v_tid8))->>'status' <> 'private' THEN RAISE EXCEPTION 'FAIL 11: private'; END IF;
  IF (purchase_intent(v_a, v_pub, 'preset', v_tid8))->>'status' <> 'bad_source' THEN RAISE EXCEPTION 'FAIL 11: preset source on custom'; END IF;
  IF (purchase_intent(v_a, v_pub, 'created', v_tid8))->>'status' <> 'bad_source' THEN RAISE EXCEPTION 'FAIL 11: created source by non-owner'; END IF;
  IF (purchase_intent(v_a, v_pub, 'bogus', v_tid8))->>'status' <> 'bad_source' THEN RAISE EXCEPTION 'FAIL 11: bogus source'; END IF;
  IF (purchase_intent(v_a, gen_random_uuid(), 'search', v_tid8))->>'status' <> 'not_found' THEN RAISE EXCEPTION 'FAIL 11: not_found'; END IF;
  IF (purchase_intent(v_a, v_pub, 'search', NULL))->>'status' <> 'bad_input' THEN RAISE EXCEPTION 'FAIL 11: null transfer_id'; END IF;
  SELECT count(*) INTO v_count FROM points_ledger WHERE transfer_id = v_tid8;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL 11: refusals wrote rows'; END IF;

  -- 12. Insufficient: a user with 5 tokens cannot buy at 10; no intent row is created.
  v_res := transfer_tokens(v_d, v_b, 495, NULL, NULL, v_tid9);
  IF v_res->>'status' <> 'ok' THEN RAISE EXCEPTION 'FAIL 12: setup %', v_res; END IF;
  IF (purchase_intent(v_d, v_pub, 'search', v_tid10))->>'status' <> 'insufficient' THEN RAISE EXCEPTION 'FAIL 12: insufficient'; END IF;
  SELECT count(*) INTO v_count FROM user_intents WHERE user_id = v_d AND intent_id = v_pub;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL 12: intent row created without payment'; END IF;

  -- 13. Expired intents are ignored and can be bought again; usage_count counts every purchase.
  UPDATE user_intents SET expires_at = now() - interval '1 day' WHERE user_id = v_a AND intent_id = v_pub;
  SELECT count(*) INTO v_count FROM active_user_intents WHERE user_id = v_a AND intent_id = v_pub;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL 13: expired row still active'; END IF;
  v_res := purchase_intent(v_a, v_pub, 'search', v_tid11);
  IF v_res->>'status' <> 'ok' OR (v_res->>'price')::int <> 10 OR (v_res->>'balance')::int <> 430 THEN RAISE EXCEPTION 'FAIL 13: re-buy %', v_res; END IF;
  SELECT count(*) INTO v_count FROM active_user_intents WHERE user_id = v_a AND intent_id = v_pub AND expires_at > now() + interval '27 days';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL 13: re-bought row not active'; END IF;
  SELECT usage_count INTO v_count FROM intents WHERE id = v_pub;
  IF v_count <> 4 THEN RAISE EXCEPTION 'FAIL 13: usage_count %', v_count; END IF;

  -- 14. Search: prefix on slug, owned/active flags, private only for its creator, wildcards inert.
  SELECT count(*), bool_or(s.owned), bool_and(s.active) INTO v_count, v_bool, v_active
  FROM search_intents(v_a, 'Deep', 5) s WHERE s.id = v_pub;
  IF v_count <> 1 OR v_bool OR NOT v_active THEN RAISE EXCEPTION 'FAIL 14: search as buyer (count %, owned %, active %)', v_count, v_bool, v_active; END IF;
  SELECT bool_and(s.owned AND s.active) INTO v_bool FROM search_intents(v_c, 'deep w', 5) s WHERE s.id = v_pub;
  IF v_bool IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL 14: search as creator'; END IF;
  SELECT count(*) INTO v_count FROM search_intents(v_a, 'secret', 5) s WHERE s.id = v_priv;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL 14: private intent leaked in search'; END IF;
  SELECT count(*) INTO v_count FROM search_intents(v_c, 'secret', 5) s WHERE s.id = v_priv;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL 14: creator cannot search own private intent'; END IF;
  SELECT count(*) INTO v_count FROM search_intents(v_a, '%', 50);
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL 14: % matched % rows', '%', v_count; END IF;
  SELECT count(*) INTO v_count FROM search_intents(v_a, '_', 50);
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL 14: _ matched % rows', v_count; END IF;
  SELECT count(*) INTO v_count FROM search_intents(v_a, 'deep', 1000);
  IF v_count > 50 THEN RAISE EXCEPTION 'FAIL 14: limit not clamped'; END IF;
  SELECT count(*) INTO v_count FROM hot_intents(50) h WHERE h.id = v_pub;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL 14: bought intent missing from hot list'; END IF;
  SELECT count(*) INTO v_count FROM hot_intents(50) h WHERE h.id = v_priv;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL 14: private intent in hot list'; END IF;
  SELECT count(*) INTO v_count FROM location_intents();
  IF v_count < 15 THEN RAISE EXCEPTION 'FAIL 14: location intents seeded %', v_count; END IF;

  -- 15. Rank: equal totals share a rank; a higher total ranks strictly above.
  IF points_rank_of(v_e) <> points_rank_of(v_f) THEN RAISE EXCEPTION 'FAIL 15: tie ranks % and %', points_rank_of(v_e), points_rank_of(v_f); END IF;
  IF points_rank_of(v_b) >= points_rank_of(v_e) THEN RAISE EXCEPTION 'FAIL 15: richer user ranks lower'; END IF;
  SELECT count(*) INTO v_count FROM points_leaderboard(10);
  IF v_count > 10 THEN RAISE EXCEPTION 'FAIL 15: leaderboard limit'; END IF;

  -- 16. Near by: no location -> no_location; nearest online user without raw coordinates.
  UPDATE users SET lat = 51.5074, lng = -0.1278, city = 'London', location_updated_at = now() WHERE id = v_a;
  UPDATE users SET lat = 48.8566, lng = 2.3522, city = 'Paris', location_updated_at = now() WHERE id = v_b;
  INSERT INTO user_presence (user_id, last_seen_at) VALUES (v_b, now());
  v_res := nearby_user_intents(v_c);
  IF v_res->>'status' <> 'no_location' THEN RAISE EXCEPTION 'FAIL 16: no location %', v_res; END IF;
  v_res := nearby_user_intents(v_a);
  IF v_res->>'status' <> 'ok' OR (v_res->'user'->>'id')::uuid <> v_b THEN RAISE EXCEPTION 'FAIL 16: nearest %', v_res; END IF;
  IF v_res->'user' ? 'lat' OR v_res->'user' ? 'lng' THEN RAISE EXCEPTION 'FAIL 16: raw coordinates returned %', v_res; END IF;
  v_num := (v_res->'user'->>'distance_km')::numeric;
  IF v_num < 330 OR v_num > 360 THEN RAISE EXCEPTION 'FAIL 16: London-Paris distance %', v_num; END IF;
  SELECT count(*) INTO v_count FROM jsonb_array_elements(v_res->'intents') e WHERE (e->>'id')::uuid = v_pub;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL 16: neighbour intents %', v_res->'intents'; END IF;

  -- 17. Spark: custom intent names are accepted (2..40), 1 char is not.
  BEGIN
    INSERT INTO match_queue (user_id, mode, intent) VALUES (v_e, 'text', 'x');
    RAISE EXCEPTION 'FAIL 17: one-char intent accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 18. Match fallback: different intents do not pair before 60 s; after 60 s a shared active
  --     intent pairs them with fallback = true. Exact matches report fallback = false.
  INSERT INTO match_queue (user_id, mode, intent) VALUES (v_a, 'text', 'Deep Work');
  INSERT INTO match_queue (user_id, mode, intent) VALUES (v_b, 'text', 'Brainstorm');
  v_res := match_waiting_user(v_a);
  IF v_res->>'status' <> 'waiting' THEN RAISE EXCEPTION 'FAIL 18: paired before 60 s: %', v_res; END IF;
  UPDATE match_queue SET enqueued_at = now() - interval '61 seconds' WHERE user_id = v_a AND status = 'waiting';
  v_res := match_waiting_user(v_a);
  IF v_res->>'status' <> 'matched' OR (v_res->>'partner_user_id')::uuid <> v_b OR (v_res->>'fallback')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL 18: fallback did not pair A with B: %', v_res;
  END IF;
  INSERT INTO match_queue (user_id, mode, intent) VALUES (v_e, 'video', 'Gardening'), (v_f, 'video', 'Gardening');
  v_res := match_waiting_user(v_f);
  IF v_res->>'status' <> 'matched' OR (v_res->>'partner_user_id')::uuid <> v_e OR (v_res->>'fallback')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FAIL 18: exact match: %', v_res;
  END IF;

  RAISE NOTICE 'tokens and intents tests passed';
END $$;

ROLLBACK;

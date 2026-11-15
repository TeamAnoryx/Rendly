-- Spark deferred charge: pairing is free; a pair is charged only once the match has lasted
-- 30 seconds.
-- Run after 20250625_spark_v2*.sql and 20261115_huddle_edits.sql, then
-- 20261116_spark_deferred_charge_index.sql on its own. Safe to run more than once.
--
-- Model (must stay equal to services/auth-service/src/spark-rules.ts):
--   * match_waiting_user pairs two waiting rows without touching points_ledger. Both rows get
--     status = 'matched', charged = false and charge_state = 'pending'. The balance check at
--     pairing time is kept: a side that cannot afford its own cost is still 'insufficient'.
--   * spark_settle_pairing(p_user_id, p_end) settles the caller's latest matched pair:
--       - pending and the match lasted >= 30s (now, or the moment it ended): each side is
--         debited its OWN cost once (transfer_id = its queue row id, reason/category
--         'spark_match'), charged = true and charge_state = 'charged' on both rows;
--       - pending and the match ended (p_end, or ended_at already set) before 30s: both rows
--         become 'waived', no ledger rows;
--       - p_end also stamps ended_at = now() on both rows (after the charge decision).
--     'charged' and 'waived' rows never change again, so the call is idempotent.
--   * A balance never goes negative: if a side spent tokens between pairing and settling, it
--     is debited at most its current balance (possibly nothing) and the row still counts as
--     charged.
--   * charge_state is NULL for rows that were never matched.

-- ---------------------------------------------------------------------------
-- match_queue.charge_state
-- ---------------------------------------------------------------------------
ALTER TABLE match_queue ADD COLUMN IF NOT EXISTS charge_state TEXT;

ALTER TABLE match_queue DROP CONSTRAINT IF EXISTS match_queue_charge_state_check;
ALTER TABLE match_queue ADD CONSTRAINT match_queue_charge_state_check
  CHECK (charge_state IS NULL OR charge_state IN ('pending', 'charged', 'waived'));

-- Backfill rows matched under the v2 (charge-at-pairing) model.
UPDATE match_queue SET charge_state = 'charged'
WHERE status = 'matched' AND charged AND charge_state IS NULL;
UPDATE match_queue SET charge_state = 'waived'
WHERE status = 'matched' AND NOT charged AND charge_state IS NULL;

-- ---------------------------------------------------------------------------
-- Trigger: v2 semantics (intent = intents[1], priced on insert, intents / cost / user_id
-- immutable, charged stays true) plus charge_state rules:
--   * insert: charge_state is always NULL;
--   * 'charged' and 'waived' never change; a charged row is always 'charged';
--   * nothing moves back to NULL or 'pending' once settled.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION match_queue_spark_v2_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.intents IS NULL OR cardinality(NEW.intents) = 0 THEN
      NEW.intents := CASE WHEN NEW.intent IS NULL THEN '{}'::TEXT[] ELSE ARRAY[NEW.intent] END;
    ELSE
      -- Flatten to a plain 1-based, 1-dimensional array.
      NEW.intents := ARRAY(SELECT x FROM unnest(NEW.intents) AS x);
      NEW.intent := NEW.intents[1];
    END IF;
    NEW.cost := (SELECT COALESCE(SUM(spark_intent_price(x)), 0) FROM unnest(NEW.intents) AS x);
    NEW.charged := false;
    NEW.charge_state := NULL;
    NEW.shared_intents := NULL;
    NEW.cancel_reason := NULL;
  ELSE
    NEW.intents := OLD.intents;
    NEW.intent := OLD.intent;
    NEW.cost := OLD.cost;
    NEW.user_id := OLD.user_id;
    -- A charged row stays charged.
    IF OLD.charged THEN
      NEW.charged := true;
      NEW.charge_state := 'charged';
    ELSIF OLD.charge_state IN ('charged', 'waived') THEN
      -- Settled rows are final.
      NEW.charge_state := OLD.charge_state;
    ELSIF OLD.charge_state = 'pending' AND NEW.charge_state IS NULL THEN
      NEW.charge_state := 'pending';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION match_queue_spark_v2_row() FROM PUBLIC;
REVOKE ALL ON FUNCTION match_queue_spark_v2_row() FROM anon, authenticated;

DROP TRIGGER IF EXISTS trg_match_queue_spark_v2_row ON match_queue;
CREATE TRIGGER trg_match_queue_spark_v2_row
  BEFORE INSERT OR UPDATE ON match_queue
  FOR EACH ROW EXECUTE FUNCTION match_queue_spark_v2_row();

-- ---------------------------------------------------------------------------
-- match_waiting_user, replacing the 20250625 version (same signature). Identical pairing,
-- locking and balance checks; the pair is NOT charged here (see spark_settle_pairing).
-- Returns jsonb:
--   {status:'none'}
--   {status:'waiting', queue_id}
--   {status:'insufficient', cost, balance}  the caller cannot pay; their row is cancelled
--   {status:'matched', queue_id, partner_queue_id, partner_user_id, mode, partner_mode,
--    shared_intents, partner_note, partner_anonymous, partner_username (NULL if anonymous),
--    initiator, cost_charged (always 0), matched_at, cost, charge_state ('pending'),
--    settles_at (matched_at + 30s)}
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION match_waiting_user(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_self match_queue%ROWTYPE;
  v_cand match_queue%ROWTYPE;
  v_self_eff TEXT[];
  v_self_lower TEXT[];
  v_cand_eff TEXT[];
  v_shared TEXT[];
  v_self_balance BIGINT;
  v_cand_balance BIGINT;
  v_username TEXT;
  v_now TIMESTAMPTZ := now();
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'none');
  END IF;

  SELECT * INTO v_self FROM match_queue
  WHERE user_id = p_user_id AND status = 'waiting'
  ORDER BY enqueued_at DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'none');
  END IF;

  -- Only the newest waiting row may be matched; any older one is cancelled.
  UPDATE match_queue SET status = 'cancelled'
  WHERE user_id = p_user_id AND status = 'waiting' AND id <> v_self.id;

  v_self_eff := spark_effective_intents(p_user_id, v_self.intents);
  IF cardinality(v_self_eff) = 0 THEN
    RETURN jsonb_build_object('status', 'waiting', 'queue_id', v_self.id);
  END IF;
  v_self_lower := ARRAY(SELECT lower(x) FROM unnest(v_self_eff) AS x);

  FOR v_cand IN
    SELECT q.* FROM match_queue q
    WHERE q.status = 'waiting'
      AND q.mode = v_self.mode
      AND q.user_id <> p_user_id
      AND NOT q.charged
      AND EXISTS (SELECT 1 FROM unnest(q.intents) AS y WHERE lower(y) = ANY (v_self_lower))
      AND NOT EXISTS (
        SELECT 1 FROM user_blocks b
        WHERE (b.blocker_id = p_user_id AND b.blocked_id = q.user_id)
           OR (b.blocker_id = q.user_id AND b.blocked_id = p_user_id)
      )
    ORDER BY q.enqueued_at
    LIMIT 50
    FOR UPDATE OF q SKIP LOCKED
  LOOP
    -- Drop intents either side no longer holds, then recompute the overlap.
    v_cand_eff := spark_effective_intents(v_cand.user_id, v_cand.intents);
    v_shared := ARRAY(
      SELECT t.x FROM unnest(v_self_eff) WITH ORDINALITY AS t(x, ord)
      WHERE lower(t.x) IN (SELECT lower(y) FROM unnest(v_cand_eff) AS y)
      ORDER BY t.ord
    );
    CONTINUE WHEN cardinality(v_shared) = 0;

    -- Same try-locks as v2 (hashtext(user_id::text), uuid order); a busy payer is skipped.
    CONTINUE WHEN NOT pg_try_advisory_xact_lock(hashtext(LEAST(p_user_id, v_cand.user_id)::text));
    CONTINUE WHEN NOT pg_try_advisory_xact_lock(hashtext(GREATEST(p_user_id, v_cand.user_id)::text));

    SELECT COALESCE(SUM(amount), 0) INTO v_cand_balance FROM points_ledger WHERE user_id = v_cand.user_id;
    IF v_cand_balance < v_cand.cost THEN
      UPDATE match_queue SET status = 'cancelled', cancel_reason = 'insufficient' WHERE id = v_cand.id;
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_self_balance FROM points_ledger WHERE user_id = p_user_id;
    IF v_self_balance < v_self.cost THEN
      UPDATE match_queue SET status = 'cancelled', cancel_reason = 'insufficient' WHERE id = v_self.id;
      RETURN jsonb_build_object('status', 'insufficient', 'cost', v_self.cost, 'balance', v_self_balance);
    END IF;

    -- Deferred charge: pair now, settle later (spark_settle_pairing).
    UPDATE match_queue
    SET status = 'matched', matched_at = v_now, partner_user_id = p_user_id,
        charged = false, charge_state = 'pending', shared_intents = v_shared
    WHERE id = v_cand.id;
    UPDATE match_queue
    SET status = 'matched', matched_at = v_now, partner_user_id = v_cand.user_id,
        charged = false, charge_state = 'pending', shared_intents = v_shared
    WHERE id = v_self.id;

    IF NOT v_cand.anonymous THEN
      SELECT username INTO v_username FROM users WHERE id = v_cand.user_id;
    END IF;

    RETURN jsonb_build_object(
      'status', 'matched',
      'queue_id', v_self.id,
      'partner_queue_id', v_cand.id,
      'partner_user_id', v_cand.user_id,
      'mode', v_self.mode,
      'partner_mode', v_cand.mode,
      'shared_intents', to_jsonb(v_shared),
      'partner_note', v_cand.note,
      'partner_anonymous', v_cand.anonymous,
      'partner_username', CASE WHEN v_cand.anonymous THEN NULL ELSE v_username END,
      'initiator', p_user_id < v_cand.user_id,
      'cost_charged', 0,
      'matched_at', v_now,
      'cost', v_self.cost,
      'charge_state', 'pending',
      'settles_at', v_now + interval '30 seconds'
    );
  END LOOP;

  RETURN jsonb_build_object('status', 'waiting', 'queue_id', v_self.id);
END;
$$;

REVOKE ALL ON FUNCTION match_waiting_user(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION match_waiting_user(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION match_waiting_user(UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- spark_charge_row: debit one matched row its own cost (internal helper; the caller holds
-- the ledger advisory lock and the row lock). Never drives the balance below zero and never
-- writes a second debit for the same row (transfer_id = row id, plus
-- uq_points_ledger_transfer_side). Marks the row charged.
-- ---------------------------------------------------------------------------
-- Older draft signature (never shipped) is dropped so re-runs leave one helper.
DROP FUNCTION IF EXISTS spark_charge_row(match_queue, UUID);

CREATE OR REPLACE FUNCTION spark_charge_row(p_row match_queue)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_balance BIGINT;
  v_amount BIGINT;
BEGIN
  IF p_row.id IS NULL OR p_row.charged THEN
    RETURN;
  END IF;

  IF p_row.cost > 0
     AND NOT EXISTS (SELECT 1 FROM points_ledger WHERE transfer_id = p_row.id AND amount < 0) THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_balance FROM points_ledger WHERE user_id = p_row.user_id;
    -- Spent elsewhere since pairing: take what is left, never go negative.
    v_amount := LEAST(p_row.cost::BIGINT, GREATEST(v_balance, 0));
    IF v_amount > 0 THEN
      INSERT INTO points_ledger (user_id, amount, reason, category, counterparty_id, transfer_id, note)
      -- counterparty_id stays NULL like v2: an anonymous partner must not appear in history.
      VALUES (p_row.user_id, -v_amount::INT, 'spark_match', 'spark_match', NULL, p_row.id, 'Spark match');
    END IF;
  END IF;

  UPDATE match_queue SET charged = true, charge_state = 'charged' WHERE id = p_row.id;
END;
$$;

REVOKE ALL ON FUNCTION spark_charge_row(match_queue) FROM PUBLIC;
REVOKE ALL ON FUNCTION spark_charge_row(match_queue) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION spark_charge_row(match_queue) TO service_role;

-- ---------------------------------------------------------------------------
-- spark_settle_pairing: settle (and with p_end, end) the caller's latest matched pairing of
-- the last 24 hours. Idempotent.
-- Returns jsonb:
--   {status:'none'}
--   {status:'ok', queue_id, state ('pending'|'charged'|'waived'), cost, settles_at,
--    matched_at, ended}
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION spark_settle_pairing(p_user_id UUID, p_end BOOLEAN DEFAULT false)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_own match_queue%ROWTYPE;
  v_partner match_queue%ROWTYPE;
  v_row match_queue%ROWTYPE;
  v_partner_id UUID;
  v_now TIMESTAMPTZ := now();
  v_settles TIMESTAMPTZ;
  v_ended TIMESTAMPTZ;
  v_end_at TIMESTAMPTZ;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'none');
  END IF;

  -- Unlocked read to learn the partner, so the ledger locks can be taken first (same order
  -- as every debit: advisory lock, then rows).
  SELECT * INTO v_own FROM match_queue
  WHERE user_id = p_user_id AND status = 'matched'
    AND matched_at > v_now - interval '24 hours'
  ORDER BY matched_at DESC, id DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'none');
  END IF;
  v_partner_id := v_own.partner_user_id;

  IF v_partner_id IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));
  ELSE
    PERFORM pg_advisory_xact_lock(hashtext(LEAST(p_user_id, v_partner_id)::text));
    PERFORM pg_advisory_xact_lock(hashtext(GREATEST(p_user_id, v_partner_id)::text));
  END IF;

  -- Lock both rows in id order (deadlock-safe), then re-read them.
  FOR v_row IN
    SELECT q.* FROM match_queue q
    WHERE q.id = v_own.id
       OR q.id = (
         SELECT p.id FROM match_queue p
         WHERE p.user_id = v_partner_id AND p.partner_user_id = p_user_id
           AND p.status = 'matched' AND p.matched_at > v_now - interval '24 hours'
         ORDER BY p.matched_at DESC, p.id DESC
         LIMIT 1
       )
    ORDER BY q.id
    FOR UPDATE
  LOOP
    IF v_row.id = v_own.id THEN
      v_own := v_row;
    ELSE
      v_partner := v_row;
    END IF;
  END LOOP;

  IF v_own.status IS DISTINCT FROM 'matched' THEN
    RETURN jsonb_build_object('status', 'none');
  END IF;

  v_settles := v_own.matched_at + interval '30 seconds';
  -- When the pairing ended: the earliest ended_at of either side (LEAST skips NULLs), else
  -- now() if this call ends it.
  v_ended := LEAST(v_own.ended_at, v_partner.ended_at);
  v_end_at := COALESCE(v_ended, CASE WHEN p_end THEN v_now END);

  IF COALESCE(v_own.charge_state, 'pending') = 'pending' AND NOT v_own.charged THEN
    IF COALESCE(v_end_at, v_now) >= v_settles AND v_now >= v_settles THEN
      PERFORM spark_charge_row(v_own);
      IF v_partner.id IS NOT NULL THEN
        PERFORM spark_charge_row(v_partner);
      END IF;
    ELSIF v_end_at IS NOT NULL THEN
      UPDATE match_queue SET charge_state = 'waived'
      WHERE id IN (v_own.id, v_partner.id) AND NOT charged
        AND COALESCE(charge_state, 'pending') = 'pending';
    END IF;
  ELSIF v_partner.id IS NOT NULL AND NOT v_partner.charged
        AND COALESCE(v_partner.charge_state, 'pending') = 'pending' THEN
    -- Repair a half-settled pair: the partner follows the caller's final state.
    IF v_own.charge_state = 'charged' OR v_own.charged THEN
      PERFORM spark_charge_row(v_partner);
    ELSIF v_own.charge_state = 'waived' THEN
      UPDATE match_queue SET charge_state = 'waived' WHERE id = v_partner.id;
    END IF;
  END IF;

  IF p_end THEN
    UPDATE match_queue SET ended_at = v_now
    WHERE id IN (v_own.id, v_partner.id) AND ended_at IS NULL;
  END IF;

  SELECT * INTO v_own FROM match_queue WHERE id = v_own.id;

  RETURN jsonb_build_object(
    'status', 'ok',
    'queue_id', v_own.id,
    'state', COALESCE(v_own.charge_state, CASE WHEN v_own.charged THEN 'charged' ELSE 'pending' END),
    'cost', v_own.cost,
    'settles_at', v_settles,
    'matched_at', v_own.matched_at,
    'ended', v_own.ended_at IS NOT NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION spark_settle_pairing(UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION spark_settle_pairing(UUID, BOOLEAN) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION spark_settle_pairing(UUID, BOOLEAN) TO service_role;

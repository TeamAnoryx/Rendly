-- Huddle tips: participants can send Rendly Tokens to the host.
-- Re-runnable. Adds huddles.tips_enabled (default on), the 'huddle_tip' ledger kind and
-- huddle_tip_host(), which moves tokens from an admitted participant to the huddle host.

ALTER TABLE huddles ADD COLUMN IF NOT EXISTS tips_enabled BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE points_ledger DROP CONSTRAINT IF EXISTS points_ledger_reason_check;
ALTER TABLE points_ledger ADD CONSTRAINT points_ledger_reason_check
  CHECK (reason IN ('signup_bonus', 'huddle_award', 'huddle_send', 'transfer', 'intent_purchase', 'intent_royalty', 'spark_match', 'huddle_tip'));
ALTER TABLE points_ledger DROP CONSTRAINT IF EXISTS points_ledger_category_check;
ALTER TABLE points_ledger ADD CONSTRAINT points_ledger_category_check
  CHECK (category IN ('signup', 'huddle_award', 'huddle_send', 'transfer', 'intent_purchase', 'intent_royalty', 'spark_match', 'huddle_tip'));

-- ---------------------------------------------------------------------------
-- huddle_tip_host: an admitted participant sends tokens to the host from their own balance.
-- Gated on huddles.tips_enabled. Amount 1..1000, optional note (140 chars).
-- Returns: ok | not_found | is_host | tips_off | not_in_room | bad_amount | bad_note
--          | bad_input | insufficient | duplicate.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION huddle_tip_host(
  p_huddle_id UUID, p_sender_id UUID, p_amount INT, p_note TEXT, p_transfer_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_huddle huddles%ROWTYPE;
  v_balance BIGINT;
  v_note TEXT := NULLIF(btrim(p_note), '');
BEGIN
  IF p_huddle_id IS NULL OR p_sender_id IS NULL THEN
    RETURN 'not_found';
  END IF;
  SELECT * INTO v_huddle FROM huddles WHERE id = p_huddle_id;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  IF v_huddle.created_by = p_sender_id THEN
    RETURN 'is_host';
  END IF;
  IF NOT v_huddle.tips_enabled THEN
    RETURN 'tips_off';
  END IF;
  IF p_amount IS NULL OR p_amount < 1 OR p_amount > 1000 THEN
    RETURN 'bad_amount';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 140 THEN
    RETURN 'bad_note';
  END IF;
  IF p_transfer_id IS NULL THEN
    RETURN 'bad_input';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM huddle_participants
    WHERE huddle_id = p_huddle_id AND user_id = p_sender_id AND left_at IS NULL AND admitted
  ) THEN
    RETURN 'not_in_room';
  END IF;

  -- Serialise every debit of this sender.
  PERFORM pg_advisory_xact_lock(hashtext(p_sender_id::text));

  IF EXISTS (SELECT 1 FROM points_ledger WHERE transfer_id = p_transfer_id) THEN
    RETURN 'duplicate';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_balance FROM points_ledger WHERE user_id = p_sender_id;
  IF v_balance < p_amount THEN
    RETURN 'insufficient';
  END IF;

  INSERT INTO points_ledger
    (user_id, amount, reason, category, huddle_id, awarded_by, counterparty_id, note, transfer_id)
  VALUES
    (p_sender_id, -p_amount, 'huddle_tip', 'huddle_tip', p_huddle_id, p_sender_id, v_huddle.created_by, v_note, p_transfer_id);
  INSERT INTO points_ledger
    (user_id, amount, reason, category, huddle_id, awarded_by, counterparty_id, note, transfer_id)
  VALUES
    (v_huddle.created_by, p_amount, 'huddle_tip', 'huddle_tip', p_huddle_id, p_sender_id, p_sender_id, v_note, p_transfer_id);
  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION huddle_tip_host(UUID, UUID, INT, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION huddle_tip_host(UUID, UUID, INT, TEXT, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION huddle_tip_host(UUID, UUID, INT, TEXT, UUID) TO service_role;

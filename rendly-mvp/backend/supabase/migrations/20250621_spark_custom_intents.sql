-- Spark with custom intents: the queue accepts any intent name (2..40 chars) and, after
-- 60 seconds of waiting, a user is paired with anyone in the same mode who shares one of
-- their active intents. Run after 20250620_intents.sql. Safe to run more than once.

-- ---------------------------------------------------------------------------
-- match_queue.intent: free text instead of the four preset names.
-- ---------------------------------------------------------------------------
ALTER TABLE match_queue DROP CONSTRAINT IF EXISTS match_queue_intent_check;
ALTER TABLE match_queue DROP CONSTRAINT IF EXISTS match_queue_intent_length_check;
ALTER TABLE match_queue ADD CONSTRAINT match_queue_intent_length_check
  CHECK (char_length(intent) BETWEEN 2 AND 40);

-- ---------------------------------------------------------------------------
-- match_waiting_user, replacing the 20250615 version (same signature).
-- 1. Exact match: oldest waiting user with the same mode and intent.
-- 2. Fallback, only once the caller has waited more than 60 seconds: oldest waiting user with
--    the same mode who holds at least one of the caller's active intents (active_user_intents).
-- Both rows are locked, so two concurrent calls cannot pair the same person twice.
-- Returns jsonb: {status:'waiting', queue_id}
--              | {status:'matched', queue_id, partner_user_id, mode, intent, partner_intent,
--                 matched_at, fallback}
--              | {status:'none'} when the user has no waiting entry.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION match_waiting_user(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_self match_queue%ROWTYPE;
  v_partner match_queue%ROWTYPE;
  v_now TIMESTAMPTZ := now();
  v_fallback BOOLEAN := false;
BEGIN
  SELECT * INTO v_self FROM match_queue
  WHERE user_id = p_user_id AND status = 'waiting'
  ORDER BY enqueued_at DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'none');
  END IF;

  SELECT * INTO v_partner FROM match_queue
  WHERE status = 'waiting'
    AND mode = v_self.mode
    AND intent = v_self.intent
    AND user_id <> p_user_id
  ORDER BY enqueued_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND AND v_now - v_self.enqueued_at > interval '60 seconds' THEN
    SELECT q.* INTO v_partner FROM match_queue q
    WHERE q.status = 'waiting'
      AND q.mode = v_self.mode
      AND q.user_id <> p_user_id
      AND EXISTS (
        SELECT 1
        FROM active_user_intents mine
        JOIN active_user_intents theirs ON theirs.intent_id = mine.intent_id
        WHERE mine.user_id = p_user_id AND theirs.user_id = q.user_id
      )
    ORDER BY q.enqueued_at
    LIMIT 1
    FOR UPDATE OF q SKIP LOCKED;
    v_fallback := FOUND;
  END IF;

  IF v_partner.id IS NULL THEN
    RETURN jsonb_build_object('status', 'waiting', 'queue_id', v_self.id);
  END IF;

  UPDATE match_queue
  SET status = 'matched', matched_at = v_now, partner_user_id = p_user_id
  WHERE id = v_partner.id;

  UPDATE match_queue
  SET status = 'matched', matched_at = v_now, partner_user_id = v_partner.user_id
  WHERE id = v_self.id;

  RETURN jsonb_build_object(
    'status', 'matched',
    'queue_id', v_self.id,
    'partner_user_id', v_partner.user_id,
    'mode', v_self.mode,
    'intent', v_self.intent,
    'partner_intent', v_partner.intent,
    'matched_at', v_now,
    'fallback', v_fallback
  );
END;
$$;

REVOKE ALL ON FUNCTION match_waiting_user(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION match_waiting_user(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION match_waiting_user(UUID) TO service_role;

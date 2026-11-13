-- Spark v2: multi-intent matching (1..5 intents per queue entry), a short note, anonymous
-- matching, a per-match price in Rendly Tokens charged once to each side, and free
-- user-created location intents (city / country).
-- Run after 20250624_account_linking*.sql, then 20250625_spark_v2_index.sql,
-- 20250625_spark_v2_index_2.sql and 20250625_spark_v2_index_3.sql, each on its own.
-- Safe to run more than once.
--
-- Rules (must stay equal to services/auth-service/src/spark-rules.ts):
--   * price per intent: 5 for the presets Light chat / Brainstorm / Motivation / Collaborate
--     (case-insensitive), 10 for anything else (spark_intent_price = sparkIntentPrice).
--   * cost of a queue entry = sum of its intent prices, fixed at enqueue by a trigger, so a
--     client can never pick its own price.
--   * a match charges each side its own cost exactly once: one ledger debit per queue row,
--     transfer_id = the queue row id (uq_points_ledger_transfer_side forbids a second debit)
--     and charged = true on the row.
--   * non-preset intents must still be held (active_user_intents) when the match is made.

-- ---------------------------------------------------------------------------
-- spark_intent_price: tokens one intent adds to the cost of a Spark.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION spark_intent_price(p_name TEXT)
RETURNS INT
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT CASE
    WHEN lower(p_name) IN ('light chat', 'brainstorm', 'motivation', 'collaborate') THEN 5
    ELSE 10
  END;
$$;

REVOKE ALL ON FUNCTION spark_intent_price(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION spark_intent_price(TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION spark_intent_price(TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- spark_intents_valid: 1..5 non-null names of 2..40 characters (used by the CHECK below).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION spark_intents_valid(p_intents TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(
    cardinality(p_intents) BETWEEN 1 AND 5
    AND NOT EXISTS (
      SELECT 1 FROM unnest(p_intents) AS x
      WHERE x IS NULL OR char_length(x) < 2 OR char_length(x) > 40
    ),
    false);
$$;

REVOKE ALL ON FUNCTION spark_intents_valid(TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION spark_intents_valid(TEXT[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION spark_intents_valid(TEXT[]) TO service_role;

-- ---------------------------------------------------------------------------
-- match_queue: new columns.
-- ---------------------------------------------------------------------------
ALTER TABLE match_queue ADD COLUMN IF NOT EXISTS intents TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE match_queue ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE match_queue ADD COLUMN IF NOT EXISTS anonymous BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE match_queue ADD COLUMN IF NOT EXISTS cost INT NOT NULL DEFAULT 0;
ALTER TABLE match_queue ADD COLUMN IF NOT EXISTS charged BOOLEAN NOT NULL DEFAULT false;
-- Intents both sides had in common when the match was made (caller's spelling).
ALTER TABLE match_queue ADD COLUMN IF NOT EXISTS shared_intents TEXT[];
-- Why a row was cancelled by the matcher ('insufficient'); NULL for a user's own cancel.
ALTER TABLE match_queue ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
-- When a matched pairing was ended (skip, leave, close or disconnect). Set on both rows of the
-- pair; an ended pairing can no longer be joined in the Spark room or used for ICE servers.
ALTER TABLE match_queue ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;

-- Backfill: every older row gets its single intent as the intents list.
UPDATE match_queue SET intents = ARRAY[intent] WHERE cardinality(intents) = 0;

-- Older waiting rows were priced at 0 by the column default; drop them so nobody is matched
-- for free. New rows always cost >= 5, so a re-run never touches them.
UPDATE match_queue SET status = 'cancelled' WHERE status = 'waiting' AND cost = 0;

ALTER TABLE match_queue DROP CONSTRAINT IF EXISTS match_queue_intents_check;
ALTER TABLE match_queue ADD CONSTRAINT match_queue_intents_check
  CHECK (spark_intents_valid(intents) OR (status <> 'waiting' AND cardinality(intents) = 0));
ALTER TABLE match_queue DROP CONSTRAINT IF EXISTS match_queue_note_check;
ALTER TABLE match_queue ADD CONSTRAINT match_queue_note_check
  CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 200);
ALTER TABLE match_queue DROP CONSTRAINT IF EXISTS match_queue_cost_check;
ALTER TABLE match_queue ADD CONSTRAINT match_queue_cost_check CHECK (cost >= 0 AND cost <= 1000);
ALTER TABLE match_queue DROP CONSTRAINT IF EXISTS match_queue_charged_check;
ALTER TABLE match_queue ADD CONSTRAINT match_queue_charged_check CHECK (NOT charged OR status = 'matched');
ALTER TABLE match_queue DROP CONSTRAINT IF EXISTS match_queue_cancel_reason_check;
ALTER TABLE match_queue ADD CONSTRAINT match_queue_cancel_reason_check
  CHECK (cancel_reason IS NULL OR cancel_reason IN ('insufficient'));

-- ---------------------------------------------------------------------------
-- Trigger: keep intent = intents[1] (legacy single-intent inserts still work), price the row
-- from its intents on insert, and make intents / cost immutable afterwards.
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
-- points_ledger: 'spark_match' reason and category (every earlier value kept).
-- ---------------------------------------------------------------------------
ALTER TABLE points_ledger DROP CONSTRAINT IF EXISTS points_ledger_reason_check;
ALTER TABLE points_ledger ADD CONSTRAINT points_ledger_reason_check
  CHECK (reason IN ('signup_bonus', 'huddle_award', 'huddle_send', 'transfer', 'intent_purchase', 'intent_royalty', 'spark_match'));
ALTER TABLE points_ledger DROP CONSTRAINT IF EXISTS points_ledger_category_check;
ALTER TABLE points_ledger ADD CONSTRAINT points_ledger_category_check
  CHECK (category IN ('signup', 'huddle_award', 'huddle_send', 'transfer', 'intent_purchase', 'intent_royalty', 'spark_match'));

-- ---------------------------------------------------------------------------
-- spark_effective_intents: the subset of p_intents p_user_id may still match on, in order.
-- Presets always count; any other name only while the user holds an intent of that name.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION spark_effective_intents(p_user_id UUID, p_intents TEXT[])
RETURNS TEXT[]
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(t.x ORDER BY t.ord), '{}'::TEXT[])
  FROM unnest(p_intents) WITH ORDINALITY AS t(x, ord)
  WHERE spark_intent_price(t.x) = 5
     OR EXISTS (
       SELECT 1
       FROM active_user_intents a
       JOIN intents i ON i.id = a.intent_id
       WHERE a.user_id = p_user_id AND lower(i.name) = lower(t.x)
     );
$$;

REVOKE ALL ON FUNCTION spark_effective_intents(UUID, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION spark_effective_intents(UUID, TEXT[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION spark_effective_intents(UUID, TEXT[]) TO service_role;

-- ---------------------------------------------------------------------------
-- match_waiting_user, replacing the 20250621 version (same signature).
-- Pairs the caller's newest waiting row with the oldest waiting row of another user in the
-- same mode that shares at least one (still held) intent, case-insensitively, skipping
-- blocked pairs. Both users are locked (same advisory key as every other debit) before
-- their balances are read; each side is charged its own fixed cost once.
-- Returns jsonb:
--   {status:'none'}                         the caller has no waiting row
--   {status:'waiting', queue_id}
--   {status:'insufficient', cost, balance}  the caller cannot pay; their row is cancelled
--   {status:'matched', queue_id, partner_queue_id, partner_user_id, mode, partner_mode,
--    shared_intents, partner_note, partner_anonymous, partner_username (NULL if anonymous),
--    initiator, cost_charged}
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

  -- Only the newest waiting row may be matched; any older one (from before
  -- uq_match_queue_one_waiting existed) is cancelled so it can never be matched or charged.
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

    -- Lock both payers in uuid order; same key as transfer_tokens / purchase_intent /
    -- spark_enqueue (hashtext(user_id::text)). Try-locks: this loop already holds row locks,
    -- so waiting here could deadlock with spark_enqueue (advisory lock, then row lock). A busy
    -- payer is skipped and retried on the next poll.
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

    -- Charge once per row: the row must still be uncharged, and transfer_id = row id makes a
    -- second debit for the same row impossible (uq_points_ledger_transfer_side).
    IF v_self.charged OR v_cand.charged
       OR EXISTS (SELECT 1 FROM points_ledger WHERE transfer_id IN (v_self.id, v_cand.id)) THEN
      RAISE EXCEPTION 'spark row already charged';
    END IF;
    IF v_self.cost > 0 THEN
      INSERT INTO points_ledger (user_id, amount, reason, category, counterparty_id, transfer_id, note)
      VALUES (p_user_id, -v_self.cost, 'spark_match', 'spark_match', NULL, v_self.id, 'Spark match');
    END IF;
    IF v_cand.cost > 0 THEN
      INSERT INTO points_ledger (user_id, amount, reason, category, counterparty_id, transfer_id, note)
      VALUES (v_cand.user_id, -v_cand.cost, 'spark_match', 'spark_match', NULL, v_cand.id, 'Spark match');
    END IF;

    UPDATE match_queue
    SET status = 'matched', matched_at = v_now, partner_user_id = p_user_id,
        charged = true, shared_intents = v_shared
    WHERE id = v_cand.id;
    UPDATE match_queue
    SET status = 'matched', matched_at = v_now, partner_user_id = v_cand.user_id,
        charged = true, shared_intents = v_shared
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
      'cost_charged', v_self.cost,
      'matched_at', v_now
    );
  END LOOP;

  RETURN jsonb_build_object('status', 'waiting', 'queue_id', v_self.id);
END;
$$;

REVOKE ALL ON FUNCTION match_waiting_user(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION match_waiting_user(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION match_waiting_user(UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- spark_enqueue: in one transaction, take the user's ledger lock (same key as every debit:
-- hashtext(user_id::text)), cancel their waiting rows and insert the new one. Returns its id.
-- The row is priced by trg_match_queue_spark_v2_row. uq_match_queue_one_waiting
-- (20250625_spark_v2_index_3.sql) backs this up: a second waiting row raises 23505.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION spark_enqueue(
  p_user_id UUID,
  p_mode TEXT,
  p_intents TEXT[],
  p_note TEXT,
  p_anonymous BOOLEAN
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'spark_enqueue: user required' USING ERRCODE = '22004';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

  UPDATE match_queue SET status = 'cancelled'
  WHERE user_id = p_user_id AND status = 'waiting';

  INSERT INTO match_queue (user_id, mode, intent, intents, note, anonymous)
  VALUES (p_user_id, p_mode, p_intents[1], p_intents, p_note, COALESCE(p_anonymous, true))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION spark_enqueue(UUID, TEXT, TEXT[], TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION spark_enqueue(UUID, TEXT, TEXT[], TEXT, BOOLEAN) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION spark_enqueue(UUID, TEXT, TEXT[], TEXT, BOOLEAN) TO service_role;

-- ---------------------------------------------------------------------------
-- Location intents created by users (free). One log row per successful call, so deleting
-- the held intent does not reset the daily limit.
-- Its (user_id, created_at) index is in 20250625_spark_v2_index_2.sql.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS location_intent_creations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  intent_id UUID REFERENCES intents(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE location_intent_creations ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- create_location_intent: find or create a public city / country intent and hold it for
-- 28 days for free (an existing hold is only ever extended). At most 10 calls per user per
-- rolling 24 hours.
-- Name: trimmed, whitespace collapsed, letters / space / . ' - only, 2..40 characters
-- (intents.name is at most 40), stored in initcap. Slug: loc-city-<slug> / loc-country-<slug>.
-- Returns jsonb: {status:'ok', intent:{id, name, slug, kind, visibility, is_mine:false, city,
--                country, usage_count}} | {status:'bad_name'|'bad_input'|'limit_reached'}
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_location_intent(p_user_id UUID, p_scope TEXT, p_name TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_name TEXT := btrim(regexp_replace(COALESCE(p_name, ''), '\s+', ' ', 'g'));
  v_part TEXT;
  v_slug TEXT;
  v_intent intents%ROWTYPE;
  v_recent INT;
  v_held BOOLEAN;
BEGIN
  IF p_user_id IS NULL OR p_scope IS NULL OR p_scope NOT IN ('city', 'country') THEN
    RETURN jsonb_build_object('status', 'bad_input');
  END IF;
  IF v_name !~ '^[[:alpha:] .''-]{2,60}$' OR char_length(v_name) > 40 OR v_name !~ '[[:alpha:]]' THEN
    RETURN jsonb_build_object('status', 'bad_name');
  END IF;
  v_name := initcap(v_name);
  v_part := intent_slug(v_name);
  IF v_part = '' THEN
    RETURN jsonb_build_object('status', 'bad_name');
  END IF;
  v_slug := btrim(left('loc-' || p_scope || '-' || v_part, 40), '-');

  -- Serialise this user's calls so the limit cannot be raced.
  PERFORM pg_advisory_xact_lock(hashtext('create_location_intent:' || p_user_id::text));

  SELECT count(*) INTO v_recent
  FROM location_intent_creations
  WHERE user_id = p_user_id AND created_at > now() - interval '24 hours';
  IF v_recent >= 10 THEN
    RETURN jsonb_build_object('status', 'limit_reached');
  END IF;

  SELECT * INTO v_intent FROM intents WHERE visibility = 'public' AND slug = v_slug;
  IF NOT FOUND THEN
    BEGIN
      INSERT INTO intents (name, slug, kind, visibility, city, country)
      VALUES (
        v_name, v_slug, 'location', 'public',
        CASE WHEN p_scope = 'city' THEN v_name END,
        CASE WHEN p_scope = 'country' THEN v_name END
      )
      RETURNING * INTO v_intent;
    EXCEPTION WHEN unique_violation THEN
      SELECT * INTO v_intent FROM intents WHERE visibility = 'public' AND slug = v_slug;
    END;
  END IF;
  -- A custom intent can never be claimed for free through this path.
  IF v_intent.id IS NULL OR v_intent.kind <> 'location' THEN
    RETURN jsonb_build_object('status', 'bad_name');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM user_intents ui
    WHERE ui.user_id = p_user_id AND ui.intent_id = v_intent.id
      AND (ui.expires_at IS NULL OR ui.expires_at > now())
  ) INTO v_held;

  INSERT INTO user_intents (user_id, intent_id, source, expires_at)
  VALUES (p_user_id, v_intent.id, 'location', now() + interval '28 days')
  ON CONFLICT (user_id, intent_id) DO UPDATE SET
    source = CASE WHEN user_intents.expires_at IS NOT NULL AND user_intents.expires_at <= now()
                  THEN EXCLUDED.source ELSE user_intents.source END,
    created_at = CASE WHEN user_intents.expires_at IS NOT NULL AND user_intents.expires_at <= now()
                      THEN now() ELSE user_intents.created_at END,
    expires_at = CASE WHEN user_intents.expires_at IS NULL THEN NULL
                      ELSE GREATEST(user_intents.expires_at, EXCLUDED.expires_at) END;

  IF NOT v_held THEN
    UPDATE intents SET usage_count = usage_count + 1 WHERE id = v_intent.id
    RETURNING * INTO v_intent;
  END IF;

  INSERT INTO location_intent_creations (user_id, intent_id) VALUES (p_user_id, v_intent.id);

  RETURN jsonb_build_object(
    'status', 'ok',
    'intent', jsonb_build_object(
      'id', v_intent.id,
      'name', v_intent.name,
      'slug', v_intent.slug,
      'kind', v_intent.kind,
      'visibility', v_intent.visibility,
      'is_mine', false,
      'city', v_intent.city,
      'country', v_intent.country,
      'usage_count', v_intent.usage_count
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION create_location_intent(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_location_intent(UUID, TEXT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION create_location_intent(UUID, TEXT, TEXT) TO service_role;

-- Rendly Tokens, ledger v2: the points ledger becomes the app currency.
-- Adds who/what/why columns to points_ledger, peer transfers (transfer_tokens),
-- host-paid huddle sends (huddle_send_tokens), a tie-aware leaderboard, profile
-- huddle stats and the opt-in user location. Run after 20250618_group_unread_excludes_own.sql.
-- Safe to run more than once. CONCURRENTLY indexes are in 20250622_tokens_indexes_N.sql.
--
-- Money invariants:
--   * A balance is always SUM(points_ledger.amount); there is no cached balance column.
--   * Every debit is written by one RPC that takes pg_advisory_xact_lock on the payer,
--     re-reads the balance inside the lock and inserts debit + credit in one transaction.
--   * transfer_id is the caller's idempotency key: the unique index
--     uq_points_ledger_transfer_side allows at most one debit and one credit per transfer.

-- ---------------------------------------------------------------------------
-- points_ledger: new columns
-- ---------------------------------------------------------------------------
ALTER TABLE points_ledger ADD COLUMN IF NOT EXISTS counterparty_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE points_ledger ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE points_ledger ADD COLUMN IF NOT EXISTS intent_id UUID;
ALTER TABLE points_ledger ADD COLUMN IF NOT EXISTS conversation_id TEXT
  CHECK (conversation_id IS NULL OR char_length(conversation_id) <= 120);
ALTER TABLE points_ledger ADD COLUMN IF NOT EXISTS transfer_id UUID;
ALTER TABLE points_ledger ADD COLUMN IF NOT EXISTS purpose TEXT
  CHECK (purpose IS NULL OR char_length(purpose) <= 40);

-- Backfill category from reason, then make it mandatory.
UPDATE points_ledger SET category = 'signup' WHERE category IS NULL AND reason = 'signup_bonus';
UPDATE points_ledger SET category = 'huddle_award' WHERE category IS NULL AND reason = 'huddle_award';
UPDATE points_ledger SET counterparty_id = awarded_by
  WHERE counterparty_id IS NULL AND reason = 'huddle_award' AND awarded_by IS NOT NULL;
ALTER TABLE points_ledger ALTER COLUMN category SET NOT NULL;

-- Replace the reason CHECK and add the category CHECK (drop + add keeps this re-runnable).
ALTER TABLE points_ledger DROP CONSTRAINT IF EXISTS points_ledger_reason_check;
ALTER TABLE points_ledger ADD CONSTRAINT points_ledger_reason_check
  CHECK (reason IN ('signup_bonus', 'huddle_award', 'huddle_send', 'transfer', 'intent_purchase', 'intent_royalty'));
ALTER TABLE points_ledger DROP CONSTRAINT IF EXISTS points_ledger_category_check;
ALTER TABLE points_ledger ADD CONSTRAINT points_ledger_category_check
  CHECK (category IN ('signup', 'huddle_award', 'huddle_send', 'transfer', 'intent_purchase', 'intent_royalty'));

-- One debit (amount < 0) and one credit (amount > 0) per transfer_id, never more.
-- Not CONCURRENTLY: the RPCs below rely on it from their first call.
CREATE UNIQUE INDEX IF NOT EXISTS uq_points_ledger_transfer_side
  ON points_ledger (transfer_id, (amount > 0))
  WHERE transfer_id IS NOT NULL;
-- (user_id, created_at DESC) already exists as idx_points_ledger_user from 20250617_notifications_points_indexes_2.sql.

-- ---------------------------------------------------------------------------
-- huddles: hosts can opt in to paying tokens to participants from their own balance.
-- ---------------------------------------------------------------------------
ALTER TABLE huddles ADD COLUMN IF NOT EXISTS rewards_receive_enabled BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- users: opt-in location for "Near By" intents. Raw lat/lng are never returned to other users.
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE users ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
ALTER TABLE users ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_lat_range_check' AND conrelid = 'users'::regclass) THEN
    ALTER TABLE users ADD CONSTRAINT users_lat_range_check CHECK (lat IS NULL OR (lat >= -90 AND lat <= 90));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_lng_range_check' AND conrelid = 'users'::regclass) THEN
    ALTER TABLE users ADD CONSTRAINT users_lng_range_check CHECK (lng IS NULL OR (lng >= -180 AND lng <= 180));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_city_length_check' AND conrelid = 'users'::regclass) THEN
    ALTER TABLE users ADD CONSTRAINT users_city_length_check CHECK (city IS NULL OR char_length(city) <= 80);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Welcome trigger: same bonus, new wording, category set.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION on_user_created_welcome()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  INSERT INTO points_ledger (user_id, amount, reason, category, note)
  SELECT NEW.id, 500, 'signup_bonus', 'signup', 'Welcome to Rendly'
  WHERE NOT EXISTS (SELECT 1 FROM points_ledger WHERE user_id = NEW.id AND reason = 'signup_bonus');
  INSERT INTO notifications (user_id, type, title, body)
  VALUES (NEW.id, 'welcome', 'Welcome to Rendly', 'You start with 500 Rendly Tokens. Spark a match or join a huddle to get going.');
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- points_rank_of: 1-based rank by total; ties share a rank (RANK, not ROW_NUMBER).
-- NULL when the user has no ledger rows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION points_rank_of(p_user_id UUID)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT r.rnk::INT
  FROM (
    SELECT t.user_id, RANK() OVER (ORDER BY t.total DESC) AS rnk
    FROM user_points_totals t
  ) r
  WHERE r.user_id = p_user_id;
$$;

REVOKE ALL ON FUNCTION points_rank_of(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION points_rank_of(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION points_rank_of(UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- points_leaderboard: top users with their shared rank. Limit clamped to 1..100.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION points_leaderboard(p_limit INT)
RETURNS TABLE (rank INT, user_id UUID, username TEXT, avatar_url TEXT, total INT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT r.rnk::INT AS rank, r.user_id, u.username, u.avatar_url, r.total
  FROM (
    SELECT t.user_id, t.total, RANK() OVER (ORDER BY t.total DESC) AS rnk
    FROM user_points_totals t
  ) r
  JOIN users u ON u.id = r.user_id
  ORDER BY r.rnk, u.username NULLS LAST, r.user_id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 100);
$$;

REVOKE ALL ON FUNCTION points_leaderboard(INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION points_leaderboard(INT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION points_leaderboard(INT) TO service_role;

-- ---------------------------------------------------------------------------
-- transfer_tokens: peer-to-peer send (whispers). Min 1, max = balance, no fee.
-- Returns jsonb:
--   {status:'ok', transfer_id, balance}            balance = payer's balance after the send
--   {status:'bad_amount'|'self'|'bad_input'|'no_user'|'insufficient'|'duplicate'}
-- bad_input: null ids, null transfer_id, note > 140 chars or conversation_id > 120 chars.
-- The payer is locked (advisory xact lock) before the duplicate check and the balance read,
-- so two concurrent sends from one user cannot both pass the balance check.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION transfer_tokens(
  p_from UUID, p_to UUID, p_amount INT, p_note TEXT, p_conversation_id TEXT, p_transfer_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_balance BIGINT;
  v_note TEXT := NULLIF(btrim(p_note), '');
  v_conversation TEXT := NULLIF(btrim(p_conversation_id), '');
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_transfer_id IS NULL THEN
    RETURN jsonb_build_object('status', 'bad_input');
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 140 THEN
    RETURN jsonb_build_object('status', 'bad_input');
  END IF;
  IF v_conversation IS NOT NULL AND char_length(v_conversation) > 120 THEN
    RETURN jsonb_build_object('status', 'bad_input');
  END IF;
  -- 100000 is the points_ledger amount CHECK; above it the insert could never succeed.
  IF p_amount IS NULL OR p_amount < 1 OR p_amount > 100000 THEN
    RETURN jsonb_build_object('status', 'bad_amount');
  END IF;
  IF p_from = p_to THEN
    RETURN jsonb_build_object('status', 'self');
  END IF;

  -- Serialise every debit of this payer: duplicate check and balance read happen under the lock.
  PERFORM pg_advisory_xact_lock(hashtext(p_from::text));

  IF EXISTS (SELECT 1 FROM points_ledger WHERE transfer_id = p_transfer_id) THEN
    RETURN jsonb_build_object('status', 'duplicate');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_to) THEN
    RETURN jsonb_build_object('status', 'no_user');
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_balance FROM points_ledger WHERE user_id = p_from;
  IF v_balance < p_amount THEN
    RETURN jsonb_build_object('status', 'insufficient');
  END IF;

  INSERT INTO points_ledger (user_id, amount, reason, category, counterparty_id, conversation_id, transfer_id, note)
  VALUES (p_from, -p_amount, 'transfer', 'transfer', p_to, v_conversation, p_transfer_id, v_note);
  INSERT INTO points_ledger (user_id, amount, reason, category, counterparty_id, conversation_id, transfer_id, note)
  VALUES (p_to, p_amount, 'transfer', 'transfer', p_from, v_conversation, p_transfer_id, v_note);

  RETURN jsonb_build_object(
    'status', 'ok',
    'transfer_id', p_transfer_id,
    'balance', (v_balance - p_amount)::INT
  );
END;
$$;

REVOKE ALL ON FUNCTION transfer_tokens(UUID, UUID, INT, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION transfer_tokens(UUID, UUID, INT, TEXT, TEXT, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION transfer_tokens(UUID, UUID, INT, TEXT, TEXT, UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- huddle_send_tokens: the host pays a participant from the host's own balance.
-- Gated on huddles.rewards_receive_enabled (award_huddle_points, which mints, stays
-- gated on rewards_enabled). Amount 1..1000. purpose 'other' requires a note.
-- Returns: ok | not_found | not_host | rewards_off | not_in_room | bad_amount | bad_purpose
--          | note_required | bad_note | bad_input | insufficient | duplicate.
-- bad_note: note longer than 140 chars. bad_input: null transfer_id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION huddle_send_tokens(
  p_huddle_id UUID, p_host_id UUID, p_user_id UUID, p_amount INT, p_purpose TEXT, p_note TEXT, p_transfer_id UUID
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
  IF p_huddle_id IS NULL OR p_host_id IS NULL OR p_user_id IS NULL THEN
    RETURN 'not_found';
  END IF;
  SELECT * INTO v_huddle FROM huddles WHERE id = p_huddle_id;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  IF v_huddle.created_by <> p_host_id THEN
    RETURN 'not_host';
  END IF;
  IF NOT v_huddle.rewards_receive_enabled THEN
    RETURN 'rewards_off';
  END IF;
  IF p_amount IS NULL OR p_amount < 1 OR p_amount > 1000 THEN
    RETURN 'bad_amount';
  END IF;
  IF p_purpose IS NULL OR p_purpose NOT IN ('winner', 'best_answer', 'participation', 'speaker_thanks', 'bounty', 'other') THEN
    RETURN 'bad_purpose';
  END IF;
  IF p_purpose = 'other' AND v_note IS NULL THEN
    RETURN 'note_required';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 140 THEN
    RETURN 'bad_note';
  END IF;
  IF p_transfer_id IS NULL THEN
    RETURN 'bad_input';
  END IF;
  IF p_user_id = p_host_id OR NOT EXISTS (
    SELECT 1 FROM huddle_participants
    WHERE huddle_id = p_huddle_id AND user_id = p_user_id AND left_at IS NULL AND admitted
  ) THEN
    RETURN 'not_in_room';
  END IF;

  -- Serialise every debit of this host.
  PERFORM pg_advisory_xact_lock(hashtext(p_host_id::text));

  IF EXISTS (SELECT 1 FROM points_ledger WHERE transfer_id = p_transfer_id) THEN
    RETURN 'duplicate';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_balance FROM points_ledger WHERE user_id = p_host_id;
  IF v_balance < p_amount THEN
    RETURN 'insufficient';
  END IF;

  INSERT INTO points_ledger
    (user_id, amount, reason, category, huddle_id, awarded_by, counterparty_id, purpose, note, transfer_id)
  VALUES
    (p_host_id, -p_amount, 'huddle_send', 'huddle_send', p_huddle_id, p_host_id, p_user_id, p_purpose, v_note, p_transfer_id);
  INSERT INTO points_ledger
    (user_id, amount, reason, category, huddle_id, awarded_by, counterparty_id, purpose, note, transfer_id)
  VALUES
    (p_user_id, p_amount, 'huddle_send', 'huddle_send', p_huddle_id, p_host_id, p_host_id, p_purpose, v_note, p_transfer_id);
  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION huddle_send_tokens(UUID, UUID, UUID, INT, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION huddle_send_tokens(UUID, UUID, UUID, INT, TEXT, TEXT, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION huddle_send_tokens(UUID, UUID, UUID, INT, TEXT, TEXT, UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- award_huddle_points, replacing the 20250617 version: same signature and codes,
-- now records category and the host as counterparty. Still mints (host is not debited).
-- Returns: ok | not_found | not_host | rewards_off | not_in_room | bad_amount.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION award_huddle_points(
  p_huddle_id UUID, p_host_id UUID, p_user_id UUID, p_amount INT, p_note TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_huddle huddles%ROWTYPE;
BEGIN
  SELECT * INTO v_huddle FROM huddles WHERE id = p_huddle_id;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  IF v_huddle.created_by <> p_host_id THEN
    RETURN 'not_host';
  END IF;
  IF NOT v_huddle.rewards_enabled THEN
    RETURN 'rewards_off';
  END IF;
  IF p_amount IS NULL OR p_amount < 1 OR p_amount > 1000 THEN
    RETURN 'bad_amount';
  END IF;
  IF p_user_id = p_host_id OR NOT EXISTS (
    SELECT 1 FROM huddle_participants
    WHERE huddle_id = p_huddle_id AND user_id = p_user_id AND left_at IS NULL AND admitted
  ) THEN
    RETURN 'not_in_room';
  END IF;

  INSERT INTO points_ledger (user_id, amount, reason, category, huddle_id, awarded_by, counterparty_id, note)
  VALUES (p_user_id, p_amount, 'huddle_award', 'huddle_award', p_huddle_id, p_host_id, p_host_id, NULLIF(btrim(p_note), ''));
  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION award_huddle_points(UUID, UUID, UUID, INT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION award_huddle_points(UUID, UUID, UUID, INT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION award_huddle_points(UUID, UUID, UUID, INT, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- profile_huddle_stats: {hosted, public_joined} for the profile Huddles card.
-- hosted = huddles the user created; public_joined = distinct public huddles (not their
-- own) where the user held an admitted seat at some point.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION profile_huddle_stats(p_user_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'hosted', (SELECT count(*) FROM huddles h WHERE h.created_by = p_user_id),
    'public_joined', (
      SELECT count(DISTINCT p.huddle_id)
      FROM huddle_participants p
      JOIN huddles h ON h.id = p.huddle_id
      WHERE p.user_id = p_user_id AND p.admitted AND h.type = 'public' AND h.created_by <> p_user_id
    )
  );
$$;

REVOKE ALL ON FUNCTION profile_huddle_stats(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION profile_huddle_stats(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION profile_huddle_stats(UUID) TO service_role;

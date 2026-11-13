-- Rendly Tokens hardening (security review follow-up). Run after 20250622_tokens_indexes_4.sql.
-- Safe to run more than once: every statement is CREATE OR REPLACE, IF [NOT] EXISTS or a
-- DROP + CREATE of a function/view whose signature or column types change.
--
--   C1  award_huddle_points: minting is bounded per huddle, per recipient and per host per 24 h.
--   H1  transfer_tokens: sender account >= 24 h old and an existing relationship with the recipient.
--   H2  nearby_user_intents: opt-in users only, bucketed distance, nobody closer than 1 km;
--       set_user_location: 1 update per 10 minutes, coordinates rounded to ~1 km.
--   H3  views run as the caller (security_invoker); views and location columns hidden from anon/authenticated.
--   M1  one whisper bubble per transfer_id (unique index in 20250623_tokens_hardening_index.sql).
--   M2  location intents always cost 20.
--   M3/M4 purchase_intent: no charge while an unexpired copy is held; usage_count only for new/expired
--       rows and never for the creator.
--   M7  create_intent: at most 20 active custom intents per creator and 10 creations per 24 h.
--   L2  token totals are BIGINT.
--   L3  intent list RPCs no longer return creator_id; they return is_mine for the caller instead.

-- ---------------------------------------------------------------------------
-- L2: user_points_totals.total INT -> BIGINT. A view column type cannot change in place.
-- points_rank_of / points_leaderboard are LANGUAGE sql (bodies not dependency-tracked), so the
-- DROP does not cascade into them; they are recreated below.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS user_points_totals;
CREATE VIEW user_points_totals WITH (security_invoker = true) AS
  SELECT user_id, SUM(amount)::BIGINT AS total
  FROM points_ledger
  GROUP BY user_id;

DROP FUNCTION IF EXISTS points_leaderboard(INT);
CREATE FUNCTION points_leaderboard(p_limit INT)
RETURNS TABLE (rank INT, user_id UUID, username TEXT, avatar_url TEXT, total BIGINT)
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
-- H3: views run with the caller's privileges (RLS of points_ledger / user_intents applies),
-- and only the service role reads them.
-- ---------------------------------------------------------------------------
ALTER VIEW active_user_intents SET (security_invoker = true);
ALTER VIEW user_points_totals SET (security_invoker = true);
REVOKE ALL ON active_user_intents FROM PUBLIC;
REVOKE ALL ON active_user_intents FROM anon, authenticated;
REVOKE ALL ON user_points_totals FROM PUBLIC;
REVOKE ALL ON user_points_totals FROM anon, authenticated;
GRANT SELECT ON active_user_intents TO service_role;
GRANT SELECT ON user_points_totals TO service_role;

-- ---------------------------------------------------------------------------
-- H2: explicit Near By opt-in flag.
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS discoverable_nearby BOOLEAN NOT NULL DEFAULT false;
-- Existing stored locations were set through the opt-in PUT, so they stay discoverable.
UPDATE users SET discoverable_nearby = true
WHERE discoverable_nearby = false AND lat IS NOT NULL AND lng IS NOT NULL AND location_updated_at IS NOT NULL
  AND lat IS NOT NULL;

-- H3: users has no RLS in these migrations, so it is not enabled here (that could break existing
-- reads). Instead anon/authenticated lose SELECT on the location columns. In Postgres a column
-- REVOKE does nothing while a table-wide SELECT grant exists, so a table-wide grant is replaced by
-- a column list of every other column (existing reads keep working). Columns added to users later
-- must be granted explicitly if anon/authenticated need them.
DO $$
DECLARE
  v_role TEXT;
  v_cols TEXT;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      CONTINUE;
    END IF;
    IF has_table_privilege(v_role, 'public.users', 'SELECT') THEN
      SELECT string_agg(quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position) INTO v_cols
      FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = 'users'
        AND c.column_name NOT IN ('lat', 'lng', 'discoverable_nearby', 'location_updated_at');
      EXECUTE format('REVOKE SELECT ON public.users FROM %I', v_role);
      IF v_cols IS NOT NULL THEN
        EXECUTE format('GRANT SELECT (%s) ON public.users TO %I', v_cols, v_role);
      END IF;
    END IF;
    EXECUTE format('REVOKE SELECT (lat, lng, discoverable_nearby, location_updated_at) ON public.users FROM %I', v_role);
  END LOOP;
END $$;

-- M1: the unique index uq_whisper_messages_transfer_id is in 20250623_tokens_hardening_index.sql
-- (CONCURRENTLY, so it must run as its own query outside a transaction).

-- ---------------------------------------------------------------------------
-- C1: award_huddle_points (same signature). Still mints, now bounded:
--   per (host, huddle)         <= 2000 tokens in total
--   per (recipient, huddle)    <= 1000 tokens in total
--   per host, rolling 24 hours <= 3000 tokens across all huddles
-- The host is locked (advisory xact lock) so concurrent awards cannot overshoot a cap.
-- Returns: ok | not_found | not_host | rewards_off | not_in_room | bad_amount | cap_reached.
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
  v_huddle_total BIGINT;
  v_recipient_total BIGINT;
  v_day_total BIGINT;
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

  PERFORM pg_advisory_xact_lock(hashtext(p_host_id::text));

  SELECT COALESCE(SUM(amount), 0) INTO v_huddle_total FROM points_ledger
  WHERE reason = 'huddle_award' AND huddle_id = p_huddle_id AND counterparty_id = p_host_id;
  SELECT COALESCE(SUM(amount), 0) INTO v_recipient_total FROM points_ledger
  WHERE reason = 'huddle_award' AND huddle_id = p_huddle_id AND user_id = p_user_id;
  SELECT COALESCE(SUM(amount), 0) INTO v_day_total FROM points_ledger
  WHERE reason = 'huddle_award' AND counterparty_id = p_host_id AND created_at > now() - interval '24 hours';

  IF v_huddle_total + p_amount > 2000
     OR v_recipient_total + p_amount > 1000
     OR v_day_total + p_amount > 3000 THEN
    RETURN 'cap_reached';
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
-- H1: transfer_tokens (same signature). Min 1, max = balance, no fee, no daily cap.
-- New refusals:
--   too_new         the sender's account is younger than 24 hours
--   no_relationship the recipient does not exist, either side blocked the other, or the pair has
--                   neither a connection nor a whisper message from the recipient to the sender.
--                   An unknown recipient gives the same code, so user ids cannot be probed.
-- 'no_user' is no longer returned.
-- Returns jsonb: {status:'ok', transfer_id, balance}
--              | {status:'bad_amount'|'self'|'bad_input'|'too_new'|'no_relationship'|'insufficient'|'duplicate'}
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
  v_created TIMESTAMPTZ;
  v_a UUID := LEAST(p_from, p_to);
  v_b UUID := GREATEST(p_from, p_to);
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
  IF p_amount IS NULL OR p_amount < 1 OR p_amount > 100000 THEN
    RETURN jsonb_build_object('status', 'bad_amount');
  END IF;
  IF p_from = p_to THEN
    RETURN jsonb_build_object('status', 'self');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_from::text));

  -- First, so an idempotent retry of a completed send is recognised.
  IF EXISTS (SELECT 1 FROM points_ledger WHERE transfer_id = p_transfer_id) THEN
    RETURN jsonb_build_object('status', 'duplicate');
  END IF;

  SELECT created_at INTO v_created FROM users WHERE id = p_from;
  IF v_created IS NULL OR v_created > now() - interval '24 hours' THEN
    RETURN jsonb_build_object('status', 'too_new');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_to)
     OR EXISTS (
       SELECT 1 FROM user_blocks
       WHERE (blocker_id = p_from AND blocked_id = p_to) OR (blocker_id = p_to AND blocked_id = p_from)
     )
     OR NOT (
       EXISTS (SELECT 1 FROM connections WHERE user_id = v_a AND connected_user_id = v_b)
       OR EXISTS (
         SELECT 1 FROM whisper_messages w
         WHERE w.user_a = v_a AND w.user_b = v_b AND w.message->>'sent_by_id' = p_to::text
       )
     ) THEN
    RETURN jsonb_build_object('status', 'no_relationship');
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
    'balance', v_balance - p_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION transfer_tokens(UUID, UUID, INT, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION transfer_tokens(UUID, UUID, INT, TEXT, TEXT, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION transfer_tokens(UUID, UUID, INT, TEXT, TEXT, UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- M2/M3/M4: purchase_intent (same signature).
-- Price: preset or own intent 0; kind 'location' always 20 (whatever source the client names);
--        a custom intent bought via 'search' 10; via hot/location/nearby 20.
-- An unexpired copy already held -> {status:'already_active', expires_at}; nothing is charged
-- and usage_count does not move. usage_count grows only for a new or expired row bought by
-- someone other than the creator.
-- The buyer is locked before the duplicate / already_active checks, so two concurrent buys of
-- one intent cannot both charge.
-- Returns jsonb: {status:'ok', price, expires_at, balance}
--              | {status:'already_active', expires_at}
--              | {status:'not_found'|'private'|'bad_source'|'bad_input'|'insufficient'|'duplicate'}
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION purchase_intent(p_user_id UUID, p_intent_id UUID, p_source TEXT, p_transfer_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_intent intents%ROWTYPE;
  v_owner BOOLEAN;
  v_price INT;
  v_expires TIMESTAMPTZ;
  v_held_expires TIMESTAMPTZ;
  v_held BOOLEAN;
  v_balance BIGINT;
BEGIN
  IF p_user_id IS NULL OR p_intent_id IS NULL THEN
    RETURN jsonb_build_object('status', 'bad_input');
  END IF;
  IF p_source IS NULL OR p_source NOT IN ('preset', 'hot', 'location', 'nearby', 'search', 'created') THEN
    RETURN jsonb_build_object('status', 'bad_source');
  END IF;

  SELECT * INTO v_intent FROM intents WHERE id = p_intent_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  v_owner := v_intent.creator_id IS NOT NULL AND v_intent.creator_id = p_user_id;
  IF v_intent.visibility = 'private' AND NOT v_owner THEN
    RETURN jsonb_build_object('status', 'private');
  END IF;
  IF p_source = 'preset' AND v_intent.kind <> 'preset' THEN
    RETURN jsonb_build_object('status', 'bad_source');
  END IF;
  IF p_source = 'created' AND NOT v_owner THEN
    RETURN jsonb_build_object('status', 'bad_source');
  END IF;

  -- Price table (= intentPrice in intents-rules.ts).
  IF v_intent.kind = 'preset' OR v_owner THEN
    v_price := 0;
  ELSIF v_intent.kind = 'location' THEN
    v_price := 20;
  ELSIF p_source = 'search' THEN
    v_price := 10;
  ELSE
    v_price := 20;
  END IF;
  IF v_price > 0 AND p_transfer_id IS NULL THEN
    RETURN jsonb_build_object('status', 'bad_input');
  END IF;

  -- Serialise every purchase of this buyer.
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

  IF p_transfer_id IS NOT NULL AND EXISTS (SELECT 1 FROM points_ledger WHERE transfer_id = p_transfer_id) THEN
    RETURN jsonb_build_object('status', 'duplicate');
  END IF;

  SELECT true, ui.expires_at INTO v_held, v_held_expires
  FROM user_intents ui
  WHERE ui.user_id = p_user_id AND ui.intent_id = v_intent.id
    AND (ui.expires_at IS NULL OR ui.expires_at > now());
  IF v_held THEN
    RETURN jsonb_build_object('status', 'already_active', 'expires_at', v_held_expires);
  END IF;

  -- Duration table (= INTENT_DURATION_DAYS in intents-rules.ts).
  IF v_intent.kind = 'preset' THEN
    v_expires := NULL;
  ELSIF v_owner AND v_intent.visibility = 'private' THEN
    v_expires := now() + interval '7 days';
  ELSIF v_owner THEN
    v_expires := NULL;
  ELSE
    v_expires := now() + interval '28 days';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_balance FROM points_ledger WHERE user_id = p_user_id;

  IF v_price > 0 THEN
    IF v_balance < v_price THEN
      RETURN jsonb_build_object('status', 'insufficient');
    END IF;

    INSERT INTO points_ledger (user_id, amount, reason, category, intent_id, counterparty_id, transfer_id, note)
    VALUES (p_user_id, -v_price, 'intent_purchase', 'intent_purchase', v_intent.id, v_intent.creator_id, p_transfer_id, v_intent.name);

    IF v_intent.creator_id IS NOT NULL AND v_intent.creator_id <> p_user_id THEN
      INSERT INTO points_ledger (user_id, amount, reason, category, intent_id, counterparty_id, transfer_id, note)
      VALUES (v_intent.creator_id, 10, 'intent_royalty', 'intent_royalty', v_intent.id, p_user_id, p_transfer_id, v_intent.name);
    END IF;

    v_balance := v_balance - v_price;
  END IF;

  INSERT INTO user_intents (user_id, intent_id, source, expires_at, created_at)
  VALUES (p_user_id, v_intent.id, p_source, v_expires, now())
  ON CONFLICT (user_id, intent_id)
  DO UPDATE SET source = EXCLUDED.source, expires_at = EXCLUDED.expires_at, created_at = now();

  IF NOT v_owner THEN
    UPDATE intents SET usage_count = usage_count + 1 WHERE id = v_intent.id;
  END IF;

  RETURN jsonb_build_object(
    'status', 'ok',
    'price', v_price,
    'expires_at', v_expires,
    'balance', v_balance
  );
END;
$$;

REVOKE ALL ON FUNCTION purchase_intent(UUID, UUID, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION purchase_intent(UUID, UUID, TEXT, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION purchase_intent(UUID, UUID, TEXT, UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- M7: create_intent (same signature) with creation limits.
--   * at most 20 active custom intents per creator: public ones (catalogue entries are permanent)
--     plus private ones the creator still holds unexpired;
--   * at most 10 custom intents created per rolling 24 hours.
-- Returns jsonb: {status:'ok', intent:{... is_mine}} | {status:'taken'|'bad_name'|'bad_input'|'limit_reached'}
-- The returned intent no longer carries creator_id (L3).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_intent(p_user_id UUID, p_name TEXT, p_visibility TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_name TEXT := btrim(regexp_replace(COALESCE(p_name, ''), '\s+', ' ', 'g'));
  v_slug TEXT;
  v_expires TIMESTAMPTZ;
  v_intent intents%ROWTYPE;
  v_active INT;
  v_recent INT;
BEGIN
  IF p_user_id IS NULL OR p_visibility IS NULL OR p_visibility NOT IN ('public', 'private') THEN
    RETURN jsonb_build_object('status', 'bad_input');
  END IF;
  IF char_length(v_name) < 2 OR char_length(v_name) > 40 OR v_name !~ '^[[:alpha:][:digit:] &''-]+$' THEN
    RETURN jsonb_build_object('status', 'bad_name');
  END IF;
  v_slug := intent_slug(v_name);
  IF v_slug = '' THEN
    RETURN jsonb_build_object('status', 'bad_name');
  END IF;

  -- Serialise this creator's creations so the limits cannot be raced.
  PERFORM pg_advisory_xact_lock(hashtext('create_intent:' || p_user_id::text));

  SELECT count(*) INTO v_active
  FROM intents i
  WHERE i.creator_id = p_user_id AND i.kind = 'custom'
    AND (
      i.visibility = 'public'
      OR EXISTS (
        SELECT 1 FROM user_intents ui
        WHERE ui.user_id = p_user_id AND ui.intent_id = i.id
          AND (ui.expires_at IS NULL OR ui.expires_at > now())
      )
    );
  SELECT count(*) INTO v_recent
  FROM intents i
  WHERE i.creator_id = p_user_id AND i.kind = 'custom' AND i.created_at > now() - interval '24 hours';
  IF v_active >= 20 OR v_recent >= 10 THEN
    RETURN jsonb_build_object('status', 'limit_reached');
  END IF;

  IF p_visibility = 'public' THEN
    IF EXISTS (SELECT 1 FROM intents WHERE visibility = 'public' AND slug = v_slug) THEN
      RETURN jsonb_build_object('status', 'taken');
    END IF;
    v_expires := NULL;
  ELSE
    IF EXISTS (SELECT 1 FROM intents WHERE visibility = 'private' AND creator_id = p_user_id AND slug = v_slug) THEN
      RETURN jsonb_build_object('status', 'taken');
    END IF;
    v_expires := now() + interval '7 days';
  END IF;

  BEGIN
    INSERT INTO intents (name, slug, kind, visibility, creator_id)
    VALUES (v_name, v_slug, 'custom', p_visibility, p_user_id)
    RETURNING * INTO v_intent;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('status', 'taken');
  END;

  INSERT INTO user_intents (user_id, intent_id, source, expires_at)
  VALUES (p_user_id, v_intent.id, 'created', v_expires)
  ON CONFLICT (user_id, intent_id)
  DO UPDATE SET source = 'created', expires_at = EXCLUDED.expires_at, created_at = now();

  RETURN jsonb_build_object(
    'status', 'ok',
    'intent', jsonb_build_object(
      'id', v_intent.id,
      'name', v_intent.name,
      'slug', v_intent.slug,
      'kind', v_intent.kind,
      'visibility', v_intent.visibility,
      'is_mine', true,
      'usage_count', v_intent.usage_count,
      'created_at', v_intent.created_at,
      'expires_at', v_expires
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION create_intent(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_intent(UUID, TEXT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION create_intent(UUID, TEXT, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- L3: hot_intents now takes the viewer and returns is_mine instead of creator_id.
-- The old one-argument version is dropped.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS hot_intents(INT);
CREATE OR REPLACE FUNCTION hot_intents(p_user_id UUID, p_limit INT)
RETURNS TABLE (id UUID, name TEXT, slug TEXT, kind TEXT, is_mine BOOLEAN, usage_count INT, created_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT i.id, i.name, i.slug, i.kind,
         (i.creator_id IS NOT NULL AND i.creator_id = p_user_id) AS is_mine,
         i.usage_count, i.created_at
  FROM intents i
  WHERE i.visibility = 'public' AND i.kind = 'custom'
  ORDER BY i.usage_count DESC, i.created_at DESC, i.slug
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 50);
$$;
REVOKE ALL ON FUNCTION hot_intents(UUID, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION hot_intents(UUID, INT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION hot_intents(UUID, INT) TO service_role;

-- L3: search_intents without creator_id (owned = the caller created it, active = the caller holds it).
DROP FUNCTION IF EXISTS search_intents(UUID, TEXT, INT);
CREATE FUNCTION search_intents(p_user_id UUID, p_q TEXT, p_limit INT)
RETURNS TABLE (
  id UUID, name TEXT, slug TEXT, kind TEXT, visibility TEXT,
  usage_count INT, owned BOOLEAN, active BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH q AS (
    SELECT replace(replace(replace(intent_slug(p_q), '\', '\\'), '%', '\%'), '_', '\_') AS prefix
  )
  SELECT i.id, i.name, i.slug, i.kind, i.visibility, i.usage_count,
         (i.creator_id IS NOT NULL AND i.creator_id = p_user_id) AS owned,
         EXISTS (SELECT 1 FROM active_user_intents a WHERE a.user_id = p_user_id AND a.intent_id = i.id) AS active
  FROM intents i, q
  WHERE q.prefix <> ''
    AND i.slug LIKE q.prefix || '%' ESCAPE '\'
    AND (i.visibility = 'public' OR (i.creator_id IS NOT NULL AND i.creator_id = p_user_id))
  ORDER BY i.usage_count DESC, i.slug, i.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 5), 1), 50);
$$;
REVOKE ALL ON FUNCTION search_intents(UUID, TEXT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION search_intents(UUID, TEXT, INT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION search_intents(UUID, TEXT, INT) TO service_role;

-- ---------------------------------------------------------------------------
-- H2: set_user_location – the only way to store a location. Coordinates are rounded to 2
-- decimals (~1 km). At most one update per 10 minutes (location_updated_at survives a clear).
-- Turns discoverable_nearby on.
-- Returns jsonb: {status:'ok', city, location_updated_at}
--              | {status:'too_soon', retry_after_seconds} | {status:'bad_input'}
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_user_location(p_user_id UUID, p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION, p_city TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_last TIMESTAMPTZ;
  v_now TIMESTAMPTZ := now();
  v_city TEXT := NULLIF(btrim(p_city), '');
BEGIN
  IF p_user_id IS NULL OR p_lat IS NULL OR p_lng IS NULL
     OR p_lat < -90 OR p_lat > 90 OR p_lng < -180 OR p_lng > 180
     OR (v_city IS NOT NULL AND char_length(v_city) > 80) THEN
    RETURN jsonb_build_object('status', 'bad_input');
  END IF;

  SELECT location_updated_at INTO v_last FROM users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'bad_input');
  END IF;
  IF v_last IS NOT NULL AND v_last > v_now - interval '10 minutes' THEN
    RETURN jsonb_build_object(
      'status', 'too_soon',
      'retry_after_seconds', CEIL(EXTRACT(EPOCH FROM (v_last + interval '10 minutes' - v_now)))::INT
    );
  END IF;

  UPDATE users
  SET lat = round(p_lat::numeric, 2)::DOUBLE PRECISION,
      lng = round(p_lng::numeric, 2)::DOUBLE PRECISION,
      city = v_city,
      location_updated_at = v_now,
      discoverable_nearby = true
  WHERE id = p_user_id;

  RETURN jsonb_build_object('status', 'ok', 'city', v_city, 'location_updated_at', v_now);
END;
$$;
REVOKE ALL ON FUNCTION set_user_location(UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION set_user_location(UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION set_user_location(UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- H2: nearby_user_intents (same signature).
-- Only users who opted in (discoverable_nearby) and are online (presence within 60 s) are
-- considered. If the nearest such user is closer than 1 km, nobody is returned (an exact
-- neighbour cannot be pinpointed). Distance is a coarse bucket, never a number:
-- '<5 km' | '5-10 km' | '10-25 km' | '25-50 km' | '50+ km'.
-- Returns jsonb: {status:'no_location'}
--              | {status:'ok', user:null, intents:[]}
--              | {status:'ok', user:{id,username,avatar_url,city,distance}, intents:[{..., is_mine}]}
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION nearby_user_intents(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_lat DOUBLE PRECISION;
  v_lng DOUBLE PRECISION;
  v_user RECORD;
  v_intents JSONB;
  v_bucket TEXT;
BEGIN
  SELECT u.lat, u.lng INTO v_lat, v_lng FROM users u WHERE u.id = p_user_id;
  IF v_lat IS NULL OR v_lng IS NULL THEN
    RETURN jsonb_build_object('status', 'no_location');
  END IF;

  SELECT u.id, u.username, u.avatar_url, u.city,
         2 * 6371 * asin(LEAST(1.0, sqrt(
           power(sin(radians(u.lat - v_lat) / 2), 2)
           + cos(radians(v_lat)) * cos(radians(u.lat)) * power(sin(radians(u.lng - v_lng) / 2), 2)
         ))) AS distance_km
  INTO v_user
  FROM users u
  JOIN user_presence p ON p.user_id = u.id
  WHERE u.id <> p_user_id
    AND u.discoverable_nearby
    AND u.lat IS NOT NULL AND u.lng IS NOT NULL
    AND p.last_seen_at > now() - interval '60 seconds'
  ORDER BY 5 ASC, u.id
  LIMIT 1;

  IF NOT FOUND OR v_user.distance_km < 1 THEN
    RETURN jsonb_build_object('status', 'ok', 'user', 'null'::jsonb, 'intents', '[]'::jsonb);
  END IF;

  v_bucket := CASE
    WHEN v_user.distance_km < 5 THEN '<5 km'
    WHEN v_user.distance_km < 10 THEN '5-10 km'
    WHEN v_user.distance_km < 25 THEN '10-25 km'
    WHEN v_user.distance_km < 50 THEN '25-50 km'
    ELSE '50+ km'
  END;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', i.id, 'name', i.name, 'slug', i.slug, 'kind', i.kind,
           'is_mine', (i.creator_id IS NOT NULL AND i.creator_id = p_user_id),
           'usage_count', i.usage_count
         ) ORDER BY i.usage_count DESC, i.slug), '[]'::jsonb)
  INTO v_intents
  FROM active_user_intents a
  JOIN intents i ON i.id = a.intent_id
  WHERE a.user_id = v_user.id AND i.visibility = 'public';

  RETURN jsonb_build_object(
    'status', 'ok',
    'user', jsonb_build_object(
      'id', v_user.id,
      'username', v_user.username,
      'avatar_url', v_user.avatar_url,
      'city', v_user.city,
      'distance', v_bucket
    ),
    'intents', v_intents
  );
END;
$$;

REVOKE ALL ON FUNCTION nearby_user_intents(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION nearby_user_intents(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION nearby_user_intents(UUID) TO service_role;

-- Custom intents: the intents catalogue, each user's active intents, purchases paid in
-- Rendly Tokens, creator royalties, the hot / search / location / near-by lists.
-- Run after 20250619_tokens_ledger_v2.sql. Safe to run more than once.
-- CONCURRENTLY indexes are in 20250622_tokens_indexes_N.sql.
--
-- Rules (must stay equal to services/auth-service/src/intents-rules.ts):
--   * slug = lower(name), whitespace runs -> '-', drop anything outside [a-z0-9-],
--     collapse '--', trim '-', at most 40 chars (intent_slug below = intentSlug in TS).
--   * price: preset 0; your own intent 0; hot/location/nearby 20; search 10.
--   * duration: preset never expires; own public never; own private 7 days; purchased 28 days.
--   * the creator earns 10 tokens when someone else pays for their intent.
--   * expired user_intents rows are ignored (active_user_intents view); re-buying is allowed.

-- ---------------------------------------------------------------------------
-- intent_slug: the canonical key for an intent name.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION intent_slug(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT left(
    btrim(
      regexp_replace(
        regexp_replace(
          regexp_replace(lower(btrim(COALESCE(p_name, ''))), '\s+', '-', 'g'),
          '[^a-z0-9-]', '', 'g'),
        '-{2,}', '-', 'g'),
      '-'),
    40);
$$;

REVOKE ALL ON FUNCTION intent_slug(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION intent_slug(TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION intent_slug(TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- intents: presets, user-created custom intents and seeded city intents.
-- A public slug is unique across the catalogue; a private slug is unique per creator.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 40),
  slug TEXT NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  kind TEXT NOT NULL CHECK (kind IN ('preset', 'custom', 'location')),
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  creator_id UUID REFERENCES users(id) ON DELETE SET NULL,
  city TEXT CHECK (city IS NULL OR char_length(city) <= 80),
  country TEXT CHECK (country IS NULL OR char_length(country) <= 80),
  lat DOUBLE PRECISION CHECK (lat IS NULL OR (lat >= -90 AND lat <= 90)),
  lng DOUBLE PRECISION CHECK (lng IS NULL OR (lng >= -180 AND lng <= 180)),
  usage_count INT NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_intents_public_slug ON intents (slug) WHERE visibility = 'public';
CREATE UNIQUE INDEX IF NOT EXISTS uq_intents_private_slug ON intents (creator_id, slug) WHERE visibility = 'private';
CREATE INDEX IF NOT EXISTS idx_intents_slug_prefix ON intents (slug text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_intents_public_usage ON intents (usage_count DESC, created_at DESC) WHERE visibility = 'public';
CREATE INDEX IF NOT EXISTS idx_intents_creator ON intents (creator_id) WHERE creator_id IS NOT NULL;
ALTER TABLE intents ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- user_intents: which intents a user holds, where each came from and until when.
-- expires_at NULL = never. Reads go through active_user_intents.
-- (user_id, expires_at) index is in 20250622_tokens_indexes_1.sql.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_intents (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  intent_id UUID NOT NULL REFERENCES intents(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('preset', 'hot', 'location', 'nearby', 'search', 'created')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, intent_id)
);
-- Reverse lookup for the Spark fallback (who else holds this intent). Table is new, so not CONCURRENTLY.
CREATE INDEX IF NOT EXISTS idx_user_intents_intent ON user_intents (intent_id);
ALTER TABLE user_intents ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE VIEW active_user_intents AS
  SELECT ui.user_id, ui.intent_id, ui.source, ui.expires_at, ui.created_at
  FROM user_intents ui
  WHERE ui.expires_at IS NULL OR ui.expires_at > now();

-- ---------------------------------------------------------------------------
-- points_ledger.intent_id now references intents (column added in 20250619).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'points_ledger_intent_id_fkey' AND conrelid = 'points_ledger'::regclass
  ) THEN
    ALTER TABLE points_ledger
      ADD CONSTRAINT points_ledger_intent_id_fkey FOREIGN KEY (intent_id) REFERENCES intents(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Seed: the five presets (same names as users.selected_intents) and city intents.
-- Idempotent on the public slug.
-- ---------------------------------------------------------------------------
INSERT INTO intents (name, slug, kind, visibility)
SELECT v.name, intent_slug(v.name), 'preset', 'public'
FROM (VALUES ('Light chat'), ('Brainstorm'), ('Motivation'), ('Collaborate'), ('Networking')) AS v(name)
ON CONFLICT (slug) WHERE visibility = 'public' DO NOTHING;

INSERT INTO intents (name, slug, kind, visibility, city, country, lat, lng)
SELECT v.name, intent_slug(v.name), 'location', 'public', v.city, v.country, v.lat, v.lng
FROM (VALUES
  ('London',        'London',        'United Kingdom',       51.5074,  -0.1278),
  ('New York',      'New York',      'United States',        40.7128, -74.0060),
  ('San Francisco', 'San Francisco', 'United States',        37.7749, -122.4194),
  ('Toronto',       'Toronto',       'Canada',               43.6532, -79.3832),
  ('Berlin',        'Berlin',        'Germany',              52.5200,  13.4050),
  ('Paris',         'Paris',         'France',               48.8566,   2.3522),
  ('Amsterdam',     'Amsterdam',     'Netherlands',          52.3676,   4.9041),
  ('Lisbon',        'Lisbon',        'Portugal',             38.7223,  -9.1393),
  ('Dubai',         'Dubai',         'United Arab Emirates', 25.2048,  55.2708),
  ('Bangalore',     'Bangalore',     'India',                12.9716,  77.5946),
  ('Mumbai',        'Mumbai',        'India',                19.0760,  72.8777),
  ('Singapore',     'Singapore',     'Singapore',             1.3521, 103.8198),
  ('Tokyo',         'Tokyo',         'Japan',                35.6762, 139.6503),
  ('Sydney',        'Sydney',        'Australia',           -33.8688, 151.2093),
  ('Lagos',         'Lagos',         'Nigeria',               6.5244,   3.3792),
  ('Sao Paulo',     'Sao Paulo',     'Brazil',              -23.5505, -46.6333)
) AS v(name, city, country, lat, lng)
ON CONFLICT (slug) WHERE visibility = 'public' DO NOTHING;

-- Backfill: every preset chip a user already picked becomes a never-expiring user_intents row.
INSERT INTO user_intents (user_id, intent_id, source, expires_at)
SELECT u.id, i.id, 'preset', NULL
FROM users u
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE WHEN jsonb_typeof(u.selected_intents) = 'array' THEN u.selected_intents ELSE '[]'::jsonb END
) AS s(name)
JOIN intents i ON i.kind = 'preset' AND i.visibility = 'public' AND i.slug = intent_slug(s.name)
ON CONFLICT (user_id, intent_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- purchase_intent: give p_user_id the intent, charging the source price.
-- Returns jsonb:
--   {status:'ok', price, expires_at, balance}      balance = buyer's balance after the purchase
--   {status:'not_found'|'private'|'bad_source'|'bad_input'|'insufficient'|'duplicate'}
-- bad_input: null ids, or a paid purchase without a transfer_id.
-- bad_source: unknown source, 'preset' on a non-preset intent, or 'created' by a non-creator
--   (both would otherwise be free, so they are refused rather than priced).
-- A private intent is only purchasable by its creator (free, 7 days). The buyer is locked
-- (advisory xact lock) before the duplicate check and the balance read whenever tokens move.
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

  -- Price table (= INTENT_PRICES in intents-rules.ts).
  IF v_intent.kind = 'preset' OR v_owner THEN
    v_price := 0;
  ELSIF p_source IN ('hot', 'location', 'nearby') THEN
    v_price := 20;
  ELSE
    v_price := 10; -- search
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
    IF p_transfer_id IS NULL THEN
      RETURN jsonb_build_object('status', 'bad_input');
    END IF;

    -- Serialise every debit of this buyer: duplicate check and balance read happen under the lock.
    PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

    IF EXISTS (SELECT 1 FROM points_ledger WHERE transfer_id = p_transfer_id) THEN
      RETURN jsonb_build_object('status', 'duplicate');
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_balance FROM points_ledger WHERE user_id = p_user_id;
    IF v_balance < v_price THEN
      RETURN jsonb_build_object('status', 'insufficient');
    END IF;

    INSERT INTO points_ledger (user_id, amount, reason, category, intent_id, counterparty_id, transfer_id, note)
    VALUES (p_user_id, -v_price, 'intent_purchase', 'intent_purchase', v_intent.id, v_intent.creator_id, p_transfer_id, v_intent.name);

    -- Royalty: only when tokens moved and the intent belongs to someone else.
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

  UPDATE intents SET usage_count = usage_count + 1 WHERE id = v_intent.id;

  RETURN jsonb_build_object(
    'status', 'ok',
    'price', v_price,
    'expires_at', v_expires,
    'balance', v_balance::INT
  );
END;
$$;

REVOKE ALL ON FUNCTION purchase_intent(UUID, UUID, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION purchase_intent(UUID, UUID, TEXT, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION purchase_intent(UUID, UUID, TEXT, UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- create_intent: a user creates a custom intent and holds it at once. Free, no ledger rows.
-- Returns jsonb: {status:'ok', intent:{...}} | {status:'taken'|'bad_name'|'bad_input'}
-- bad_name: after collapsing whitespace the name is not 2..40 chars of letters, digits,
--   spaces, &, - and ' (= validateIntentName in TS), or it slugs to nothing.
-- taken: a public intent with that slug exists (for public), or the creator already has a
--   private intent with that slug (for private).
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
    -- Lost a race with an identical create.
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
      'creator_id', v_intent.creator_id,
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
-- hot_intents: the most used public custom intents. Limit clamped to 1..50 (default 10).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hot_intents(p_limit INT)
RETURNS TABLE (id UUID, name TEXT, slug TEXT, kind TEXT, creator_id UUID, usage_count INT, created_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT i.id, i.name, i.slug, i.kind, i.creator_id, i.usage_count, i.created_at
  FROM intents i
  WHERE i.visibility = 'public' AND i.kind = 'custom'
  ORDER BY i.usage_count DESC, i.created_at DESC, i.slug
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 50);
$$;

REVOKE ALL ON FUNCTION hot_intents(INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION hot_intents(INT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION hot_intents(INT) TO service_role;

-- ---------------------------------------------------------------------------
-- search_intents: prefix search on the slug of the query. Public intents plus the caller's
-- own private ones. The query is slugified first (that strips %, _ and \), then LIKE
-- wildcards are escaped anyway. Empty prefix -> no rows. Limit clamped to 1..50 (default 5).
-- owned = the caller created it; active = the caller currently holds it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search_intents(p_user_id UUID, p_q TEXT, p_limit INT)
RETURNS TABLE (
  id UUID, name TEXT, slug TEXT, kind TEXT, visibility TEXT, creator_id UUID,
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
  SELECT i.id, i.name, i.slug, i.kind, i.visibility, i.creator_id, i.usage_count,
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
-- location_intents: the seeded city intents, alphabetical.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION location_intents()
RETURNS TABLE (id UUID, name TEXT, slug TEXT, city TEXT, country TEXT, usage_count INT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT i.id, i.name, i.slug, i.city, i.country, i.usage_count
  FROM intents i
  WHERE i.kind = 'location' AND i.visibility = 'public'
  ORDER BY i.name, i.id;
$$;

REVOKE ALL ON FUNCTION location_intents() FROM PUBLIC;
REVOKE ALL ON FUNCTION location_intents() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION location_intents() TO service_role;

-- ---------------------------------------------------------------------------
-- nearby_user_intents: the nearest online user (presence within 60 s) with a stored location,
-- and their active public intents. Never returns another user's lat/lng: only city and
-- distance_km (Haversine, 1 decimal).
-- Returns jsonb: {status:'no_location'} when the caller has no location
--              | {status:'ok', user:null, intents:[]} when nobody is near
--              | {status:'ok', user:{id,username,avatar_url,city,distance_km}, intents:[...]}
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
BEGIN
  SELECT u.lat, u.lng INTO v_lat, v_lng FROM users u WHERE u.id = p_user_id;
  IF v_lat IS NULL OR v_lng IS NULL THEN
    RETURN jsonb_build_object('status', 'no_location');
  END IF;

  SELECT u.id, u.username, u.avatar_url, u.city,
         round((
           2 * 6371 * asin(LEAST(1.0, sqrt(
             power(sin(radians(u.lat - v_lat) / 2), 2)
             + cos(radians(v_lat)) * cos(radians(u.lat)) * power(sin(radians(u.lng - v_lng) / 2), 2)
           )))
         )::numeric, 1) AS distance_km
  INTO v_user
  FROM users u
  JOIN user_presence p ON p.user_id = u.id
  WHERE u.id <> p_user_id
    AND u.lat IS NOT NULL AND u.lng IS NOT NULL
    AND p.last_seen_at > now() - interval '60 seconds'
  ORDER BY 5 ASC, u.id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'ok', 'user', 'null'::jsonb, 'intents', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', i.id, 'name', i.name, 'slug', i.slug, 'kind', i.kind,
           'creator_id', i.creator_id, 'usage_count', i.usage_count
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
      'distance_km', v_user.distance_km
    ),
    'intents', v_intents
  );
END;
$$;

REVOKE ALL ON FUNCTION nearby_user_intents(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION nearby_user_intents(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION nearby_user_intents(UUID) TO service_role;

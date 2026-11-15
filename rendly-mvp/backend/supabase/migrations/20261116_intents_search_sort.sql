-- ---------------------------------------------------------------------------
-- search_intents_sorted: intent search with a sort and a per-sort count, for the Spark
-- intent sheet ("[2k] #ai"). Same visibility rules and escaped prefix match as
-- search_intents (20250623_tokens_hardening.sql), except a blank p_q matches every visible
-- public intent (plus the caller's own private ones).
--   p_sort 'trending'  : count = user_intents rows for the intent created in the last 7 days
--          'popular'   : count = current active holders (active_user_intents)
--          'most_used' : count = intents.usage_count
--   anything else behaves as 'trending'.
-- Idempotent.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS search_intents_sorted(UUID, TEXT, INT, TEXT);
CREATE FUNCTION search_intents_sorted(p_user_id UUID, p_q TEXT, p_limit INT, p_sort TEXT)
RETURNS TABLE (
  id UUID, name TEXT, slug TEXT, kind TEXT, visibility TEXT,
  usage_count INT, owned BOOLEAN, active BOOLEAN, count INT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH q AS (
    SELECT replace(replace(replace(intent_slug(COALESCE(p_q, '')), '\', '\\'), '%', '\%'), '_', '\_') AS prefix,
           CASE lower(btrim(COALESCE(p_sort, '')))
             WHEN 'popular' THEN 'popular'
             WHEN 'most_used' THEN 'most_used'
             ELSE 'trending'
           END AS sort
  ),
  matched AS (
    SELECT i.id, i.name, i.slug, i.kind, i.visibility, i.usage_count, i.creator_id
    FROM intents i, q
    WHERE (q.prefix = '' OR i.slug LIKE q.prefix || '%' ESCAPE '\')
      AND (i.visibility = 'public' OR (i.creator_id IS NOT NULL AND i.creator_id = p_user_id))
  ),
  counted AS (
    SELECT m.*,
           (CASE q.sort
              WHEN 'popular' THEN (SELECT count(*) FROM active_user_intents a WHERE a.intent_id = m.id)
              WHEN 'most_used' THEN COALESCE(m.usage_count, 0)::BIGINT
              ELSE (SELECT count(*) FROM user_intents u
                    WHERE u.intent_id = m.id AND u.created_at > now() - interval '7 days')
            END)::INT AS cnt
    FROM matched m, q
  )
  SELECT c.id, c.name, c.slug, c.kind, c.visibility, c.usage_count,
         (c.creator_id IS NOT NULL AND c.creator_id = p_user_id) AS owned,
         EXISTS (SELECT 1 FROM active_user_intents a WHERE a.user_id = p_user_id AND a.intent_id = c.id) AS active,
         c.cnt AS count
  FROM counted c
  ORDER BY c.cnt DESC, c.usage_count DESC, c.slug, c.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 5), 1), 50);
$$;
REVOKE ALL ON FUNCTION search_intents_sorted(UUID, TEXT, INT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION search_intents_sorted(UUID, TEXT, INT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION search_intents_sorted(UUID, TEXT, INT, TEXT) TO service_role;

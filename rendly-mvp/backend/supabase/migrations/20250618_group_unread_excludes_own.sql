-- Group unread counts included the user's own messages, so a group you had just posted in
-- showed as unread. Count only messages sent by someone else. Safe to run more than once.
CREATE OR REPLACE FUNCTION get_group_unread_count(p_user_id UUID, p_group_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_last_read_at timestamptz;
  v_count integer := 0;
  v_since timestamptz := now() - interval '30 days';
BEGIN
  SELECT last_read_at INTO v_last_read_at
  FROM user_group_read
  WHERE user_id = p_user_id AND group_id = p_group_id;

  SELECT COUNT(*)::integer INTO v_count
  FROM group_chat_data g,
       jsonb_array_elements(COALESCE(g.data->'messages', '[]'::jsonb)) AS elem
  WHERE g.group_id = p_group_id
    AND COALESCE(elem->>'sent_by_id', elem->>'sender_id', '') <> p_user_id::text
    AND ( (elem->>'created_at')::timestamptz >= v_since OR elem->>'created_at' IS NULL )
    AND ( v_last_read_at IS NULL OR (elem->>'created_at')::timestamptz > v_last_read_at );

  RETURN COALESCE(v_count, 0);
END;
$$;

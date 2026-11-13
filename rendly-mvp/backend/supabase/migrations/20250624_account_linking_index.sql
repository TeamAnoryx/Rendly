-- Account linking: one account per email, case-insensitive.
-- Run AFTER 20250624_account_linking.sql, on its own (CONCURRENTLY cannot run inside a
-- transaction block). Safe to run more than once.
--
-- BEFORE running, check for existing duplicates; the build fails while any remain:
--
--   SELECT lower(email) AS email_key, count(*) AS accounts,
--          array_agg(id ORDER BY created_at) AS user_ids
--   FROM users
--   WHERE email IS NOT NULL
--   GROUP BY lower(email)
--   HAVING count(*) > 1
--   ORDER BY accounts DESC;
--
-- Resolve every row returned (merge manually, see the account-linking notes), then run this.
-- If a previous attempt failed, drop the invalid index first:
--   DROP INDEX CONCURRENTLY IF EXISTS uq_users_email_lower;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_users_email_lower
  ON users (lower(email))
  WHERE email IS NOT NULL;

-- Account linking: one account per github identity. Run on its own (CONCURRENTLY).
-- Check first: SELECT github_id, count(*) FROM users WHERE github_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_users_github_id
  ON users (github_id)
  WHERE github_id IS NOT NULL;

-- Account linking: one account per linkedin identity. Run on its own (CONCURRENTLY).
-- Check first: SELECT linkedin_id, count(*) FROM users WHERE linkedin_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_users_linkedin_id
  ON users (linkedin_id)
  WHERE linkedin_id IS NOT NULL;

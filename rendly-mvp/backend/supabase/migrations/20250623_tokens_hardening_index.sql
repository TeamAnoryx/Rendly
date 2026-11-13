-- M1 (tokens hardening): at most one whisper bubble per ledger transfer. Run after
-- 20250623_tokens_hardening.sql, each statement as its own query (CONCURRENTLY cannot run
-- inside a transaction block). Safe to run more than once.
-- The unique index replaces the plain idx_whisper_messages_transfer_id from
-- 20250622_tokens_indexes_4.sql and serves the same chat-service lookup.
-- If existing duplicate bubbles make the build fail, drop the invalid index
-- (DROP INDEX CONCURRENTLY uq_whisper_messages_transfer_id), delete the extra bubbles, re-run.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_whisper_messages_transfer_id
  ON whisper_messages ((message->>'transfer_id'))
  WHERE message ? 'transfer_id';

DROP INDEX CONCURRENTLY IF EXISTS idx_whisper_messages_transfer_id;

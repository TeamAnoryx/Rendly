-- M1 (tokens hardening), step 2: drop the plain index the unique one replaces.
-- Run alone, after 20250623_tokens_hardening_index.sql (CONCURRENTLY cannot run in a transaction).
DROP INDEX CONCURRENTLY IF EXISTS idx_whisper_messages_transfer_id;

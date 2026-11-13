-- Index 4 of 4 for the Rendly Tokens migrations (20250619 to 20250622): the chat-service "transfer already
-- has a bubble" check for token_transfer whisper messages.
-- Run as its own query (CONCURRENTLY cannot run inside a transaction block).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_whisper_messages_transfer_id ON whisper_messages ((message->>'transfer_id')) WHERE message ? 'transfer_id';

/**
 * Rendly Tokens: verification of a whisper token transfer before it becomes a chat bubble.
 *
 * The money moves in auth-service (POST /api/tokens/transfer -> transfer_tokens RPC), which
 * writes a debit row (amount < 0) and a credit row (amount > 0) to points_ledger sharing one
 * transfer_id. The chat-service only checks that the debit row exists, belongs to this sender,
 * names this chat partner and this conversation, and that no whisper message already carries
 * the transfer_id, so a client cannot fabricate or replay a "sent you N tokens" bubble.
 *
 * Every Supabase error is thrown; callers answer 500. Nothing here mutates the ledger.
 */

import { supabase } from "./supabase-users";

export type TransferVerification =
  | { status: "ok"; amount: number; note: string | null }
  | { status: "not_found" | "mismatch" | "used" };

type LedgerDebitRow = {
  user_id: string | null;
  counterparty_id: string | null;
  conversation_id: string | null;
  amount: number | null;
  note: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a canonical 8-4-4-4-12 hex UUID string. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * Verify that `transferId` is a ledger transfer from `senderId` to `otherUserId` recorded for
 * `conversationId`, and that it has not already been attached to a whisper message.
 *
 * Throws when Supabase is not configured or any query fails.
 */
export async function verifyTransferForMessage(
  transferId: string,
  senderId: string,
  otherUserId: string,
  conversationId: string
): Promise<TransferVerification> {
  if (!supabase) throw new Error("Supabase client not configured");
  if (!isUuid(transferId)) return { status: "not_found" };

  // Debit side only: the sender's row. The unique index uq_points_ledger_transfer_side
  // guarantees at most one row with amount < 0 per transfer_id, so maybeSingle is safe.
  const { data: debit, error: debitError } = await supabase
    .from("points_ledger")
    .select("user_id, counterparty_id, conversation_id, amount, note")
    .eq("transfer_id", transferId)
    .lt("amount", 0)
    .maybeSingle();
  if (debitError) {
    throw new Error(`points_ledger lookup failed for transfer ${transferId}: ${debitError.message}`);
  }
  if (!debit) return { status: "not_found" };

  const row = debit as LedgerDebitRow;
  const amount = typeof row.amount === "number" ? Math.abs(row.amount) : NaN;
  if (
    row.user_id !== senderId ||
    row.counterparty_id !== otherUserId ||
    row.conversation_id !== conversationId ||
    !Number.isInteger(amount) ||
    amount < 1
  ) {
    return { status: "mismatch" };
  }

  // Replay guard: one bubble per transfer. Expression index on (message->>'transfer_id')
  // from 20250619_tokens_ledger_v2.sql serves this filter.
  const { data: existing, error: usedError } = await supabase
    .from("whisper_messages")
    .select("id")
    .eq("message->>transfer_id", transferId)
    .limit(1)
    .maybeSingle();
  if (usedError) {
    throw new Error(`whisper_messages lookup failed for transfer ${transferId}: ${usedError.message}`);
  }
  if (existing) return { status: "used" };

  return { status: "ok", amount, note: typeof row.note === "string" ? row.note : null };
}

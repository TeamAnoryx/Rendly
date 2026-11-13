/**
 * Pure Rendly Tokens rules: request validation for peer transfers and host-paid huddle sends.
 * No database access, so everything here is unit-testable. Ranges mirror the SQL RPCs
 * (transfer_tokens, huddle_send_tokens) so a bad body is rejected before it reaches the DB.
 */

import { isUuid } from "./huddle-rules";

export { isUuid };

export const HUDDLE_SEND_PURPOSES = ["winner", "best_answer", "participation", "speaker_thanks", "bounty", "other"] as const;
export type HuddleSendPurpose = (typeof HUDDLE_SEND_PURPOSES)[number];

export const HUDDLE_SEND_PURPOSE_LABELS: Readonly<Record<HuddleSendPurpose, string>> = {
  winner: "Winner",
  best_answer: "Best answer",
  participation: "Participation",
  speaker_thanks: "Speaker thanks",
  bounty: "Bounty",
  other: "Other",
};

export const TRANSFER_MIN_AMOUNT = 1;
export const TRANSFER_MAX_AMOUNT = 1_000_000;
export const HUDDLE_SEND_MIN_AMOUNT = 1;
export const HUDDLE_SEND_MAX_AMOUNT = 1000;
export const NOTE_MAX_LENGTH = 140;
export const CONVERSATION_ID_MAX_LENGTH = 120;

export type RulesResult<T> = { ok: true; value: T } | { ok: false; error: string };

export type TransferBody = {
  to_user_id: string;
  amount: number;
  note: string | null;
  conversation_id: string;
};

export type HuddleSendBody = {
  user_id: string;
  amount: number;
  purpose: HuddleSendPurpose;
  note: string | null;
};

function asRecord(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

/** Whole-number amount inside [min, max]; strings and floats are rejected. */
function validateAmount(raw: unknown, min: number, max: number): RulesResult<number> {
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    return { ok: false, error: "amount must be a whole number" };
  }
  if (raw < min || raw > max) {
    return { ok: false, error: `amount must be between ${min} and ${max}` };
  }
  return { ok: true, value: raw };
}

/** Optional free-text note: trimmed, at most NOTE_MAX_LENGTH characters, empty means null. */
function validateNote(raw: unknown): RulesResult<string | null> {
  if (raw == null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, error: "note must be text" };
  const note = raw.trim();
  if (note.length > NOTE_MAX_LENGTH) {
    return { ok: false, error: `note must be at most ${NOTE_MAX_LENGTH} characters` };
  }
  return { ok: true, value: note || null };
}

export function isHuddleSendPurpose(value: unknown): value is HuddleSendPurpose {
  return typeof value === "string" && (HUDDLE_SEND_PURPOSES as readonly string[]).includes(value);
}

/** Validate a POST /api/tokens/transfer body. */
export function validateTransferBody(body: unknown): RulesResult<TransferBody> {
  const input = asRecord(body);
  if (!isUuid(input.to_user_id)) return { ok: false, error: "to_user_id must be a user id" };
  const amount = validateAmount(input.amount, TRANSFER_MIN_AMOUNT, TRANSFER_MAX_AMOUNT);
  if (!amount.ok) return amount;
  const note = validateNote(input.note);
  if (!note.ok) return note;
  const conversationId = typeof input.conversation_id === "string" ? input.conversation_id.trim() : "";
  if (!conversationId) return { ok: false, error: "conversation_id is required" };
  if (conversationId.length > CONVERSATION_ID_MAX_LENGTH) {
    return { ok: false, error: `conversation_id must be at most ${CONVERSATION_ID_MAX_LENGTH} characters` };
  }
  return {
    ok: true,
    value: { to_user_id: input.to_user_id, amount: amount.value, note: note.value, conversation_id: conversationId },
  };
}

/** Validate a POST /api/huddles/:id/send-tokens body. A note is required when purpose is "other". */
export function validateHuddleSendBody(body: unknown): RulesResult<HuddleSendBody> {
  const input = asRecord(body);
  if (!isUuid(input.user_id)) return { ok: false, error: "user_id must be a user id" };
  const amount = validateAmount(input.amount, HUDDLE_SEND_MIN_AMOUNT, HUDDLE_SEND_MAX_AMOUNT);
  if (!amount.ok) return amount;
  if (!isHuddleSendPurpose(input.purpose)) {
    return { ok: false, error: `purpose must be one of ${HUDDLE_SEND_PURPOSES.join(", ")}` };
  }
  const note = validateNote(input.note);
  if (!note.ok) return note;
  if (input.purpose === "other" && note.value === null) {
    return { ok: false, error: "note is required when purpose is other" };
  }
  return {
    ok: true,
    value: { user_id: input.user_id, amount: amount.value, purpose: input.purpose, note: note.value },
  };
}

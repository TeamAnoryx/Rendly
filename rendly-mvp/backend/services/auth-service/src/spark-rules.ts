/**
 * Pure Spark matching rules: request validation, conversation ids and call roles.
 * No database access, so everything here is unit-testable.
 */

export const MATCH_MODES = ["text", "video"] as const;
export type MatchMode = (typeof MATCH_MODES)[number];

/**
 * Any intent name, preset or custom: trimmed free text between MATCH_INTENT_MIN and
 * MATCH_INTENT_MAX characters. Mirrors the match_queue CHECK (char_length BETWEEN 2 AND 40).
 */
export type MatchIntent = string;
export const MATCH_INTENT_MIN = 2;
export const MATCH_INTENT_MAX = 40;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; message: string };

export function validateMatchRequest(body: unknown): ValidationResult<{ mode: MatchMode; intent: MatchIntent }> {
  const input = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  if (!MATCH_MODES.includes(input.mode as MatchMode)) {
    return { ok: false, message: "mode must be text or video" };
  }
  const intent = typeof input.intent === "string" ? input.intent.replace(/\s+/g, " ").trim() : "";
  if (intent.length < MATCH_INTENT_MIN || intent.length > MATCH_INTENT_MAX) {
    return { ok: false, message: `intent must be between ${MATCH_INTENT_MIN} and ${MATCH_INTENT_MAX} characters` };
  }
  return { ok: true, value: { mode: input.mode as MatchMode, intent } };
}

/** Same id the chat service uses for a 1:1 conversation, so both users land in one thread. */
export function whisperConversationId(userIdA: string, userIdB: string): string {
  const [a, b] = [userIdA, userIdB].sort();
  return `whisper_${a}_${b}`;
}

/**
 * For a video match, exactly one side starts the call. The user with the smaller id
 * initiates, so both sides agree without another round trip.
 */
export function isCallInitiator(userId: string, partnerId: string): boolean {
  return userId < partnerId;
}

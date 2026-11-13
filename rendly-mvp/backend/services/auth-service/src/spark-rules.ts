/**
 * Pure Spark matching rules: request validation, pricing, conversation ids and call roles.
 * No database access, so everything here is unit-testable.
 *
 * Pricing must stay equal to spark_intent_price in 20250625_spark_v2.sql.
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
export const MATCH_INTENTS_MAX = 5;
export const MATCH_NOTE_MAX = 200;

/** The four Spark presets: 5 tokens each. Anything else (hot, location, near by, custom) costs 10. */
export const SPARK_PRESETS = ["Light chat", "Brainstorm", "Motivation", "Collaborate"] as const;
export const SPARK_PRESET_PRICE = 5;
export const SPARK_OTHER_PRICE = 10;

const PRESET_KEYS = new Set(SPARK_PRESETS.map((p) => p.toLowerCase()));

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; message: string };

export type MatchRequest = {
  mode: MatchMode;
  intents: MatchIntent[];
  note: string | null;
  anonymous: boolean;
};

/** True for the four preset names, case-insensitive. */
export function isSparkPreset(name: string): boolean {
  return PRESET_KEYS.has(name.trim().toLowerCase());
}

/** Tokens one intent adds to the cost of a Spark. */
export function sparkIntentPrice(name: string): number {
  return isSparkPreset(name) ? SPARK_PRESET_PRICE : SPARK_OTHER_PRICE;
}

/** Cost of one match for a list of intents: the sum of their prices. */
export function sparkMatchCost(intents: readonly string[]): number {
  return intents.reduce((sum, name) => sum + sparkIntentPrice(name), 0);
}

/** Trim and collapse whitespace; returns "" for non-strings. */
function normaliseIntent(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
}

/**
 * Validate a list of intent names: 1..5 names of 2..40 characters each, trimmed and
 * whitespace-collapsed, duplicates (case-insensitive) dropped keeping the first spelling.
 */
export function validateIntentList(raw: unknown): ValidationResult<MatchIntent[]> {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, message: "intents must be a list of 1 to 5 names" };
  }
  // Bound the work before normalising: duplicates may shrink the list, but not by much.
  if (raw.length > MATCH_INTENTS_MAX * 4) {
    return { ok: false, message: `intents must be a list of 1 to ${MATCH_INTENTS_MAX} names` };
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const name = normaliseIntent(item);
    if (name.length < MATCH_INTENT_MIN || name.length > MATCH_INTENT_MAX) {
      return { ok: false, message: `each intent must be between ${MATCH_INTENT_MIN} and ${MATCH_INTENT_MAX} characters` };
    }
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  if (out.length > MATCH_INTENTS_MAX) {
    return { ok: false, message: `intents must be a list of 1 to ${MATCH_INTENTS_MAX} names` };
  }
  return { ok: true, value: out };
}

/** Strip control characters, trim; null when empty. Fails when longer than 200 characters. */
function validateNote(raw: unknown): ValidationResult<string | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, message: "note must be text" };
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) return { ok: true, value: null };
  if (cleaned.length > MATCH_NOTE_MAX) return { ok: false, message: `note must be at most ${MATCH_NOTE_MAX} characters` };
  return { ok: true, value: cleaned };
}

/**
 * Validate a POST /api/match/queue body: {mode, intents[1..5], note?, anonymous?}.
 * The legacy {mode, intent} shape is accepted as intents = [intent]. anonymous defaults to true.
 */
export function validateMatchRequest(body: unknown): ValidationResult<MatchRequest> {
  const input = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  if (!MATCH_MODES.includes(input.mode as MatchMode)) {
    return { ok: false, message: "mode must be text or video" };
  }
  const rawIntents = input.intents !== undefined ? input.intents : input.intent !== undefined ? [input.intent] : undefined;
  const intents = validateIntentList(rawIntents);
  if (!intents.ok) return intents;
  const note = validateNote(input.note);
  if (!note.ok) return note;
  if (input.anonymous !== undefined && typeof input.anonymous !== "boolean") {
    return { ok: false, message: "anonymous must be true or false" };
  }
  return {
    ok: true,
    value: {
      mode: input.mode as MatchMode,
      intents: intents.value,
      note: note.value,
      anonymous: input.anonymous === undefined ? true : (input.anonymous as boolean),
    },
  };
}

/** Parse GET /api/match/quote?intents=a,b (already URL-decoded by express). */
export function parseQuoteIntents(raw: unknown): ValidationResult<MatchIntent[]> {
  if (typeof raw !== "string" || raw.length > 400) {
    return { ok: false, message: "intents must be a comma-separated list of 1 to 5 names" };
  }
  return validateIntentList(raw.split(","));
}

/** Names shared by both lists (case-insensitive), in the order and spelling of `mine`. */
export function sharedIntents(mine: readonly string[], theirs: readonly string[]): string[] {
  const other = new Set(theirs.map((x) => x.toLowerCase()));
  return mine.filter((x) => other.has(x.toLowerCase()));
}

/** What the partner is shown as: '@username' when public, '@Anonymous' otherwise. */
export function partnerDisplayName(anonymous: boolean, username: string | null | undefined): string {
  return !anonymous && username ? `@${username}` : "@Anonymous";
}

/**
 * True when a Supabase/PostgREST error means the Spark v2 migration has not run yet:
 * unknown RPC (PGRST202), unknown column (42703) or unknown function (42883).
 */
export function isMissingSchemaError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === "PGRST202" || code === "42703" || code === "42883" || code === "PGRST204";
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

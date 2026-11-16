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
  /** Default (guaranteed match): pair with another Default user when no intent match is found. */
  match_any: boolean;
};

/** Extra tokens per side when a match was made by the Default fallback (never for intent matches). */
export const SPARK_DEFAULT_FEE = 5;

/** Seconds a waiting user is given to find an intent match before the Default fallback (and mixed-mode pairing) applies. */
export const SPARK_FALLBACK_GRACE_SECONDS = 5;

/** How a pair was made: a shared intent, or the Default fallback. */
export type MatchedVia = "intents" | "default";

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
  if (input.match_any !== undefined && typeof input.match_any !== "boolean") {
    return { ok: false, message: "match_any must be true or false" };
  }
  return {
    ok: true,
    value: {
      mode: input.mode as MatchMode,
      intents: intents.value,
      note: note.value,
      anonymous: input.anonymous === undefined ? true : (input.anonymous as boolean),
      match_any: input.match_any === undefined ? true : (input.match_any as boolean),
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

/**
 * What each side of a pair is charged: the sum of the prices of the intents they share.
 * Intents only one side picked cost nothing. A pair with no shared intent was made by the
 * Default fallback and costs SPARK_DEFAULT_FEE each. Mirrors match_cost in
 * 20261122_spark_shared_pricing.sql.
 */
export function sharedMatchCost(mine: readonly string[], theirs: readonly string[]): number {
  const shared = sharedIntents(mine, theirs);
  return shared.length === 0 ? SPARK_DEFAULT_FEE : sparkMatchCost(shared);
}

/**
 * The least a request can end up costing: its cheapest intent (a pair always shares at least
 * one), or the Default fee when Default matching is on. The balance must cover this to queue.
 */
export function sparkMinMatchCost(intents: readonly string[], matchAny: boolean): number {
  const prices = intents.map(sparkIntentPrice);
  if (matchAny) prices.push(SPARK_DEFAULT_FEE);
  return prices.length === 0 ? 0 : Math.min(...prices);
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

/* ---------------------------------------------------------------------------------------
 * Deferred charging and rate limit.
 * A pair is charged (each side its own cost) only once the match has lasted
 * SPARK_CHARGE_AFTER_SECONDS. Ending earlier waives the charge for both sides.
 * Mirrors spark_settle_pairing in the deferred-charge migration.
 * ------------------------------------------------------------------------------------- */

export const SPARK_CHARGE_AFTER_SECONDS = 30;
export const SPARK_MATCHES_PER_WINDOW = 20;
export const SPARK_WINDOW_MINUTES = 60;

export type SparkChargeState = "pending" | "charged" | "waived";
export type SparkCharge = { state: SparkChargeState; settles_at: string | null; cost: number };

export type SparkLimits = {
  balance: number;
  matches_used: number;
  matches_left: number;
  max_per_window: number;
  window_minutes: number;
  resets_at: string | null;
};

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/** When a pairing matched at matchedAt becomes chargeable (ISO). */
export function chargeSettlesAt(matchedAt: Date | string): string {
  return new Date(toDate(matchedAt).getTime() + SPARK_CHARGE_AFTER_SECONDS * 1000).toISOString();
}

/**
 * What to do with a pairing's charge now. Pending and lasted >= 30s (less a 1s tolerance;
 * measured to endedAt when ended) -> charge; pending and ending/ended before 30s -> waive; otherwise keep.
 */
/**
 * A settle that arrives up to this early still charges: clocks drift and the client's
 * countdown fires on its own timer. Mirrors the 1 second tolerance in spark_settle_pairing.
 */
export const SPARK_SETTLE_TOLERANCE_MS = 1000;

export function decideSettlement(input: {
  state: SparkChargeState;
  matchedAt: Date;
  endedAt: Date | null;
  now: Date;
  ending: boolean;
}): "charge" | "waive" | "keep" {
  if (input.state !== "pending") return "keep";
  const until = input.endedAt ?? input.now;
  const elapsedMs = until.getTime() - input.matchedAt.getTime();
  if (elapsedMs >= SPARK_CHARGE_AFTER_SECONDS * 1000 - SPARK_SETTLE_TOLERANCE_MS) return "charge";
  if (input.ending || input.endedAt) return "waive";
  return "keep";
}

/** Rolling-window match allowance from the matched_at times of the user's recent matches. */
export function computeSparkLimits(
  matchedAts: readonly (Date | string)[],
  balance: number,
  now: Date,
  max = SPARK_MATCHES_PER_WINDOW,
  windowMinutes = SPARK_WINDOW_MINUTES
): SparkLimits {
  const windowMs = windowMinutes * 60 * 1000;
  const start = now.getTime() - windowMs;
  const inWindow = matchedAts
    .map((x) => toDate(x).getTime())
    .filter((t) => Number.isFinite(t) && t > start && t <= now.getTime());
  const used = inWindow.length;
  const oldest = used > 0 ? Math.min(...inWindow) : null;
  return {
    balance,
    matches_used: used,
    matches_left: Math.max(0, max - used),
    max_per_window: max,
    window_minutes: windowMinutes,
    resets_at: oldest === null ? null : new Date(oldest + windowMs).toISOString(),
  };
}

/** True when no matches are left in the current window. */
export function isRateLimited(limits: SparkLimits): boolean {
  return limits.matches_left <= 0;
}

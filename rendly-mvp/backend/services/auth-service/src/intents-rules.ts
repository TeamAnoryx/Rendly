/**
 * Pure intent rules: slugs, prices, durations and request validation for custom intents
 * and the opt-in user location. No database access. The price and duration tables must
 * stay equal to the purchase_intent SQL RPC.
 */

export const INTENT_NAME_MIN = 2;
export const INTENT_NAME_MAX = 40;
export const INTENT_SLUG_MAX = 40;
export const CITY_MAX_LENGTH = 80;

/** Letters (any script), digits, spaces, ampersand, hyphen and apostrophe. */
const INTENT_NAME_PATTERN = /^[\p{L}\p{N} &'-]+$/u;

export const INTENT_KINDS = ["preset", "custom", "location"] as const;
export type IntentKind = (typeof INTENT_KINDS)[number];

export const INTENT_VISIBILITIES = ["public", "private"] as const;
export type IntentVisibility = (typeof INTENT_VISIBILITIES)[number];

/** Where a user_intents row came from. Only the paid sources carry a price. */
export const INTENT_SOURCES = ["preset", "hot", "location", "nearby", "search", "created"] as const;
export type IntentSource = (typeof INTENT_SOURCES)[number];

export const PAID_INTENT_SOURCES = ["hot", "location", "nearby", "search"] as const;
export type PaidIntentSource = (typeof PAID_INTENT_SOURCES)[number];

/** Rendly Tokens charged per source; must equal the SQL purchase_intent prices. */
export const INTENT_PRICES: Readonly<Record<PaidIntentSource, number>> = { hot: 20, location: 20, nearby: 20, search: 10 };

/** Tokens the creator earns when someone else buys their intent. */
export const INTENT_ROYALTY = 10;

/** How long an intent stays active, in days. Presets and own public intents never expire. */
export const INTENT_DURATION_DAYS = { purchased: 28, ownPrivate: 7 } as const;

export type RulesResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function isIntentSource(value: unknown): value is IntentSource {
  return typeof value === "string" && (INTENT_SOURCES as readonly string[]).includes(value);
}

export function isPaidIntentSource(value: unknown): value is PaidIntentSource {
  return typeof value === "string" && (PAID_INTENT_SOURCES as readonly string[]).includes(value);
}

/** Lowercase, whitespace runs become one hyphen, anything outside [a-z0-9-] dropped, at most 40 chars. */
export function intentSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, INTENT_SLUG_MAX);
}

/** Price of a location intent, whatever source the client names (= purchase_intent SQL). */
export const LOCATION_INTENT_PRICE = 20;

/**
 * Price in tokens: presets and your own intents are free; location intents always cost 20
 * (the source is client-chosen, so it must never discount them); other intents follow the
 * source table. Must equal the purchase_intent SQL RPC.
 */
export function intentPrice(kind: IntentKind, source: IntentSource, isOwner: boolean): number {
  if (kind === "preset") return 0;
  if (isOwner) return 0;
  if (kind === "location") return LOCATION_INTENT_PRICE;
  if (isPaidIntentSource(source)) return INTENT_PRICES[source];
  return 0;
}

/** 2..40 characters after trimming, letters/digits/space/&/-/' only. */
export function validateIntentName(name: unknown): RulesResult<string> {
  if (typeof name !== "string") return { ok: false, error: "name must be text" };
  const trimmed = name.replace(/\s+/g, " ").trim();
  if (trimmed.length < INTENT_NAME_MIN || trimmed.length > INTENT_NAME_MAX) {
    return { ok: false, error: `name must be between ${INTENT_NAME_MIN} and ${INTENT_NAME_MAX} characters` };
  }
  if (!INTENT_NAME_PATTERN.test(trimmed)) {
    return { ok: false, error: "name may only use letters, digits, spaces, &, - and '" };
  }
  return { ok: true, value: trimmed };
}

function asRecord(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

export type CreateIntentBody = { name: string; visibility: IntentVisibility };

/** Validate a POST /api/intents body. */
export function validateCreateIntentBody(body: unknown): RulesResult<CreateIntentBody> {
  const input = asRecord(body);
  const name = validateIntentName(input.name);
  if (!name.ok) return name;
  if (!(INTENT_VISIBILITIES as readonly unknown[]).includes(input.visibility)) {
    return { ok: false, error: "visibility must be public or private" };
  }
  return { ok: true, value: { name: name.value, visibility: input.visibility as IntentVisibility } };
}

export type LocationBody = { lat: number; lng: number; city: string | null };

/** Validate a PUT /api/users/me/location body: finite lat -90..90, lng -180..180, optional city <= 80. */
export function validateLocationBody(body: unknown): RulesResult<LocationBody> {
  const input = asRecord(body);
  const { lat, lng } = input;
  if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    return { ok: false, error: "lat must be a number between -90 and 90" };
  }
  if (typeof lng !== "number" || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return { ok: false, error: "lng must be a number between -180 and 180" };
  }
  let city: string | null = null;
  if (input.city != null) {
    if (typeof input.city !== "string") return { ok: false, error: "city must be text" };
    city = input.city.replace(/\s+/g, " ").trim() || null;
    if (city && city.length > CITY_MAX_LENGTH) {
      return { ok: false, error: `city must be at most ${CITY_MAX_LENGTH} characters` };
    }
  }
  return { ok: true, value: { lat, lng, city } };
}

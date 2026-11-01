/**
 * Pure huddle rules: access control, input validation and response shaping.
 * No database access here, so everything in this module is unit-testable.
 */

export type HuddleType = "public" | "private" | "instant";
export type HuddleCategory = "trendy" | "live" | "all";

export const HUDDLE_TYPES: readonly HuddleType[] = ["public", "private", "instant"];
export const HUDDLE_CATEGORIES: readonly HuddleCategory[] = ["trendy", "live", "all"];
export const ALLOWED_MAX_PARTICIPANTS: readonly number[] = [10, 15, 20, 50];

export const TITLE_MAX_LENGTH = 255;
export const DESCRIPTION_MAX_LENGTH = 2000;
export const MIN_DURATION_MINUTES = 1;
export const MAX_DURATION_MINUTES = 30;
/** How far ahead a huddle may be scheduled. */
export const MAX_SCHEDULE_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;
/** Grace window so a "now" schedule sent by a client with clock skew is not rejected. */
export const SCHEDULE_PAST_GRACE_MS = 5 * 60 * 1000;
export const HUDDLE_MODES = ["open", "seminar", "hackathon", "launch"] as const;
export type HuddleMode = (typeof HUDDLE_MODES)[number];
/** Intent tags act like hashtags: lowercase letters, digits and hyphens, up to 30 characters. */
export const INTENT_TAG_PATTERN = /^[a-z0-9][a-z0-9-]{0,29}$/;
export const MAX_INTENTS_PER_HUDDLE = 5;
export const MAX_INVITEES_PER_REQUEST = 50;
export const SETTINGS_MAX_KEYS = 20;
export const SETTINGS_MAX_BYTES = 4096;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type HuddleRow = {
  id: string;
  created_by: string;
  title: string;
  description: string | null;
  max_participants: number;
  type: HuddleType;
  is_active: boolean;
  started_at: string | null;
  ended_at: string | null;
  scheduled_at: string | null;
  duration_minutes: number | null;
  invite_code: string | null;
  settings: Record<string, unknown>;
  created_at: string;
  mode: HuddleMode;
  waiting_room: boolean;
  media_path: string | null;
  media_type: "image" | "video" | "audio" | null;
};

export type CreateHuddleInput = {
  title: string;
  description: string | null;
  max_participants: number;
  type: HuddleType;
  scheduled_at: string | null;
  duration_minutes: number | null;
  settings: Record<string, unknown>;
  mode: HuddleMode;
  waiting_room: boolean;
  intents: string[];
  invitee_ids: string[];
};

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; message: string };

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function parseCategory(value: unknown): HuddleCategory {
  return HUDDLE_CATEGORIES.includes(value as HuddleCategory) ? (value as HuddleCategory) : "all";
}

export type AccessContext = {
  viewerId: string;
  isParticipant: boolean;
  /** The host or a co-host has invited this user. */
  isInvited: boolean;
};

/**
 * Public and instant huddles are open. Private huddles are visible only to the creator,
 * people already in the room, and people the host or a co-host invited. A link alone does
 * not grant access, so invite codes are no longer used.
 */
export function canAccessHuddle(huddle: HuddleRow, ctx: AccessContext): boolean {
  if (huddle.type !== "private") return true;
  if (huddle.created_by === ctx.viewerId) return true;
  if (ctx.isParticipant) return true;
  return ctx.isInvited;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function validateSettings(raw: unknown): ValidationResult<Record<string, unknown>> {
  if (raw == null) return { ok: true, value: {} };
  if (!isPlainObject(raw)) return { ok: false, message: "settings must be an object" };
  const keys = Object.keys(raw);
  if (keys.length > SETTINGS_MAX_KEYS) return { ok: false, message: `settings may have at most ${SETTINGS_MAX_KEYS} keys` };
  for (const key of keys) {
    const v = raw[key];
    const isScalar = v === null || ["string", "number", "boolean"].includes(typeof v);
    if (!isScalar) return { ok: false, message: "settings values must be strings, numbers, booleans or null" };
  }
  if (Buffer.byteLength(JSON.stringify(raw)) > SETTINGS_MAX_BYTES) {
    return { ok: false, message: "settings is too large" };
  }
  return { ok: true, value: { ...raw } };
}

/** Intents: trimmed, lowercased, a leading # removed, unique, up to MAX_INTENTS_PER_HUDDLE. Absent means none. */
export function validateIntents(raw: unknown): ValidationResult<string[]> {
  if (raw == null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, message: "intents must be a list" };
  const tags: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") return { ok: false, message: "each intent must be a string" };
    const tag = item.trim().toLowerCase().replace(/^#/, "");
    if (!INTENT_TAG_PATTERN.test(tag)) {
      return { ok: false, message: "intents use lowercase letters, digits and hyphens (30 characters at most)" };
    }
    if (!tags.includes(tag)) tags.push(tag);
  }
  if (tags.length > MAX_INTENTS_PER_HUDDLE) {
    return { ok: false, message: `a huddle can have at most ${MAX_INTENTS_PER_HUDDLE} intents` };
  }
  return { ok: true, value: tags };
}

/** Invitee ids: UUIDs, unique, up to MAX_INVITEES_PER_REQUEST. Absent means none. */
export function validateInviteeIds(raw: unknown): ValidationResult<string[]> {
  if (raw == null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, message: "invitee_ids must be a list" };
  if (raw.length > MAX_INVITEES_PER_REQUEST) {
    return { ok: false, message: `at most ${MAX_INVITEES_PER_REQUEST} invitees per request` };
  }
  const ids: string[] = [];
  for (const item of raw) {
    if (!isUuid(item)) return { ok: false, message: "each invitee must be a user id" };
    if (!ids.includes(item)) ids.push(item);
  }
  return { ok: true, value: ids };
}

function validateScheduledAt(raw: unknown, now: number): ValidationResult<string | null> {
  if (raw == null || raw === "") return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, message: "scheduled_at must be an ISO date string" };
  const time = Date.parse(raw);
  if (Number.isNaN(time)) return { ok: false, message: "scheduled_at must be a valid date" };
  if (time < now - SCHEDULE_PAST_GRACE_MS) return { ok: false, message: "scheduled_at cannot be in the past" };
  if (time > now + MAX_SCHEDULE_AHEAD_MS) return { ok: false, message: "scheduled_at is too far in the future" };
  return { ok: true, value: new Date(time).toISOString() };
}

function validateDuration(raw: unknown): ValidationResult<number | null> {
  if (raw == null || raw === "") return { ok: true, value: null };
  const minutes = Number(raw);
  if (!Number.isInteger(minutes) || minutes < MIN_DURATION_MINUTES || minutes > MAX_DURATION_MINUTES) {
    return { ok: false, message: `duration_minutes must be a whole number between ${MIN_DURATION_MINUTES} and ${MAX_DURATION_MINUTES}` };
  }
  return { ok: true, value: minutes };
}

/** Validate and normalize a create-huddle request body. */
export function validateCreateHuddleInput(body: unknown, now: number = Date.now()): ValidationResult<CreateHuddleInput> {
  const input = isPlainObject(body) ? body : {};

  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) return { ok: false, message: "Title is required" };
  if (title.length > TITLE_MAX_LENGTH) return { ok: false, message: `Title must be at most ${TITLE_MAX_LENGTH} characters` };

  let description: string | null = null;
  if (input.description != null) {
    if (typeof input.description !== "string") return { ok: false, message: "description must be a string" };
    description = input.description.trim() || null;
    if (description && description.length > DESCRIPTION_MAX_LENGTH) {
      return { ok: false, message: `description must be at most ${DESCRIPTION_MAX_LENGTH} characters` };
    }
  }

  const maxParticipants = Number(input.max_participants);
  if (!ALLOWED_MAX_PARTICIPANTS.includes(maxParticipants)) {
    return { ok: false, message: `max_participants must be one of ${ALLOWED_MAX_PARTICIPANTS.join(", ")}` };
  }

  let type: HuddleType = "public";
  if (input.type != null) {
    if (!HUDDLE_TYPES.includes(input.type as HuddleType)) return { ok: false, message: "type must be public, private or instant" };
    type = input.type as HuddleType;
  }

  const scheduledAt = validateScheduledAt(input.scheduled_at, now);
  if (!scheduledAt.ok) return scheduledAt;
  const duration = validateDuration(input.duration_minutes);
  if (!duration.ok) return duration;
  const settings = validateSettings(input.settings);
  if (!settings.ok) return settings;

  let mode: HuddleMode = "open";
  if (input.mode != null) {
    if (!HUDDLE_MODES.includes(input.mode as HuddleMode)) {
      return { ok: false, message: `mode must be one of ${HUDDLE_MODES.join(", ")}` };
    }
    mode = input.mode as HuddleMode;
  }
  if (input.waiting_room != null && typeof input.waiting_room !== "boolean") {
    return { ok: false, message: "waiting_room must be true or false" };
  }
  const intents = validateIntents(input.intents);
  if (!intents.ok) return intents;
  const invitees = validateInviteeIds(input.invitee_ids);
  if (!invitees.ok) return invitees;

  return {
    ok: true,
    value: {
      title,
      description,
      max_participants: maxParticipants,
      type,
      scheduled_at: scheduledAt.value,
      duration_minutes: duration.value,
      settings: settings.value,
      mode,
      waiting_room: input.waiting_room === true,
      intents: intents.value,
      invitee_ids: invitees.value,
    },
  };
}

/** Link to a huddle. Private huddles still need an invite from the host to open it. */
export function buildInviteUrl(origin: string, huddle: Pick<HuddleRow, "id">): string {
  if (!origin) return "";
  return `${origin}/dashboard/huddles/${encodeURIComponent(huddle.id)}`;
}

/**
 * When a huddle stops being live, as epoch ms: the earlier of started_at + duration_minutes
 * and ended_at. Null when it has not started or has no end yet.
 */
export function huddleEndsAt(huddle: Pick<HuddleRow, "started_at" | "ended_at" | "duration_minutes">): number | null {
  if (huddle.started_at == null) return null;
  const startedMs = Date.parse(huddle.started_at);
  if (Number.isNaN(startedMs)) return null;
  const ends: number[] = [];
  if (huddle.duration_minutes != null) ends.push(startedMs + huddle.duration_minutes * 60 * 1000);
  if (huddle.ended_at != null) {
    const endedMs = Date.parse(huddle.ended_at);
    if (!Number.isNaN(endedMs)) ends.push(endedMs);
  }
  return ends.length === 0 ? null : Math.min(...ends);
}

/** Live: active, started, and not yet past its end time. Mirrors the list_live_huddles SQL. */
export function isLive(huddle: Pick<HuddleRow, "is_active" | "started_at" | "ended_at" | "duration_minutes">, nowMs: number): boolean {
  if (!huddle.is_active || huddle.started_at == null) return false;
  const endsAt = huddleEndsAt(huddle);
  return endsAt == null || endsAt > nowMs;
}

export type PublicHuddle = Omit<HuddleRow, "invite_code" | "created_by" | "settings"> & {
  participants_count: number;
  is_owner: boolean;
  /** When the huddle stops being live (ISO), or null when it has no end yet. */
  ends_at: string | null;
  invite_code?: string | null;
};

/** Shape a huddle for API output. The invite code is only exposed to the creator. */
export function toPublicHuddle(huddle: HuddleRow, viewerId: string, participantsCount: number): PublicHuddle {
  const { invite_code, created_by, settings: _settings, ...rest } = huddle;
  const isOwner = created_by === viewerId;
  const endsAt = huddleEndsAt(huddle);
  return {
    ...rest,
    participants_count: participantsCount,
    is_owner: isOwner,
    ends_at: endsAt == null ? null : new Date(endsAt).toISOString(),
    ...(isOwner ? { invite_code } : {}),
  };
}

/** Normalize the Origin/Referer header to a bare origin; ignores anything not http(s). */
export function requestOrigin(originHeader: string | undefined, refererHeader: string | undefined): string {
  for (const candidate of [originHeader, refererHeader]) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === "http:" || url.protocol === "https:") return url.origin;
    } catch {
      // not a URL, try the next header
    }
  }
  return "";
}

/**
 * Trending score, from RENDLY_MULTI_AGENT_AI_BACKEND_ARCHITECTURE.md section 5:
 *   trending(h) = alpha * visits(h) + beta * seatJoins(h) + gamma * decay(h) + delta * recency(h)
 * Visits and seat joins are counted over the last hour and normalised by the largest value in the
 * cohort. decay(h) = exp(-mu * hours since last activity). recency(h) falls linearly from 1 to 0
 * over the first 24 hours after creation. Weights and mu are tunable; the values here are a starting point.
 */
export const TRENDING_WEIGHTS = { visits: 0.3, seatJoins: 0.3, tags: 0.2, decay: 0.1, recency: 0.1 } as const;
/** The trending list shows this many huddles. */
export const TRENDING_LIST_SIZE = 5;
export const TRENDING_DECAY_PER_HOUR = 0.5;
export const TRENDING_VELOCITY_WINDOW_MS = 60 * 60 * 1000;
export const TRENDING_RECENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

export type HuddleActivity = {
  /** Visit events in the last hour. */
  visits: number;
  /** Join events in the last hour. */
  seatJoins: number;
  /**
   * Visits and joins in the last hour across all huddles that share this huddle's intent tags,
   * so a hashtag that is busy lifts the huddles that carry it.
   */
  tagVelocity: number;
  /** Most recent visit, join or leave (epoch ms), or the creation time when there is none. */
  lastActivityMs: number;
  createdMs: number;
};

export function trendingScore(
  activity: HuddleActivity,
  cohort: { maxVisits: number; maxSeatJoins: number; maxTagVelocity: number },
  nowMs: number
): number {
  const visits = cohort.maxVisits > 0 ? activity.visits / cohort.maxVisits : 0;
  const seats = cohort.maxSeatJoins > 0 ? activity.seatJoins / cohort.maxSeatJoins : 0;
  const tags = cohort.maxTagVelocity > 0 ? activity.tagVelocity / cohort.maxTagVelocity : 0;
  const hoursIdle = Math.max(0, (nowMs - activity.lastActivityMs) / (60 * 60 * 1000));
  const decay = Math.exp(-TRENDING_DECAY_PER_HOUR * hoursIdle);
  const ageMs = Math.max(0, nowMs - activity.createdMs);
  const recency = ageMs < TRENDING_RECENCY_WINDOW_MS ? 1 - ageMs / TRENDING_RECENCY_WINDOW_MS : 0;
  return (
    TRENDING_WEIGHTS.visits * visits +
    TRENDING_WEIGHTS.seatJoins * seats +
    TRENDING_WEIGHTS.tags * tags +
    TRENDING_WEIGHTS.decay * decay +
    TRENDING_WEIGHTS.recency * recency
  );
}

/** Rank huddle ids by trending score, highest first. Ties keep the input order. */
export function rankTrending(
  candidates: { id: string; createdMs: number }[],
  activity: Map<string, HuddleActivity>,
  nowMs: number
): { id: string; score: number }[] {
  let maxVisits = 0;
  let maxSeatJoins = 0;
  let maxTagVelocity = 0;
  for (const a of activity.values()) {
    maxVisits = Math.max(maxVisits, a.visits);
    maxSeatJoins = Math.max(maxSeatJoins, a.seatJoins);
    maxTagVelocity = Math.max(maxTagVelocity, a.tagVelocity);
  }
  const cohort = { maxVisits, maxSeatJoins, maxTagVelocity };
  return candidates
    .map((c, index) => {
      const a =
        activity.get(c.id) ?? { visits: 0, seatJoins: 0, tagVelocity: 0, lastActivityMs: c.createdMs, createdMs: c.createdMs };
      return { id: c.id, score: trendingScore(a, cohort, nowMs), index };
    })
    .sort((x, y) => y.score - x.score || x.index - y.index)
    .map(({ id, score }) => ({ id, score }));
}

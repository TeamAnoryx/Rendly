/**
 * Pure huddle rules: access control, input validation and response shaping.
 * No database access here, so everything in this module is unit-testable.
 */

import crypto from "crypto";

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
};

export type CreateHuddleInput = {
  title: string;
  description: string | null;
  max_participants: number;
  type: HuddleType;
  scheduled_at: string | null;
  duration_minutes: number | null;
  settings: Record<string, unknown>;
};

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; message: string };

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function parseCategory(value: unknown): HuddleCategory {
  return HUDDLE_CATEGORIES.includes(value as HuddleCategory) ? (value as HuddleCategory) : "all";
}

/** Constant-time comparison so invite codes cannot be guessed by timing. */
export function inviteCodeMatches(expected: string | null, provided: unknown): boolean {
  if (!expected || typeof provided !== "string" || provided.length === 0) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export type AccessContext = {
  viewerId: string;
  isParticipant: boolean;
  inviteCode?: unknown;
};

/** Public and instant huddles are open. Private ones need creator, participant or a valid invite code. */
export function canAccessHuddle(huddle: HuddleRow, ctx: AccessContext): boolean {
  if (huddle.type !== "private") return true;
  if (huddle.created_by === ctx.viewerId) return true;
  if (ctx.isParticipant) return true;
  return inviteCodeMatches(huddle.invite_code, ctx.inviteCode);
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
    },
  };
}

/** Invite links carry the code for private huddles so recipients can open them. */
export function buildInviteUrl(origin: string, huddle: Pick<HuddleRow, "id" | "type" | "invite_code">): string {
  if (!origin) return "";
  const base = `${origin}/dashboard/huddles/${encodeURIComponent(huddle.id)}`;
  if (huddle.type === "private" && huddle.invite_code) return `${base}?code=${encodeURIComponent(huddle.invite_code)}`;
  return base;
}

export type PublicHuddle = Omit<HuddleRow, "invite_code" | "created_by" | "settings"> & {
  participants_count: number;
  is_owner: boolean;
  invite_code?: string | null;
};

/** Shape a huddle for API output. The invite code is only exposed to the creator. */
export function toPublicHuddle(huddle: HuddleRow, viewerId: string, participantsCount: number): PublicHuddle {
  const { invite_code, created_by, settings: _settings, ...rest } = huddle;
  const isOwner = created_by === viewerId;
  return {
    ...rest,
    participants_count: participantsCount,
    is_owner: isOwner,
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

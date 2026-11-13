/**
 * Mapping for GET /api/huddles/active. The API returns snake_case fields
 * (title, max_participants, participants_count, ends_at, thumbnail_url, mode, type,
 * intents, is_owner, is_participant, waiting_room); the dashboard works in camelCase.
 */

import type { HuddleMode, HuddleType } from '@/services/huddlesApi';

export type ActiveHuddle = {
  id: string;
  topic: string;
  /** Seconds until the huddle ends, or null when it has no timed end. */
  timeLeftSeconds: number | null;
  participantsCount: number;
  maxParticipants: number | null;
  canJoin: boolean;
  /** Poster image/video URL set by the host, or null. */
  thumbnailUrl: string | null;
  /** Huddle mode (open, seminar, hackathon, launch), or null when unknown. */
  mode: HuddleMode | null;
  /** Huddle visibility type (public, private, instant), or null when unknown. */
  type: HuddleType | null;
  /** Intent tags attached to the huddle. */
  intents: string[];
  /** The viewer hosts this huddle. */
  isOwner: boolean;
  /** The viewer is already admitted (joining again is a "Rejoin"). */
  isParticipant: boolean;
  /** The host screens newcomers: joining puts the viewer in a waiting room. */
  waitingRoom: boolean;
};

const HUDDLE_MODES: ReadonlySet<string> = new Set(['open', 'seminar', 'hackathon', 'launch']);
const HUDDLE_TYPES: ReadonlySet<string> = new Set(['public', 'private', 'instant']);

function asMode(value: unknown): HuddleMode | null {
  return typeof value === 'string' && HUDDLE_MODES.has(value) ? (value as HuddleMode) : null;
}

function asType(value: unknown): HuddleType | null {
  return typeof value === 'string' && HUDDLE_TYPES.has(value) ? (value as HuddleType) : null;
}

function asIntents(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

export function mapActiveHuddle(raw: Record<string, unknown>, nowMs: number): ActiveHuddle {
  const endsAtMs = typeof raw.ends_at === 'string' ? Date.parse(raw.ends_at) : NaN;
  const timeLeftSeconds = Number.isNaN(endsAtMs) ? null : Math.max(0, Math.floor((endsAtMs - nowMs) / 1000));
  const participantsCount = typeof raw.participants_count === 'number' ? raw.participants_count : 0;
  const maxParticipants = typeof raw.max_participants === 'number' ? raw.max_participants : null;
  const canJoin =
    typeof raw.canJoin === 'boolean' ? raw.canJoin : maxParticipants == null || participantsCount < maxParticipants;
  return {
    id: String(raw.id ?? ''),
    topic: String(raw.title ?? 'Untitled'),
    timeLeftSeconds,
    participantsCount,
    maxParticipants,
    canJoin,
    thumbnailUrl: typeof raw.thumbnail_url === 'string' && raw.thumbnail_url ? raw.thumbnail_url : null,
    mode: asMode(raw.mode),
    type: asType(raw.type),
    intents: asIntents(raw.intents),
    isOwner: raw.is_owner === true,
    isParticipant: raw.is_participant === true,
    waitingRoom: raw.waiting_room === true,
  };
}

/** Countdown label. Null means the huddle has no timed end. */
export function formatTimeLeft(seconds: number | null): string {
  if (seconds == null) return 'No time limit';
  if (seconds <= 0) return 'Ended';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')} left`;
}

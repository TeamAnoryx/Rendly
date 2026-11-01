/**
 * Mapping for GET /api/huddles/active. The API returns snake_case fields
 * (title, max_participants, participants_count, ends_at); the dashboard works in camelCase.
 */

export type ActiveHuddle = {
  id: string;
  topic: string;
  /** Seconds until the huddle ends, or null when it has no timed end. */
  timeLeftSeconds: number | null;
  participantsCount: number;
  maxParticipants: number | null;
  canJoin: boolean;
};

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

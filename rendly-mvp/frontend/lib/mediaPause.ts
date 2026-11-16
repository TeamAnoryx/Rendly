/**
 * Pause / resume for calls, huddles and Spark.
 *
 * Pausing freezes what this person sends (every outgoing audio and video track is disabled);
 * resuming restores each track to the user's own mic/camera choice. The server tells the others,
 * and also marks someone "away" while their connection is gone (seat held for a grace window).
 */

export type PauseReason = 'manual' | 'away';
/** One person's pause flags: paused on purpose, and/or briefly disconnected. */
export type PauseFlags = { manual: boolean; away: boolean };
export type PauseMap = Readonly<Record<string, PauseFlags>>;

type TrackLike = { kind: string; enabled: boolean };
type StreamLike = { getTracks: () => TrackLike[] };

/**
 * Enable or disable outgoing tracks. While paused everything is off; otherwise audio follows
 * `mic` and video follows `cam`, so resuming never turns on a mic or camera the user had off.
 */
export function applyPausedTracks(
  stream: StreamLike | null | undefined,
  paused: boolean,
  wanted: { mic: boolean; cam: boolean },
): void {
  if (!stream) return;
  stream.getTracks().forEach((t) => {
    const on = t.kind === 'audio' ? wanted.mic : t.kind === 'video' ? wanted.cam : t.enabled;
    t.enabled = !paused && on;
  });
}

/** Apply a server pause event (`*-paused` / `*-resumed`) to the map. Returns a new map. */
export function applyPauseEvent(
  map: PauseMap,
  userId: string,
  kind: 'paused' | 'resumed',
  reason?: string,
): PauseMap {
  const cur = map[userId] ?? { manual: false, away: false };
  // A resume without a reason is a reconnect: only the "away" flag clears.
  const isManual = reason === 'manual';
  const next: PauseFlags =
    kind === 'paused'
      ? { ...cur, [isManual ? 'manual' : 'away']: true }
      : isManual
        ? { ...cur, manual: false }
        : { ...cur, away: false };
  const rest = { ...map };
  delete rest[userId];
  return next.manual || next.away ? { ...rest, [userId]: next } : rest;
}

/** Seed the map from a join ack's `paused` list (reason unknown, shown as paused). */
export function pauseMapFromList(ids: readonly string[] | undefined): PauseMap {
  const out: Record<string, PauseFlags> = {};
  (ids ?? []).forEach((id) => {
    out[id] = { manual: true, away: false };
  });
  return out;
}

/** What a tile shows for a paused person, or null when they are live. */
export function pauseLabel(flags: PauseFlags | null | undefined): string | null {
  if (!flags) return null;
  if (flags.away) return 'Reconnecting…';
  if (flags.manual) return 'Paused';
  return null;
}

/** Same as pauseLabel for a single reason (1:1 calls and Spark). */
export function pauseLabelFor(reason: PauseReason | null | undefined): string | null {
  if (reason === 'away') return 'Reconnecting…';
  if (reason === 'manual') return 'Paused';
  return null;
}

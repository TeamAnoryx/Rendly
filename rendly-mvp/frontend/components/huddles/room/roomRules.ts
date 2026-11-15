/** Huddle room rules shared by the room UI. They mirror chat-service `breakout-rules.ts`. */

export type RoomRole = 'host' | 'co_host' | 'participant';

export const MAIN_ROOM = 'main';
/** Private room for the host and admins. */
export const ADMIN_ROOM = 'admins';
/** Most people a breakout room holds. */
export const ROOM_CAP = 12;
export const ROOM_NAME = /^[a-z0-9][a-z0-9-]{0,19}$/;
export const MAX_BREAKOUT_ROOMS = 10;

export function roomLabel(room: string): string {
  if (room === MAIN_ROOM) return 'Main room';
  if (room === ADMIN_ROOM) return 'Admin room';
  return room;
}

/** "Host", "Admin" or "Participant". */
export function roleLabel(role: RoomRole | undefined): string {
  return role === 'host' ? 'Host' : role === 'co_host' ? 'Admin' : 'Participant';
}

/** The room an admin leads, or null. */
export function ledRoom(leaders: Readonly<Record<string, string>>, userId: string | null): string | null {
  if (!userId) return null;
  return Object.entries(leaders).find(([, id]) => id === userId)?.[0] ?? null;
}

/** Host: every room. Admin: only the room they lead. */
export function canManageRoom(role: RoomRole, userId: string | null, room: string, leaders: Readonly<Record<string, string>>): boolean {
  if (role === 'host') return true;
  return role === 'co_host' && !!userId && leaders[room] === userId;
}

/** Breakout room names room-1 … room-n. */
export function breakoutRoomNames(count: number): string[] {
  const n = Math.max(1, Math.min(MAX_BREAKOUT_ROOMS, Math.floor(count)));
  return Array.from({ length: n }, (_, i) => `room-${i + 1}`);
}

/** Fewest rooms that fit everyone under the cap (at least 2). */
export function suggestedRoomCount(people: number, cap = ROOM_CAP): number {
  return Math.min(MAX_BREAKOUT_ROOMS, Math.max(2, Math.ceil(people / cap)));
}

/**
 * Spread people over rooms round-robin without passing the cap. People who do not fit stay
 * in the main room.
 */
export function autoSplit(ids: readonly string[], rooms: readonly string[], cap = ROOM_CAP): Record<string, string> {
  const plan: Record<string, string> = {};
  const fill = new Map<string, number>();
  let next = 0;
  for (const id of ids) {
    let placed = false;
    for (let tries = 0; tries < rooms.length && !placed; tries++) {
      const room = rooms[(next + tries) % rooms.length];
      if ((fill.get(room) ?? 0) < cap) {
        plan[id] = room;
        fill.set(room, (fill.get(room) ?? 0) + 1);
        next = (next + tries + 1) % rooms.length;
        placed = true;
      }
    }
    if (!placed) plan[id] = MAIN_ROOM;
  }
  return plan;
}

/** How many people a plan puts in each room. */
export function planCounts(plan: Readonly<Record<string, string>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const room of Object.values(plan)) out[room] = (out[room] ?? 0) + 1;
  return out;
}

/** Case-insensitive match on display name or @username. */
export function matchesPerson(query: string, displayName: string | null | undefined, username: string | null | undefined): boolean {
  const q = query.trim().toLowerCase().replace(/^@/, '');
  if (!q) return true;
  return (displayName ?? '').toLowerCase().includes(q) || (username ?? '').toLowerCase().includes(q);
}

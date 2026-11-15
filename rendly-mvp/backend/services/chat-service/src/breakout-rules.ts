/**
 * Pure rules for huddle rooms: who may enter which room, who may manage people in a room
 * (host everywhere, an admin only in the room they lead), the breakout room cap and the
 * main-room video slots. No I/O, so they are unit tested directly.
 */

export type HuddleRole = "host" | "co_host" | "participant";

/** Private room for the host and admins (co-hosts). */
export const ADMIN_ROOM = "admins";
/** Most people a breakout room holds; mesh video stays smooth up to about this size. */
export const ROOM_CAP = 12;
/** People in the main room who may publish a camera; later joiners get audio and chat. */
export const MAIN_VIDEO_SLOTS = 12;

const MAIN = "main";

export type EnterCheck = { ok: true } | { ok: false; message: string };

/** Hosts and admins (co-hosts) manage huddles. */
export function isManagerRole(role: HuddleRole | null | undefined): boolean {
  return role === "host" || role === "co_host";
}

/**
 * Whether someone may enter a room. `occupants` is who is in it now. Managers may always
 * enter breakout rooms to peek or lead.
 */
export function canEnterRoom(role: HuddleRole, room: string, occupants: readonly string[], userId: string): EnterCheck {
  if (room === ADMIN_ROOM) {
    return isManagerRole(role) ? { ok: true } : { ok: false, message: "Only the host and admins can enter the Admin room" };
  }
  if (room === MAIN || isManagerRole(role) || occupants.includes(userId)) return { ok: true };
  return occupants.length >= ROOM_CAP ? { ok: false, message: `This room is full (${ROOM_CAP} people)` } : { ok: true };
}

/**
 * Whether `actorId` may manage people in `room` (mute, allow sharing, move out, record).
 * The host may everywhere; an admin only in the room they lead.
 */
export function canManageInRoom(
  actorRole: HuddleRole | null | undefined,
  actorId: string,
  room: string,
  leaders: ReadonlyMap<string, string> | undefined
): boolean {
  if (actorRole === "host") return true;
  if (actorRole !== "co_host") return false;
  return leaders?.get(room) === actorId;
}

/** Whether a person may be moved into `destination` (the Admin room is for managers only). */
export function canBeMovedTo(targetRole: HuddleRole, destination: string): boolean {
  return destination !== ADMIN_ROOM || isManagerRole(targetRole);
}

/**
 * Whether a user may publish a camera in this room. Breakout and Admin rooms: everyone.
 * Main room: the first MAIN_VIDEO_SLOTS people in join order, plus hosts and admins.
 */
export function hasVideoSlot(room: string, joinOrder: readonly string[], userId: string, role: HuddleRole): boolean {
  if (room !== MAIN || isManagerRole(role)) return true;
  // Someone not in the list yet would join at the end of it.
  const index = joinOrder.indexOf(userId);
  return (index >= 0 ? index : joinOrder.length) < MAIN_VIDEO_SLOTS;
}

/** The room a user is in, from a list of rooms with their members; null when in none. */
export function roomOfUser(rooms: readonly { room: string; user_ids: readonly string[] }[], userId: string): string | null {
  return rooms.find((r) => r.user_ids.includes(userId))?.room ?? null;
}

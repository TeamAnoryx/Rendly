import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_ROOM,
  MAIN_VIDEO_SLOTS,
  ROOM_CAP,
  canBeMovedTo,
  canEnterRoom,
  canManageInRoom,
  hasVideoSlot,
  roomOfUser,
} from "./breakout-rules";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `u${i}`);

test("only the host and admins enter the Admin room", () => {
  assert.deepEqual(canEnterRoom("host", ADMIN_ROOM, [], "h"), { ok: true });
  assert.deepEqual(canEnterRoom("co_host", ADMIN_ROOM, [], "a"), { ok: true });
  assert.equal(canEnterRoom("participant", ADMIN_ROOM, [], "p").ok, false);
});

test("a full breakout room refuses participants but not managers or people already inside", () => {
  const full = ids(ROOM_CAP);
  assert.equal(canEnterRoom("participant", "room-1", full, "new").ok, false);
  assert.equal(canEnterRoom("participant", "room-1", full, "u3").ok, true);
  assert.equal(canEnterRoom("co_host", "room-1", full, "lead").ok, true);
  assert.equal(canEnterRoom("participant", "room-1", ids(ROOM_CAP - 1), "new").ok, true);
});

test("the main room has no cap", () => {
  assert.equal(canEnterRoom("participant", "main", ids(60), "new").ok, true);
});

test("the host manages every room, an admin only the room they lead", () => {
  const leaders = new Map([["room-1", "a1"]]);
  assert.equal(canManageInRoom("host", "h", "room-2", leaders), true);
  assert.equal(canManageInRoom("co_host", "a1", "room-1", leaders), true);
  assert.equal(canManageInRoom("co_host", "a1", "room-2", leaders), false);
  assert.equal(canManageInRoom("co_host", "a2", "room-1", leaders), false);
  assert.equal(canManageInRoom("participant", "p", "room-1", leaders), false);
  assert.equal(canManageInRoom("co_host", "a1", "room-1", undefined), false);
});

test("only managers can be moved into the Admin room", () => {
  assert.equal(canBeMovedTo("participant", ADMIN_ROOM), false);
  assert.equal(canBeMovedTo("co_host", ADMIN_ROOM), true);
  assert.equal(canBeMovedTo("participant", "room-3"), true);
});

test("main room video slots go to the first joiners, managers always get one", () => {
  const order = ids(MAIN_VIDEO_SLOTS + 3);
  assert.equal(hasVideoSlot("main", order, "u0", "participant"), true);
  assert.equal(hasVideoSlot("main", order, `u${MAIN_VIDEO_SLOTS - 1}`, "participant"), true);
  assert.equal(hasVideoSlot("main", order, `u${MAIN_VIDEO_SLOTS}`, "participant"), false);
  assert.equal(hasVideoSlot("main", order, "late", "participant"), false);
  assert.equal(hasVideoSlot("main", ids(3), "late", "participant"), true);
  assert.equal(hasVideoSlot("main", order, `u${MAIN_VIDEO_SLOTS + 1}`, "co_host"), true);
  assert.equal(hasVideoSlot("room-1", order, "late", "participant"), true);
});

test("roomOfUser finds the room or null", () => {
  const rooms = [
    { room: "main", user_ids: ["a"] },
    { room: "room-1", user_ids: ["b"] },
  ];
  assert.equal(roomOfUser(rooms, "b"), "room-1");
  assert.equal(roomOfUser(rooms, "z"), null);
});

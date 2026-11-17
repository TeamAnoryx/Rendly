import { test } from "node:test";
import assert from "node:assert/strict";
import { addToRoom, canEndHuddle, endHuddleRooms, type RoomIo } from "./huddle-room";

const HUDDLE = "22222222-2222-4222-8222-222222222222";
const HOST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GUEST = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CANCELLED = { created_by: HOST, cancelled_at: "2026-11-17T10:00:00.000Z" };

test("end: the host can end once the huddle is cancelled, even with the seat already closed", () => {
  assert.equal(canEndHuddle(HOST, null, CANCELLED), true);
  assert.equal(canEndHuddle(HOST, { role: "host" }, CANCELLED), true);
});

test("end: a huddle that is still live cannot be ended over the socket", () => {
  const live = { created_by: HOST, cancelled_at: null };
  assert.equal(canEndHuddle(HOST, { role: "host" }, live), false);
  assert.equal(canEndHuddle(HOST, null, null), false);
});

test("end: nobody but the host can end it", () => {
  assert.equal(canEndHuddle(GUEST, { role: "co_host" }, CANCELLED), false);
  assert.equal(canEndHuddle(GUEST, null, CANCELLED), false);
  assert.equal(canEndHuddle("", null, CANCELLED), false);
});

test("end: every socket in every room of the huddle hears huddle:ended", () => {
  const sent: { room: string; event: string }[] = [];
  const io: RoomIo = { to: (room) => ({ emit: (event) => sent.push({ room, event }) }) };
  addToRoom(`${HUDDLE}:main`, HOST, "h1");
  addToRoom(`${HUDDLE}:main`, GUEST, "g1");
  addToRoom(`${HUDDLE}:breakout-1`, GUEST, "g2");
  addToRoom("33333333-3333-4333-8333-333333333333:main", GUEST, "other");
  endHuddleRooms(io, HUDDLE);
  assert.deepEqual(sent.map((s) => s.room).sort(), ["g1", "g2", "h1"]);
  assert.ok(sent.every((s) => s.event === "huddle:ended"));
});

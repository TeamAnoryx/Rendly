import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";
import { GRACE_MS, GraceTimers } from "./grace";
import { createCallTracker } from "./call-grace";
import { addToRoom, holdSeat, membersOf, pausedIn, resumeSeat, type RoomIo } from "./huddle-room";

type Emitted = { room: string; event: string; payload: unknown };

function fakeIo(): { io: RoomIo; emitted: Emitted[] } {
  const emitted: Emitted[] = [];
  return {
    emitted,
    io: { to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }) },
  };
}

const HUDDLE = "11111111-1111-4111-8111-111111111111";
const ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
afterEach(() => mock.timers.reset());

test("GraceTimers: cancel before the window keeps the hold from expiring", () => {
  const grace = new GraceTimers();
  let expired = 0;
  grace.hold("k", () => expired++);
  mock.timers.tick(GRACE_MS - 1);
  assert.equal(grace.cancel("k"), true);
  mock.timers.tick(GRACE_MS);
  assert.equal(expired, 0);
  assert.equal(grace.cancel("k"), false);
});

test("GraceTimers: the hold expires once after the window", () => {
  const grace = new GraceTimers();
  let expired = 0;
  grace.hold("k", () => expired++);
  mock.timers.tick(GRACE_MS);
  assert.equal(expired, 1);
  assert.equal(grace.isHeld("k"), false);
});

test("huddle: rejoining within the grace window keeps the seat", () => {
  const room = `${HUDDLE}:keep`;
  const { io, emitted } = fakeIo();
  addToRoom(room, ALICE, "s1");
  addToRoom(room, BOB, "s2");
  holdSeat(io, room, ALICE, "s1");
  assert.deepEqual(membersOf(room), [ALICE, BOB]);
  assert.deepEqual(pausedIn(room), [ALICE]);
  assert.ok(emitted.some((e) => e.event === "huddle:peer-paused"));

  mock.timers.tick(GRACE_MS - 1000);
  assert.equal(resumeSeat(io, room, ALICE), true);
  addToRoom(room, ALICE, "s3");
  mock.timers.tick(GRACE_MS);

  assert.deepEqual(membersOf(room), [ALICE, BOB]);
  assert.deepEqual(pausedIn(room), []);
  assert.ok(emitted.some((e) => e.event === "huddle:peer-resumed"));
  assert.ok(!emitted.some((e) => e.event === "huddle:peer-left"));
});

test("huddle: after the grace window the user leaves the room", () => {
  const room = `${HUDDLE}:gone`;
  const { io, emitted } = fakeIo();
  addToRoom(room, ALICE, "s1");
  addToRoom(room, BOB, "s2");
  holdSeat(io, room, ALICE, "s1");
  mock.timers.tick(GRACE_MS);
  assert.deepEqual(membersOf(room), [BOB]);
  assert.deepEqual(emitted.at(-1), { room, event: "huddle:peer-left", payload: { user_id: ALICE } });
  assert.equal(resumeSeat(io, room, ALICE), false);
});

test("huddle: dropping one of two sockets does not pause the user", () => {
  const room = `${HUDDLE}:twotabs`;
  const { io, emitted } = fakeIo();
  addToRoom(room, ALICE, "s1");
  addToRoom(room, ALICE, "s2");
  holdSeat(io, room, ALICE, "s1");
  assert.equal(emitted.length, 0);
  assert.deepEqual(pausedIn(room), []);
});

test("call: reconnecting within the grace window resumes the call", () => {
  const sent: { to: string; event: string }[] = [];
  const calls = createCallTracker((to, event) => sent.push({ to, event }));
  calls.accepted("conv", ALICE, BOB);
  calls.userOffline(ALICE);
  mock.timers.tick(GRACE_MS - 1);
  calls.userOnline(ALICE);
  mock.timers.tick(GRACE_MS);
  assert.deepEqual(sent, [
    { to: BOB, event: "call:peer-paused" },
    { to: BOB, event: "call:peer-resumed" },
  ]);
  assert.equal(calls.isActive("conv"), true);
});

test("call: after the grace window the peer hears the call ended", () => {
  const sent: { to: string; event: string }[] = [];
  const calls = createCallTracker((to, event) => sent.push({ to, event }));
  calls.accepted("conv", ALICE, BOB);
  calls.userOffline(BOB);
  mock.timers.tick(GRACE_MS);
  assert.deepEqual(sent, [
    { to: ALICE, event: "call:peer-paused" },
    { to: ALICE, event: "call:ended" },
  ]);
  assert.equal(calls.isActive("conv"), false);
});

test("call: an explicit end clears the hold", () => {
  const sent: { to: string; event: string }[] = [];
  const calls = createCallTracker((to, event) => sent.push({ to, event }));
  calls.accepted("conv", ALICE, BOB);
  calls.userOffline(BOB);
  calls.ended("conv");
  mock.timers.tick(GRACE_MS);
  assert.deepEqual(sent, [{ to: ALICE, event: "call:peer-paused" }]);
});

test("huddle: an empty or unknown room has no members and no paused users", () => {
  const room = `${HUDDLE}:empty`;
  assert.deepEqual(membersOf(room), []);
  assert.deepEqual(pausedIn(room), []);
  assert.deepEqual(membersOf(""), []);
});

test("huddle: holding a seat for someone not in the room does nothing", () => {
  const room = `${HUDDLE}:stranger`;
  const { io, emitted } = fakeIo();
  holdSeat(io, room, ALICE, "missing-socket");
  holdSeat(io, room, "", "");
  mock.timers.tick(GRACE_MS);
  assert.equal(emitted.length, 0);
  assert.equal(resumeSeat(io, room, ALICE), false);
});

test("call: going offline or online with no live call emits nothing", () => {
  const sent: string[] = [];
  const calls = createCallTracker((_to, event) => sent.push(event));
  calls.userOffline(ALICE);
  calls.userOnline("");
  calls.accepted("self", ALICE, ALICE);
  mock.timers.tick(GRACE_MS);
  assert.deepEqual(sent, []);
  assert.equal(calls.isActive("self"), false);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { createSparkLobby } from "./spark-lobby";

test("lobby: counts people, not tabs", () => {
  const lobby = createSparkLobby();
  assert.equal(lobby.enter("a", "s1"), true);
  assert.equal(lobby.enter("a", "s2"), false);
  assert.equal(lobby.enter("b", "s3"), true);
  assert.equal(lobby.count(), 2);
});

test("lobby: a person leaves only when their last tab closes", () => {
  const lobby = createSparkLobby();
  lobby.enter("a", "s1");
  lobby.enter("a", "s2");
  assert.equal(lobby.leave("a", "s1"), false);
  assert.equal(lobby.count(), 1);
  assert.equal(lobby.leave("a", "s2"), true);
  assert.equal(lobby.count(), 0);
});

test("lobby: leaving twice or unknown sockets changes nothing", () => {
  const lobby = createSparkLobby();
  assert.equal(lobby.leave("x", "s9"), false);
  lobby.enter("a", "s1");
  assert.equal(lobby.leave("a", "s1"), true);
  assert.equal(lobby.leave("a", "s1"), false);
  assert.equal(lobby.count(), 0);
});

test("lobby: an empty count starts at zero", () => {
  assert.equal(createSparkLobby().count(), 0);
});

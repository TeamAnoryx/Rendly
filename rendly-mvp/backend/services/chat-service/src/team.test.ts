import { test } from "node:test";
import assert from "node:assert/strict";
import { isRendlyTeam, RENDLY_TEAM_USER_ID, withTeamFirst } from "./team";

test("withTeamFirst puts the Rendly Team first, exactly once", () => {
  assert.deepEqual(withTeamFirst("u1", ["a", RENDLY_TEAM_USER_ID, "b"]), [RENDLY_TEAM_USER_ID, "a", "b"]);
  assert.deepEqual(withTeamFirst("u1", []), [RENDLY_TEAM_USER_ID]);
});

test("the team account itself does not get a chat with itself", () => {
  assert.deepEqual(withTeamFirst(RENDLY_TEAM_USER_ID, ["a"]), ["a"]);
});

test("isRendlyTeam", () => {
  assert.equal(isRendlyTeam(RENDLY_TEAM_USER_ID), true);
  assert.equal(isRendlyTeam("someone"), false);
  assert.equal(isRendlyTeam(null), false);
});

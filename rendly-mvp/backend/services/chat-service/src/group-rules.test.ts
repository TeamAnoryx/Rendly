import { test } from "node:test";
import assert from "node:assert/strict";
import { canPostInGroup } from "./group-rules";

const base = { viewOnly: true, role: "member", priorityUserId: null, userId: "u1" };

test("everyone posts when view-only is off", () => {
  assert.equal(canPostInGroup({ ...base, viewOnly: false }), true);
});

test("view-only blocks plain members", () => {
  assert.equal(canPostInGroup(base), false);
  assert.equal(canPostInGroup({ ...base, role: undefined }), false);
});

test("view-only allows the creator and admins", () => {
  assert.equal(canPostInGroup({ ...base, role: "creator" }), true);
  assert.equal(canPostInGroup({ ...base, role: "admin" }), true);
});

test("view-only allows the priority member only", () => {
  assert.equal(canPostInGroup({ ...base, priorityUserId: "u1" }), true);
  assert.equal(canPostInGroup({ ...base, priorityUserId: "u2" }), false);
});

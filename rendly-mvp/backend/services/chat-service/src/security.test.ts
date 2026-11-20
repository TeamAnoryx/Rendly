import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canDeleteGroupMessage,
  canRemoveMember,
  canSetMemberRole,
  createRateLimiter,
  resolveJwtSecret,
  sanitizeMessageIds,
  MAX_MESSAGE_IDS,
} from "./security";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

test("JWT secret: production without a secret fails closed", () => {
  assert.throws(() => resolveJwtSecret({ NODE_ENV: "production" }), /JWT_SECRET/);
  assert.equal(resolveJwtSecret({ NODE_ENV: "production", JWT_SECRET: "s" }), "s");
  assert.equal(typeof resolveJwtSecret({ NODE_ENV: "development" }), "string");
});

test("message ids: only distinct UUIDs survive, capped", () => {
  assert.deepEqual(sanitizeMessageIds([A, A, "x", 5, null, B]), [A, B]);
  assert.deepEqual(sanitizeMessageIds("nope"), []);
  const many = Array.from({ length: 300 }, (_, i) => `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`);
  assert.equal(sanitizeMessageIds(many).length, MAX_MESSAGE_IDS);
});

test("remove member: outsiders and plain members cannot remove others", () => {
  assert.equal(canRemoveMember({ actorId: A, actorRole: undefined, targetId: B, targetRole: "member" }), false);
  assert.equal(canRemoveMember({ actorId: A, actorRole: "member", targetId: B, targetRole: "member" }), false);
  assert.equal(canRemoveMember({ actorId: A, actorRole: "admin", targetId: B, targetRole: undefined }), false);
});

test("remove member: self leave, creator and admin rules", () => {
  assert.equal(canRemoveMember({ actorId: A, actorRole: "member", targetId: A, targetRole: "member" }), true);
  assert.equal(canRemoveMember({ actorId: A, actorRole: "creator", targetId: B, targetRole: "admin" }), true);
  assert.equal(canRemoveMember({ actorId: A, actorRole: "admin", targetId: B, targetRole: "member" }), true);
  assert.equal(canRemoveMember({ actorId: A, actorRole: "admin", targetId: B, targetRole: "admin" }), false);
  assert.equal(canRemoveMember({ actorId: A, actorRole: "admin", targetId: B, targetRole: "creator" }), false);
  assert.equal(canRemoveMember({ actorId: A, actorRole: "creator", targetId: A, targetRole: "creator" }), false);
});

test("set role: creator only, never self or the creator, admin/member only", () => {
  const base = { actorId: A, actorRole: "creator", targetId: B, targetRole: "member", nextRole: "admin" };
  assert.equal(canSetMemberRole(base), true);
  assert.equal(canSetMemberRole({ ...base, actorRole: "admin" }), false);
  assert.equal(canSetMemberRole({ ...base, actorRole: "member" }), false);
  assert.equal(canSetMemberRole({ ...base, actorRole: undefined }), false);
  assert.equal(canSetMemberRole({ ...base, targetId: A }), false);
  assert.equal(canSetMemberRole({ ...base, targetRole: undefined }), false);
  assert.equal(canSetMemberRole({ ...base, nextRole: "creator" }), false);
  assert.equal(canSetMemberRole({ ...base, nextRole: "owner" }), false);
});

test("delete group message: sender or group admins, never outsiders", () => {
  assert.equal(canDeleteGroupMessage({ actorId: A, actorRole: "member", senderId: A }), true);
  assert.equal(canDeleteGroupMessage({ actorId: A, actorRole: "member", senderId: B }), false);
  assert.equal(canDeleteGroupMessage({ actorId: A, actorRole: "admin", senderId: B }), true);
  assert.equal(canDeleteGroupMessage({ actorId: A, actorRole: undefined, senderId: A }), false);
});

test("rate limiter: blocks after max and recovers after the window", () => {
  let t = 0;
  const limiter = createRateLimiter(2, 1000, () => t);
  assert.equal(limiter.allow("u"), true);
  assert.equal(limiter.allow("u"), true);
  assert.equal(limiter.allow("u"), false);
  assert.equal(limiter.allow("other"), true);
  t = 1001;
  assert.equal(limiter.allow("u"), true);
});

test("empty inputs: no ids, empty secret, empty actor or target", () => {
  assert.deepEqual(sanitizeMessageIds([]), []);
  assert.throws(() => resolveJwtSecret({ NODE_ENV: "production", JWT_SECRET: "" }), /JWT_SECRET/);
  assert.equal(canRemoveMember({ actorId: "", actorRole: undefined, targetId: "", targetRole: undefined }), false);
  assert.equal(canSetMemberRole({ actorId: "", actorRole: undefined, targetId: "", targetRole: undefined, nextRole: "" }), false);
  assert.equal(canDeleteGroupMessage({ actorId: "", actorRole: undefined, senderId: "" }), false);
});

test("rate limiter: a hit expires exactly at the window boundary", () => {
  let t = 0;
  const limiter = createRateLimiter(1, 1000, () => t);
  assert.equal(limiter.allow("u"), true);
  t = 999;
  assert.equal(limiter.allow("u"), false);
  t = 1000;
  assert.equal(limiter.allow("u"), true);
});

test("rate limiter: idle keys are swept", () => {
  let t = 0;
  const limiter = createRateLimiter(5, 1000, () => t);
  limiter.allow("a");
  limiter.allow("b");
  t = 5000;
  limiter.allow("c");
  assert.equal(limiter.size(), 1);
});

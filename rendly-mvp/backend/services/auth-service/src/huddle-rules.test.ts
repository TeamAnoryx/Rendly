import {
  buildInviteUrl,
  canAccessHuddle,
  inviteCodeMatches,
  isUuid,
  parseCategory,
  requestOrigin,
  toPublicHuddle,
  validateCreateHuddleInput,
  type HuddleRow,
} from "./huddle-rules";

const OWNER = "11111111-1111-4111-8111-111111111111";
const STRANGER = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-11-01T12:00:00.000Z");

function huddle(overrides: Partial<HuddleRow> = {}): HuddleRow {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    created_by: OWNER,
    title: "Standup",
    description: null,
    max_participants: 10,
    type: "public",
    is_active: true,
    started_at: null,
    ended_at: null,
    scheduled_at: null,
    duration_minutes: null,
    invite_code: "secret-code",
    settings: {},
    created_at: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("canAccessHuddle", () => {
  test("public huddles are open to anyone", () => {
    expect(canAccessHuddle(huddle(), { viewerId: STRANGER, isParticipant: false })).toBe(true);
  });

  test("private huddle denies a stranger without a code", () => {
    expect(canAccessHuddle(huddle({ type: "private" }), { viewerId: STRANGER, isParticipant: false })).toBe(false);
  });

  test("private huddle denies a stranger with a wrong code", () => {
    const ctx = { viewerId: STRANGER, isParticipant: false, inviteCode: "wrong-code!" };
    expect(canAccessHuddle(huddle({ type: "private" }), ctx)).toBe(false);
  });

  test("private huddle allows creator, participant and code holder", () => {
    const h = huddle({ type: "private" });
    expect(canAccessHuddle(h, { viewerId: OWNER, isParticipant: false })).toBe(true);
    expect(canAccessHuddle(h, { viewerId: STRANGER, isParticipant: true })).toBe(true);
    expect(canAccessHuddle(h, { viewerId: STRANGER, isParticipant: false, inviteCode: "secret-code" })).toBe(true);
  });
});

describe("inviteCodeMatches", () => {
  test("rejects missing, non-string and empty codes", () => {
    expect(inviteCodeMatches(null, "x")).toBe(false);
    expect(inviteCodeMatches("abc", undefined)).toBe(false);
    expect(inviteCodeMatches("abc", ["abc"])).toBe(false);
    expect(inviteCodeMatches("abc", "")).toBe(false);
  });
});

describe("toPublicHuddle", () => {
  test("hides invite code, creator id and settings from non-owners", () => {
    const out = toPublicHuddle(huddle({ settings: { a: 1 } }), STRANGER, 3);
    expect(out).not.toHaveProperty("invite_code");
    expect(out).not.toHaveProperty("created_by");
    expect(out).not.toHaveProperty("settings");
    expect(out.is_owner).toBe(false);
    expect(out.participants_count).toBe(3);
  });

  test("shows invite code to the owner", () => {
    expect(toPublicHuddle(huddle(), OWNER, 0).invite_code).toBe("secret-code");
  });
});

describe("validateCreateHuddleInput", () => {
  const base = { title: "  Demo  ", max_participants: 10 };

  test("normalizes a minimal valid body", () => {
    const result = validateCreateHuddleInput(base, NOW);
    expect(result).toEqual({
      ok: true,
      value: {
        title: "Demo",
        description: null,
        max_participants: 10,
        type: "public",
        scheduled_at: null,
        duration_minutes: null,
        settings: {},
      },
    });
  });

  test.each([
    [{ max_participants: 10 }, "Title is required"],
    [{ ...base, title: "x".repeat(256) }, "Title must be"],
    [{ ...base, max_participants: 11 }, "max_participants"],
    [{ ...base, type: "secret" }, "type must be"],
    [{ ...base, description: 42 }, "description must be a string"],
    [{ ...base, duration_minutes: 31 }, "duration_minutes"],
    [{ ...base, duration_minutes: 2.5 }, "duration_minutes"],
    [{ ...base, scheduled_at: "not a date" }, "valid date"],
    [{ ...base, scheduled_at: "2026-10-01T00:00:00Z" }, "past"],
    [{ ...base, scheduled_at: "2030-01-01T00:00:00Z" }, "too far"],
    [{ ...base, settings: ["a"] }, "settings must be an object"],
    [{ ...base, settings: { nested: { a: 1 } } }, "settings values"],
    [{ ...base, settings: { big: "x".repeat(5000) } }, "too large"],
  ])("rejects %j", (body, message) => {
    const result = validateCreateHuddleInput(body, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(message);
  });

  test("accepts a near-future schedule and normalizes it to ISO", () => {
    const result = validateCreateHuddleInput({ ...base, scheduled_at: "2026-11-02T10:00:00+02:00" }, NOW);
    expect(result.ok && result.value.scheduled_at).toBe("2026-11-02T08:00:00.000Z");
  });

  test("accepts values exactly at the limits", () => {
    const result = validateCreateHuddleInput(
      { title: "x".repeat(255), max_participants: 50, duration_minutes: 30, description: "" },
      NOW
    );
    expect(result.ok).toBe(true);
    expect(validateCreateHuddleInput({ ...base, duration_minutes: 1 }, NOW).ok).toBe(true);
  });

  test("rejects a non-object body", () => {
    expect(validateCreateHuddleInput(null, NOW).ok).toBe(false);
  });
});

describe("helpers", () => {
  test("isUuid accepts only UUIDs", () => {
    expect(isUuid(OWNER)).toBe(true);
    expect(isUuid("abc,created_by.eq.x")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid("")).toBe(false);
  });

  test("parseCategory falls back to all", () => {
    expect(parseCategory("live")).toBe("live");
    expect(parseCategory("drop table")).toBe("all");
    expect(parseCategory(["live"])).toBe("all");
    expect(parseCategory(null)).toBe("all");
    expect(parseCategory("")).toBe("all");
  });

  test("buildInviteUrl adds the code only for private huddles", () => {
    expect(buildInviteUrl("https://app.test", huddle())).toBe(`https://app.test/dashboard/huddles/${huddle().id}`);
    expect(buildInviteUrl("https://app.test", huddle({ type: "private" }))).toBe(
      `https://app.test/dashboard/huddles/${huddle().id}?code=secret-code`
    );
    expect(buildInviteUrl("", huddle())).toBe("");
  });

  test("requestOrigin keeps only an http(s) origin", () => {
    expect(requestOrigin("https://app.test", undefined)).toBe("https://app.test");
    expect(requestOrigin(undefined, "https://app.test/dashboard?x=1#y")).toBe("https://app.test");
    expect(requestOrigin("javascript:alert(1)", "garbage")).toBe("");
  });
});

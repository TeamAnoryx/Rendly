import {
  buildInviteUrl,
  canAccessHuddle,
  validateIntents,
  validateInviteeIds,
  huddleEndsAt,
  isLive,
  isUuid,
  rankTrending,
  trendingScore,
  TRENDING_LIST_SIZE,
  TRENDING_WEIGHTS,
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
    mode: "open",
    waiting_room: false,
    media_path: null,
    media_type: null,
    ...overrides,
  };
}

describe("canAccessHuddle", () => {
  test("public huddles are open to anyone", () => {
    expect(canAccessHuddle(huddle(), { viewerId: STRANGER, isParticipant: false, isInvited: false })).toBe(true);
  });

  test("private huddle denies a stranger", () => {
    expect(canAccessHuddle(huddle({ type: "private" }), { viewerId: STRANGER, isParticipant: false, isInvited: false })).toBe(false);
  });

  test("private huddle allows creator, participant and invitee", () => {
    const h = huddle({ type: "private" });
    expect(canAccessHuddle(h, { viewerId: OWNER, isParticipant: false, isInvited: false })).toBe(true);
    expect(canAccessHuddle(h, { viewerId: STRANGER, isParticipant: true, isInvited: false })).toBe(true);
    expect(canAccessHuddle(h, { viewerId: STRANGER, isParticipant: false, isInvited: true })).toBe(true);
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
        mode: "open",
        waiting_room: false,
        intents: [],
        invitee_ids: [],
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

  test("buildInviteUrl is the plain huddle link, with no code", () => {
    expect(buildInviteUrl("https://app.test", huddle())).toBe(`https://app.test/dashboard/huddles/${huddle().id}`);
    expect(buildInviteUrl("https://app.test", huddle({ type: "private" }))).toBe(
      `https://app.test/dashboard/huddles/${huddle().id}`
    );
    expect(buildInviteUrl("", huddle())).toBe("");
  });

  test("requestOrigin keeps only an http(s) origin", () => {
    expect(requestOrigin("https://app.test", undefined)).toBe("https://app.test");
    expect(requestOrigin(undefined, "https://app.test/dashboard?x=1#y")).toBe("https://app.test");
    expect(requestOrigin("javascript:alert(1)", "garbage")).toBe("");
  });
});

describe("huddle lifecycle", () => {
  const START = "2026-11-01T12:00:00.000Z";
  const startedAt = (overrides: Partial<HuddleRow> = {}) => huddle({ started_at: START, duration_minutes: 30, ...overrides });

  test("huddleEndsAt is started_at plus duration", () => {
    expect(huddleEndsAt(startedAt())).toBe(Date.parse("2026-11-01T12:30:00.000Z"));
  });

  test("huddleEndsAt uses the earlier of duration end and ended_at", () => {
    expect(huddleEndsAt(startedAt({ ended_at: "2026-11-01T12:10:00.000Z" }))).toBe(Date.parse("2026-11-01T12:10:00.000Z"));
    expect(huddleEndsAt(startedAt({ ended_at: "2026-11-01T13:00:00.000Z" }))).toBe(Date.parse("2026-11-01T12:30:00.000Z"));
  });

  test("huddleEndsAt is null before the first join or without any end", () => {
    expect(huddleEndsAt(huddle({ duration_minutes: 30 }))).toBeNull();
    expect(huddleEndsAt(startedAt({ duration_minutes: null }))).toBeNull();
  });

  test("isLive is false before start, after the duration, and when inactive", () => {
    const before = Date.parse("2026-11-01T12:29:59.000Z");
    const after = Date.parse("2026-11-01T12:30:00.000Z");
    expect(isLive(huddle({ duration_minutes: 30 }), before)).toBe(false);
    expect(isLive(startedAt(), before)).toBe(true);
    expect(isLive(startedAt(), after)).toBe(false);
    expect(isLive(startedAt({ is_active: false }), before)).toBe(false);
  });

  test("a started huddle with no timed end stays live until ended_at", () => {
    const later = Date.parse("2030-01-01T00:00:00.000Z");
    expect(isLive(startedAt({ duration_minutes: null }), later)).toBe(true);
    expect(isLive(startedAt({ duration_minutes: null, ended_at: "2026-11-01T13:00:00.000Z" }), later)).toBe(false);
  });

  test("toPublicHuddle exposes ends_at as ISO, or null", () => {
    expect(toPublicHuddle(startedAt(), STRANGER, 0).ends_at).toBe("2026-11-01T12:30:00.000Z");
    expect(toPublicHuddle(huddle(), STRANGER, 0).ends_at).toBeNull();
  });
});

describe("trending", () => {
  const NOW = Date.parse("2026-11-01T12:00:00.000Z");
  const hour = 60 * 60 * 1000;
  const base = { visits: 0, seatJoins: 0, tagVelocity: 0, lastActivityMs: NOW - 5 * hour, createdMs: NOW - 2 * hour };

  test("a busier huddle ranks above a quiet one", () => {
    const activity = new Map([
      ["busy", { ...base, visits: 10, seatJoins: 4, lastActivityMs: NOW - 60_000 }],
      ["quiet", { ...base, visits: 1, seatJoins: 0 }],
    ]);
    const ranked = rankTrending(
      [
        { id: "quiet", createdMs: NOW - 2 * hour },
        { id: "busy", createdMs: NOW - 2 * hour },
      ],
      activity,
      NOW
    );
    expect(ranked.map((r) => r.id)).toEqual(["busy", "quiet"]);
  });

  test("a recently active huddle outranks an idle one with the same velocity", () => {
    const activity = new Map([
      ["fresh", { ...base, visits: 3, seatJoins: 1, lastActivityMs: NOW - 60_000 }],
      ["stale", { ...base, visits: 3, seatJoins: 1, lastActivityMs: NOW - 10 * hour }],
    ]);
    const ranked = rankTrending(
      [
        { id: "stale", createdMs: NOW - 2 * hour },
        { id: "fresh", createdMs: NOW - 2 * hour },
      ],
      activity,
      NOW
    );
    expect(ranked[0].id).toBe("fresh");
  });

  test("velocities are normalised so the score stays between 0 and 1", () => {
    const activity = new Map([["only", { ...base, visits: 50, seatJoins: 20, lastActivityMs: NOW }]]);
    const [top] = rankTrending([{ id: "only", createdMs: NOW - hour }], activity, NOW);
    expect(top.score).toBeGreaterThan(0);
    expect(top.score).toBeLessThanOrEqual(1);
  });

  test("an old huddle with no recent activity scores near zero", () => {
    const old = { visits: 0, seatJoins: 0, tagVelocity: 0, lastActivityMs: NOW - 100 * hour, createdMs: NOW - 100 * hour };
    expect(trendingScore(old, { maxVisits: 0, maxSeatJoins: 0, maxTagVelocity: 0 }, NOW)).toBeLessThan(0.01);
  });
});

describe("validateIntents", () => {
  test("normalises tags and removes duplicates", () => {
    expect(validateIntents(["#Hackathon", " ai ", "ai"])).toEqual({ ok: true, value: ["hackathon", "ai"] });
  });

  test("absent means none", () => {
    expect(validateIntents(undefined)).toEqual({ ok: true, value: [] });
  });

  test.each([
    [["has space"], "intents use"],
    [["UPPER_CASE"], "intents use"],
    [["a".repeat(31)], "intents use"],
    [["1", "2", "3", "4", "5", "6"], "at most 5"],
    [[42], "each intent"],
    ["ai", "must be a list"],
  ])("rejects %j", (raw, message) => {
    const result = validateIntents(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(message);
  });
});

describe("validateInviteeIds", () => {
  test("accepts unique user ids", () => {
    expect(validateInviteeIds([OWNER, OWNER, STRANGER])).toEqual({ ok: true, value: [OWNER, STRANGER] });
  });

  test("rejects non-uuids and over-long lists", () => {
    expect(validateInviteeIds(["not-a-uuid"]).ok).toBe(false);
    expect(validateInviteeIds(Array.from({ length: 51 }, () => OWNER)).ok).toBe(false);
  });
});

describe("validateCreateHuddleInput room fields", () => {
  const base = { title: "Launch", max_participants: 10 };

  test("defaults to an open huddle with no waiting room, intents or invitees", () => {
    const result = validateCreateHuddleInput(base, NOW);
    expect(result.ok && result.value).toMatchObject({ mode: "open", waiting_room: false, intents: [], invitee_ids: [] });
  });

  test("accepts seminar mode, waiting room, intents and invitees", () => {
    const result = validateCreateHuddleInput(
      { ...base, mode: "seminar", waiting_room: true, intents: ["ai", "launch"], invitee_ids: [STRANGER] },
      NOW
    );
    expect(result.ok && result.value).toMatchObject({
      mode: "seminar",
      waiting_room: true,
      intents: ["ai", "launch"],
      invitee_ids: [STRANGER],
    });
  });

  test("rejects an unknown mode and a non-boolean waiting room", () => {
    expect(validateCreateHuddleInput({ ...base, mode: "party" }, NOW).ok).toBe(false);
    expect(validateCreateHuddleInput({ ...base, waiting_room: "yes" }, NOW).ok).toBe(false);
  });
});

describe("trending by intent tag", () => {
  const NOW = Date.parse("2026-11-01T12:00:00.000Z");
  const hour = 60 * 60 * 1000;
  const quiet = { visits: 0, seatJoins: 0, tagVelocity: 0, lastActivityMs: NOW - 5 * hour, createdMs: NOW - 2 * hour };

  test("a huddle whose tag is busy ranks above an equal huddle on a quiet tag", () => {
    const activity = new Map([
      ["busy-tag", { ...quiet, tagVelocity: 20 }],
      ["quiet-tag", { ...quiet, tagVelocity: 1 }],
    ]);
    const ranked = rankTrending(
      [
        { id: "quiet-tag", createdMs: NOW - 2 * hour },
        { id: "busy-tag", createdMs: NOW - 2 * hour },
      ],
      activity,
      NOW
    );
    expect(ranked[0].id).toBe("busy-tag");
  });

  test("the weights still sum to 1", () => {
    const sum = Object.values(TRENDING_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  test("the trending list shows five huddles", () => {
    expect(TRENDING_LIST_SIZE).toBe(5);
  });
});

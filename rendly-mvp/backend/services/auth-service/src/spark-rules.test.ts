import {
  chargeSettlesAt,
  computeSparkLimits,
  decideSettlement,
  isRateLimited,
  SPARK_MATCHES_PER_WINDOW,
  type SparkChargeState,
  isCallInitiator,
  isMissingSchemaError,
  parseQuoteIntents,
  partnerDisplayName,
  sharedIntents,
  sparkIntentPrice,
  sparkMatchCost,
  SPARK_PRESETS,
  validateMatchRequest,
  whisperConversationId,
} from "./spark-rules";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("sparkIntentPrice / sparkMatchCost", () => {
  test("presets cost 5 in any case, everything else 10", () => {
    for (const p of SPARK_PRESETS) expect(sparkIntentPrice(p)).toBe(5);
    expect(sparkIntentPrice("BRAINSTORM")).toBe(5);
    expect(sparkIntentPrice("light CHAT")).toBe(5);
    expect(sparkIntentPrice("Networking")).toBe(10);
    expect(sparkIntentPrice("Porto")).toBe(10);
  });

  test("cost is the sum of intent prices", () => {
    expect(sparkMatchCost(["Brainstorm", "Motivation", "DigitalMarketing"])).toBe(20);
    expect(sparkMatchCost([])).toBe(0);
  });
});

describe("validateMatchRequest", () => {
  test("accepts the new shape with defaults", () => {
    expect(validateMatchRequest({ mode: "text", intents: ["Brainstorm", "Gaming"] })).toEqual({
      ok: true,
      value: { mode: "text", intents: ["Brainstorm", "Gaming"], note: null, anonymous: true, match_any: true },
    });
  });

  test("accepts the legacy {intent} shape", () => {
    expect(validateMatchRequest({ mode: "video", intent: "  Rock  &  Roll " })).toEqual({
      ok: true,
      value: { mode: "video", intents: ["Rock & Roll"], note: null, anonymous: true, match_any: true },
    });
  });

  test("trims, collapses and dedupes intents case-insensitively", () => {
    const r = validateMatchRequest({ mode: "text", intents: [" Brainstorm ", "brainstorm", "Deep   Work"] });
    expect(r).toEqual({ ok: true, value: { mode: "text", intents: ["Brainstorm", "Deep Work"], note: null, anonymous: true, match_any: true } });
  });

  test("cleans the note and keeps anonymous false", () => {
    const r = validateMatchRequest({ mode: "text", intents: ["ab"], note: "  hi\u0000 there\n ", anonymous: false });
    expect(r).toEqual({ ok: true, value: { mode: "text", intents: ["ab"], note: "hi there", anonymous: false, match_any: true } });
    const empty = validateMatchRequest({ mode: "text", intents: ["ab"], note: "   " });
    expect(empty.ok && empty.value.note).toBeNull();
  });

  test("keeps match_any false when requested", () => {
    const r = validateMatchRequest({ mode: "text", intents: ["ab"], match_any: false });
    expect(r.ok && r.value.match_any).toBe(false);
  });

  test("rejects a non-boolean match_any", () => {
    expect(validateMatchRequest({ mode: "text", intents: ["ab"], match_any: "yes" })).toEqual({
      ok: false,
      message: "match_any must be true or false",
    });
  });

  test("accepts the boundaries", () => {
    expect(validateMatchRequest({ mode: "text", intents: ["ab", "a".repeat(40), "cc", "dd", "ee"] }).ok).toBe(true);
    expect(validateMatchRequest({ mode: "text", intents: ["ab"], note: "x".repeat(200) }).ok).toBe(true);
  });

  test.each([
    [{ mode: "audio", intents: ["Brainstorm"] }, "mode"],
    [{ mode: "text" }, "intents"],
    [{ mode: "text", intents: [] }, "intents"],
    [{ mode: "text", intents: "Brainstorm" }, "intents"],
    [{ mode: "text", intents: ["aa", "bb", "cc", "dd", "ee", "ff"] }, "intents"],
    [{ mode: "text", intents: ["a"] }, "intent"],
    [{ mode: "text", intents: ["a".repeat(41)] }, "intent"],
    [{ mode: "text", intents: [42] }, "intent"],
    [{ mode: "text", intent: "   " }, "intent"],
    [{ mode: "text", intents: ["ab"], note: "x".repeat(201) }, "note"],
    [{ mode: "text", intents: ["ab"], note: 5 }, "note"],
    [{ mode: "text", intents: ["ab"], anonymous: "yes" }, "anonymous"],
    [null, "mode"],
    [["text"], "mode"],
  ])("rejects %j", (body, field) => {
    const result = validateMatchRequest(body);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(field);
  });
});

describe("parseQuoteIntents", () => {
  test("splits a comma list", () => {
    expect(parseQuoteIntents("Brainstorm, Deep Work")).toEqual({ ok: true, value: ["Brainstorm", "Deep Work"] });
  });
  test.each([[undefined], [""], ["a"], ["aa,bb,cc,dd,ee,ff"], [["aa"]], ["x".repeat(401)]])("rejects %j", (raw) => {
    expect(parseQuoteIntents(raw).ok).toBe(false);
  });
});

describe("sharedIntents / partnerDisplayName / isMissingSchemaError", () => {
  test("intersection keeps my spelling and order", () => {
    expect(sharedIntents(["Motivation", "Gaming", "Brainstorm"], ["brainstorm", "motivation"])).toEqual(["Motivation", "Brainstorm"]);
    expect(sharedIntents(["a"], [])).toEqual([]);
  });
  test("display name hides anonymous partners", () => {
    expect(partnerDisplayName(false, "sam")).toBe("@sam");
    expect(partnerDisplayName(true, "sam")).toBe("@Anonymous");
    expect(partnerDisplayName(false, null)).toBe("@Anonymous");
  });
  test("schema errors", () => {
    expect(isMissingSchemaError({ code: "PGRST202" })).toBe(true);
    expect(isMissingSchemaError({ code: "42703" })).toBe(true);
    expect(isMissingSchemaError({ code: "42883" })).toBe(true);
    expect(isMissingSchemaError({ code: "23505" })).toBe(false);
    expect(isMissingSchemaError(null)).toBe(false);
  });
});

describe("whisperConversationId", () => {
  test("is the same in either order and matches the chat service format", () => {
    expect(whisperConversationId(A, B)).toBe(`whisper_${A}_${B}`);
    expect(whisperConversationId(B, A)).toBe(whisperConversationId(A, B));
  });
});

describe("isCallInitiator", () => {
  test("exactly one side of a pair initiates", () => {
    expect(isCallInitiator(A, B)).toBe(true);
    expect(isCallInitiator(B, A)).toBe(false);
  });
});

describe("chargeSettlesAt", () => {
  test("returns the ISO time 30 seconds after the match", () => {
    // Arrange
    const matchedAt = "2026-11-15T10:00:00.000Z";
    // Act
    const settles = chargeSettlesAt(matchedAt);
    // Assert
    expect(settles).toBe("2026-11-15T10:00:30.000Z");
  });

  test("accepts a Date", () => {
    expect(chargeSettlesAt(new Date("2026-11-15T10:00:00.000Z"))).toBe("2026-11-15T10:00:30.000Z");
  });
});

describe("decideSettlement", () => {
  const matchedAt = new Date("2026-11-15T10:00:00.000Z");
  const at = (ms: number) => new Date(matchedAt.getTime() + ms);
  const decide = (state: SparkChargeState, now: Date, ending: boolean, endedAt: Date | null = null) =>
    decideSettlement({ state, matchedAt, endedAt, now, ending });

  test("charges a pending pairing at exactly 30 seconds", () => {
    expect(decide("pending", at(30_000), false)).toBe("charge");
  });

  test("charges a pending pairing ended after 30 seconds", () => {
    expect(decide("pending", at(31_000), true)).toBe("charge");
  });

  test("waives a pending pairing ended at 29.9 seconds", () => {
    expect(decide("pending", at(29_900), true)).toBe("waive");
  });

  test("keeps a pending pairing under 30 seconds that is not ending", () => {
    expect(decide("pending", at(10_000), false)).toBe("keep");
  });

  test("waives a pairing ended at 10 seconds even when checked later", () => {
    expect(decide("pending", at(120_000), false, at(10_000))).toBe("waive");
  });

  test("keeps an already charged or waived pairing", () => {
    expect(decide("charged", at(60_000), true)).toBe("keep");
    expect(decide("waived", at(60_000), true)).toBe("keep");
  });
});

describe("computeSparkLimits", () => {
  const now = new Date("2026-11-15T12:00:00.000Z");
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

  test("with no matches leaves the full allowance and no reset time", () => {
    // Act
    const limits = computeSparkLimits([], 42, now);
    // Assert
    expect(limits).toEqual({
      balance: 42,
      matches_used: 0,
      matches_left: SPARK_MATCHES_PER_WINDOW,
      max_per_window: 20,
      window_minutes: 60,
      resets_at: null,
    });
    expect(isRateLimited(limits)).toBe(false);
  });

  test("20 matches in the window leave none and rate-limit the user", () => {
    // Arrange
    const times = Array.from({ length: 20 }, (_, i) => minutesAgo(i * 2));
    // Act
    const limits = computeSparkLimits(times, 0, now);
    // Assert
    expect(limits.matches_used).toBe(20);
    expect(limits.matches_left).toBe(0);
    expect(isRateLimited(limits)).toBe(true);
  });

  test("ignores matches older than 60 minutes", () => {
    const limits = computeSparkLimits([minutesAgo(61), minutesAgo(60), minutesAgo(5)], 0, now);
    expect(limits.matches_used).toBe(1);
    expect(limits.matches_left).toBe(19);
  });

  test("resets when the oldest in-window match leaves the window", () => {
    const limits = computeSparkLimits([minutesAgo(5), minutesAgo(40).toISOString()], 0, now);
    expect(limits.resets_at).toBe(new Date(minutesAgo(40).getTime() + 60 * 60_000).toISOString());
  });

  test("honours max and window overrides", () => {
    const limits = computeSparkLimits([minutesAgo(5), minutesAgo(20)], 3, now, 2, 10);
    expect(limits.matches_used).toBe(1);
    expect(limits.matches_left).toBe(1);
    expect(limits.max_per_window).toBe(2);
    expect(limits.window_minutes).toBe(10);
    expect(isRateLimited(computeSparkLimits([minutesAgo(1), minutesAgo(2)], 0, now, 2, 10))).toBe(true);
  });
});

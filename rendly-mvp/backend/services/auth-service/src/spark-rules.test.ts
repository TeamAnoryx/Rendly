import {
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
      value: { mode: "text", intents: ["Brainstorm", "Gaming"], note: null, anonymous: true },
    });
  });

  test("accepts the legacy {intent} shape", () => {
    expect(validateMatchRequest({ mode: "video", intent: "  Rock  &  Roll " })).toEqual({
      ok: true,
      value: { mode: "video", intents: ["Rock & Roll"], note: null, anonymous: true },
    });
  });

  test("trims, collapses and dedupes intents case-insensitively", () => {
    const r = validateMatchRequest({ mode: "text", intents: [" Brainstorm ", "brainstorm", "Deep   Work"] });
    expect(r).toEqual({ ok: true, value: { mode: "text", intents: ["Brainstorm", "Deep Work"], note: null, anonymous: true } });
  });

  test("cleans the note and keeps anonymous false", () => {
    const r = validateMatchRequest({ mode: "text", intents: ["ab"], note: "  hi\u0000 there\n ", anonymous: false });
    expect(r).toEqual({ ok: true, value: { mode: "text", intents: ["ab"], note: "hi there", anonymous: false } });
    const empty = validateMatchRequest({ mode: "text", intents: ["ab"], note: "   " });
    expect(empty.ok && empty.value.note).toBeNull();
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

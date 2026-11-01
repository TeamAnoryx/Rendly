import { isCallInitiator, validateMatchRequest, whisperConversationId } from "./spark-rules";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("validateMatchRequest", () => {
  test("accepts a text or video request with a known intent", () => {
    expect(validateMatchRequest({ mode: "text", intent: "Brainstorm" })).toEqual({
      ok: true,
      value: { mode: "text", intent: "Brainstorm" },
    });
    expect(validateMatchRequest({ mode: "video", intent: "Collaborate" }).ok).toBe(true);
  });

  test.each([
    [{ mode: "audio", intent: "Brainstorm" }, "mode"],
    [{ mode: "text" }, "intent"],
    [{ mode: "text", intent: "Gaming" }, "intent"],
    [null, "mode"],
    [["text"], "mode"],
  ])("rejects %j", (body, field) => {
    const result = validateMatchRequest(body);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(field);
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

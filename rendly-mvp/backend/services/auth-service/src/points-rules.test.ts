import {
  HUDDLE_SEND_PURPOSE_LABELS,
  HUDDLE_SEND_PURPOSES,
  isHuddleSendPurpose,
  isUuid,
  validateHuddleSendBody,
  validateTransferBody,
} from "./points-rules";

const USER = "11111111-1111-4111-8111-111111111111";
const CONV = `whisper_${USER}_22222222-2222-4222-8222-222222222222`;

describe("huddle send purposes", () => {
  test("lists the six purposes agreed with the SQL CHECK", () => {
    expect([...HUDDLE_SEND_PURPOSES]).toEqual(["winner", "best_answer", "participation", "speaker_thanks", "bounty", "other"]);
  });

  test("every purpose has a label", () => {
    for (const purpose of HUDDLE_SEND_PURPOSES) {
      expect(HUDDLE_SEND_PURPOSE_LABELS[purpose]).toEqual(expect.any(String));
    }
    expect(HUDDLE_SEND_PURPOSE_LABELS.best_answer).toBe("Best answer");
  });

  test("isHuddleSendPurpose narrows", () => {
    expect(isHuddleSendPurpose("bounty")).toBe(true);
    expect(isHuddleSendPurpose("tip")).toBe(false);
    expect(isHuddleSendPurpose(1)).toBe(false);
  });

  test("re-exports isUuid", () => {
    expect(isUuid(USER)).toBe(true);
    expect(isUuid("nope")).toBe(false);
  });
});

describe("validateTransferBody", () => {
  const good = { to_user_id: USER, amount: 50, note: "  thanks  ", conversation_id: CONV };

  test("accepts a valid body and trims the note", () => {
    expect(validateTransferBody(good)).toEqual({
      ok: true,
      value: { to_user_id: USER, amount: 50, note: "thanks", conversation_id: CONV },
    });
  });

  test("note is optional and empty becomes null", () => {
    const r = validateTransferBody({ ...good, note: undefined });
    expect(r.ok && r.value.note).toBeNull();
    const r2 = validateTransferBody({ ...good, note: "   " });
    expect(r2.ok && r2.value.note).toBeNull();
  });

  test("accepts the boundary amounts", () => {
    expect(validateTransferBody({ ...good, amount: 1 }).ok).toBe(true);
    expect(validateTransferBody({ ...good, amount: 1_000_000 }).ok).toBe(true);
  });

  test.each([
    [{ ...good, to_user_id: "not-a-uuid" }, "to_user_id"],
    [{ ...good, to_user_id: undefined }, "to_user_id"],
    [{ ...good, amount: 0 }, "amount"],
    [{ ...good, amount: -5 }, "amount"],
    [{ ...good, amount: 1_000_001 }, "amount"],
    [{ ...good, amount: 1.5 }, "amount"],
    [{ ...good, amount: "50" }, "amount"],
    [{ ...good, note: "x".repeat(141) }, "note"],
    [{ ...good, note: 42 }, "note"],
    [{ ...good, conversation_id: "" }, "conversation_id"],
    [{ ...good, conversation_id: undefined }, "conversation_id"],
    [{ ...good, conversation_id: "c".repeat(121) }, "conversation_id"],
    [null, "to_user_id"],
    [[], "to_user_id"],
    ["string", "to_user_id"],
  ])("rejects %j", (body, field) => {
    const r = validateTransferBody(body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(field);
  });

  test("does not mutate the input", () => {
    const body = { ...good };
    const snapshot = JSON.stringify(body);
    validateTransferBody(body);
    expect(JSON.stringify(body)).toBe(snapshot);
  });
});

describe("validateHuddleSendBody", () => {
  const good = { user_id: USER, amount: 100, purpose: "winner", note: null };

  test("accepts a valid body without a note", () => {
    expect(validateHuddleSendBody(good)).toEqual({
      ok: true,
      value: { user_id: USER, amount: 100, purpose: "winner", note: null },
    });
  });

  test("accepts every purpose except other without a note", () => {
    for (const purpose of HUDDLE_SEND_PURPOSES.filter((p) => p !== "other")) {
      expect(validateHuddleSendBody({ ...good, purpose }).ok).toBe(true);
    }
  });

  test("other requires a non-empty note", () => {
    const missing = validateHuddleSendBody({ ...good, purpose: "other" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toContain("note");
    const blank = validateHuddleSendBody({ ...good, purpose: "other", note: "   " });
    expect(blank.ok).toBe(false);
    const withNote = validateHuddleSendBody({ ...good, purpose: "other", note: " Great energy " });
    expect(withNote).toEqual({ ok: true, value: { user_id: USER, amount: 100, purpose: "other", note: "Great energy" } });
  });

  test("accepts the boundary amounts", () => {
    expect(validateHuddleSendBody({ ...good, amount: 1 }).ok).toBe(true);
    expect(validateHuddleSendBody({ ...good, amount: 1000 }).ok).toBe(true);
  });

  test.each([
    [{ ...good, user_id: "x" }, "user_id"],
    [{ ...good, amount: 0 }, "amount"],
    [{ ...good, amount: 1001 }, "amount"],
    [{ ...good, amount: 2.5 }, "amount"],
    [{ ...good, amount: "10" }, "amount"],
    [{ ...good, purpose: "tip" }, "purpose"],
    [{ ...good, purpose: undefined }, "purpose"],
    [{ ...good, note: "n".repeat(141) }, "note"],
    [{ ...good, note: {} }, "note"],
    [undefined, "user_id"],
  ])("rejects %j", (body, field) => {
    const r = validateHuddleSendBody(body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(field);
  });
});

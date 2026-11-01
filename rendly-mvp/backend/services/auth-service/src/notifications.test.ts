import { normaliseNotification } from "./notifications";

describe("normaliseNotification", () => {
  test("trims fields and fills in an empty payload", () => {
    expect(normaliseNotification({ type: "welcome", title: "  Hi  ", body: "  there " })).toEqual({
      type: "welcome",
      title: "Hi",
      body: "there",
      payload: {},
    });
  });

  test("cuts an over-long title and body to the column limits", () => {
    const n = normaliseNotification({ type: "message", title: "t".repeat(400), body: "b".repeat(900) });
    expect(n?.title).toHaveLength(160);
    expect(n?.body).toHaveLength(500);
  });

  test("rejects a bad type or an empty title", () => {
    expect(normaliseNotification({ type: "Bad Type", title: "x" })).toBeNull();
    expect(normaliseNotification({ type: "ok", title: "   " })).toBeNull();
  });

  test("an empty body becomes null", () => {
    expect(normaliseNotification({ type: "ok", title: "x", body: "   " })?.body).toBeNull();
  });
});

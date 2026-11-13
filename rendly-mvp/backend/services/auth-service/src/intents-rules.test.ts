import {
  INTENT_DURATION_DAYS,
  INTENT_PRICES,
  INTENT_ROYALTY,
  INTENT_SOURCES,
  intentPrice,
  intentSlug,
  isIntentSource,
  validateCreateIntentBody,
  validateIntentName,
  validateLocationBody,
} from "./intents-rules";

describe("intentSlug", () => {
  test.each([
    ["Light chat", "light-chat"],
    ["  Brainstorm  ", "brainstorm"],
    ["Rock   &   Roll", "rock-roll"],
    ["Café Crawl", "caf-crawl"],
    ["Founders' Night", "founders-night"],
    ["--hello--", "hello"],
    ["Hello-World", "hello-world"],
    ["a".repeat(50), "a".repeat(40)],
    ["", ""],
    ["!!!", ""],
  ])("slugs %j to %j", (name, slug) => {
    expect(intentSlug(name)).toBe(slug);
  });
});

describe("prices and durations", () => {
  test("price table matches the SQL purchase_intent RPC", () => {
    expect(INTENT_PRICES).toEqual({ hot: 20, location: 20, nearby: 20, search: 10 });
    expect(INTENT_ROYALTY).toBe(10);
    expect(INTENT_DURATION_DAYS).toEqual({ purchased: 28, ownPrivate: 7 });
  });

  test("sources list every user_intents source", () => {
    expect([...INTENT_SOURCES]).toEqual(["preset", "hot", "location", "nearby", "search", "created"]);
    expect(isIntentSource("search")).toBe(true);
    expect(isIntentSource("bought")).toBe(false);
  });

  test("presets are free regardless of source", () => {
    expect(intentPrice("preset", "hot", false)).toBe(0);
    expect(intentPrice("preset", "search", false)).toBe(0);
  });

  test("your own intent is free", () => {
    expect(intentPrice("custom", "hot", true)).toBe(0);
    expect(intentPrice("custom", "search", true)).toBe(0);
    expect(intentPrice("location", "location", true)).toBe(0);
  });

  test("other people's intents follow the source table", () => {
    expect(intentPrice("custom", "hot", false)).toBe(20);
    expect(intentPrice("location", "location", false)).toBe(20);
    expect(intentPrice("custom", "nearby", false)).toBe(20);
    expect(intentPrice("custom", "search", false)).toBe(10);
  });

  test("non-paid sources cost nothing", () => {
    expect(intentPrice("custom", "created", false)).toBe(0);
    expect(intentPrice("custom", "preset", false)).toBe(0);
  });
});

describe("validateIntentName", () => {
  test("trims, collapses spaces and accepts letters, digits, &, - and '", () => {
    expect(validateIntentName("  Rock  &  Roll  ")).toEqual({ ok: true, value: "Rock & Roll" });
    expect(validateIntentName("Founders' Night 2026")).toEqual({ ok: true, value: "Founders' Night 2026" });
    expect(validateIntentName("Co-founder hunt")).toEqual({ ok: true, value: "Co-founder hunt" });
    expect(validateIntentName("Café")).toEqual({ ok: true, value: "Café" });
  });

  test("accepts the 2 and 40 character boundaries", () => {
    expect(validateIntentName("ab").ok).toBe(true);
    expect(validateIntentName("a".repeat(40)).ok).toBe(true);
  });

  test.each([
    ["a", "between"],
    ["a".repeat(41), "between"],
    ["   ", "between"],
    ["hello!", "letters"],
    ["<script>", "letters"],
    ["drop; table", "letters"],
    [42, "text"],
    [null, "text"],
  ])("rejects %j", (name, fragment) => {
    const r = validateIntentName(name);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(fragment);
  });
});

describe("validateCreateIntentBody", () => {
  test("accepts name + visibility", () => {
    expect(validateCreateIntentBody({ name: " Hackers ", visibility: "private" })).toEqual({
      ok: true,
      value: { name: "Hackers", visibility: "private" },
    });
    expect(validateCreateIntentBody({ name: "Hackers", visibility: "public" }).ok).toBe(true);
  });

  test.each([
    [{ name: "Hackers", visibility: "friends" }, "visibility"],
    [{ name: "Hackers" }, "visibility"],
    [{ name: "H", visibility: "public" }, "name"],
    [{ visibility: "public" }, "name"],
    [null, "name"],
  ])("rejects %j", (body, fragment) => {
    const r = validateCreateIntentBody(body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(fragment);
  });
});

describe("validateLocationBody", () => {
  test("accepts a point with an optional city", () => {
    expect(validateLocationBody({ lat: 48.8566, lng: 2.3522, city: "  Paris " })).toEqual({
      ok: true,
      value: { lat: 48.8566, lng: 2.3522, city: "Paris" },
    });
    expect(validateLocationBody({ lat: 0, lng: 0 })).toEqual({ ok: true, value: { lat: 0, lng: 0, city: null } });
    expect(validateLocationBody({ lat: -90, lng: 180, city: "" })).toEqual({ ok: true, value: { lat: -90, lng: 180, city: null } });
  });

  test.each([
    [{ lat: 90.1, lng: 0 }, "lat"],
    [{ lat: -90.1, lng: 0 }, "lat"],
    [{ lat: "10", lng: 0 }, "lat"],
    [{ lat: Number.NaN, lng: 0 }, "lat"],
    [{ lat: 0, lng: 180.1 }, "lng"],
    [{ lat: 0, lng: Number.POSITIVE_INFINITY }, "lng"],
    [{ lat: 0 }, "lng"],
    [{ lat: 0, lng: 0, city: 5 }, "city"],
    [{ lat: 0, lng: 0, city: "c".repeat(81) }, "city"],
    [null, "lat"],
  ])("rejects %j", (body, fragment) => {
    const r = validateLocationBody(body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(fragment);
  });
});

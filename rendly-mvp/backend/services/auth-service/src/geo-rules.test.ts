import {
  mapReverseResponse,
  mapSearchItem,
  mapSearchResponse,
  normaliseGeoQuery,
  parseCoords,
  reverseCacheKey,
  sanitiseAcceptLanguage,
  searchCacheKey,
} from "./geo-rules";

describe("normaliseGeoQuery", () => {
  test("trims, collapses and strips control characters", () => {
    expect(normaliseGeoQuery("  Rua   Augusta\n 10 ")).toBe("Rua Augusta 10");
    expect(normaliseGeoQuery("ab")).toBe("ab");
    expect(normaliseGeoQuery("x".repeat(120))).toBe("x".repeat(120));
  });
  test.each([[undefined], [42], [""], ["a"], ["   a  "], ["x".repeat(121)], [["Lisbon"]]])("rejects %j", (raw) => {
    expect(normaliseGeoQuery(raw)).toBeNull();
  });
});

describe("parseCoords", () => {
  test("parses and rounds to 3 decimals", () => {
    expect(parseCoords("38.722252", "-9.139337")).toEqual({ lat: 38.722, lng: -9.139 });
    expect(parseCoords("-90", "180")).toEqual({ lat: -90, lng: 180 });
  });
  test.each([
    ["91", "0"],
    ["0", "-181"],
    ["abc", "0"],
    ["1e3", "0"],
    ["", ""],
    [undefined, "1"],
    ["NaN", "1"],
  ])("rejects %s,%s", (lat, lng) => {
    expect(parseCoords(lat, lng)).toBeNull();
  });
});

describe("cache keys", () => {
  test("search key is case-insensitive", () => {
    expect(searchCacheKey("Lisbon", "en")).toBe(searchCacheKey("LISBON", "en"));
    expect(searchCacheKey("Lisbon", "en")).not.toBe(searchCacheKey("Lisbon", "pt"));
  });
  test("reverse key uses 3 decimals", () => {
    expect(reverseCacheKey(38.7, -9.1, "en")).toBe("r:en:38.700,-9.100");
  });
});

describe("sanitiseAcceptLanguage", () => {
  test("keeps up to 3 clean tags", () => {
    expect(sanitiseAcceptLanguage("pt-PT,pt;q=0.9,en-US;q=0.8,en;q=0.7")).toBe("pt-PT,pt,en-US");
  });
  test.each([[undefined], [""], ["*"], ["<script>"], ["x\r\nInjected: 1"]])("falls back to en for %j", (raw) => {
    expect(sanitiseAcceptLanguage(raw)).toBe("en");
  });
});

describe("Nominatim mapping", () => {
  const item = {
    display_name: "Lisbon, Portugal",
    lat: "38.7077507",
    lon: "-9.1365919",
    address: { city: "Lisbon", country: "Portugal" },
    osm_id: 123,
  };

  test("maps a search item", () => {
    expect(mapSearchItem(item)).toEqual({ label: "Lisbon, Portugal", lat: 38.7077507, lng: -9.1365919, city: "Lisbon", country: "Portugal" });
  });
  test("falls back to town / village for city", () => {
    expect(mapSearchItem({ ...item, address: { village: "Sintra", country: "Portugal" } })?.city).toBe("Sintra");
    expect(mapSearchItem({ ...item, address: undefined })).toMatchObject({ city: null, country: null });
  });
  test("drops broken items and caps at 5", () => {
    expect(mapSearchItem({ display_name: "x", lat: "abc", lon: "1" })).toBeNull();
    expect(mapSearchItem(null)).toBeNull();
    expect(mapSearchResponse(Array(8).fill(item))).toHaveLength(5);
    expect(mapSearchResponse({ error: "x" })).toEqual([]);
  });
  test("maps a reverse response", () => {
    expect(mapReverseResponse(item)).toEqual({ label: "Lisbon, Portugal", city: "Lisbon", country: "Portugal" });
    expect(mapReverseResponse({ error: "Unable to geocode" })).toBeNull();
    expect(mapReverseResponse([item])).toBeNull();
  });
});

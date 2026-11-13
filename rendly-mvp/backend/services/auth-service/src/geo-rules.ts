/**
 * Pure helpers for the geocoding proxy (GET /api/geo/search, GET /api/geo/reverse):
 * input normalisation, cache keys and mapping of Nominatim jsonv2 items. No I/O.
 */

export const GEO_QUERY_MIN = 2;
export const GEO_QUERY_MAX = 120;
/** Coordinates are rounded to 3 decimals (~110 m) for the cache key and the upstream request. */
export const GEO_COORD_DECIMALS = 3;
const LABEL_MAX = 200;
const PLACE_MAX = 80;

export type GeoSearchResult = { label: string; lat: number; lng: number; city: string | null; country: string | null };
export type GeoReverseResult = { label: string; city: string | null; country: string | null };

/** Trim, drop control characters, collapse whitespace; null unless 2..120 characters. */
export function normaliseGeoQuery(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > GEO_QUERY_MAX * 4) return null;
  // eslint-disable-next-line no-control-regex
  const q = raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
  if (q.length < GEO_QUERY_MIN || q.length > GEO_QUERY_MAX) return null;
  return q;
}

function roundCoord(value: number): number {
  const f = 10 ** GEO_COORD_DECIMALS;
  return Math.round(value * f) / f;
}

/** Parse lat/lng query values; null unless both are finite and in range. Rounded to 3 decimals. */
export function parseCoords(rawLat: unknown, rawLng: unknown): { lat: number; lng: number } | null {
  if (typeof rawLat !== "string" || typeof rawLng !== "string") return null;
  if (!/^-?\d{1,3}(\.\d{1,15})?$/.test(rawLat.trim()) || !/^-?\d{1,3}(\.\d{1,15})?$/.test(rawLng.trim())) return null;
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat: roundCoord(lat), lng: roundCoord(lng) };
}

export function searchCacheKey(query: string, lang: string): string {
  return `s:${lang}:${query.toLowerCase()}`;
}

export function reverseCacheKey(lat: number, lng: number, lang: string): string {
  return `r:${lang}:${lat.toFixed(GEO_COORD_DECIMALS)},${lng.toFixed(GEO_COORD_DECIMALS)}`;
}

/**
 * Reduce an Accept-Language header to a safe value for the upstream request:
 * at most 3 language tags, no quality values; "en" when nothing usable remains.
 */
export function sanitiseAcceptLanguage(raw: unknown): string {
  if (typeof raw !== "string") return "en";
  const tags = raw
    .slice(0, 200)
    .split(",")
    .map((part) => part.split(";")[0].trim())
    .filter((tag) => /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/.test(tag))
    .slice(0, 3);
  return tags.length > 0 ? tags.join(",") : "en";
}

function clip(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const s = value.replace(/\s+/g, " ").trim();
  return s.length === 0 ? null : s.slice(0, max);
}

type NominatimAddress = Record<string, unknown>;

function cityOf(address: NominatimAddress | undefined): string | null {
  if (!address) return null;
  for (const key of ["city", "town", "village", "municipality", "hamlet", "suburb", "county"]) {
    const v = clip(address[key], PLACE_MAX);
    if (v) return v;
  }
  return null;
}

function addressOf(item: Record<string, unknown>): NominatimAddress | undefined {
  const a = item.address;
  return typeof a === "object" && a !== null && !Array.isArray(a) ? (a as NominatimAddress) : undefined;
}

/** Map one Nominatim jsonv2 search item; null when it has no usable label or coordinates. */
export function mapSearchItem(raw: unknown): GeoSearchResult | null {
  if (typeof raw !== "object" || raw === null) return null;
  const item = raw as Record<string, unknown>;
  const label = clip(item.display_name, LABEL_MAX);
  const lat = Number(item.lat);
  const lng = Number(item.lon);
  if (!label || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const address = addressOf(item);
  return { label, lat, lng, city: cityOf(address), country: clip(address?.country, PLACE_MAX) };
}

/** Map a Nominatim jsonv2 search response (array) to at most 5 results. */
export function mapSearchResponse(raw: unknown): GeoSearchResult[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 10)
    .map(mapSearchItem)
    .filter((x): x is GeoSearchResult => x !== null)
    .slice(0, 5);
}

/** Map a Nominatim jsonv2 reverse response; null when nothing was found. */
export function mapReverseResponse(raw: unknown): GeoReverseResult | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  const label = clip(item.display_name, LABEL_MAX);
  if (!label) return null;
  const address = addressOf(item);
  return { label, city: cityOf(address), country: clip(address?.country, PLACE_MAX) };
}

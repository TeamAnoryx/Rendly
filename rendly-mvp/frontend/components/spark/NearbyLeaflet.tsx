'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MapContainer, Marker, TileLayer, ZoomControl } from 'react-leaflet';
import { reverseGeocode, searchAddress, type GeoSearchResult } from '@/services/geoApi';
import {
  clearMyLocation,
  getNearbyIntents,
  purchaseIntent,
  setMyLocation,
  type NearbyResult,
} from '@/services/intentsApi';
import { newIdempotencyKey } from '@/services/pointsApi';
import { compactCount } from '@/utils/formatCount';
import PagedList from './setup/PagedList';

type Props = {
  selected: string[];
  onSelect: (name: string) => void;
  maxReached: boolean;
};

type LatLng = { lat: number; lng: number };

const FALLBACK_CENTER: LatLng = { lat: 20, lng: 0 };
const FALLBACK_ZOOM = 2;
const LOCATED_ZOOM = 13;
const GEO_TIMEOUT_MS = 10_000;
const GEO_MAX_AGE_MS = 60_000;
const SEARCH_DEBOUNCE_MS = 600;
const SEARCH_MIN_CHARS = 3;
const SEARCH_MAX_RESULTS = 5;
const NEARBY_PRICE = 10;
/** Drag / search saves wait this long so a burst of moves becomes one PUT. */
export const SAVE_DEBOUNCE_MS = 800;
/** Moves shorter than this are not worth a save (the server allows one per 10 minutes). */
const MIN_SAVE_DISTANCE_M = 25;
const EARTH_RADIUS_M = 6_371_000;

// Optional overrides; defaults need no API key (CARTO basemaps, OSM data).
const TILE_URL =
  process.env.NEXT_PUBLIC_MAP_TILE_URL || 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_ATTRIBUTION =
  process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION || '&copy; OpenStreetMap contributors &copy; CARTO';

export const THROTTLE_MESSAGE =
  'You can update your location once every 10 minutes. Your last saved spot is still being used.';
export const GEO_DENIED_MESSAGE =
  'Location access is blocked. Allow it in your browser settings, or search for a place instead.';
export const GEO_INSECURE_MESSAGE =
  'Your browser only shares location over a secure (https) connection. Search for a place or drag the pin.';
const GEO_UNAVAILABLE_MESSAGE = 'Location is unavailable in this browser. Search for a place instead.';
const GEO_FAILED_MESSAGE = 'We could not get your location. Search for a place or drag the pin.';

const pinIcon = L.divIcon({
  className: 'nbm-pin',
  html: '<span class="nbm-pin-bob"><span class="nbm-pin-ring"></span><span class="nbm-pin-dot"></span></span>',
  // 44px hit area so the pin is easy to grab on touch screens.
  iconSize: [44, 44],
  iconAnchor: [22, 22],
});

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function isThrottleError(err: unknown): boolean {
  return /too[_\s-]?soon|10 ?min|once every/i.test(errorText(err, ''));
}

function distanceMeters(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

function moveMap(map: L.Map | null, p: LatLng, zoom: number) {
  if (!map) return;
  if (prefersReducedMotion()) map.setView([p.lat, p.lng], zoom);
  else map.flyTo([p.lat, p.lng], zoom);
}

/** Returns a user-facing reason geolocation cannot run here, or null when it can. */
function geolocationBlocker(): string | null {
  if (typeof window !== 'undefined' && window.isSecureContext === false) return GEO_INSECURE_MESSAGE;
  if (typeof navigator === 'undefined' || !navigator.geolocation) return GEO_UNAVAILABLE_MESSAGE;
  return null;
}

const DOCK_QUERY = '(orientation: landscape) and (min-width: 1180px) and (min-height: 560px)';

/** The right-column slot the map pops into on wide screens; null elsewhere (map renders inline). */
function useMapSlot(): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(DOCK_QUERY);
    const sync = () => setSlot(mq.matches ? document.getElementById('spark-map-slot') : null);
    sync();
    mq.addEventListener?.('change', sync);
    return () => mq.removeEventListener?.('change', sync);
  }, []);
  return slot;
}

function LocateGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  );
}

export default function NearbyLeaflet({ selected, onSelect, maxReached }: Props) {
  const [map, setMap] = useState<L.Map | null>(null);
  const [pos, setPos] = useState<LatLng>(FALLBACK_CENTER);
  const [label, setLabel] = useState('');
  const [city, setCity] = useState<string | null>(null);
  const [geoMsg, setGeoMsg] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeoSearchResult[]>([]);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const searchReq = useRef(0);
  const reverseReq = useRef(0);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nearby, setNearby] = useState<NearbyResult | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  /** Map popup: open while choosing a spot, slides away once a location is saved. */
  const [mapOpen, setMapOpen] = useState(true);
  const [mapLeaving, setMapLeaving] = useState(false);
  const mapSlot = useMapSlot();

  /** True once the user placed the pin themselves; the initial auto-locate must not override it. */
  const userMoved = useRef(false);
  const lastSaved = useRef<LatLng | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveReq = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  /** Reverse-geocodes p; resolves to its city, or undefined when a newer lookup superseded it. */
  const lookup = useCallback(async (p: LatLng): Promise<string | null | undefined> => {
    const id = ++reverseReq.current;
    try {
      const r = await reverseGeocode(p.lat, p.lng);
      if (id !== reverseReq.current || !mounted.current) return undefined;
      setLabel(r.label || 'Pinned location');
      setCity(r.city);
      return r.city;
    } catch (err) {
      if (id !== reverseReq.current || !mounted.current) return undefined;
      setLabel('Pinned location');
      setCity(null);
      setError(errorText(err, 'Could not look up that location.'));
      return null;
    }
  }, []);

  const loadNearby = useCallback(async () => {
    try {
      const result = await getNearbyIntents();
      if (mounted.current) setNearby(result);
    } catch (err) {
      if (mounted.current) setError(errorText(err, 'Could not load people near you.'));
    }
  }, []);

  /** Single save path for confirm, drag, search and current location (PUT /api/users/me/location). */
  const saveLocation = useCallback(
    async (p: LatLng, placeCity: string | null) => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      const prev = lastSaved.current;
      if (prev && distanceMeters(prev, p) < MIN_SAVE_DISTANCE_M) {
        setError(null);
        await loadNearby();
        return;
      }
      const id = ++saveReq.current;
      setBusy(true);
      setError(null);
      try {
        await setMyLocation({ lat: p.lat, lng: p.lng, city: placeCity });
      } catch (err) {
        if (id === saveReq.current && mounted.current) {
          setError(isThrottleError(err) ? THROTTLE_MESSAGE : errorText(err, 'Could not save your location.'));
          setBusy(false);
        }
        return;
      }
      lastSaved.current = p;
      await loadNearby();
      if (id === saveReq.current && mounted.current) {
        setBusy(false);
        setMapLeaving(true);
      }
    },
    [loadNearby]
  );

  const scheduleSave = useCallback(
    (p: LatLng, placeCity: string | null) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        void saveLocation(p, placeCity);
      }, SAVE_DEBOUNCE_MS);
    },
    [saveLocation]
  );

  // Leaflet measures its container once; re-measure after mount and whenever the panel resizes
  // (the map lives in a dynamic, sometimes initially hidden container).
  useEffect(() => {
    if (!map) return;
    const raf = requestAnimationFrame(() => map.invalidateSize());
    const el = typeof map.getContainer === 'function' ? map.getContainer() : null;
    let ro: ResizeObserver | null = null;
    if (el && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => map.invalidateSize());
      ro.observe(el);
    }
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [map]);

  // Initial center from the browser (not persisted); never overrides a pin the user placed.
  useEffect(() => {
    if (!map) return;
    const blocker = geolocationBlocker();
    if (blocker) {
      setGeoMsg(blocker);
      return;
    }
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (gp) => {
        if (cancelled || userMoved.current) return;
        const p = { lat: gp.coords.latitude, lng: gp.coords.longitude };
        setPos(p);
        map.setView([p.lat, p.lng], LOCATED_ZOOM);
        void lookup(p);
      },
      () => {
        if (cancelled || userMoved.current) return;
        setGeoMsg(GEO_FAILED_MESSAGE);
        map.setView([FALLBACK_CENTER.lat, FALLBACK_CENTER.lng], FALLBACK_ZOOM);
      },
      { timeout: GEO_TIMEOUT_MS, maximumAge: GEO_MAX_AGE_MS }
    );
    return () => {
      cancelled = true;
    };
  }, [map, lookup]);

  // Debounced address search; stale responses are dropped via a request counter.
  useEffect(() => {
    const q = query.trim();
    if (q.length < SEARCH_MIN_CHARS) {
      searchReq.current += 1;
      setResults([]);
      setSearchErr(null);
      return;
    }
    const timer = setTimeout(async () => {
      const id = ++searchReq.current;
      try {
        const { results: found } = await searchAddress(q);
        if (id !== searchReq.current) return;
        setResults(found.slice(0, SEARCH_MAX_RESULTS));
        setSearchErr(found.length ? null : 'No places found.');
      } catch (err) {
        if (id !== searchReq.current) return;
        setResults([]);
        setSearchErr(errorText(err, 'Could not search that address.'));
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const pickResult = (r: GeoSearchResult) => {
    userMoved.current = true;
    searchReq.current += 1;
    reverseReq.current += 1;
    const p = { lat: r.lat, lng: r.lng };
    setPos(p);
    setLabel(r.label);
    setCity(r.city);
    setResults([]);
    setQuery('');
    setGeoMsg(null);
    moveMap(map, p, LOCATED_ZOOM);
    scheduleSave(p, r.city);
  };

  const markerHandlers = useMemo(
    () => ({
      dragstart: () => {
        userMoved.current = true;
        if (saveTimer.current) clearTimeout(saveTimer.current);
      },
      dragend: async (e: L.LeafletEvent) => {
        userMoved.current = true;
        const ll = (e.target as L.Marker).getLatLng();
        const p = { lat: ll.lat, lng: ll.lng };
        setPos(p);
        setLabel('Looking up…');
        setGeoMsg(null);
        const placeCity = await lookup(p);
        if (placeCity === undefined || !mounted.current) return; // a newer move owns the save
        scheduleSave(p, placeCity);
      },
    }),
    [lookup, scheduleSave]
  );

  const locateMe = () => {
    const blocker = geolocationBlocker();
    if (blocker) {
      setGeoMsg(blocker);
      return;
    }
    setLocating(true);
    setGeoMsg(null);
    navigator.geolocation.getCurrentPosition(
      async (gp) => {
        if (!mounted.current) return;
        userMoved.current = true;
        const p = { lat: gp.coords.latitude, lng: gp.coords.longitude };
        setPos(p);
        moveMap(map, p, LOCATED_ZOOM);
        setLabel('Looking up…');
        const placeCity = await lookup(p);
        if (!mounted.current) return;
        setLocating(false);
        if (placeCity === undefined) return;
        await saveLocation(p, placeCity);
      },
      (err) => {
        if (!mounted.current) return;
        setLocating(false);
        setGeoMsg(err && err.code === 1 ? GEO_DENIED_MESSAGE : GEO_FAILED_MESSAGE);
      },
      { enableHighAccuracy: true, timeout: GEO_TIMEOUT_MS, maximumAge: GEO_MAX_AGE_MS }
    );
  };

  const confirm = () => saveLocation(pos, city);

  const clear = async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    saveReq.current += 1;
    setBusy(true);
    setError(null);
    try {
      await clearMyLocation();
      lastSaved.current = null;
      setNearby(null);
    } catch (err) {
      setError(errorText(err, 'Could not clear your location.'));
    } finally {
      setBusy(false);
    }
  };

  const pickIntent = async (intentId: string, name: string, owned: boolean) => {
    if (maxReached || selected.includes(name)) return;
    setError(null);
    if (owned) {
      onSelect(name);
      return;
    }
    setPendingId(intentId);
    try {
      await purchaseIntent(intentId, 'nearby', newIdempotencyKey());
      onSelect(name); // 'ok' and 'already_active' both count as success
    } catch (err) {
      setError(errorText(err, 'Could not add that intent.'));
    } finally {
      setPendingId(null);
    }
  };

  const mapCard = (
    <div
      className={`nbm-card nbm-pop${mapSlot ? ' nbm-pop--docked' : ''}${mapLeaving ? ' is-leaving' : ''}`}
      onAnimationEnd={(e) => {
        if (e.animationName === 'nbm-pop-out') {
          setMapOpen(false);
          setMapLeaving(false);
        }
      }}
    >
      <MapContainer
        ref={setMap}
        center={[FALLBACK_CENTER.lat, FALLBACK_CENTER.lng]}
        zoom={FALLBACK_ZOOM}
        className="nbm-map"
        zoomControl={false}
        worldCopyJump
      >
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} maxZoom={19} />
        <ZoomControl position="bottomright" />
        <Marker position={[pos.lat, pos.lng]} icon={pinIcon} draggable autoPan eventHandlers={markerHandlers} />
      </MapContainer>
      <div className="nbm-pop-head">
        <span className="nbm-pop-title">Drag the pin to your spot</span>
        <button type="button" className="nbm-pop-close" aria-label="Hide map" onClick={() => setMapLeaving(true)}>
          ×
        </button>
      </div>
      {geoMsg && <div className="nbm-geo-msg" role="status">{geoMsg}</div>}
    </div>
  );

  return (
    <div className="nbm-wrap">
      <div className="nbm-search nbm-search--inline">
        <div className="nbm-search-row">
          <div className="nbm-search-field">
            <svg className="nbm-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              className="nbm-search-input"
              placeholder="Search a place or address"
              aria-label="Search a place or address"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button
            type="button"
            className={`nbm-locate${locating ? ' is-busy' : ''}`}
            onClick={locateMe}
            disabled={locating}
            aria-label={locating ? 'Finding your location' : 'Use current location'}
            title="Use current location"
          >
            {locating ? <span className="nbm-spinner" aria-hidden="true" /> : <LocateGlyph />}
          </button>
          {!mapOpen && (
            <button type="button" className="nbm-btn nbm-showmap" onClick={() => setMapOpen(true)}>
              Show map
            </button>
          )}
        </div>
        {(results.length > 0 || searchErr) && (
          <ul className="nbm-results" role="listbox">
            {results.map((r, i) => (
              <li key={`${r.lat},${r.lng},${i}`}>
                <button type="button" className="nbm-result" onClick={() => pickResult(r)}>
                  {r.label}
                </button>
              </li>
            ))}
            {searchErr && results.length === 0 && <li className="nbm-result-empty">{searchErr}</li>}
          </ul>
        )}
      </div>

      {mapOpen && (mapSlot ? createPortal(mapCard, mapSlot) : mapCard)}

      <div className="nbm-footer">
        <div className="nbm-bar">
          <div className="nbm-label" title={label}>
            {label || 'Drag the pin or search to choose a spot'}
          </div>
          <div className="nbm-actions">
            <button type="button" className="nbm-btn nbm-btn-primary" onClick={confirm} disabled={busy}>
              {busy ? 'Saving…' : 'Save location'}
            </button>
            <button type="button" className="nbm-btn" onClick={clear} disabled={busy}>
              Clear location
            </button>
          </div>
        </div>
        {error && <p className="nbm-error" role="alert">{error}</p>}

        {nearby?.status === 'no_location' && (
          <p className="nbm-note">Save a location to see who is nearby.</p>
        )}
        {nearby?.status === 'nobody' && (
          <p className="nbm-note">Nobody nearby yet. Check back soon.</p>
        )}
        {nearby?.status === 'ok' && (
          <div className="nbm-nearby">
            <p className="nbm-note">
              Near you: {nearby.user.city || nearby.user.distance || 'close by'}
            </p>
            <PagedList
              className="nbm-paged"
              items={nearby.intents}
              label="intents near you"
              getKey={(it) => it.id}
              renderItem={(it) => {
                const isSelected = selected.includes(it.name);
                return (
                  <button
                    type="button"
                    className={`nbm-chip${isSelected ? ' is-selected' : ''}`}
                    disabled={maxReached || isSelected || pendingId !== null}
                    onClick={() => pickIntent(it.id, it.name, Boolean(it.owned))}
                  >
                    <span className="nbm-chip-name">{it.name}</span>
                    <span className="nbm-chip-count">{compactCount(it.usage_count)}</span>
                    {!it.owned && <span className="nbm-chip-price">{NEARBY_PRICE}</span>}
                  </button>
                );
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

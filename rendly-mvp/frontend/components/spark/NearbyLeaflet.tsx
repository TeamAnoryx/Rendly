'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, TileLayer } from 'react-leaflet';
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
const SEARCH_DEBOUNCE_MS = 600;
const SEARCH_MIN_CHARS = 3;
const SEARCH_MAX_RESULTS = 5;
const NEARBY_PRICE = 10;

const TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_ATTRIBUTION = '&copy; OpenStreetMap contributors &copy; CARTO';

const pinIcon = L.divIcon({
  className: 'nbm-pin',
  html: '<span class="nbm-pin-bob"><span class="nbm-pin-ring"></span><span class="nbm-pin-dot"></span></span>',
  iconSize: [36, 36],
  iconAnchor: [18, 18],
});

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function locationErrorText(err: unknown): string {
  const msg = errorText(err, 'Could not save your location.');
  if (/too[_\s-]?soon|10 ?min|minute/i.test(msg)) {
    return 'You can only update your location once every 10 minutes. Please try again shortly.';
  }
  return msg;
}

export default function NearbyLeaflet({ selected, onSelect, maxReached }: Props) {
  const [map, setMap] = useState<L.Map | null>(null);
  const [pos, setPos] = useState<LatLng>(FALLBACK_CENTER);
  const [label, setLabel] = useState('');
  const [city, setCity] = useState<string | null>(null);
  const [geoMsg, setGeoMsg] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeoSearchResult[]>([]);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const searchReq = useRef(0);
  const reverseReq = useRef(0);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nearby, setNearby] = useState<NearbyResult | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const lookup = useCallback(async (p: LatLng) => {
    const id = ++reverseReq.current;
    try {
      const r = await reverseGeocode(p.lat, p.lng);
      if (id !== reverseReq.current) return;
      setLabel(r.label || 'Pinned location');
      setCity(r.city);
    } catch (err) {
      if (id !== reverseReq.current) return;
      setLabel('Pinned location');
      setCity(null);
      setError(errorText(err, 'Could not look up that location.'));
    }
  }, []);

  // Initial center from the browser; fall back to a world view.
  useEffect(() => {
    if (!map) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoMsg('Location is unavailable in this browser. Search for a place instead.');
      return;
    }
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (gp) => {
        if (cancelled) return;
        const p = { lat: gp.coords.latitude, lng: gp.coords.longitude };
        setPos(p);
        map.setView([p.lat, p.lng], LOCATED_ZOOM);
        void lookup(p);
      },
      () => {
        if (cancelled) return;
        setGeoMsg('We could not get your location. Search for a place or drag the pin.');
        map.setView([FALLBACK_CENTER.lat, FALLBACK_CENTER.lng], FALLBACK_ZOOM);
      },
      { timeout: GEO_TIMEOUT_MS }
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
    searchReq.current += 1;
    reverseReq.current += 1;
    const p = { lat: r.lat, lng: r.lng };
    setPos(p);
    setLabel(r.label);
    setCity(r.city);
    setResults([]);
    setQuery('');
    setGeoMsg(null);
    map?.flyTo([p.lat, p.lng], LOCATED_ZOOM);
  };

  const markerHandlers = useMemo(
    () => ({
      dragend: (e: L.LeafletEvent) => {
        const ll = (e.target as L.Marker).getLatLng();
        const p = { lat: ll.lat, lng: ll.lng };
        setPos(p);
        setLabel('Looking up…');
        void lookup(p);
      },
    }),
    [lookup]
  );

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await setMyLocation({ lat: pos.lat, lng: pos.lng, city });
    } catch (err) {
      setError(locationErrorText(err));
      setBusy(false);
      return;
    }
    try {
      setNearby(await getNearbyIntents());
    } catch (err) {
      setError(errorText(err, 'Could not load people near you.'));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    setError(null);
    try {
      await clearMyLocation();
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

  return (
    <div className="nbm-wrap">
      <div className="nbm-card">
        <MapContainer
          ref={setMap}
          center={[FALLBACK_CENTER.lat, FALLBACK_CENTER.lng]}
          zoom={FALLBACK_ZOOM}
          className="nbm-map"
          worldCopyJump
        >
          <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} maxZoom={19} />
          <Marker position={[pos.lat, pos.lng]} icon={pinIcon} draggable eventHandlers={markerHandlers} />
        </MapContainer>

        <div className="nbm-search">
          <input
            type="search"
            className="nbm-search-input"
            placeholder="Search a place or address"
            aria-label="Search a place or address"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
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

        {geoMsg && <div className="nbm-geo-msg" role="status">{geoMsg}</div>}
      </div>

      <div className="nbm-footer">
        <div className="nbm-bar">
          <div className="nbm-label" title={label}>
            {label || 'Drag the pin or search to choose a spot'}
          </div>
          <div className="nbm-actions">
            <button type="button" className="nbm-btn nbm-btn-primary" onClick={confirm} disabled={busy}>
              {busy ? 'Saving…' : 'Confirm location'}
            </button>
            <button type="button" className="nbm-btn" onClick={clear} disabled={busy}>
              Clear location
            </button>
          </div>
        </div>
        {error && <p className="nbm-error" role="alert">{error}</p>}

        {nearby?.status === 'no_location' && (
          <p className="nbm-note">Confirm a location to see who is nearby.</p>
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

'use client';

/** World map of visitor cities: one glowing circle per city, sized by visitors. */
import 'leaflet/dist/leaflet.css';
import { CircleMarker, MapContainer, TileLayer, Tooltip } from 'react-leaflet';

export interface CityPoint {
  key: string;
  country: string | null;
  count: number;
  lat: number | null;
  lon: number | null;
}

const TILE_URL =
  process.env.NEXT_PUBLIC_MAP_TILE_URL || 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_ATTRIBUTION =
  process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION || '&copy; OpenStreetMap contributors &copy; CARTO';

export default function CityMap({ cities }: { cities: CityPoint[] }) {
  const located = cities.filter((c): c is CityPoint & { lat: number; lon: number } => c.lat !== null && c.lon !== null);
  const max = Math.max(1, ...located.map((c) => c.count));
  return (
    <div className="cm-wrap">
      <MapContainer center={[20, 10]} zoom={2} minZoom={1} scrollWheelZoom={false} worldCopyJump className="cm-map">
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
        {located.map((c) => (
          <CircleMarker
            key={`${c.key}-${c.country}`}
            center={[c.lat, c.lon]}
            radius={5 + Math.sqrt(c.count / max) * 16}
            pathOptions={{ color: '#b78bff', weight: 1.5, fillColor: '#8ea2ff', fillOpacity: 0.45 }}
          >
            <Tooltip direction="top">
              {c.key}
              {c.country ? `, ${c.country}` : ''}: {c.count.toLocaleString('en-GB')} visitors
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
      {located.length === 0 && (
        <p className="cm-empty">No located visitors yet. Cities appear once the site runs behind its CDN (Vercel / Cloudflare), which supplies the location.</p>
      )}
    </div>
  );
}

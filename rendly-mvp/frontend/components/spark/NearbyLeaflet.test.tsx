import '@testing-library/jest-dom';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';

type Handlers = Record<string, (e?: unknown) => unknown>;
const leafletState: { handlers: Handlers; map: Record<string, jest.Mock> | null } = { handlers: {}, map: null };

jest.mock('leaflet/dist/leaflet.css', () => ({}));
jest.mock('leaflet', () => ({ __esModule: true, default: { divIcon: () => ({}) } }));
jest.mock('react-leaflet', () => {
  const R = jest.requireActual('react') as typeof React;
  const MapContainer = R.forwardRef<unknown, { children?: React.ReactNode }>(function MapContainer(
    { children },
    ref
  ) {
    R.useEffect(() => {
      const map = {
        setView: jest.fn(),
        flyTo: jest.fn(),
        invalidateSize: jest.fn(),
        getContainer: jest.fn(() => document.createElement('div')),
      };
      leafletState.map = map;
      if (typeof ref === 'function') ref(map);
    }, [ref]);
    return R.createElement('div', { 'data-testid': 'map' }, children);
  });
  return {
    MapContainer,
    TileLayer: () => null,
    ZoomControl: () => null,
    Marker: ({ eventHandlers }: { eventHandlers: Handlers }) => {
      leafletState.handlers = eventHandlers;
      return R.createElement('div', { 'data-testid': 'marker' });
    },
  };
});

jest.mock('@/services/geoApi', () => ({
  reverseGeocode: jest.fn(),
  searchAddress: jest.fn(),
}));
jest.mock('@/services/intentsApi', () => ({
  clearMyLocation: jest.fn(),
  getNearbyIntents: jest.fn(),
  purchaseIntent: jest.fn(),
  setMyLocation: jest.fn(),
}));
jest.mock('@/services/pointsApi', () => ({ newIdempotencyKey: () => 'key' }));

import NearbyLeaflet, { GEO_DENIED_MESSAGE, SAVE_DEBOUNCE_MS, THROTTLE_MESSAGE } from './NearbyLeaflet';
import { reverseGeocode } from '@/services/geoApi';
import { getNearbyIntents, setMyLocation } from '@/services/intentsApi';

const mockReverse = reverseGeocode as jest.Mock;
const mockSave = setMyLocation as jest.Mock;
const mockNearby = getNearbyIntents as jest.Mock;

type GeoSuccess = (p: { coords: { latitude: number; longitude: number } }) => void;
type GeoError = (e: { code: number }) => void;
const getCurrentPosition = jest.fn();

function renderMap() {
  return render(<NearbyLeaflet selected={[]} onSelect={jest.fn()} maxReached={false} />);
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  leafletState.handlers = {};
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  Object.defineProperty(navigator, 'geolocation', {
    value: { getCurrentPosition },
    configurable: true,
  });
  // Initial auto-locate: never resolves unless a test drives it.
  getCurrentPosition.mockImplementation(() => undefined);
  mockReverse.mockResolvedValue({ label: 'Lisbon, Portugal', city: 'Lisbon', country: 'Portugal' });
  mockSave.mockResolvedValue(undefined);
  mockNearby.mockResolvedValue({ status: 'nobody' });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('NearbyLeaflet', () => {
  it('saves the browser position when "Use current location" is pressed', async () => {
    renderMap();
    getCurrentPosition.mockImplementation((ok: GeoSuccess) =>
      ok({ coords: { latitude: 38.72, longitude: -9.14 } })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Use current location' }));
    await flush();

    const opts = getCurrentPosition.mock.calls.at(-1)?.[2];
    expect(opts).toMatchObject({ enableHighAccuracy: true, maximumAge: 60000 });
    expect(mockReverse).toHaveBeenCalledWith(38.72, -9.14);
    expect(mockSave).toHaveBeenCalledWith({ lat: 38.72, lng: -9.14, city: 'Lisbon' });
    expect(mockNearby).toHaveBeenCalled();
  });

  it('reverse-geocodes then saves (debounced) after the pin is dragged', async () => {
    jest.useFakeTimers();
    renderMap();
    await flush();

    await act(async () => {
      await leafletState.handlers.dragend({ target: { getLatLng: () => ({ lat: 51.5, lng: -0.12 }) } });
    });
    expect(mockReverse).toHaveBeenCalledWith(51.5, -0.12);
    expect(mockSave).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    });
    await flush();
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenCalledWith({ lat: 51.5, lng: -0.12, city: 'Lisbon' });
  });

  it('collapses a burst of drags into one save', async () => {
    jest.useFakeTimers();
    renderMap();
    await flush();

    for (const lat of [10, 11, 12]) {
      await act(async () => {
        await leafletState.handlers.dragend({ target: { getLatLng: () => ({ lat, lng: 5 }) } });
      });
    }
    await act(async () => {
      jest.advanceTimersByTime(SAVE_DEBOUNCE_MS);
    });
    await flush();
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenCalledWith({ lat: 12, lng: 5, city: 'Lisbon' });
  });

  it('shows the throttle message and keeps the pin when the server says too soon', async () => {
    mockSave.mockRejectedValue(new Error('You can update your location once every 10 minutes'));
    renderMap();

    fireEvent.click(screen.getByRole('button', { name: 'Save location' }));
    await flush();

    expect(await screen.findByRole('alert')).toHaveTextContent(THROTTLE_MESSAGE);
    expect(mockNearby).not.toHaveBeenCalled();
  });

  it('explains when the browser denies location access', async () => {
    renderMap();
    getCurrentPosition.mockImplementation((_ok: GeoSuccess, fail: GeoError) => fail({ code: 1 }));

    fireEvent.click(screen.getByRole('button', { name: 'Use current location' }));
    await flush();

    expect(screen.getByRole('status')).toHaveTextContent(GEO_DENIED_MESSAGE);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('does not let the initial auto-locate override a pin the user moved', async () => {
    let initialOk: GeoSuccess | null = null;
    getCurrentPosition.mockImplementation((ok: GeoSuccess) => {
      if (!initialOk) initialOk = ok;
    });
    renderMap();
    await flush();

    await act(async () => {
      await leafletState.handlers.dragend({ target: { getLatLng: () => ({ lat: 1, lng: 2 }) } });
    });
    await act(async () => {
      initialOk?.({ coords: { latitude: 40, longitude: 40 } });
    });
    expect(leafletState.map?.setView).not.toHaveBeenCalledWith([40, 40], expect.any(Number));
  });
});

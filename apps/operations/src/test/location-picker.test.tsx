import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error - mapInstances exists only on the test stand-in (test/setup.ts).
import { mapInstances } from 'maplibre-gl';
import { DEFAULT_CENTER, LocationPickerMap, roundCoord } from '../components/LocationPickerMap';
import type { LatLng } from '../lib/route';

/** The picker plus the two number fields, as the clinic form wires them. */
function Harness({ start = null }: { start?: LatLng | null }) {
  const [value, setValue] = useState<LatLng | null>(start);
  return (
    <>
      <LocationPickerMap value={value} onChange={setValue} label="Hospital location" />
      <output data-testid="coords">{value ? `${value.lat},${value.lng}` : 'none'}</output>
      <button type="button" onClick={() => setValue({ lat: 6.9, lng: 79.9 })}>
        type
      </button>
    </>
  );
}

describe('LocationPickerMap (set a hospital on the map)', () => {
  afterEach(() => {
    mapInstances.length = 0;
    vi.unstubAllGlobals();
  });

  it('opens on Dharga Town when nothing is set yet, with no pin', () => {
    render(<Harness />);
    const map = mapInstances[0];
    expect(map.options.center).toEqual([DEFAULT_CENTER.lng, DEFAULT_CENTER.lat]);
    expect(map.markers).toHaveLength(0);
    expect(screen.getByTestId('coords')).toHaveTextContent('none');
  });

  it('tapping the map sets the exact coordinates and drops a draggable pin', () => {
    render(<Harness />);
    const map = mapInstances[0];
    act(() => map.handlers.click({ lngLat: { lat: 6.46581234567, lng: 80.07161234567 } }));
    expect(screen.getByTestId('coords')).toHaveTextContent('6.465812,80.071612');
    expect(map.markers[0].lngLat).toEqual([80.071612, 6.465812]);
    expect(map.markers[0].options).toMatchObject({ draggable: true });
  });

  it('dragging the pin updates the coordinates', () => {
    render(<Harness start={{ lat: 6.4, lng: 80.0 }} />);
    const pin = mapInstances[0].markers[0];
    act(() => {
      pin.setLngLat([80.05, 6.41]);
      pin.markerHandlers.dragend();
    });
    expect(screen.getByTestId('coords')).toHaveTextContent('6.41,80.05');
  });

  it('typed coordinates move the pin and the view', async () => {
    render(<Harness start={{ lat: 6.4, lng: 80.0 }} />);
    await userEvent.click(screen.getByRole('button', { name: 'type' }));
    const map = mapInstances[0];
    expect(map.markers[0].lngLat).toEqual([79.9, 6.9]);
    expect(map.centre).toEqual([79.9, 6.9]);
  });

  it('"Use my current location" uses the device GPS', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: {
        getCurrentPosition: (ok: (p: GeolocationPosition) => void) =>
          ok({ coords: { latitude: 6.405501, longitude: 80.05236 } } as GeolocationPosition),
      },
    });
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Use my current location' }));
    expect(screen.getByTestId('coords')).toHaveTextContent('6.405501,80.05236');
  });

  it('rounds to 6 decimals (about 10 cm)', () => {
    expect(roundCoord(6.12345678)).toBe(6.123457);
  });
});

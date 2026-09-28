import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MAP_STYLE_URL, toLatLng, type LatLng } from '../lib/route';

/**
 * Set a place's exact location on a map (2026-09-28) - hospitals and clinics
 * first. Typing latitude/longitude by hand put pins in the wrong place; here
 * the operator taps the map or drags the pin, or uses the device's own GPS,
 * and the coordinates follow. Free and open source: MapLibre + OpenFreeMap,
 * worldwide, no key.
 *
 * Controlled: `value` is the current coordinate (or null), `onChange` gets
 * the new one, rounded to 6 decimals (about 10 cm) - the same precision the
 * number fields show.
 */

/** Where the map opens when nothing is set yet: Dharga Town. */
export const DEFAULT_CENTER: LatLng = { lat: 6.4382, lng: 80.0118 };

export function roundCoord(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export function LocationPickerMap({
  value,
  onChange,
  label = 'Location',
}: {
  value: LatLng | null;
  onChange(next: LatLng): void;
  label?: string;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [mapFailed, setMapFailed] = useState(false);
  const [locating, setLocating] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  function place(point: LatLng, report: boolean) {
    const next = { lat: roundCoord(point.lat), lng: roundCoord(point.lng) };
    const m = map.current;
    if (m) {
      if (!marker.current) {
        marker.current = new maplibregl.Marker({ color: '#0c831f', draggable: true })
          .setLngLat([next.lng, next.lat])
          .addTo(m);
        marker.current.on('dragend', () => {
          const ll = marker.current!.getLngLat();
          place({ lat: ll.lat, lng: ll.lng }, true);
        });
      } else {
        marker.current.setLngLat([next.lng, next.lat]);
      }
    }
    if (report) onChangeRef.current(next);
  }

  // The map, once.
  useEffect(() => {
    if (!container.current) return;
    let m: maplibregl.Map;
    const start = value ?? DEFAULT_CENTER;
    try {
      m = new maplibregl.Map({
        container: container.current,
        style: MAP_STYLE_URL,
        center: [start.lng, start.lat],
        zoom: value ? 16 : 13,
        attributionControl: { compact: true },
      });
    } catch {
      setMapFailed(true);
      return;
    }
    map.current = m;
    m.on('click', (e: { lngLat: { lat: number; lng: number } }) => place(e.lngLat, true));
    if (value) place(value, false);
    return () => {
      m.remove();
      map.current = null;
      marker.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Typed coordinates move the pin (and the view) too.
  useEffect(() => {
    if (!value || !map.current) return;
    const at = marker.current?.getLngLat();
    if (at && roundCoord(at.lat) === value.lat && roundCoord(at.lng) === value.lng) return;
    place(value, false);
    map.current.easeTo({ center: [value.lng, value.lat] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.lat, value?.lng]);

  function useMyLocation() {
    if (!('geolocation' in navigator)) {
      setGpsError('This device cannot share its location.');
      return;
    }
    setLocating(true);
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        place(here, true);
        map.current?.easeTo({ center: [here.lng, here.lat], zoom: 17 });
      },
      () => {
        setLocating(false);
        setGpsError('Could not get your location. Tap the map instead.');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  if (mapFailed) {
    return <p className="field__hint">The map can't be shown here. Type the latitude and longitude instead.</p>;
  }

  return (
    <div className="location-picker">
      <div
        ref={container}
        className="location-picker__canvas"
        role="application"
        aria-label={`${label}: tap the map or drag the pin to set the exact spot`}
        data-testid="location-picker-map"
      />
      <div className="location-picker__bar">
        <span className="field__hint">Tap the map or drag the pin to the exact entrance.</span>
        <button type="button" className="button button--ghost" onClick={useMyLocation} disabled={locating}>
          {locating ? 'Locating…' : 'Use my current location'}
        </button>
      </div>
      {gpsError ? <p className="field__error">{gpsError}</p> : null}
    </div>
  );
}

/** A read-only map with one pin, for detail pages. */
export function LocationPreviewMap({ latitude, longitude, label }: { latitude: unknown; longitude: unknown; label?: string }) {
  const container = useRef<HTMLDivElement | null>(null);
  const point = toLatLng(latitude, longitude);
  const [mapFailed, setMapFailed] = useState(false);

  useEffect(() => {
    if (!container.current || !point) return;
    let m: maplibregl.Map;
    try {
      m = new maplibregl.Map({
        container: container.current,
        style: MAP_STYLE_URL,
        center: [point.lng, point.lat],
        zoom: 16,
        interactive: true,
        attributionControl: { compact: true },
      });
    } catch {
      setMapFailed(true);
      return;
    }
    new maplibregl.Marker({ color: '#0c831f' }).setLngLat([point.lng, point.lat]).addTo(m);
    return () => m.remove();
  }, [point?.lat, point?.lng]);

  if (!point || mapFailed) {
    return (
      <div className="clinic-map clinic-map--unavailable" role="img" aria-label="Map unavailable">
        <p className="empty__title">Map unavailable</p>
      </div>
    );
  }
  return (
    <div
      ref={container}
      className="location-picker__canvas"
      role="img"
      aria-label={label ? `Map showing ${label}'s location` : 'Map showing the location'}
    />
  );
}

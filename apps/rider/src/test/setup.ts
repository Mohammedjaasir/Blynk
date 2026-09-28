import '@testing-library/jest-dom/vitest';

/**
 * maplibre-gl needs WebGL and Blob URLs, which jsdom has neither of. Every
 * test gets this stand-in; DeliveryMap's own test inspects what was asked of
 * it (centre, markers, route data) through `mapInstances`.
 */
import { vi } from 'vitest';
vi.mock('maplibre-gl', () => {
  class FakeMarker {
    lngLat: [number, number] | null = null;
    options: unknown;
    constructor(options?: unknown) {
      this.options = options;
    }
    setLngLat(ll: [number, number]) {
      this.lngLat = ll;
      return this;
    }
    addTo() {
      return this;
    }
  }
  const mapInstances: FakeMap[] = [];
  class FakeMap {
    options: { center: [number, number] };
    sources: Record<string, { data: unknown; setData(d: unknown): void }> = {};
    handlers: Record<string, () => void> = {};
    fitted: unknown = null;
    constructor(options: { center: [number, number] }) {
      this.options = options;
      mapInstances.push(this);
    }
    on(event: string, handler: () => void) {
      this.handlers[event] = handler;
    }
    addSource(id: string, spec: { data: unknown }) {
      const source = { data: spec.data, setData(d: unknown) { source.data = d; } };
      this.sources[id] = source;
    }
    addLayer() {}
    getSource(id: string) {
      return this.sources[id];
    }
    fitBounds(bounds: unknown) {
      this.fitted = bounds;
    }
    remove() {}
  }
  return { default: { Map: FakeMap, Marker: FakeMarker }, mapInstances };
});

/**
 * The welcome screen (pages/Welcome.tsx) opens on every launch. Existing
 * tests are about what comes after it, so each starts past it; welcome.test
 * resets it to test the welcome screen itself.
 */
import { beforeEach } from 'vitest';
import { markIntroSeen } from '../pages/Welcome';
beforeEach(() => {
  markIntroSeen();
});

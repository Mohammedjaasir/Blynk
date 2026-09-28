import '@testing-library/jest-dom/vitest';

/**
 * Every test stubs `fetch` per test via `vi.stubGlobal`/`vi.unstubAllGlobals()`
 * (test/helpers.tsx's `mockApi`). `unstubAllGlobals()` restores whatever
 * `fetch` was before the FIRST stub in a file - in this Node-based jsdom
 * environment that is Node's own built-in `fetch`, which can reach a real
 * server if one happens to be running on localhost (common.md: "a backend
 * dev server may or may not be running... never assume one is available").
 * A component with several parallel in-flight requests that haven't all
 * settled by the time a test's own assertions resolve (e.g. Home's summary
 * fetch, F2) can leak an unmocked request into the brief gap between one
 * test's cleanup and the next test's stub - if a real dev server is running,
 * that stray request gets a genuine response (observed: a real 401 for the
 * fake test bearer token), which cascades into a spurious session-end
 * unrelated to whatever the next test was actually checking. Overwriting the
 * *pre-stub* `fetch` here, once per test file before any test/stub runs,
 * means `unstubAllGlobals()` always restores to this safe no-op instead -
 * nothing a test does can ever reach a real network.
 */
if (typeof globalThis.fetch === 'function') {
  globalThis.fetch = (() =>
    Promise.reject(
      new Error('fetch was called without a test mock in place - see src/test/helpers.tsx´s mockApi')
    )) as typeof fetch;
}

/**
 * jsdom does not implement `Element.scrollIntoView` (task F3's Orders board
 * calls it for the deep-link-from-Home "scroll to lane" nice-to-have) -
 * without a stub, calling it throws inside a component effect. A harmless
 * no-op here, once for the whole suite, rather than re-stubbing it per test.
 */
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

/**
 * jsdom does not implement `URL.createObjectURL`/`revokeObjectURL` (task F5's
 * `ImageUploader` calls both to show a picked file immediately, before the
 * upload resolves) - the same class of harmless, additive test-harness stub
 * as the `scrollIntoView` one above, not a source change.
 */
if (typeof URL !== 'undefined' && typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = () => 'blob:mock';
  URL.revokeObjectURL = () => {};
}

/**
 * The welcome screen (pages/Welcome.tsx) opens on every launch. Every
 * existing test is about what happens after it, so each test starts as a
 * launch that has already passed it; welcome.test and routing.test reset it
 * to test the welcome screen itself.
 */
import { beforeEach } from 'vitest';
import { markIntroSeen } from '../pages/Welcome';
beforeEach(() => {
  markIntroSeen();
});
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
    markerHandlers: Record<string, () => void> = {};
    setLngLat(ll: [number, number]) {
      this.lngLat = ll;
      return this;
    }
    getLngLat() {
      return { lng: this.lngLat![0], lat: this.lngLat![1] };
    }
    addTo(map?: FakeMap) {
      map?.markers.push(this);
      return this;
    }
    on(event: string, handler: () => void) {
      this.markerHandlers[event] = handler;
      return this;
    }
  }
  const mapInstances: FakeMap[] = [];
  class FakeMap {
    options: { center: [number, number] };
    sources: Record<string, { data: unknown; setData(d: unknown): void }> = {};
    handlers: Record<string, (e?: unknown) => void> = {};
    markers: FakeMarker[] = [];
    fitted: unknown = null;
    centre: unknown = null;
    constructor(options: { center: [number, number] }) {
      this.options = options;
      mapInstances.push(this);
    }
    on(event: string, handler: (e?: unknown) => void) {
      this.handlers[event] = handler;
    }
    easeTo(options: { center: unknown }) {
      this.centre = options.center;
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

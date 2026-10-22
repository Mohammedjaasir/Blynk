import { insideCoverage, pinForArea, validLatLng, type Coverage, type PlaceAt } from './coverage';
import type { LatLng } from './places';

/*
 * The steps of adding a delivery address (owner, 2026-10-14):
 *   area  - the delivery-area map first, with three ways on: use my location (GPS), drag the
 *           pin to my house (the map opens at the store, no GPS needed), or choose my area;
 *   list  - the area list (in-radius areas; the ones outside say so);
 *   map   - the map picker with the fixed centre pin (at the GPS fix, the store, or the area's centre);
 *   form  - house / street / landmark and the recipient.
 * A denied or unavailable location never blocks: the area step stays with a note and the
 * other two ways. Pure state, so the screen and the tests share it.
 */

export type Step = 'area' | 'list' | 'map' | 'form';
export type GpsFailure = 'denied' | 'unavailable' | 'timeout' | 'unsupported';
export type Note = GpsFailure | 'outsideFix' | 'drag' | 'areaPicked' | null;

export type FlowState = {
  step: Step;
  /** Waiting for the browser's location answer. */
  asking: boolean;
  note: Note;
  /** Where the map opens / moves to; bumped `startKey` makes the open map move there. */
  start: LatLng;
  startKey: number;
  /** The area picked from the list (its name becomes the address's city). */
  area: PlaceAt | null;
  /** Editing a saved address: the area step and list are skipped. */
  editing: boolean;
  /** The map opens at a spot we made up (the store, an area's middle), not at a GPS fix: the customer must move it. */
  fresh: boolean;
};

export type FlowEvent =
  | { type: 'useGps' }
  | { type: 'gpsOk'; fix: LatLng; coverage: Coverage }
  | { type: 'gpsFail'; reason: GpsFailure }
  | { type: 'dragPin'; coverage: Coverage }
  | { type: 'openList' }
  | { type: 'pickArea'; area: PlaceAt }
  | { type: 'confirmPin' }
  | { type: 'back' };

/** GeolocationPositionError codes: 1 denied, 2 unavailable, 3 timeout; anything else (no API) = unsupported. */
export function gpsFailureOf(e: unknown): GpsFailure {
  const code = (e as { code?: unknown } | null)?.code;
  if (code === 1) return 'denied';
  if (code === 2) return 'unavailable';
  if (code === 3) return 'timeout';
  return 'unsupported';
}

/**
 * Where the screen starts, from its route params:
 *   editing           -> the map at the saved address;
 *   a GPS fix inside  -> the map at the fix (the customer already chose GPS);
 *   a GPS fix outside -> the area map first, saying the spot is outside;
 *   gps=off           -> the area map first, with the "location is off, no problem" note;
 *   otherwise         -> the area map first.
 */
export function initialFlow(args: {
  coverage: Coverage; fix?: LatLng | null; gpsOff?: boolean;
  /** Editing a saved address (its pin may still be loading: then the store centre until it arrives). */
  edit?: boolean; editing?: LatLng | null;
}): FlowState {
  const base = { asking: false, startKey: 0, area: null, editing: false, fresh: true };
  if (args.edit) {
    return { ...base, step: 'map', note: null, start: args.editing && validLatLng(args.editing) ? args.editing : args.coverage.center, editing: true };
  }
  if (args.fix && validLatLng(args.fix)) {
    const inside = insideCoverage(args.coverage, args.fix).inside;
    return inside
      ? { ...base, step: 'map', note: null, start: args.fix, fresh: false }
      : { ...base, step: 'area', note: 'outsideFix', start: args.fix };
  }
  return { ...base, step: 'area', note: args.gpsOff ? 'denied' : null, start: args.coverage.center };
}

export function flowReducer(s: FlowState, e: FlowEvent): FlowState {
  switch (e.type) {
    case 'useGps':
      return s.asking ? s : { ...s, asking: true, note: null };
    case 'gpsOk':
      // a fix outside the circle still opens the map there: the card says it is outside
      return { ...s, asking: false, step: 'map', note: null, start: e.fix, startKey: s.startKey + 1, area: null, fresh: false };
    case 'gpsFail':
      // denied / unavailable: stay (or go back) to the area map with the two GPS-free ways
      return { ...s, asking: false, step: s.step === 'map' ? 'map' : 'area', note: e.reason };
    case 'dragPin':
      return { ...s, step: 'map', note: 'drag', start: e.coverage.center, startKey: s.startKey + 1, area: null, fresh: true };
    case 'openList':
      return { ...s, step: 'list', note: s.note === 'outsideFix' ? null : s.note };
    case 'pickArea':
      if (!e.area.inside) return s;
      return { ...s, step: 'map', note: 'areaPicked', start: pinForArea(e.area), startKey: s.startKey + 1, area: e.area, fresh: true };
    case 'confirmPin':
      return s.step === 'map' ? { ...s, step: 'form' } : s;
    case 'back':
      if (s.step === 'form') return { ...s, step: 'map' };
      if (s.step === 'map' && !s.editing) return { ...s, step: s.area ? 'list' : 'area', note: null };
      if (s.step === 'list') return { ...s, step: 'area' };
      return s;
  }
}

/** Leaving the screen instead of going back a step. */
export const leavesScreen = (s: FlowState) => s.step === 'area' || (s.step === 'map' && s.editing);

/** The address's city: the picked area, else the store's town. */
export const cityFor = (s: Pick<FlowState, 'area'>, town: string) => s.area?.name ?? town;

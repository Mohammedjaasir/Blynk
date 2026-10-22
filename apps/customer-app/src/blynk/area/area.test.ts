import { describe, expect, test } from 'vitest';
import { AREA, noteText } from './copy';
import {
  centreName, circleRing, coverageOf, deliveryAreas, edgePoint, frameFor, inFrame, insideCoverage, kmBetween, kmText,
  areaChoices, areaOfPin, isDefaultPin, nearestPlace, pinForArea, placesAround, project, radiusText,
} from './coverage';
import { cityFor, flowReducer, gpsFailureOf, initialFlow, leavesScreen, type FlowState } from './flow';
import { CLOCK_TOWER } from './places';

const STORE = { radius_km: 4, store_location: { lat: 6.441313, lng: 80.011437 }, hub_name: 'Dharga Town Central Dark Store' };
const cov = coverageOf(STORE);
const byName = (name: string) => placesAround(cov).find((p) => p.name === name)!;

describe('coverage from GET /store', () => {
  test('uses the server centre and radius; landmark while at the Clock Tower', () => {
    expect(cov).toMatchObject({ radiusKm: 4, fromServer: true, landmark: 'Clock Tower', town: 'Dharga Town' });
    expect(centreName(cov)).toBe('Clock Tower, Dharga Town');
    expect(AREA.within(cov)).toBe('We deliver within 4 km of the Clock Tower, Dharga Town.');
    expect(radiusText(3.5)).toBe('3.5 km');
    expect(radiusText(4)).toBe('4 km');
  });

  test('falls back to the Clock Tower and 4 km until the store answers (or on an older server)', () => {
    const c = coverageOf(null);
    expect(c).toMatchObject({ center: CLOCK_TOWER, radiusKm: 4, fromServer: false });
    expect(coverageOf({ radius_km: null, hub_name: null }).fromServer).toBe(false);
    expect(coverageOf({ radius_km: 0, store_location: STORE.store_location, hub_name: null }).radiusKm).toBe(4);
  });

  test('a changed radius or a moved store changes what is inside, and drops the landmark', () => {
    const wide = coverageOf({ ...STORE, radius_km: 5.5 });
    expect(placesAround(wide).find((p) => p.name === 'Beruwala town')!.inside).toBe(true);
    const moved = coverageOf({ ...STORE, store_location: { lat: 6.4775, lng: 79.9850 }, hub_name: 'Beruwala Store' });
    expect(moved.landmark).toBeNull();
    expect(centreName(moved)).toBe('Beruwala');
  });
});

describe('the places on the owner\'s sketch', () => {
  test('distances from the Clock Tower (owner points) to within 0.1 km', () => {
    const want: Record<string, number> = {
      'Kande Vihara': 1.5, Aluthgama: 1.4, Kaluwamodara: 1.9, Bentota: 2.7, Moragalla: 3.0, 'Beruwala town': 4.9, Welipenna: 11,
    };
    for (const [name, km] of Object.entries(want)) expect(Math.abs(byName(name).km - km)).toBeLessThanOrEqual(km >= 10 ? 0.5 : 0.1);
  });

  test('inside: Kande Vihara, Aluthgama, Kaluwamodara, Bentota, Moragalla; outside: Beruwala town, Welipenna', () => {
    for (const n of ['Kande Vihara', 'Aluthgama', 'Kaluwamodara', 'Bentota', 'Moragalla']) expect(byName(n).inside).toBe(true);
    for (const n of ['Beruwala town', 'Welipenna']) expect(byName(n).inside).toBe(false);
  });

  test('kmText: one decimal under 10 km, whole km from 10', () => {
    expect(kmText(1.449)).toBe('1.4 km');
    expect(kmText(3)).toBe('3.0 km');
    expect(kmText(11.04)).toBe('11 km');
    expect(kmText(0.01)).toBe('0 km');
    expect(kmText(NaN)).toBe('');
  });
});

describe('area list and pin placement', () => {
  test('the store\'s town first, then in-radius areas nearest first; outside ones listed separately', () => {
    const { inside, outside } = deliveryAreas(cov);
    expect(inside.map((a) => a.name)).toEqual(['Dharga Town', 'Aluthgama', 'Kande Vihara', 'Kaluwamodara', 'Bentota', 'Moragalla']);
    expect(outside.map((a) => a.name)).toEqual(['Beruwala town', 'Welipenna']);
    expect(inside.every((a) => a.inside)).toBe(true);
  });

  test('picking an area puts the pin at its centre, which is inside the circle', () => {
    const a = byName('Bentota');
    const pin = pinForArea(a);
    expect(pin).toEqual({ lat: a.lat, lng: a.lng });
    expect(insideCoverage(cov, pin).inside).toBe(true);
  });

  test('insideCoverage is advisory and uses the same haversine as the server', () => {
    expect(insideCoverage(cov, cov.center)).toEqual({ inside: true, km: 0 });
    const welipenna = byName('Welipenna');
    expect(insideCoverage(cov, welipenna).inside).toBe(false);
    // 1 degree of latitude is about 111 km
    expect(kmBetween({ lat: 6, lng: 80 }, { lat: 7, lng: 80 })).toBeCloseTo(111.2, 0);
  });

  test('nearestPlace names a listed place within 1.2 km, else null', () => {
    expect(nearestPlace(cov, { lat: 6.4345, lng: 80.0003 })?.name).toBe('Aluthgama');
    expect(nearestPlace(cov, { lat: 6.5, lng: 80.2 })).toBeNull();
  });

  test('the map picker\'s circle ring is closed and every point is radius km from the centre', () => {
    const ring = circleRing(cov, 36);
    expect(ring).toHaveLength(37);
    expect(ring[0]).toEqual(ring[36]);
    for (const [lng, lat] of ring) expect(kmBetween(cov.center, { lat, lng })).toBeCloseTo(4, 3);
  });

  test('the drawing fits the circle, keeps the sea west, and puts Welipenna past the edge', () => {
    const f = frameFor(cov, 360, 360, 1.3);
    const c = project(cov, f, cov.center);
    expect(c).toEqual({ x: 180, y: 180 });
    expect(4 * f.pxPerKm * 2).toBeLessThanOrEqual(360);
    expect(project(cov, f, byName('Moragalla')).x).toBeLessThan(180);
    const w = project(cov, f, byName('Welipenna'));
    expect(inFrame(f, w)).toBe(false);
    const e = edgePoint(f, w, 14);
    expect(e.x).toBeCloseTo(346, 0);
    expect(inFrame(f, project(cov, f, byName('Beruwala town')))).toBe(true);
  });
});

describe('address flow when location access is denied', () => {
  const start = (over: Partial<Parameters<typeof initialFlow>[0]> = {}) => initialFlow({ coverage: cov, ...over });

  test('opens on the delivery-area map first; gps=off adds the "location is off" note', () => {
    expect(start()).toMatchObject({ step: 'area', note: null, start: cov.center });
    expect(start({ gpsOff: true })).toMatchObject({ step: 'area', note: 'denied' });
    expect(noteText('denied')).toMatch(/choose your house on the map/);
  });

  test('a GPS fix inside goes straight to the map; outside shows the area map first', () => {
    const inside = { lat: 6.4372, lng: 80.0378 };
    expect(start({ fix: inside })).toMatchObject({ step: 'map', start: inside });
    expect(start({ fix: { lat: 6.9271, lng: 79.8612 } })).toMatchObject({ step: 'area', note: 'outsideFix' });
    expect(start({ fix: { lat: NaN, lng: NaN } }).step).toBe('area');
  });

  test('editing skips the area map', () => {
    const at = { lat: 6.44, lng: 80.02 };
    expect(start({ edit: true, editing: at })).toMatchObject({ step: 'map', editing: true, start: at });
    expect(start({ edit: true, editing: null })).toMatchObject({ step: 'map', editing: true, start: cov.center });
  });

  test('a denied permission keeps the customer on the area map with the GPS-free ways', () => {
    let s = flowReducer(start(), { type: 'useGps' });
    expect(s.asking).toBe(true);
    expect(flowReducer(s, { type: 'useGps' })).toBe(s);
    s = flowReducer(s, { type: 'gpsFail', reason: gpsFailureOf({ code: 1 }) });
    expect(s).toMatchObject({ step: 'area', asking: false, note: 'denied' });
  });

  test('error codes: 1 denied, 2 unavailable, 3 timeout, no API unsupported', () => {
    expect(gpsFailureOf({ code: 1 })).toBe('denied');
    expect(gpsFailureOf({ code: 2 })).toBe('unavailable');
    expect(gpsFailureOf({ code: 3 })).toBe('timeout');
    expect(gpsFailureOf(new Error('unsupported'))).toBe('unsupported');
    expect(gpsFailureOf(null)).toBe('unsupported');
  });

  test('(b) drag the pin: the map opens at the store, no GPS needed', () => {
    const s = flowReducer(start({ gpsOff: true }), { type: 'dragPin', coverage: cov });
    expect(s).toMatchObject({ step: 'map', note: 'drag', start: cov.center, startKey: 1, area: null });
    expect(cityFor(s, 'Dharga Town')).toBe('Dharga Town');
  });

  test('(c) pick an area: the pin at its centre, the area becomes the city; outside areas cannot be picked', () => {
    let s = flowReducer(start({ gpsOff: true }), { type: 'openList' });
    expect(s.step).toBe('list');
    expect(flowReducer(s, { type: 'pickArea', area: byName('Welipenna') })).toBe(s);
    s = flowReducer(s, { type: 'pickArea', area: byName('Kaluwamodara') });
    expect(s).toMatchObject({ step: 'map', note: 'areaPicked', start: pinForArea(byName('Kaluwamodara')) });
    expect(cityFor(s, 'Dharga Town')).toBe('Kaluwamodara');
    expect(AREA.areaLine('Kaluwamodara')).toMatch(/middle of Kaluwamodara/);
  });

  test('back goes form -> map -> list (or area) -> area, and only the area step leaves the screen', () => {
    let s: FlowState = flowReducer(flowReducer(start(), { type: 'openList' }), { type: 'pickArea', area: byName('Aluthgama') });
    s = flowReducer(s, { type: 'confirmPin' });
    expect(s.step).toBe('form');
    s = flowReducer(s, { type: 'back' });
    expect(s.step).toBe('map');
    expect(leavesScreen(s)).toBe(false);
    s = flowReducer(s, { type: 'back' });
    expect(s.step).toBe('list');
    s = flowReducer(s, { type: 'back' });
    expect(s.step).toBe('area');
    expect(leavesScreen(s)).toBe(true);
    const drag = flowReducer(start(), { type: 'dragPin', coverage: cov });
    expect(flowReducer(drag, { type: 'back' }).step).toBe('area');
    expect(leavesScreen(start({ edit: true, editing: cov.center }))).toBe(true);
  });

  test('a GPS fix later in the flow opens the map there, even outside (the card warns; owner, 2026-10-16: no "Confirm & proceed" while it does)', () => {
    const far = { lat: 6.9271, lng: 79.8612 };
    const s = flowReducer(flowReducer(start(), { type: 'useGps' }), { type: 'gpsOk', fix: far, coverage: cov });
    expect(s).toMatchObject({ step: 'map', start: far, asking: false });
    expect(insideCoverage(cov, far).inside).toBe(false);
    expect(AREA.farLine(insideCoverage(cov, far).km, cov)).toMatch(/We deliver within 4 km\. Move the pin closer to continue\./);
  });
});

describe('the pin is never left on a spot we made up (owner, 2026-10-22)', () => {
  test('the store and the middle of a listed area are default spots; a real house is not', () => {
    expect(isDefaultPin(cov, cov.center)).toBe(true);
    expect(isDefaultPin(cov, { lat: cov.center.lat + 0.0001, lng: cov.center.lng })).toBe(true); // about 11 m
    expect(isDefaultPin(cov, pinForArea(byName('Aluthgama')))).toBe(true);
    expect(isDefaultPin(cov, { lat: cov.center.lat + 0.002, lng: cov.center.lng })).toBe(false); // about 220 m
    expect(isDefaultPin(cov, { lat: NaN, lng: NaN })).toBe(true);
  });

  test('the map opens "fresh" without a GPS fix and not with one', () => {
    const start = (over: Partial<Parameters<typeof initialFlow>[0]> = {}) => initialFlow({ coverage: cov, ...over });
    expect(start().fresh).toBe(true);
    expect(start({ fix: { lat: 6.4372, lng: 80.0378 } }).fresh).toBe(false);
    const area = flowReducer(start(), { type: 'dragPin', coverage: cov });
    expect(area.fresh).toBe(true);
    expect(flowReducer(area, { type: 'gpsOk', fix: { lat: 6.4372, lng: 80.0378 }, coverage: cov }).fresh).toBe(false);
  });
});

describe('the address area comes from the pin (owner, 2026-10-22)', () => {
  test('a pin takes the nearest known place, the store town in the middle', () => {
    expect(areaOfPin(cov, cov.center)).toBe('Dharga Town');
    expect(areaOfPin(cov, { lat: 6.4700, lng: 79.9850 })).toBe('Beruwala');
    expect(areaOfPin(cov, { lat: 6.4350, lng: 80.0010 })).toBe('Aluthgama');
    expect(areaOfPin(cov, { lat: 6.4405, lng: 79.9950 })).toBe('Kaluwamodara');
    expect(areaOfPin(cov, { lat: 6.60, lng: 80.30 })).toBe('Dharga Town'); // nowhere near a known place
    expect(areaOfPin(cov, { lat: NaN, lng: NaN })).toBe('Dharga Town');
  });

  test('the form offers the town first, the areas inside the radius, then Beruwala', () => {
    const names = areaChoices(cov);
    expect(names[0]).toBe('Dharga Town');
    expect(names).toEqual(expect.arrayContaining(['Aluthgama', 'Kaluwamodara', 'Bentota', 'Moragalla', 'Beruwala']));
    expect(names[names.length - 1]).toBe('Beruwala');
    expect(new Set(names).size).toBe(names.length);
  });
});

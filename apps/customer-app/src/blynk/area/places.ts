/*
 * The places around the Blynk store that the delivery-area map shows (owner's sketch,
 * 2026-10-14): the store at the Clock Tower in Dharga Town, the towns inside the radius and
 * the two nearest ones outside it. Coordinates are real, approximate town centres (the
 * distances from the Clock Tower match the owner's sketch to within 0.1 km); the map and the
 * area list compute every distance from the store location GET /store sends, so they stay
 * right if the store or its radius changes. Whether an address is delivered to is always the
 * server's decision (422 DELIVERY_OUTSIDE_RADIUS).
 */

export type LatLng = { lat: number; lng: number };

/** Dharga Town Clock Tower (Plus Code C2R6+GH): the dev seed's store location and the fallback centre. */
export const CLOCK_TOWER: LatLng = { lat: 6.441313, lng: 80.011437 };
/** Used only until GET /store answers (or on a server without store_location / radius_km). */
export const FALLBACK_RADIUS_KM = 4;

export type Place = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Where the label sits next to its dot on the map, and a nudge up/down (px) to keep labels apart. */
  label: { side: 'left' | 'right'; dy: number };
  /** Offered in "Choose your area" (when inside the radius). */
  listed: boolean;
};

export const PLACES: readonly Place[] = [
  { id: 'dharga-town', name: 'Dharga Town', lat: CLOCK_TOWER.lat, lng: CLOCK_TOWER.lng, label: { side: 'right', dy: 0 }, listed: true },
  { id: 'aluthgama', name: 'Aluthgama', lat: 6.4348, lng: 80.0008, label: { side: 'left', dy: -4 }, listed: true },
  { id: 'kande-vihara', name: 'Kande Vihara', lat: 6.4290, lng: 80.0050, label: { side: 'right', dy: -7 }, listed: true },
  { id: 'kaluwamodara', name: 'Kaluwamodara', lat: 6.4262, lng: 80.0040, label: { side: 'right', dy: 9 }, listed: true },
  { id: 'bentota', name: 'Bentota', lat: 6.4200, lng: 79.9990, label: { side: 'left', dy: 6 }, listed: true },
  { id: 'moragalla', name: 'Moragalla', lat: 6.4495, lng: 79.9858, label: { side: 'right', dy: -2 }, listed: true },
  { id: 'beruwala', name: 'Beruwala town', lat: 6.4770, lng: 79.9855, label: { side: 'right', dy: 0 }, listed: false },
  { id: 'welipenna', name: 'Welipenna', lat: 6.4605, lng: 80.1095, label: { side: 'left', dy: 0 }, listed: false },
];

/** The store's own town: drawn as the store, not as a separate dot. */
export const CENTRE_PLACE_ID = 'dharga-town';

/**
 * The coastline west of the store (north to south), the Bentota river (from inland, past the
 * south of Dharga Town, round Aluthgama, then behind the sand spit to its mouth) and Galle Road
 * (A2). Traced approximately off OpenStreetMap for the drawing only.
 */
export const COAST: readonly LatLng[] = [
  { lat: 6.520, lng: 79.978 }, { lat: 6.4933, lng: 79.9816 }, { lat: 6.4773, lng: 79.9798 }, { lat: 6.4671, lng: 79.9730 },
  { lat: 6.4614, lng: 79.9736 }, { lat: 6.4557, lng: 79.9781 }, { lat: 6.4494, lng: 79.9810 }, { lat: 6.4414, lng: 79.9872 },
  { lat: 6.4312, lng: 79.9935 }, { lat: 6.4238, lng: 79.9969 }, { lat: 6.4135, lng: 80.0004 }, { lat: 6.4021, lng: 80.0038 },
  { lat: 6.3907, lng: 80.0049 }, { lat: 6.3700, lng: 80.0080 }, { lat: 6.3400, lng: 80.0140 },
];

export const RIVER: readonly LatLng[] = [
  { lat: 6.4000, lng: 80.0800 }, { lat: 6.4095, lng: 80.0618 }, { lat: 6.4181, lng: 80.0391 }, { lat: 6.4226, lng: 80.0277 },
  { lat: 6.4295, lng: 80.0209 }, { lat: 6.4363, lng: 80.0140 }, { lat: 6.4374, lng: 80.0072 }, { lat: 6.4340, lng: 80.0032 },
  { lat: 6.4295, lng: 80.0021 }, { lat: 6.4266, lng: 79.9992 }, { lat: 6.4283, lng: 79.9958 }, { lat: 6.4340, lng: 79.9924 },
  { lat: 6.4395, lng: 79.9885 }, { lat: 6.4414, lng: 79.9870 },
];

/** Galle Road (A2) along the coast. */
export const GALLE_ROAD: readonly LatLng[] = [
  { lat: 6.520, lng: 79.978 }, { lat: 6.4933, lng: 79.9820 }, { lat: 6.4773, lng: 79.9850 }, { lat: 6.4591, lng: 79.9855 },
  { lat: 6.4399, lng: 79.9939 }, { lat: 6.4303, lng: 79.9978 }, { lat: 6.4246, lng: 79.9976 }, { lat: 6.4104, lng: 80.0010 },
  { lat: 6.3900, lng: 80.0040 }, { lat: 6.3400, lng: 80.0120 },
];

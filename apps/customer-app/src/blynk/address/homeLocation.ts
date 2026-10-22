import { router } from 'expo-router';
import { useState } from 'react';
import { useSession } from '@/blynk/auth/session';
import type { StoreInfo } from '@/blynk/api/types';
import { LIVE_LOCATION_SHEET } from '@/demo/homeLive';
import { addressSummary } from './api';
import { locateOnce } from './maplibre';
import { useDeliveryLocation } from './store';

/*
 * The location parts of the live home screen: the header row's text and tap, and the
 * first-launch sheet's GRANT and "Enter Location Manually".
 */
export const HOME_SHEET = {
  ...LIVE_LOCATION_SHEET,
  sub: 'Lets the app find your delivery spot on the map.',
  asking: 'WAIT…',
};

/** The header row until the customer sets a delivery spot. */
export const NOT_SET = { name: 'Location not set', line: 'Tap to set your delivery location' } as const;

const RETURN = '/home';

export function useHomeLocation(store: StoreInfo | null) {
  const session = useSession();
  const loc = useDeliveryLocation();
  const [asking, setAsking] = useState(false);

  // before a spot is chosen the header says so, not the store's own name (owner, 2026-10-22: "location is not set yet")
  let name: string = NOT_SET.name;
  let address: string | null = NOT_SET.line;
  if (session && loc.address) {
    name = loc.address.label;
    address = addressSummary(loc.address);
  } else if (loc.guestPin) {
    address = `Delivering to: ${loc.guestPin.label ?? 'your pin on the map'}`;
  }

  /** Signed in: the saved addresses; a guest: the map. */
  const openRow = () => {
    if (session) router.push({ pathname: '/addresses', params: { return: RETURN } } as never);
    else router.push({ pathname: '/address', params: { return: RETURN } } as never);
  };

  /** GRANT: ask the browser for one fix and open the map there; on denial, at the store area with a note. */
  const grant = () => {
    if (asking) return;
    setAsking(true);
    locateOnce()
      .then((p) => router.push({ pathname: '/address', params: { lat: String(p.lat), lng: String(p.lng), return: RETURN } } as never))
      .catch(() => router.push({ pathname: '/address', params: { gps: 'off', return: RETURN } } as never))
      .finally(() => setAsking(false));
  };

  const manual = () => router.push({ pathname: '/address', params: { return: RETURN } } as never);

  return { chosen: loc.chosen, name, address, openRow, grant, manual, asking, sheet: HOME_SHEET };
}

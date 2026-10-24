import { router } from 'expo-router';
import { useState } from 'react';
import { useSession } from '@/blynk/auth/session';
import type { StoreInfo } from '@/blynk/api/types';
import { addressSummary } from './api';
import { locateOnce } from './maplibre';
import { useDeliveryLocation } from './store';
import { HOME_LOCATION, labelText } from './words';

/*
 * The location parts of the live home screen: the header row's text and tap, and the
 * first-launch sheet's GRANT and "Enter Location Manually". The words come from HOME_LOCATION
 * (read while rendering, so they follow the chosen language).
 */
const homeSheet = () => ({
  title: HOME_LOCATION.title,
  sub: HOME_LOCATION.sub,
  cta: HOME_LOCATION.cta,
  manual: HOME_LOCATION.manual,
  asking: HOME_LOCATION.asking,
});

const RETURN = '/home';

export function useHomeLocation(store: StoreInfo | null) {
  const session = useSession();
  const loc = useDeliveryLocation();
  const [asking, setAsking] = useState(false);

  // before a spot is chosen the header says so, not the store's own name (owner, 2026-10-22: "location is not set yet")
  let name: string = HOME_LOCATION.notSetName;
  let address: string | null = HOME_LOCATION.notSetLine;
  if (session && loc.address) {
    name = labelText(loc.address.label);
    address = addressSummary(loc.address);
  } else if (loc.guestPin) {
    address = HOME_LOCATION.deliveringTo(loc.guestPin.label ?? HOME_LOCATION.yourPin);
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

  return { chosen: loc.chosen, name, address, openRow, grant, manual, asking, sheet: homeSheet() };
}

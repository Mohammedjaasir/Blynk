import type { NavigateFunction } from 'react-router-dom';

/** Back, or the shop when this is the first screen of the app (e.g. opened from a shared link). */
export function goBack(nav: NavigateFunction, locationKey: string) {
  if (locationKey === 'default') nav('/'); else nav(-1);
}

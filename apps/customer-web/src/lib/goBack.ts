import type { NavigateFunction } from 'react-router-dom';

/** Back, or the shop when there is no history to go back to (e.g. opened from a shared link). */
export function goBack(nav: NavigateFunction) {
  if (window.history.length > 1) nav(-1); else nav('/');
}

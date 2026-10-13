import { writePendingReferral } from '@/blynk/rewards/api';
import { referralCodeFromSearch, routeFromHash } from './links';

/*
 * What the page address carried when the web app started, read once, before the router moves
 * the address on (the intro replaces it with /home):
 * - `?ref=CODE` is kept on the device until sign-in (Flutter ReferralLink.captureFromPageAddress);
 * - `#/p/<id>` (the site's redirect of a shared /p/<id> link) and the Flutter shop's other hash
 *   routes become a route to open on top of Home once it shows (Flutter generateInitialRoutes).
 * The hash is removed from the address so a reload does not open it again. Native has no page
 * address; nothing happens there.
 */

type PageLocation = { search: string; hash: string; pathname: string };
type PageHistory = { replaceState: (data: unknown, unused: string, url?: string) => void };

let pendingRoute: string | null = null;

/** Reads the page address. Exposed for tests; called once at import on the web. Never throws. */
export function captureFromPage(loc: PageLocation | null | undefined, history?: PageHistory | null): void {
  if (!loc) return;
  try {
    const code = referralCodeFromSearch(loc.search);
    if (code) writePendingReferral(code);
  } catch { /* storage blocked: no code */ }
  try {
    const route = routeFromHash(loc.hash);
    if (route) pendingRoute = route;
    if (loc.hash && loc.hash.length > 1 && history) history.replaceState(null, '', `${loc.pathname}${loc.search}`);
  } catch { /* an address we cannot rewrite is left alone */ }
}

/** The route a shared link asked for, once; null afterwards. */
export function takePendingRoute(): string | null {
  const r = pendingRoute;
  pendingRoute = null;
  return r;
}

export const peekPendingRoute = () => pendingRoute;

const g = globalThis as { location?: PageLocation; history?: PageHistory; document?: unknown };
if (g.document && g.location) captureFromPage(g.location, g.history);

/*
 * Is this build usable? (Flutter Services/app_config.dart + ConfigErrorApp.) A release build
 * with no API address, a malformed one, a local one or a plain-http one cannot work, so the app
 * shows "This build isn't configured" with a short code instead of failing screen by screen.
 * Development builds always start (they fall back to the local API). A web page that is itself
 * served from this machine (a local preview) may use a local, http API.
 */

export type ConfigProblem = 'API_URL_MISSING' | 'API_URL_INVALID' | 'API_URL_LOCAL' | 'API_URL_NOT_HTTPS';

const LOCAL_NAMES = new Set(['localhost', '0.0.0.0', '::', '::1', '10.0.2.2', '10.0.3.2']);

/** Hosts that only mean "this machine / this network segment". */
export function isLocalHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (LOCAL_NAMES.has(h) || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (/^127\./.test(h) || /^169\.254\./.test(h) || /^0\./.test(h)) return true;
  if (/^fe80:/.test(h)) return true;
  return false;
}

export interface ConfigInput {
  /** EXPO_PUBLIC_API_BASE_URL as built (undefined when unset). */
  apiBaseUrl: string | undefined;
  /** A development build (__DEV__). */
  dev: boolean;
  /** The page's own host on the web (location.hostname); null in a native app. */
  pageHost: string | null;
  /** The design mock fetches nothing, so it needs no API. */
  demo?: boolean;
}

export function configProblem({ apiBaseUrl, dev, pageHost, demo }: ConfigInput): ConfigProblem | null {
  if (dev || demo) return null;
  const raw = (apiBaseUrl ?? '').trim();
  if (!raw) return 'API_URL_MISSING';
  let url: URL;
  try { url = new URL(raw); } catch { return 'API_URL_INVALID'; }
  if (!url.hostname || (url.protocol !== 'https:' && url.protocol !== 'http:')) return 'API_URL_INVALID';
  const localPreview = pageHost != null && isLocalHost(pageHost);
  if (isLocalHost(url.hostname) && !localPreview) return 'API_URL_LOCAL';
  if (url.protocol !== 'https:' && !localPreview) return 'API_URL_NOT_HTTPS';
  return null;
}

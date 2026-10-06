/**
 * Build-time guard for VITE_API_BASE_URL (used by vite.config.ts; kept here,
 * dependency-free, so it is unit-tested like the rest of the app).
 *
 * Vite loads `.env.local` in EVERY mode, production included, so a developer's
 * localhost address used to end up baked into a release APK or web bundle.
 * Dev values now live in `.env.development.local` (loaded by `npm run dev`
 * only), and a production build refuses to finish unless the API address is
 * a real https URL.
 *
 * The one exception is the LAN test APK (`CAP_LAN_HTTP=1`, see
 * scripts/lan-android-config.mjs): plain http to a private LAN IPv4 only.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1', '10.0.2.2']);

function isPrivateLanIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4 || !parts.every((p) => /^(0|[1-9][0-9]{0,2})$/.test(p))) return false;
  const [a, b] = parts.map(Number);
  if (parts.some((p) => Number(p) > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

const HOW_TO =
  'Build with the live API, e.g.\n' +
  '  VITE_API_BASE_URL=https://api.blynk.lk/api/v1 npm run build && npx cap sync android';

/** Returns null when the value is fine for a production build, otherwise the reason it is not. */
export function apiBaseUrlProblem(value: string | undefined, opts: { lanHttp?: boolean } = {}): string | null {
  const raw = (value ?? '').trim();
  if (!raw) return `VITE_API_BASE_URL is not set, so the app would not know which API to call.\n${HOW_TO}`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return `VITE_API_BASE_URL is not a valid URL ("${raw}").\n${HOW_TO}`;
  }
  const host = url.hostname.toLowerCase();
  if (LOCAL_HOSTS.has(host) || host.endsWith('.localhost') || host.startsWith('127.')) {
    return `VITE_API_BASE_URL points at this computer (${raw}); a phone or browser elsewhere cannot reach it.\n${HOW_TO}`;
  }
  if (url.protocol === 'https:') return null;
  if (url.protocol === 'http:' && opts.lanHttp && isPrivateLanIpv4(host)) return null;
  return `VITE_API_BASE_URL must be an https:// address (${raw}).\n${HOW_TO}`;
}

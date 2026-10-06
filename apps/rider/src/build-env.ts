/**
 * Build-time guard (imported by vite.config.ts, never by the app). A
 * production bundle has its API address compiled in, so a missing value
 * would silently fall back to the client's development default
 * (http://localhost:4000) and a rider's phone would talk to itself. Fail the
 * build instead.
 *
 * Development values (a LAN address over http for a device test, the dev
 * rider phone) belong in .env.development.local, used by `vite` and by
 * `vite build --mode development`.
 */
export function productionApiProblem(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return 'VITE_API_BASE_URL is not set.';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return `VITE_API_BASE_URL is not a valid URL: ${raw}`;
  }
  if (url.protocol !== 'https:') return `VITE_API_BASE_URL must use https:// in production: ${raw}`;
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host.startsWith('127.') || host === '0.0.0.0') {
    return `VITE_API_BASE_URL points at this machine (${host}); a phone can't reach it: ${raw}`;
  }
  return null;
}

export function assertProductionEnv(env: Record<string, string | undefined>): void {
  const problem = productionApiProblem(env.VITE_API_BASE_URL);
  if (problem) {
    throw new Error(
      `${problem}\nSet it to the public https API address (e.g. https://api.example.com/api/v1) for production builds. ` +
        'For a development build use `vite build --mode development` with .env.development.local.'
    );
  }
}

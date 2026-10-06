/**
 * Build-time guard for the API address (used by vite.config.ts). A production
 * bundle has the address compiled in, so a missing, localhost or plain-http
 * value would ship an app that cannot reach Blynk - or would send staff
 * tokens in clear text. Returns the problem, or null when the value is fine.
 */
export function productionApiUrlProblem(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return 'VITE_API_BASE_URL is not set. Production builds need the public https address of the Blynk API.';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return `VITE_API_BASE_URL is not a valid URL: "${raw}".`;
  }
  if (url.protocol !== 'https:') return `VITE_API_BASE_URL must use https in production builds (got "${raw}").`;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0' || host === '[::1]' || host.startsWith('127.')) {
    return `VITE_API_BASE_URL points to this machine ("${raw}"). Use the public address of the Blynk API.`;
  }
  return null;
}

import { API_BASE_URL, apiRequest } from '../api/client';

/**
 * In-app updates settings (owner, 2026-10-12): helpers for the "App updates"
 * card (More here, Settings in Admin). Same logic in apps/admin.
 */
export type StaffAppName = 'ops' | 'rider';
export const STAFF_APP_NAMES: ReadonlyArray<{ id: StaffAppName; label: string }> = [
  { id: 'ops', label: 'Blynk Ops' },
  { id: 'rider', label: 'Blynk Rider' },
];
export const MAX_VERSION_CODE = 2_100_000_000;
export const MAX_NOTES = 500;

export interface PublishedVersion {
  version_code: number;
  version_name: string;
  released_at: string;
  size: number;
}

/**
 * The published APK, from the signed-in manifest endpoint
 * (GET /app-updates/manifest?app=<app>; ADMIN and OPERATIONS may read both
 * apps). The APKs are no longer public on blynk.lk (owner, 2026-10-12).
 * null when nothing is published or it cannot be read.
 */
export async function fetchPublishedVersion(app: StaffAppName): Promise<PublishedVersion | null> {
  try {
    const v = (await apiRequest<unknown>(`/app-updates/manifest?app=${app}`)) as Record<string, unknown> | null;
    if (!v || v.app !== app || typeof v.version_code !== 'number' || !Number.isInteger(v.version_code)) return null;
    return {
      version_code: v.version_code,
      version_name: typeof v.version_name === 'string' ? v.version_name : String(v.version_code),
      released_at: typeof v.released_at === 'string' ? v.released_at : '',
      size: typeof v.size === 'number' ? v.size : 0,
    };
  } catch {
    return null;
  }
}

/** Temporary public share link (owner, 2026-10-12): 1-72 hours, default 24. */
export const SHARE_MIN_HOURS = 1;
export const SHARE_MAX_HOURS = 72;
export const SHARE_DEFAULT_HOURS = 24;

/** A whole number of hours from 1 to 72. */
export function parseShareHours(raw: string): { value: number } | { error: string } {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return { error: `Enter whole hours, ${SHARE_MIN_HOURS} to ${SHARE_MAX_HOURS}.` };
  const value = Number(text);
  if (value < SHARE_MIN_HOURS || value > SHARE_MAX_HOURS) {
    return { error: `Enter whole hours, ${SHARE_MIN_HOURS} to ${SHARE_MAX_HOURS}.` };
  }
  return { value };
}

/** The full public link: the API base (…/api/v1) + the path the API returns. */
export const shareLinkUrl = (path: string) => `${API_BASE_URL}${path}`;

/** A whole number from 0; '' means 0 (no minimum). */
export function parseMinVersionCode(raw: string): { value: number } | { error: string } {
  const text = raw.trim();
  if (text === '') return { value: 0 };
  if (!/^\d+$/.test(text)) return { error: 'Enter a whole number (0 = no minimum).' };
  const value = Number(text);
  if (value > MAX_VERSION_CODE) return { error: `At most ${MAX_VERSION_CODE}.` };
  return { value };
}

/** A note for staff when the settings cannot do what they probably expect. */
export function minimumWarning(min: number, mode: 'optional' | 'required' | 'automatic', published: PublishedVersion | null): string | null {
  if (mode !== 'required' || min === 0) return null;
  if (published && min > published.version_code) {
    return `The minimum is above the published version (${published.version_code}). Phones that update to it can keep working; publish the newer APK first.`;
  }
  return null;
}

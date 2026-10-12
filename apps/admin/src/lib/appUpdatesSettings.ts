/**
 * In-app updates settings (owner, 2026-10-12): helpers for the "App updates"
 * panel (Settings here, More in Operations). Same logic in apps/operations.
 */
export type StaffAppName = 'ops' | 'rider';
export const STAFF_APP_NAMES: ReadonlyArray<{ id: StaffAppName; label: string }> = [
  { id: 'ops', label: 'Blynk Ops' },
  { id: 'rider', label: 'Blynk Rider' },
];
export const MAX_VERSION_CODE = 2_100_000_000;
export const MAX_NOTES = 500;

export const publishedManifestUrl = (app: StaffAppName) => `https://blynk.lk/download/${app}.json`;

export interface PublishedVersion {
  version_code: number;
  version_name: string;
  released_at: string;
  size: number;
}

/** The APK published on the landing site, read from its manifest; null when missing or unreadable. */
export async function fetchPublishedVersion(app: StaffAppName): Promise<PublishedVersion | null> {
  try {
    const res = await fetch(publishedManifestUrl(app), { cache: 'no-store' });
    if (!res.ok) return null;
    const v = JSON.parse(await res.text()) as Record<string, unknown>;
    if (v.app !== app || typeof v.version_code !== 'number' || !Number.isInteger(v.version_code)) return null;
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
export function minimumWarning(min: number, mode: 'optional' | 'required', published: PublishedVersion | null): string | null {
  if (mode !== 'required' || min === 0) return null;
  if (published && min > published.version_code) {
    return `The minimum is above the published version (${published.version_code}). Phones that update to it can keep working; publish the newer APK first.`;
  }
  return null;
}

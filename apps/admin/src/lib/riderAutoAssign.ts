/**
 * Automatic rider assignment settings (owner, 2026-10-25). The limits mirror the API
 * (PUT /admin/settings/rider-auto-assign), which re-checks them.
 */
export const WAIT_MIN_SECONDS = 30;
export const WAIT_MAX_SECONDS = 900;
export const DISTANCE_MIN_KM = 0.5;
export const DISTANCE_MAX_KM = 25;

/** Whole seconds, 30 to 900 (a minutes figure such as "2m" is not accepted: say 120). */
export function parseWaitSeconds(input: string): { value: number } | { error: string } {
  const text = input.trim().replace(/\s*(s|sec|seconds)$/i, '');
  if (text === '') return { error: 'Enter how many seconds an order waits.' };
  if (!/^\d+$/.test(text)) return { error: 'Enter whole seconds, like 90.' };
  const value = Number(text);
  if (value < WAIT_MIN_SECONDS || value > WAIT_MAX_SECONDS) {
    return { error: `Enter from ${WAIT_MIN_SECONDS} to ${WAIT_MAX_SECONDS} seconds.` };
  }
  return { value };
}

/** Km, 0.5 to 25, at most one decimal. */
export function parseDistanceKm(input: string): { value: number } | { error: string } {
  const text = input.trim().replace(/\s*km$/i, '');
  if (text === '') return { error: 'Enter a distance in km.' };
  if (!/^\d+(\.\d+)?$/.test(text)) return { error: 'Enter a distance like 5.' };
  const value = Number(text);
  if (value < DISTANCE_MIN_KM || value > DISTANCE_MAX_KM) {
    return { error: `Enter a distance from ${DISTANCE_MIN_KM} to ${DISTANCE_MAX_KM} km.` };
  }
  if (!/^\d+(\.\d)?$/.test(text)) return { error: 'Use at most 1 decimal, e.g. 2.5.' };
  return { value };
}

/** "1 min 30 s", "90 s", "2 min". */
export function waitLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m} min ${s} s` : `${m} min`;
}

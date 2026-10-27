import { useSyncExternalStore } from 'react';

/*
 * What Home's "Buy again" rail is showing (owner's brother, 2026-10-27: after one test order Home showed the same
 * diaper pack under "Buy again" AND "Your usuals" - "a distraction"). The rail publishes the product ids it shows;
 * "Your usuals" reads them and stays away when it would only repeat them. `resolved` is false while the rail is
 * still loading, so "Your usuals" does not flash in and then disappear. No rail mounted (null) = no opinion.
 */
export type BuyAgainShown = { resolved: boolean; ids: string[] } | null;

let current: BuyAgainShown = null;
const listeners = new Set<() => void>();

export function setBuyAgainShown(next: BuyAgainShown): void {
  const same =
    current === next ||
    (!!current && !!next && current.resolved === next.resolved && current.ids.length === next.ids.length && current.ids.every((id, i) => id === next.ids[i]));
  if (same) return;
  current = next;
  listeners.forEach((l) => l());
}

export const getBuyAgainShown = (): BuyAgainShown => current;

export function useBuyAgainShown(): BuyAgainShown {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    getBuyAgainShown,
    getBuyAgainShown,
  );
}

/** True when "Your usuals" should not show: Buy again is still loading, or already shows every one of its products. */
export function hideUsuals(shown: BuyAgainShown, usualIds: readonly string[]): boolean {
  if (!shown) return false;
  if (!shown.resolved) return true;
  if (!usualIds.length || !shown.ids.length) return false;
  const have = new Set(shown.ids);
  return usualIds.every((id) => have.has(id));
}

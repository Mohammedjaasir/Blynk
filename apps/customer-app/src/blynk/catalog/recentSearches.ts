import { storage } from '@/blynk/lib/storage';

/* Device-local search history, the Flutter shop's rules (recent_searches_storage.dart). */

export const MAX_RECENT_SEARCHES = 8;
export const RECENT_SEARCHES_KEY = 'blynk.app.recentSearches.v1';
/** The backend's cap on `search`. */
export const SEARCH_MAX = 100;

/** Trimmed, repeated spaces collapsed, capped at the backend's 100 characters. */
export function normalizeSearch(v: string | null | undefined): string {
  const t = (v ?? '').trim().replace(/\s+/g, ' ');
  return t.length <= SEARCH_MAX ? t : t.slice(0, SEARCH_MAX);
}

/** `current` with `query` moved to the front: trimmed, never empty, de-duplicated case-insensitively, capped. */
export function addRecentSearch(current: string[], query: string, max = MAX_RECENT_SEARCHES): string[] {
  const t = query.trim();
  if (!t) return [...current];
  const lower = t.toLowerCase();
  return [t, ...current.filter((q) => q.toLowerCase() !== lower)].slice(0, max);
}

export function loadRecentSearches(): string[] {
  try {
    const raw: unknown = JSON.parse(storage.get(RECENT_SEARCHES_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter((q): q is string => typeof q === 'string').map((q) => q.trim()).filter(Boolean).slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
}

export const saveRecentSearches = (list: string[]) => storage.set(RECENT_SEARCHES_KEY, JSON.stringify(list));
export const clearRecentSearches = () => storage.set(RECENT_SEARCHES_KEY, '');

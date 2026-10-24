/* Blynk Admin copy of apps/operations/src/lib/categoryHours.ts (common.md rule 2: no cross-app imports) - keep the two in step. */
/*
 * Available hours per category (owner's brother, 2026-10-24: "I can't find the time setting thing in the
 * app for category or products"). The Categories page edits ONE category's window; the API only
 * has GET/PUT /admin/settings/availability-windows, which replaces the whole list, so a save reads the
 * list, changes this category's entry and sends everything back (lib/availability.ts has the rules).
 */
import { windowProblem, windowText, type AvailabilityWindow } from './availability';

export interface CategoryHours {
  from: string;
  until: string;
}

type Listed = Pick<AvailabilityWindow, 'kind' | 'id' | 'from' | 'until'>;

/** Category id -> its window, from the settings list (product windows are ignored). */
export function hoursById(windows: ReadonlyArray<Listed>): Map<string, CategoryHours> {
  return new Map(windows.filter((w) => w.kind === 'CATEGORY').map((w) => [w.id, { from: w.from, until: w.until }]));
}

/** The whole list with only this category's entry set (`next`) or removed (null); order and everything else kept. */
export function withCategoryHours<T extends Listed>(windows: ReadonlyArray<T>, categoryId: string, next: CategoryHours | null): Listed[] {
  const list: Listed[] = windows.map((w) => ({ kind: w.kind, id: w.id, from: w.from, until: w.until }));
  const at = list.findIndex((w) => w.kind === 'CATEGORY' && w.id === categoryId);
  if (next === null) return at < 0 ? list : list.filter((_, i) => i !== at);
  const entry: Listed = { kind: 'CATEGORY', id: categoryId, from: next.from, until: next.until };
  if (at < 0) return [...list, entry];
  return list.map((w, i) => (i === at ? entry : w));
}

/** The form's two times -> what to save: both empty = any time (null), one empty or equal = a problem in words. */
export function parseHoursInput(from: string, until: string): { hours: CategoryHours | null } | { problem: string } {
  if (from === '' && until === '') return { hours: null };
  if (from === '' || until === '') return { problem: 'Choose both times, or leave both empty for any time.' };
  const problem = windowProblem({ from, until });
  return problem ? { problem } : { hours: { from, until } };
}

/** The row's line: "Hours: 6 am - 6 pm", or "Hours: 6 am - 6 pm (from Beverages)" when it follows its main category; '' when none. */
export function hoursRowText(
  category: { id: string; parent_id?: string | null },
  hours: ReadonlyMap<string, CategoryHours>,
  all: ReadonlyArray<{ id: string; name: string }>
): string {
  const own = hours.get(category.id);
  if (own) return `Hours: ${windowText(own)}`;
  const parent = category.parent_id ? hours.get(category.parent_id) : undefined;
  if (!parent) return '';
  const name = all.find((c) => c.id === category.parent_id)?.name;
  return `Hours: ${windowText(parent)}${name ? ` (from ${name})` : ''}`;
}

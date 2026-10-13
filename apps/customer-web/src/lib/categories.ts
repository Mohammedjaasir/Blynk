import type { Category } from '../api/types';

/** Maps any category id to its top-level ancestor id (itself when top-level or unknown). */
export function topLevelOf(categories: Category[]): (id: string) => string {
  const parent = new Map(categories.map((c) => [c.id, c.parent_id]));
  return (id) => {
    let cur = id;
    for (let i = 0; i < 10; i++) {
      const p = parent.get(cur);
      if (!p || !parent.has(p)) return cur;
      cur = p;
    }
    return cur;
  };
}

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

/** Ancestor chain of a category id, nearest first, ending at the top-level id (cycle-safe). */
export function ancestorsOf(categories: Category[]): (id: string) => string[] {
  const parent = new Map(categories.map((c) => [c.id, c.parent_id]));
  return (id) => {
    const chain = [id];
    let cur = id;
    for (let i = 0; i < 10; i++) {
      const p = parent.get(cur);
      if (!p || !parent.has(p) || chain.includes(p)) break;
      chain.push(p);
      cur = p;
    }
    return chain;
  };
}

/** Whether a category offer (offer_percent) is running right now. */
export function categoryOfferActive(c: Pick<Category, 'offer_percent' | 'offer_ends_at'>, now: Date = new Date()): boolean {
  if (c.offer_percent == null || !(c.offer_percent > 0)) return false;
  return c.offer_ends_at == null || new Date(c.offer_ends_at).getTime() > now.getTime();
}

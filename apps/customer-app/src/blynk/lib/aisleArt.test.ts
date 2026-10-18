import { describe, expect, it } from 'vitest';
import { aisleArt, aislePhase, aisleTint, BEAM_ITEMS } from './aisleArt';

describe('aisleArt', () => {
  it('picks illustrated items by the aisle name or slug', () => {
    expect(aisleArt({ name: 'Dairy & Eggs', slug: 'dairy-eggs' })).toEqual(['🥛', '🥚', '🧀']);
    expect(aisleArt({ name: 'Biscuits & Bakery', slug: 'bakery' })[0]).toBe('🍞');
    expect(aisleArt({ name: 'Rice & Groceries', slug: 'groceries' })[0]).toBe('🍚');
    expect(aisleArt({ name: 'Fruits & Vegetables', slug: 'fruits-veg' })[0]).toBe('🍎');
    expect(aisleArt({ name: 'Vegetables' })[0]).toBe('🥦');
    expect(aisleArt({ name: 'Household', slug: 'household' })[0]).toBe('🧽');
    expect(aisleArt({ name: 'Personal care', slug: 'personal-care' })[0]).toBe('🧴');
    expect(aisleArt({ name: 'Baby care' })[0]).toBe('🍼');
    expect(aisleArt({ name: 'Beverages' })[0]).toBe('🧃');
    expect(aisleArt({ name: 'Snacks & Sweets' })[0]).toBe('🍫');
    expect(aisleArt({ name: 'Fresh Veggies' })[0]).toBe('🥦');
    expect(aisleArt({ name: 'Coconut Oil' })[0]).toBe('🥥');
  });

  it('falls back to the banner beam set, varied by position', () => {
    const a = aisleArt({ name: 'Stationery', slug: 'stationery' }, 0);
    const b = aisleArt({ name: 'Stationery', slug: 'stationery' }, 1);
    expect(a).toEqual([BEAM_ITEMS[0], BEAM_ITEMS[1], BEAM_ITEMS[2]]);
    expect(b[0]).toBe(BEAM_ITEMS[1]);
    expect(aisleArt({}, -1)[0]).toBe(BEAM_ITEMS[5]);
    for (const items of [a, b]) for (const e of items) expect(BEAM_ITEMS as readonly string[]).toContain(e);
  });

  it('never returns claim text', () => {
    const all = ['Dairy', 'Bakery', 'Rice', 'Household', 'Other'].flatMap((name) => aisleArt({ name }));
    expect(all.join(' ')).not.toMatch(/[a-z]/i);
  });

  it('staggers neighbouring cards', () => {
    const p = [0, 1, 2, 3].map(aislePhase);
    for (const x of p) expect(x >= 0 && x < 3).toBe(true);
    expect(new Set(p.map((x) => x.toFixed(2))).size).toBe(4);
    expect(Math.abs(p[1] - p[0])).toBeGreaterThan(0.5);
  });

  it('gives each category a different card colour (owner, 2026-10-18)', () => {
    const dairy = aisleTint({ name: 'Dairy & Eggs', slug: 'dairy-eggs' });
    const rice = aisleTint({ name: 'Rice & Groceries', slug: 'groceries' });
    const fruit = aisleTint({ name: 'Fruits & Vegetables', slug: 'fruits-veg' });
    expect(new Set([dairy, rice, fruit]).size).toBe(3);
    for (const hex of [dairy, rice, fruit]) expect(hex).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('a category with no matching rule still gets a colour, varied by position', () => {
    const a = aisleTint({ name: 'Stationery', slug: 'stationery' }, 0);
    const b = aisleTint({ name: 'Stationery', slug: 'stationery' }, 1);
    expect(a).toMatch(/^#[0-9A-F]{6}$/i);
    expect(a).not.toBe(b);
  });
});

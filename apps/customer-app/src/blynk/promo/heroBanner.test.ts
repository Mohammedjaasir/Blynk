import { describe, expect, it } from 'vitest';
import type { PublicHeroBanner } from '../api/types';
import {
  HERO_AUTO_ITEMS, HERO_ITEMS, fillHeroTokens, heroSubSize, heroWaveSpan, heroWordSize, resolveHero,
} from './heroBanner';

const custom = (over: Partial<PublicHeroBanner> = {}): PublicHeroBanner => ({
  mode: 'CUSTOM', title: ['WEEKEND', 'DEALS'], lines: ['Up to 20% off rice', 'Groceries starting at {min_price}'],
  cta_label: 'ORDER NOW', cta_target: null, items: ['milk', 'bread'], ends_at: null, ...over,
});
const facts = { minPrice: 253, freeCount: 0 };
const now = new Date('2026-10-14T06:00:00Z');

describe('hero banner render model', () => {
  it('AUTO (null or an older API without the field) draws two catchy lines, no price, never free delivery', () => {
    for (const config of [undefined, null]) {
      expect(resolveHero(config, { minPrice: 253, freeCount: 2 }, now)).toEqual({
        title: ['FRESH', 'GROCERIES'],
        lines: ['Quality groceries, delivered with care', 'Fresh picks, every day'],
        accent: null,
        items: HERO_AUTO_ITEMS.map((k) => HERO_ITEMS[k]),
        cta: 'ORDER NOW',
        link: null,
        slides: [],
        custom: false,
        fit: false,
      });
    }
    // no price, no catalog yet: the same two catchy lines regardless
    const fresh = resolveHero(null, { minPrice: null, freeCount: 0 }, now);
    expect(fresh.title).toEqual(['FRESH', 'GROCERIES']);
    expect(fresh.lines).toEqual(['Quality groceries, delivered with care', 'Fresh picks, every day']);
    expect(resolveHero(null, { minPrice: 100, freeCount: 1 }, now).lines[0]).toBe('Quality groceries, delivered with care');
  });

  it("AUTO never advertises free delivery, even with the customer's own free deliveries left (owner, 2026-10-15: the purple banner, specifically)", () => {
    const one = resolveHero(null, { minPrice: 253, freeCount: 1, freeKind: 'personal' }, now);
    expect(one.title).toEqual(['FRESH', 'GROCERIES']);
    expect(one.lines).toEqual(['Quality groceries, delivered with care', 'Fresh picks, every day']);
    expect(one.fit).toBe(false);
    expect(resolveHero(null, { minPrice: 253, freeCount: 2, freeKind: 'personal' }, now).lines[0]).toBe('Quality groceries, delivered with care');
    // none left (or not known yet): same catchy lines, same title
    const none = resolveHero(null, { minPrice: 253, freeCount: 0, freeKind: 'none' }, now);
    expect(none.title).toEqual(['FRESH', 'GROCERIES']);
    expect(none.lines).toEqual(['Quality groceries, delivered with care', 'Fresh picks, every day']);
    expect(none.fit).toBe(false);
  });

  it('AUTO with Blynk Points on: the live rule, then a second catchy line, no price (owner, 2026-10-16)', () => {
    const m = resolveHero(null, { minPrice: 253, freeCount: 0, pointsRule: '1 point for every LKR 100' }, now);
    expect(m.title).toEqual(['EARN', 'POINTS']);
    expect(m.lines).toEqual(['1 point for every LKR 100', 'Shop smart, earn more']);
    expect(m.accent).toBeNull();
  });

  it('CUSTOM {free_count}: the personal count signed in, the store count "for new customers" for a guest', () => {
    const lines = ['First {free_count} deliveries free'];
    expect(resolveHero(custom({ lines }), { minPrice: 253, freeCount: 1, freeKind: 'personal' }, now).lines).toEqual(['First 1 deliveries free']);
    expect(resolveHero(custom({ lines }), { minPrice: 253, freeCount: 2, freeKind: 'new-customer' }, now).lines).toEqual(['First 2 deliveries free for new customers']);
    // the owner already said who it is for: not said twice
    expect(resolveHero(custom({ lines: ['New customers: {free_count} free'] }), { minPrice: 253, freeCount: 2 }, now).lines).toEqual(['New customers: 2 free']);
    // none left: the line is skipped, the owner's title stays
    const m = resolveHero(custom({ lines }), { minPrice: 253, freeCount: 0, freeKind: 'none' }, now);
    expect(m.lines).toEqual([]);
    expect(m.title).toEqual(['WEEKEND', 'DEALS']);
  });

  it('CUSTOM: Admin / Ops words with the cheapest price filled in, their items and button', () => {
    const m = resolveHero(custom({ cta_label: 'shop now' }), facts, now);
    expect(m.title).toEqual(['WEEKEND', 'DEALS']);
    expect(m.lines).toEqual(['Up to 20% off rice', 'Groceries starting at LKR 253']);
    expect(m.accent).toBe('LKR 253');
    expect(m.items).toEqual(['🥛', '🍞']);
    expect(m.cta).toBe('SHOP NOW');
    expect(m.link).toBeNull(); // the app's own: scroll to the aisles
    expect(m.custom).toBe(true);
    expect(m.fit).toBe(true);
  });

  it('a line whose token has no value is skipped', () => {
    expect(fillHeroTokens('First {free_count} deliveries free', { minPrice: 10, freeCount: 0 })).toBeNull();
    expect(fillHeroTokens('First {free_count} deliveries free', { minPrice: 10, freeCount: 3, freeKind: 'personal' })).toBe('First 3 deliveries free');
    expect(fillHeroTokens('From {min_price}', { minPrice: null, freeCount: 3 })).toBeNull();
    expect(fillHeroTokens('From {min_price}', { minPrice: 1250, freeCount: 0 })).toBe('From LKR 1,250');
    const m = resolveHero(custom({ lines: ['First {free_count} free', 'From {min_price}'] }), { minPrice: null, freeCount: 0 }, now);
    expect(m.lines).toEqual([]);
  });

  it('the button goes where a carousel banner with the same target goes', () => {
    const target = { level: 'SUB_CATEGORY' as const, id: 's1', slug: 'basmati', name: 'Basmati', parent_id: 'c1', parent_slug: 'rice', parent_name: 'Rice', is_active: true };
    expect(resolveHero(custom({ cta_target: target }), facts, now).link).toEqual({ kind: 'category', slug: 'rice', sub: 'basmati' });
    expect(resolveHero(custom({ cta_target: { ...target, is_active: false } }), facts, now).link).toBeNull();
    expect(resolveHero(custom({ cta_target: { ...target, level: 'CATALOG', id: null, slug: null } }), facts, now).link).toEqual({ kind: 'categories', group: null });
  });

  it('after its end (a cached /store), or with broken words, it is AUTO again', () => {
    expect(resolveHero(custom({ ends_at: '2026-10-14T05:00:00Z' }), facts, now).custom).toBe(false);
    expect(resolveHero(custom({ ends_at: '2026-10-15T05:00:00Z' }), facts, now).custom).toBe(true);
    expect(resolveHero(custom({ title: ['', 'DEALS'] }), facts, now).custom).toBe(false);
    // unknown item keys fall back to the automatic items
    expect(resolveHero(custom({ items: ['pizza'] }), facts, now).items).toEqual(HERO_AUTO_ITEMS.map((k) => HERO_ITEMS[k]));
  });
});

describe('hero banner fit', () => {
  it('title words are sized to the 196 pt column; 12 letters still fit', () => {
    expect(heroWordSize('FREE')).toBe(36);
    expect(heroWordSize('GROCERIES')).toBe(26);
    expect(heroWordSize('ABCDEFGHIJKL')).toBe(19);
    expect(heroWordSize('ABCDEFGHIJKL') * 12 * 0.82).toBeLessThanOrEqual(196);
  });

  it('the letter wave keeps today\'s 1 s for short titles and runs on for long ones', () => {
    expect(heroWaveSpan(['FREE', 'DELIVERY'])).toBe(1);
    expect(heroWaveSpan(['WEEKEND', 'DEALS'])).toBe(1);
    expect(heroWaveSpan(['ABCDEFGHIJKL', 'ABCDEFGHIJKL'])).toBeGreaterThan(1.8);
  });

  it('AUTO sub-lines stay 15 pt; long custom lines shrink so they end before the item', () => {
    expect(heroSubSize('Groceries starting at LKR 1,250 and more', false)).toBe(15);
    expect(heroSubSize('Up to 20% off rice', true)).toBe(15);
    const long = 'x'.repeat(40);
    const size = heroSubSize(long, true);
    expect(size).toBeLessThan(15);
    expect(size).toBeGreaterThanOrEqual(10.5);
    expect(40 * 0.519 * size).toBeLessThanOrEqual(220);
  });
});

describe('more slides (owner, 2026-10-23)', () => {
  it('CUSTOM carries the extra slides: words, an optional line with tokens filled, an optional item', () => {
    const m = resolveHero(custom({
      slides: [
        { title: ['fresh', 'juices'], line: 'Cold from {min_price}', item: 'bottle' },
        { title: ['SNACKS', 'TIME'], line: null, item: null },
        { title: ['', 'BROKEN'], line: null, item: null }, // no first word: dropped
        { title: ['PLAIN', 'ITEM'], line: 'Sale {free_count}', item: 'car' }, // token with no value, unknown item
      ],
    }), facts, now);
    expect(m.slides).toEqual([
      { title: ['FRESH', 'JUICES'], line: 'Cold from LKR 253', item: HERO_ITEMS.bottle },
      { title: ['SNACKS', 'TIME'], line: null, item: null },
      { title: ['PLAIN', 'ITEM'], line: null, item: null },
    ]);
  });

  it('AUTO, an older API without slides and a custom banner without any: just the main banner', () => {
    expect(resolveHero(null, facts, now).slides).toEqual([]);
    expect(resolveHero(custom(), facts, now).slides).toEqual([]);
    expect(resolveHero(custom({ slides: [] }), facts, now).slides).toEqual([]);
  });
});

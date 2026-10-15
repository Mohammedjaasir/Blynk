import { describe, expect, test } from 'vitest';
import type { Product } from '@/blynk/api/types';
import type { PointsRule } from '@/blynk/store/pointsPromo';
import { formatLkr } from './money';
import { priceDisplay, sizedStruck } from './pricing';
import { priceRoll, rollPhase, type PriceRollInput } from './priceRoll';

/*
 * The rolling line under a tile's price (owner 2026-10-15, Toing's "Other apps / Our app" line with
 * true facts only): struck reference <-> the saving, decided once here.
 */
const now = new Date('2026-10-15T10:00:00+05:30');
const POINTS: PointsRule = { earnPoints: 1, earnPerLkr: 100, lkrPerPoint: 1, minRedeemPoints: 50 };

type T = { selling: number; offer: number | null; mrp?: number | null; kind?: Product['offer_kind'] };
/** What ProductCard passes for a product without sizes. */
function input(t: T, o: { available?: boolean; showStruck?: boolean; points?: PointsRule | null; maxChars?: number } = {}): PriceRollInput {
  const p = { selling_price: t.selling, offer_price: t.offer, offer_ends_at: null, mrp: t.mrp ?? null };
  const shown = priceDisplay(p, { showStruck: o.showStruck ?? true, now });
  return {
    shown, struck: shown.struck, priceShown: { amount: shown.price, single: true },
    offerKind: t.kind ?? (t.offer != null ? 'PRODUCT' : null), available: o.available ?? true, points: o.points ?? null, maxChars: o.maxChars, money: formatLkr,
  };
}

describe('priceRoll', () => {
  test('product offer: the struck regular price <-> "Save LKR 50"', () => {
    expect(priceRoll(input({ selling: 590, offer: 540 }))).toEqual({
      struck: { amount: 590, kind: 'regular' },
      saving: { text: 'Save LKR 50', kind: 'lkr' },
      label: 'Regular price LKR 590, Save LKR 50',
    });
  });

  test('offer with an MRP reference: the saving is against the MRP and says so', () => {
    const r = priceRoll(input({ selling: 280, offer: 250, mrp: 300 }));
    expect(r?.struck).toEqual({ amount: 300, kind: 'mrp' });
    expect(r?.saving).toEqual({ text: 'Save LKR 50 vs MRP', kind: 'lkr' });
    expect(r?.label).toBe('MRP LKR 300, Save LKR 50 vs MRP');
  });

  test('MRP only (price under the MRP, no offer): "MRP LKR 340" <-> "Save LKR 30 vs MRP"', () => {
    const r = priceRoll(input({ selling: 310, offer: null, mrp: 340 }));
    expect(r?.struck).toEqual({ amount: 340, kind: 'mrp' });
    expect(r?.saving?.text).toBe('Save LKR 30 vs MRP');
  });

  test('a narrow tile drops " vs MRP" (line A right before it says MRP)', () => {
    expect(priceRoll(input({ selling: 310, offer: null, mrp: 340 }, { maxChars: 16 }))?.saving?.text).toBe('Save LKR 30');
    expect(priceRoll(input({ selling: 310, offer: null, mrp: 340 }, { maxChars: 18 }))?.saving?.text).toBe('Save LKR 30 vs MRP');
  });

  test('category offer: "5% off" (the aisle\'s own words), never both wordings', () => {
    expect(priceRoll(input({ selling: 540, offer: 513, kind: 'CATEGORY' }))?.saving).toEqual({ text: '5% off', kind: 'pct' });
    // a rounded offer price: the percentage is never rounded up past the truth
    expect(priceRoll(input({ selling: 576.75, offer: 547.91, kind: 'CATEGORY' }))?.saving?.text).toBe('5% off');
    expect(priceRoll(input({ selling: 100, offer: 91, kind: 'CATEGORY' }))?.saving?.text).toBe('9% off');
  });

  test('category offer with the MRP as the reference: the LKR saving vs MRP (the % is off the regular price)', () => {
    expect(priceRoll(input({ selling: 540, offer: 513, mrp: 560, kind: 'CATEGORY' }))?.saving?.text).toBe('Save LKR 47 vs MRP');
  });

  test('a fractional saving keeps its cents', () => {
    expect(priceRoll(input({ selling: 576.75, offer: 547.91 }))?.saving?.text).toBe('Save LKR 28.84');
  });

  test("Admin's show_offer_savings off: no struck price, so no line at all", () => {
    expect(priceRoll(input({ selling: 590, offer: 540 }, { showStruck: false }))).toBeNull();
    expect(priceRoll(input({ selling: 310, offer: null, mrp: 340 }, { showStruck: false }))).toBeNull();
    expect(priceRoll(input({ selling: 540, offer: 513, kind: 'CATEGORY' }, { showStruck: false }))).toBeNull();
  });

  test('no offer and no MRP saving: nothing', () => {
    expect(priceRoll(input({ selling: 310, offer: null }))).toBeNull();
    expect(priceRoll(input({ selling: 300, offer: null, mrp: 300 }))).toBeNull();
  });

  test('a sold-out tile: line A stays still (no "Save" on what cannot be bought today)', () => {
    const r = priceRoll(input({ selling: 1150, offer: 1092 }, { available: false }));
    expect(r?.struck).toEqual({ amount: 1150, kind: 'regular' });
    expect(r?.saving).toBeNull();
  });

  test('a saving under LKR 1: line A stays still', () => {
    const r = priceRoll(input({ selling: 100.5, offer: 100 }));
    expect(r?.struck).toEqual({ amount: 100.5, kind: 'regular' });
    expect(r?.saving).toBeNull();
    expect(r?.label).toBe('Regular price LKR 100.50');
  });

  describe('sizes', () => {
    const shownOf = (selling: number, offer: number | null, mrp: number | null) =>
      priceDisplay({ selling_price: selling, offer_price: offer, offer_ends_at: null, mrp }, { showStruck: true, now });

    test('a full "LKR 50 – 350" range: never rolls (the regular price stays struck, still)', () => {
      const shown = shownOf(60, 50, 65);
      const struck = sizedStruck(shown, true, 60);
      const r = priceRoll({ shown, struck, priceShown: { amount: 50, single: false }, offerKind: 'PRODUCT', available: true, points: null, money: formatLkr });
      expect(r?.struck).toEqual({ amount: 60, kind: 'regular' });
      expect(r?.saving).toBeNull();
    });

    test('a full range without an offer: nothing struck beside it, no line', () => {
      const shown = shownOf(60, null, 65);
      const struck = sizedStruck(shown, true, 60);
      expect(priceRoll({ shown, struck, priceShown: { amount: 60, single: false }, offerKind: null, available: true, points: null, money: formatLkr })).toBeNull();
    });

    test('"From LKR 50" (narrow tile): the MRP stays struck, still', () => {
      const shown = shownOf(60, 50, 65);
      const struck = sizedStruck(shown, false, 60);
      const r = priceRoll({ shown, struck, priceShown: { amount: 50, single: false }, offerKind: 'PRODUCT', available: true, points: null, money: formatLkr });
      expect(r?.struck).toEqual({ amount: 65, kind: 'mrp' });
      expect(r?.saving).toBeNull();
    });

    test('every size at one price that is the product\'s own: a clean saving, rolls', () => {
      const shown = shownOf(60, 50, 65);
      const struck = sizedStruck(shown, false, 60);
      const r = priceRoll({ shown, struck, priceShown: { amount: 50, single: true }, offerKind: 'PRODUCT', available: true, points: null, money: formatLkr });
      expect(r?.saving?.text).toBe('Save LKR 15 vs MRP');
    });

    test('one price shown that is not the product\'s own: still', () => {
      const shown = shownOf(60, 50, 65);
      const struck = sizedStruck(shown, false, 60);
      const r = priceRoll({ shown, struck, priceShown: { amount: 45, single: true }, offerKind: 'PRODUCT', available: true, points: null, money: formatLkr });
      expect(r?.saving).toBeNull();
    });
  });

  describe('Blynk Points', () => {
    test('points on or off never add "Earn N pts": no saving -> no line', () => {
      expect(priceRoll(input({ selling: 310, offer: null }, { points: POINTS }))).toBeNull();
      expect(priceRoll(input({ selling: 310, offer: null }, { points: null }))).toBeNull();
    });

    test('points on or off leave an offer\'s line unchanged', () => {
      const on = priceRoll(input({ selling: 590, offer: 540 }, { points: POINTS }));
      const off = priceRoll(input({ selling: 590, offer: 540 }, { points: null }));
      expect(on).toEqual(off);
      expect(on?.saving?.text).toBe('Save LKR 50');
    });
  });
});

describe('rollPhase', () => {
  test('0..1, stable per tile, staggered along a row', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    const a = rollPhase(0, id);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
    expect(rollPhase(0, id)).toBe(a);
    expect(rollPhase(1, id)).not.toBe(a);
    for (let i = 0; i < 30; i++) {
      const v = rollPhase(i, `p-${i}`);
      expect(v >= 0 && v < 1).toBe(true);
    }
  });
});

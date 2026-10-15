import { describe, expect, test } from 'vitest';
import { formatLkr } from './money';
import { priceDisplay, sizedStruck, struckLabel } from './pricing';
import { parseVariants, variantPriced } from '@/blynk/catalog/variants';

/*
 * MRP display rule (migration 048; owner 2026-10-14; docs/api/catalog-mrp.md): show the MRP struck
 * only when our price is lower; with an offer the MRP is the struck reference when it is at least
 * the regular price; nothing struck while Admin's show_offer_savings is off.
 */
const now = new Date('2026-10-14T10:00:00+05:30');
const on = { showStruck: true, now };
const off = { showStruck: false, now };
const p = (selling: number, offer: number | null, mrp: number | null | undefined) => ({
  selling_price: selling, offer_price: offer, offer_ends_at: null, mrp,
});

describe('priceDisplay', () => {
  test('price below MRP, no offer: the price, then "MRP" struck', () => {
    expect(priceDisplay(p(280, null, 300), on)).toEqual({ price: 280, offer: false, struck: { amount: 300, kind: 'mrp' } });
  });

  test('price == MRP (a capped product): only the price', () => {
    expect(priceDisplay(p(300, null, 300), on)).toEqual({ price: 300, offer: false, struck: null });
    // the server sends null when the price is the MRP
    expect(priceDisplay(p(300, null, null), on)).toEqual({ price: 300, offer: false, struck: null });
  });

  test('offer and an MRP above the regular price: the MRP is the struck reference', () => {
    expect(priceDisplay(p(280, 250, 300), on)).toEqual({ price: 250, offer: true, struck: { amount: 300, kind: 'mrp' } });
  });

  test('offer on a capped product (MRP == regular price): the MRP, labelled MRP', () => {
    expect(priceDisplay(p(300, 270, 300), on)).toEqual({ price: 270, offer: true, struck: { amount: 300, kind: 'mrp' } });
  });

  test('offer without an MRP: the regular price struck, as before', () => {
    expect(priceDisplay(p(280, 250, null), on)).toEqual({ price: 250, offer: true, struck: { amount: 280, kind: 'regular' } });
    expect(priceDisplay(p(280, 250, undefined), on).struck).toEqual({ amount: 280, kind: 'regular' });
  });

  test('no offer, no MRP: nothing struck', () => {
    expect(priceDisplay(p(280, null, null), on)).toEqual({ price: 280, offer: false, struck: null });
  });

  test("show_offer_savings off: nothing struck, the price and offer flag unchanged", () => {
    expect(priceDisplay(p(280, null, 300), off)).toEqual({ price: 280, offer: false, struck: null });
    expect(priceDisplay(p(280, 250, 300), off)).toEqual({ price: 250, offer: true, struck: null });
  });

  test('guards: an MRP at or under the price, zero or junk is never struck', () => {
    expect(priceDisplay(p(280, null, 250), on).struck).toBeNull();
    expect(priceDisplay(p(280, null, 0), on).struck).toBeNull();
    expect(priceDisplay(p(280, null, Number.NaN), on).struck).toBeNull();
    // an odd MRP under the regular price on an offer: the regular price stays the reference
    expect(priceDisplay(p(280, 250, 260), on).struck).toEqual({ amount: 280, kind: 'regular' });
  });

  test('an ended offer: the regular price applies, the MRP rule as without an offer', () => {
    const ended = { ...p(280, 250, 300), offer_ends_at: '2026-10-13T18:29:59.000Z' };
    expect(priceDisplay(ended, on)).toEqual({ price: 280, offer: false, struck: { amount: 300, kind: 'mrp' } });
  });
});

describe('struckLabel and sizes', () => {
  test('"MRP" prefix only for the MRP', () => {
    expect(struckLabel({ amount: 300, kind: 'mrp' }, formatLkr)).toEqual({ prefix: 'MRP', amount: 'LKR 300' });
    expect(struckLabel({ amount: 280, kind: 'regular' }, formatLkr)).toEqual({ prefix: null, amount: 'LKR 280' });
  });

  test('each size uses its own MRP (parsed from the product page answer)', () => {
    const [v50, v100] = parseVariants([
      { id: 'a', label: '50 g', sort_order: 0, selling_price: 50, offer_price: null, price: 50, is_available: true, mrp: '60.00' },
      { id: 'b', label: '100 g', sort_order: 1, selling_price: 85, offer_price: null, price: 85, is_available: true, mrp: null },
    ]);
    expect(v50!.mrp).toBe(60);
    expect(priceDisplay(variantPriced(v50!), on).struck).toEqual({ amount: 60, kind: 'mrp' });
    expect(priceDisplay(variantPriced(v100!), on).struck).toBeNull();
  });
});

describe('sized tiles (ProductCard sizedStruck)', () => {
  test('no MRP beside a full range; on an offer the regular price stays the reference', () => {
    const mrpOnly = priceDisplay(p(50, null, 65), on);
    expect(sizedStruck(mrpOnly, true, 50)).toBeNull();
    expect(sizedStruck(mrpOnly, false, 50)).toEqual({ amount: 65, kind: 'mrp' });
    const offerMrp = priceDisplay(p(60, 50, 65), on);
    expect(sizedStruck(offerMrp, true, 60)).toEqual({ amount: 60, kind: 'regular' });
    expect(sizedStruck(offerMrp, false, 60)).toEqual({ amount: 65, kind: 'mrp' });
  });
});

import { describe, expect, it } from 'vitest';
import type { PublicBundleOffer } from '@/blynk/api/types';
import { savingsHeader } from '@/blynk/checkout/savings';
import {
  bundleBadgeNote, bundleBadgeText, bundleOfferFor, bundleSavingsOf, chargedSubtotal, freeUnitsByLine, giftJustUnlocked, giftLines,
  giftSignature, giftWords, liveBundleOffers, offerCoversProduct, orderBundleSavings, orderLineTag, parseBundleQuote, progressFraction,
  progressText, spendGiftText,
} from './model';

const offer = (over: Partial<PublicBundleOffer> = {}): PublicBundleOffer => ({
  id: 'o1', type: 'BUY_X_GET_Y', title: 'Juice 2+1', ends_at: null, buy_qty: 2, get_qty: 1, product_ids: null, category: { id: 'c-juice', slug: 'juice' },
  min_subtotal: null, gift_product_id: null, gift_product_name: null, gift_qty: null, ...over,
});
const gift = (over: Partial<PublicBundleOffer> = {}): PublicBundleOffer => offer({
  id: 'g1', type: 'SPEND_GET_GIFT', title: 'Gift', buy_qty: null, get_qty: null, category: null, min_subtotal: 3000, gift_product_id: 'p-bis', gift_product_name: 'Biscuit pack', gift_qty: 1, ...over,
});

describe('which offers are live and which products they cover', () => {
  it('keeps live offers, drops ended ones and tolerates a missing list', () => {
    const now = Date.parse('2026-10-25T12:00:00+05:30');
    expect(liveBundleOffers(null, now)).toEqual([]);
    expect(liveBundleOffers({}, now)).toEqual([]);
    expect(liveBundleOffers({ bundle_offers: [offer(), offer({ id: 'old', ends_at: '2026-10-25T11:00:00+05:30' }), offer({ id: 'later', ends_at: '2026-10-25T18:00:00+05:30' })] }, now).map((o) => o.id)).toEqual(['o1', 'later']);
  });

  it('a product is covered when it is picked or sits in the category or a sub-category', () => {
    const chain = (id: string) => (id === 'c-lime' ? ['c-lime', 'c-juice'] : [id]);
    expect(offerCoversProduct(offer(), { id: 'p1', category_id: 'c-juice' }, chain)).toBe(true);
    expect(offerCoversProduct(offer(), { id: 'p1', category_id: 'c-lime' }, chain)).toBe(true);
    expect(offerCoversProduct(offer(), { id: 'p1', category_id: 'c-snacks' }, chain)).toBe(false);
    const picked = offer({ category: null, product_ids: ['p1', 'p2'] });
    expect(offerCoversProduct(picked, { id: 'p2', category_id: 'c-snacks' })).toBe(true);
    expect(offerCoversProduct(picked, { id: 'p3', category_id: 'c-snacks' })).toBe(false);
  });

  it('a spend-and-gift offer never badges a product; the first matching offer wins', () => {
    expect(offerCoversProduct(gift(), { id: 'p1', category_id: 'c-juice' })).toBe(false);
    const a = offer({ id: 'a', buy_qty: 3, get_qty: 1 });
    const b = offer({ id: 'b' });
    expect(bundleOfferFor({ id: 'p1', category_id: 'c-juice' }, [gift(), a, b])?.id).toBe('a');
    expect(bundleOfferFor({ id: 'p1', category_id: 'c-snacks' }, [a, b])).toBeNull();
  });
});

describe('the words', () => {
  it('words the badge for a tile, a very narrow tile and the product page', () => {
    expect(bundleBadgeText(offer())).toBe('Buy 2 get 1 free');
    expect(bundleBadgeText(offer(), 'card')).toBe('Buy 2 get 1');
    expect(bundleBadgeText(offer(), 'compact')).toBe('Buy 2+1');
    expect(bundleBadgeText(offer({ buy_qty: 3, get_qty: 2 }))).toBe('Buy 3 get 2 free');
  });

  it('explains the offer in a sentence', () => {
    expect(bundleBadgeNote(offer({ category: null, product_ids: ['p1'] }))).toBe('Add 3 of this item: the cheapest one is free.');
    expect(bundleBadgeNote(offer())).toBe('Add 3 of any of the eligible items: the cheapest one is free.');
    expect(bundleBadgeNote(offer({ buy_qty: 3, get_qty: 2 }))).toBe('Add 5 of any of the eligible items: the cheapest 2 are free.');
  });

  it('names the gift', () => {
    expect(giftWords('Biscuit pack', 1)).toBe('Biscuit pack');
    expect(giftWords('Biscuit pack', 2)).toBe('2 x Biscuit pack');
    expect(spendGiftText(gift())).toBe('Spend LKR 3,000, get a free Biscuit pack');
  });

  it('words the progress card for money and for units', () => {
    expect(progressText({ offer_id: 'g1', title: 'Gift', type: 'SPEND_GET_GIFT', remaining_lkr: 450, gift_product_name: 'Biscuit pack' })).toBe('Add LKR 450 more for a free Biscuit pack');
    // the gift's name can come from the store's rule
    expect(progressText({ offer_id: 'g1', title: 'Gift', type: 'SPEND_GET_GIFT', remaining_lkr: 450.5 }, [gift()])).toBe('Add LKR 450.50 more for a free Biscuit pack');
    expect(progressText({ offer_id: 'o1', title: 'x', type: 'BUY_X_GET_Y', remaining_units: 1, get_qty: 1 })).toBe('Add 1 more to get 1 free');
    expect(progressText({ offer_id: 'o1', title: 'x', type: 'BUY_X_GET_Y', remaining_units: 2 }, [offer({ get_qty: 2 })])).toBe('Add 2 more to get 2 free');
    expect(progressText(null)).toBeNull();
    expect(progressText({ offer_id: 'g1', title: 'Gift', type: 'SPEND_GET_GIFT', remaining_lkr: 0 })).toBeNull();
  });

  it('works out the progress bar from what is known', () => {
    expect(progressFraction({ offer_id: 'g1', title: '', type: 'SPEND_GET_GIFT', remaining_lkr: 750 }, [gift()])).toBeCloseTo(0.75);
    expect(progressFraction({ offer_id: 'g1', title: '', type: 'SPEND_GET_GIFT', remaining_lkr: 750 })).toBeNull();
    expect(progressFraction({ offer_id: 'o1', title: '', type: 'BUY_X_GET_Y', remaining_units: 1, buy_qty: 4 })).toBeCloseTo(0.75);
    expect(progressFraction({ offer_id: 'o1', title: '', type: 'BUY_X_GET_Y', remaining_units: 9, buy_qty: 2 })).toBeNull();
  });
});

const rawQuote = {
  ready: true, subtotal_before_bundles: '720.00', bundle_savings: '120', subtotal: 600,
  bundle_applied: [{ offer_id: 'o1', title: 'Juice 2+1', type: 'BUY_X_GET_Y', savings_lkr: 120, free_units: 1 }],
  gift_items: [{ product_id: 'p-bis', name: 'Biscuit pack', quantity: 1, value_lkr: 250, offer_id: 'g1' }],
  bundle_progress: { offer_id: 'o1', title: 'Juice 2+1', type: 'BUY_X_GET_Y', remaining_units: '2', get_qty: 1, buy_qty: 2 },
  lines: [
    { product_id: 'p1', variant_id: null, quantity: 3, paid_quantity: 2, free_quantity: 1, unit_price: '120' },
    { product_id: 'p2', variant_id: 'v9', quantity: 2, paid_quantity: 2, free_quantity: 0, unit_price: 90 },
    { product_id: 'p3', variant_id: 'v1', quantity: 4, paid_quantity: 3, free_quantity: 1, unit_price: 50 },
  ],
};

describe('the cart quote', () => {
  it('reads amounts as numbers and lists as lists', () => {
    const q = parseBundleQuote(rawQuote)!;
    expect(q.subtotal_before_bundles).toBe(720);
    expect(q.bundle_savings).toBe(120);
    expect(q.bundle_progress).toMatchObject({ offer_id: 'o1', remaining_units: 2, get_qty: 1 });
    expect(q.lines[0]).toMatchObject({ quantity: 3, paid_quantity: 2, free_quantity: 1, unit_price: 120 });
    expect(parseBundleQuote(null)).toBeNull();
    expect(parseBundleQuote('x')).toBeNull();
    expect(parseBundleQuote({ ready: true })).toMatchObject({ bundle_applied: [], gift_items: [], bundle_progress: null, lines: [] });
  });

  it('groups the free units per cart line (size lines apart) and values them', () => {
    const free = freeUnitsByLine(parseBundleQuote(rawQuote));
    expect([...free.keys()]).toEqual(['p1', 'p3:v1']);
    expect(free.get('p1')).toEqual({ free: 1, paid: 2, value: 120 });
    expect(free.get('p3:v1')).toEqual({ free: 1, paid: 3, value: 50 });
    expect(freeUnitsByLine(null).size).toBe(0);
  });

  it('charges the server subtotal, and the cart total when there is no usable quote', () => {
    const q = parseBundleQuote(rawQuote);
    expect(chargedSubtotal(720, q)).toBe(600);
    expect(bundleSavingsOf(q)).toBe(120);
    expect(chargedSubtotal(720, null)).toBe(720);
    const notReady = parseBundleQuote({ ...rawQuote, ready: false });
    expect(chargedSubtotal(720, notReady)).toBe(720);
    expect(bundleSavingsOf(notReady)).toBe(0);
    expect(freeUnitsByLine(notReady).size).toBe(0);
  });

  it('words the gift line and notices an unlock', () => {
    const q = parseBundleQuote(rawQuote);
    expect(giftLines(q).map((g) => g.label)).toEqual(['Free gift: Biscuit pack']);
    expect(giftLines(parseBundleQuote({ ...rawQuote, gift_items: [{ product_id: 'p', name: 'Pen', quantity: 2, value_lkr: 20, offer_id: 'g1' }] })).map((g) => g.label)).toEqual(['Free gift: 2 x Pen']);
    expect(giftSignature(null)).toBe('');
    expect(giftJustUnlocked(null, giftSignature(q))).toBe(false); // already there when the cart opened
    expect(giftJustUnlocked('', giftSignature(q))).toBe(true);
    expect(giftJustUnlocked(giftSignature(q), giftSignature(q))).toBe(false);
    expect(giftJustUnlocked(giftSignature(q), '')).toBe(false);
  });

  it('counts the bundle saving in the bill header', () => {
    expect(savingsHeader({ offerSaved: 0, showOfferSavings: true, discount: 0, pointsValue: 0, bundleSaved: 120, toPay: 700 })).toEqual({ saved: 120, before: 820, show: true });
    expect(savingsHeader({ offerSaved: 30, showOfferSavings: true, discount: 50, pointsValue: 0, toPay: 700 })).toEqual({ saved: 80, before: 780, show: true });
  });
});

describe('the order', () => {
  it('tags free and gift lines and reads the saving', () => {
    expect(orderLineTag({})).toBeNull();
    expect(orderLineTag({ is_bundle_free: false })).toBeNull();
    expect(orderLineTag({ is_bundle_free: true, bundle_kind: 'FREE_UNITS' })).toBe('Free');
    expect(orderLineTag({ is_bundle_free: true, bundle_kind: 'GIFT' })).toBe('Free gift');
    expect(orderBundleSavings({ bundle_savings: 120 })).toBe(120);
    expect(orderBundleSavings({})).toBe(0);
  });
});

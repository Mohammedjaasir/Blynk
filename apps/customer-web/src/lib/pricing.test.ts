import { formatLkr } from './money';
import { isOfferActive, effectivePrice, savingsPerUnit } from './pricing';

const base = { selling_price: 540, offer_price: 513, offer_ends_at: null };
const now = new Date('2026-10-13T10:00:00+05:30');

test('formatLkr', () => {
  expect(formatLkr(1250)).toBe('LKR 1,250');
  expect(formatLkr(254.4)).toBe('LKR 254.40');
  expect(formatLkr(574.75)).toBe('LKR 574.75');
  expect(formatLkr(0)).toBe('LKR 0');
});

test('active offer charges the offer price', () => {
  expect(isOfferActive(base, now)).toBe(true);
  expect(effectivePrice(base, now)).toBe(513);
  expect(savingsPerUnit(base, now)).toBe(27);
});

test('expired offer falls back to selling price', () => {
  const p = { ...base, offer_ends_at: '2026-10-12T18:29:59.000Z' };
  expect(isOfferActive(p, now)).toBe(false);
  expect(effectivePrice(p, now)).toBe(540);
  expect(savingsPerUnit(p, now)).toBe(0);
});

test('offer not below selling price is ignored', () => {
  expect(isOfferActive({ ...base, offer_price: 540 }, now)).toBe(false);
  expect(isOfferActive({ ...base, offer_price: null }, now)).toBe(false);
});

test('future end date keeps the offer', () => {
  expect(isOfferActive({ ...base, offer_ends_at: '2026-10-20T18:29:59.000Z' }, now)).toBe(true);
});

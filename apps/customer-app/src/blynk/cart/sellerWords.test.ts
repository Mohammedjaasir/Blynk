import { afterEach, describe, expect, test } from 'vitest';
import { ApiError } from '@/blynk/api/client';
import { placeErrorCopy } from '@/blynk/orders/errors';
import { setLang } from '@/blynk/i18n/lang';
import { SELLER_RULE_WORDS as W } from './sellerWords';

const SI = /[඀-෿]/;
const TA = /[஀-௿]/;
afterEach(() => setLang('en'));

describe('"Start a new cart?" words', () => {
  test('English is the planned text', () => {
    expect(W.title).toBe('Start a new cart?');
    expect(W.body('Amina Stores')).toBe('Your cart has items from Amina Stores. Start a new cart?');
    expect(W.clearAndAdd).toBe('Clear cart and add');
    expect(W.keep).toBe('Keep current cart');
    expect(W.leftOut(3)).toBe('3 items from other sellers were not added.');
  });
  test('Sinhala and Tamil follow the chosen language and keep the shop name', () => {
    setLang('si');
    expect(W.title).toMatch(SI);
    expect(W.body('Amina Stores')).toContain('Amina Stores');
    expect(W.body('Amina Stores')).toMatch(SI);
    expect(W.leftOut(2)).toMatch(SI);
    expect(W.checkout.startNew).toMatch(SI);
    setLang('ta');
    expect(W.title).toMatch(TA);
    expect(W.body('Amina Stores')).toContain('Amina Stores');
    expect(W.removed(2)).toMatch(TA);
    expect(W.checkout.messageNamed('A, B')).toContain('A, B');
  });
});

describe('MIXED_SELLERS_NOT_ALLOWED at checkout', () => {
  const err = (details?: unknown) => new ApiError('Your cart has items from different sellers. Please order from one seller at a time.', 422, 'MIXED_SELLERS_NOT_ALLOWED', details);
  test('the friendly message with the "Start a new cart" action', () => {
    expect(placeErrorCopy(err())).toEqual({
      title: 'Items from different sellers',
      message: 'Your cart has items from different sellers. Please order from one seller at a time.',
      action: 'mixed-sellers',
    });
  });
  test('names the shops when the server lists them', () => {
    const c = placeErrorCopy(err({ sources: [{ seller_id: 'a', name: 'Amina Stores' }, { seller_id: null, name: 'Blynk' }] }));
    expect(c.message).toBe('Your cart has items from Amina Stores, Blynk. Please order from one seller at a time.');
    expect(c.action).toBe('mixed-sellers');
  });
  test('translated, and a malformed details never breaks it', () => {
    setLang('si');
    expect(placeErrorCopy(err({ sources: 'x' })).message).toMatch(SI);
    setLang('ta');
    expect(placeErrorCopy(err(null)).title).toMatch(TA);
  });
});

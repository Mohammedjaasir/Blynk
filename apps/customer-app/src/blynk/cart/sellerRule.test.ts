import { afterEach, describe, expect, test } from 'vitest';
import type { Combo, Product } from '../api/types';
import { milk, store, sugar } from '../test/fixtures';
import { setLang } from '../i18n/lang';
import {
  BLYNK_SOURCE, cartSource, cartSources, conflictFor, entryUnits, oneSellerRuleOn, planAdd, ruleFromStore, setOneSellerRule, sourceName,
  sourceOf, withLeftOut, type AddEntry,
} from './sellerRule';

afterEach(() => { setLang('en'); setOneSellerRule(false); });

const fromA = (id: string): Product => ({ ...milk, id, seller_id: 'seller-a', sold_by: 'Amina Stores' });
const fromB = (id: string): Product => ({ ...milk, id, seller_id: 'seller-b', sold_by: 'Bake House' });
const blynk = (id: string): Product => ({ ...sugar, id, seller_id: null });
const line = (product: Product) => ({ product, quantity: 1 });
const entry = (product: Product, quantity = 1): AddEntry => ({ kind: 'product', product, quantity });
const combo = { id: 'c1', name: 'Pack' } as Combo;
const ids = (p: { entries: AddEntry[] }) => p.entries.map((e) => (e.kind === 'product' ? e.product.id : e.combo.id));

describe('sourceOf', () => {
  test('Blynk products (null, absent, blank) are one source', () => {
    expect(sourceOf(blynk('x'))).toEqual(BLYNK_SOURCE);
    expect(sourceOf(sugar)).toEqual(BLYNK_SOURCE);
    expect(sourceOf({ seller_id: '  ', sold_by: '  ' })).toEqual(BLYNK_SOURCE);
  });
  test('a seller is told by seller_id; the shop name is only the label', () => {
    expect(sourceOf(fromA('1'))).toEqual({ key: 'seller:seller-a', name: 'Amina Stores' });
    expect(sourceOf(fromA('1')).key).toBe(sourceOf({ seller_id: 'seller-a', sold_by: 'Renamed' }).key);
    expect(sourceOf(fromA('1')).key).not.toBe(sourceOf(fromB('2')).key);
  });
  test('without seller_id (older server) the shop name is the key, case-insensitively', () => {
    expect(sourceOf({ sold_by: 'Amina Stores' }).key).toBe(sourceOf({ sold_by: ' amina stores ' }).key);
    expect(sourceOf({ sold_by: 'Amina Stores' }).name).toBe('Amina Stores');
  });
  test('a seller id without a name reads "another seller"', () => {
    expect(sourceName(sourceOf({ seller_id: 'x', sold_by: null }))).toBe('another seller');
    expect(sourceName(sourceOf(fromA('1')))).toBe('Amina Stores');
    expect(sourceName(BLYNK_SOURCE)).toBe('Blynk');
  });
});

describe('cartSource(s)', () => {
  test('empty cart has none; the first line is the cart source', () => {
    expect(cartSource([])).toBeNull();
    expect(cartSource([line(fromA('1')), line(blynk('2'))])?.name).toBe('Amina Stores');
  });
  test('distinct, in order; combo packs count as Blynk', () => {
    expect(cartSources([line(fromA('1')), line(fromA('2')), line(blynk('3'))]).map((s) => s.name)).toEqual(['Amina Stores', 'Blynk']);
    expect(cartSources([], [{}]).map((s) => s.key)).toEqual(['blynk']);
    expect(cartSources([line(blynk('1'))], [{}])).toHaveLength(1);
  });
});

describe('conflictFor', () => {
  test('rule off: never', () => {
    expect(conflictFor([line(fromA('1'))], fromB('2'), false)).toBeNull();
  });
  test('empty cart: never', () => {
    expect(conflictFor([], fromB('2'), true)).toBeNull();
  });
  test('same seller, Blynk into a Blynk cart: no conflict', () => {
    expect(conflictFor([line(fromA('1'))], fromA('2'), true)).toBeNull();
    expect(conflictFor([line(blynk('1'))], blynk('2'), true)).toBeNull();
  });
  test('another seller into a seller cart, a seller into a Blynk cart, Blynk into a seller cart', () => {
    expect(conflictFor([line(fromA('1'))], fromB('2'), true)).toEqual({ cartSource: sourceOf(fromA('1')), productSource: sourceOf(fromB('2')) });
    expect(conflictFor([line(blynk('1'))], fromA('2'), true)?.cartSource).toEqual(BLYNK_SOURCE);
    expect(conflictFor([line(fromA('1'))], blynk('2'), true)?.productSource).toEqual(BLYNK_SOURCE);
  });
  test('a combo-only cart is a Blynk cart', () => {
    expect(conflictFor([], fromA('2'), true, [{}])?.cartSource).toEqual(BLYNK_SOURCE);
    expect(conflictFor([], blynk('2'), true, [{}])).toBeNull();
  });
  test('a cart that was mixed before the rule can still grow from a source it has', () => {
    const mixed = [line(fromA('1')), line(blynk('2'))];
    expect(conflictFor(mixed, blynk('3'), true)).toBeNull();
    expect(conflictFor(mixed, fromA('4'), true)).toBeNull();
    expect(conflictFor(mixed, fromB('5'), true)?.cartSource.name).toBe('Amina Stores');
  });
});

describe('planAdd (single and bulk)', () => {
  test('rule off or nothing to add: everything goes in', () => {
    const list = [entry(fromA('1')), entry(blynk('2'))];
    expect(planAdd([line(fromB('9'))], [], list, false)).toEqual({ kind: 'add', entries: list, leftOut: 0 });
    expect(planAdd([line(fromB('9'))], [], [], true)).toEqual({ kind: 'add', entries: [], leftOut: 0 });
  });
  test('same source: goes in', () => {
    expect(planAdd([line(fromA('1'))], [], [entry(fromA('2'), 3)], true).kind).toBe('add');
  });
  test('a different source asks; "clear and add" adds that item', () => {
    const p = planAdd([line(fromA('1'))], [], [entry(fromB('2'), 2)], true);
    expect(p).toMatchObject({ kind: 'ask', leftOut: 0 });
    if (p.kind === 'ask') {
      expect(p.cartSource.name).toBe('Amina Stores');
      expect(p.entries).toHaveLength(1);
    }
  });
  test('a combo pack into a seller cart asks (combos are Blynk)', () => {
    expect(planAdd([line(fromA('1'))], [], [{ kind: 'combo', combo, quantity: 1 }], true).kind).toBe('ask');
  });
  test('bulk list from one other source: one question, all of it goes in after "clear and add"', () => {
    const p = planAdd([line(fromA('1'))], [], [entry(fromB('2')), entry(fromB('3'), 2)], true);
    expect(p).toMatchObject({ kind: 'ask', leftOut: 0 });
    expect(p.entries).toHaveLength(2);
  });
  test('bulk list with several sources: the first source not in the cart is kept, the rest is counted', () => {
    const p = planAdd([line(fromA('1'))], [], [entry(fromA('2')), entry(fromB('3'), 2), entry(blynk('4'), 5), entry(fromB('6'))], true);
    expect(p.kind).toBe('ask');
    expect(ids(p)).toEqual(['3', '6']);
    expect(p.leftOut).toBe(1 + 5);
  });
  test('empty cart and a mixed list: no question, the first source goes in, the rest is counted', () => {
    const p = planAdd([], [], [entry(fromA('1')), entry(blynk('2'), 4), entry(fromA('3'))], true);
    expect(p.kind).toBe('add');
    expect(ids(p)).toEqual(['1', '3']);
    expect(p.leftOut).toBe(4);
  });
  test('empty cart and a one-source list: all in', () => {
    expect(planAdd([], [], [entry(fromA('1')), entry(fromA('2'))], true)).toMatchObject({ kind: 'add', leftOut: 0 });
  });
  test('units count packs and quantities', () => {
    expect(entryUnits([entry(fromA('1'), 3), { kind: 'combo', combo, quantity: 2 }])).toBe(5);
  });
});

describe('the rule switch', () => {
  test('GET /store: only an explicit true is ON; an older server (no field) is OFF', () => {
    expect(ruleFromStore({ ...store, one_seller_per_order: true })).toBe(true);
    expect(ruleFromStore({ ...store, one_seller_per_order: false })).toBe(false);
    expect(ruleFromStore(store)).toBe(false);
    expect(ruleFromStore(null)).toBe(false);
  });
  test('the cart reads it outside React', () => {
    expect(oneSellerRuleOn()).toBe(false);
    setOneSellerRule(true);
    expect(oneSellerRuleOn()).toBe(true);
  });
});

test('withLeftOut appends how many were left out, in the chosen language', () => {
  expect(withLeftOut('Added 3 items.', 0)).toBe('Added 3 items.');
  expect(withLeftOut('Added 3 items.', 2)).toBe('Added 3 items. 2 items from other sellers were not added.');
  expect(withLeftOut('x', 1)).toBe('x 1 item from other sellers was not added.');
  setLang('si');
  expect(withLeftOut('x', 2)).toMatch(/[඀-෿]/);
});

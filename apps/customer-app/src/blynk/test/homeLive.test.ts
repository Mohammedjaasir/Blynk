import { describe, expect, it } from 'vitest';
import {
  deliveryLine, liveAddress, liveAisles, liveBanner, liveFees, liveHints, livePromo, liveRail, liveUnder, liveVs,
} from '../../demo/homeLive';
import type { CatalogData } from '../catalog/CatalogContext';
import type { Category, Product } from '../api/types';
import { ancestorsOf, topLevelOf } from '../lib/categories';
import { dairy, milk, store, sugar } from './fixtures';

const groc: Category = { ...dairy, id: 'c-groc', name: 'Groceries', slug: 'groceries', offer_percent: null };
const cheese: Product = { ...milk, id: 'p-cheese', name: 'Highland Cheddar Cheese Slices 200g', selling_price: 1250, offer_price: null, offer_kind: null, image_url: 'https://x/cheese.png' };
const gone: Product = { ...sugar, id: 'p-gone', name: 'Red Rice 5KG', selling_price: 1400, is_available: false };

function catalog(products: Product[] = [milk, sugar, cheese, gone]): CatalogData {
  const categories = [dairy, groc];
  return { products, aisles: categories, categories, promotions: [], groups: [], tree: [], topOf: topLevelOf(categories), chainOf: ancestorsOf(categories) };
}
const now = new Date('2026-10-13T06:00:00Z');
const flat = { ...store, delivery_fee_mode: 'FLAT' as const, delivery_fee_lkr: 100 };
const noFree = { ...flat, new_customer_free_deliveries: { ...store.new_customer_free_deliveries, enabled: false } };

describe('live home content', () => {
  it('location: the dark store from /store, or nothing', () => {
    expect(liveAddress({ ...store, hub_name: ' Dharga Town Central Dark Store ' })).toBe('Dharga Town Central Dark Store');
    expect(liveAddress(store)).toBeNull();
    expect(liveAddress(null)).toBeNull();
  });

  it('search hints are real in-stock product names', () => {
    expect(liveHints(catalog())).toEqual([milk.name, sugar.name, cheese.name]);
    const many = ['Eggs 10', 'Rice 5KG', 'Dhal 1KG'].map((name, i) => ({ ...sugar, id: 'h' + i, name }));
    expect(liveHints(catalog([cheese, ...many]))).toEqual(['Eggs 10', 'Rice 5KG', 'Dhal 1KG']);
    expect(liveHints(null)).toEqual([]);
  });

  it('banner: photos, the cheapest effective price, the free deliveries', () => {
    const b = liveBanner(catalog(), store, now);
    expect(b.images).toEqual(['https://x/cheese.png']);
    expect(b.minPrice).toBe(253);
    expect(b.freeCount).toBe(2);
    expect(liveBanner(catalog(), noFree, now).freeCount).toBe(0);
  });

  it('rail: All, then aisles with products and their FROM price', () => {
    const r = liveRail(catalog(), now);
    expect(r.map((x) => x.id)).toEqual(['all', 'c-dairy', 'c-groc']);
    expect(r[1]).toMatchObject({ name: 'Dairy & Eggs', from: 513, image: 'https://x/cheese.png' });
    expect(r[2].from).toBe(253);
    expect(liveRail(catalog([milk]), now).map((x) => x.id)).toEqual(['all', 'c-dairy']);
  });

  it('Under LKR 300: in stock and at or under 300, per aisle and filter', () => {
    expect(liveUnder(catalog(), 'all', [], now).map((p) => p.id)).toEqual(['p-sugar']);
    expect(liveUnder(catalog(), 'c-dairy', [], now)).toEqual([]);
    expect(liveUnder(catalog(), 'all', ['offer'], now)).toEqual([]);
  });

  it('aisle cards: real counts, hours, delivery and category offers; no ratings or ETAs', () => {
    const a = liveAisles(catalog(), flat, 'all', [], now);
    expect(a.map((x) => x.cat.id)).toEqual(['c-dairy', 'c-groc']);
    expect(a[0].meta).toBe('2 items • 8 AM – 9 PM');
    // free deliveries are said once (band title + fee strip), not on every aisle card
    expect(a[0].delivery).toBe('Items from LKR 513');
    expect(a[0].offer).toBe('5% off everything here');
    expect(a[1].offer).toBeNull();
    expect(liveAisles(catalog(), noFree, 'all', [], now)[1].delivery).toBe('Items from LKR 253');
    expect(liveAisles(catalog(), flat, 'c-groc', ['offer'], now)).toEqual([]);
  });

  it('delivery line follows /store', () => {
    expect(deliveryLine({ ...store, new_customer_free_deliveries: { ...store.new_customer_free_deliveries, count: 1 } })).toBe('First delivery free for new customers');
    expect(deliveryLine(noFree)).toBe('Delivery LKR 100');
    expect(deliveryLine({ ...store, new_customer_free_deliveries: { ...store.new_customer_free_deliveries, enabled: false } })).toBe('Delivery fee at checkout');
  });

  it('vs band: offer tiles with "You save" only when Admin turns savings on', () => {
    const v = liveVs(catalog(), store, now)!;
    expect(v.kicker).toEqual(['NO PACKAGING FEE', '&', 'NO PLATFORM FEE']);
    expect(v.title).toBe('FIRST 2 DELIVERIES FREE');
    expect(v.tiles).toHaveLength(1);
    expect(v.tiles[0]).toMatchObject({ id: 'p-milk', overlay: ['NOW', 'LKR 513'], line: 'Dairy & Eggs', strike: false, save: null });
    expect(v.tiles[0].aisle?.slug).toBe('dairy-eggs');
    expect(liveVs(catalog(), { ...noFree, show_offer_savings: true }, now)!.tiles[0]).toMatchObject({ line: 'LKR 540', strike: true, save: 'You save LKR 27' });
    expect(liveVs(catalog(), noFree, now)!.title).toBe('OFFER PRICES TODAY');
  });

  it('vs band without offers falls back to aisles, and hides with nothing to show', () => {
    const v = liveVs(catalog([sugar, cheese]), noFree, now)!;
    expect(v.title).toBe('SHOP BY AISLE');
    expect(v.tiles.map((t) => t.overlay)).toEqual([['ITEMS', 'FROM LKR 1,250'], ['ITEMS', 'FROM LKR 253']]);
    expect(liveVs(catalog([]), noFree, now)).toBeNull();
    expect(liveVs(null, store, now)).toBeNull();
  });

  it('promo band and fee strip carry only true labels', () => {
    // the built-in band has no free-delivery headline (the band title and the fee strip say
    // it), just a catchy line over its true ticks (owner, 2026-10-15)
    expect(livePromo(store)).toEqual({ line1: 'No sneaky fees. Ever.', fees: ['No Platform Fee', 'No Packaging Fee'] });
    expect(livePromo(noFree).line1).toBe('No sneaky fees. Ever.');
    expect(liveFees(store)[0]).toEqual(['0', 'Packaging fee']);
    expect(liveFees(store)[2]).toEqual(['2', 'Free · new users']);
    expect(liveFees(noFree)[2]).toEqual(['LKR', 'Delivery LKR 100']);
    expect(liveFees({ ...store, new_customer_free_deliveries: { ...store.new_customer_free_deliveries, enabled: false } })[2]).toEqual(['km', 'Fee at checkout']);
    const all = JSON.stringify([liveFees(store), livePromo(store), liveVs(catalog(), store, now)]);
    expect(all).not.toMatch(/₹|lower|other apps|rating|mins/i);
  });

  it('signed in: only this customer’s free deliveries left, else no free-delivery claim at all', () => {
    const two = { kind: 'personal', count: 2 } as const;
    const one = { kind: 'personal', count: 1 } as const;
    const none = { kind: 'none', count: 0 } as const;
    expect(liveVs(catalog(), store, now, two)!.title).toBe('NEXT 2 DELIVERIES FREE');
    expect(liveVs(catalog(), store, now, one)!.title).toBe('1 FREE DELIVERY LEFT');
    // the store still has the offer on, but this customer used theirs: the band keeps its products
    const used = liveVs(catalog(), store, now, none)!;
    expect(used.title).toBe('OFFER PRICES TODAY');
    expect(used.tiles).toHaveLength(1);
    expect(liveFees(flat, none)[2]).toEqual(['LKR', 'Delivery LKR 100']);
    expect(liveFees(store, two)[2]).toEqual(['2', 'Free left']);
    expect(liveFees(store, one)[2]).toEqual(['1', 'Free delivery left']);
    expect(livePromo(store, none).line1).toBe('No sneaky fees. Ever.');
    expect(livePromo(store, two).line1).toBe('No sneaky fees. Ever.');
    expect(liveBanner(catalog(), store, now, none).freeCount).toBe(0);
    expect(liveBanner(catalog(), store, now, one).freeCount).toBe(1);
    const usedAll = JSON.stringify([liveFees(store, none), livePromo(store, none), used, liveAisles(catalog(), store, 'all', [], now)]);
    expect(usedAll).not.toMatch(/free deliver|deliveries free|delivery free/i);
  });
});

import { describe, expect, it } from 'vitest';
import {
  canCancel,
  canEditLines,
  canReceive,
  canSend,
  daysLeftText,
  initialSelection,
  itemKey,
  matchesFilter,
  orderBodyFor,
  receiveBody,
  receiveDefaults,
  suggestionText,
  type PoLine,
  type ReorderGroup,
  type ReorderItem,
  type ReorderSuggestions,
} from '../lib/purchasing';

const item = (over: Partial<ReorderItem>): ReorderItem => ({
  product_id: 'p1',
  variant_id: null,
  product_name: 'Sugar',
  variant_label: null,
  display_name: 'Sugar',
  sku: 'SUG-1',
  unit: '1 kg',
  pack_size: null,
  category_name: 'Grocery',
  quantity_on_hand: 2,
  quantity_reserved: 0,
  quantity_available: 2,
  low_stock_threshold: 5,
  units_sold: 8,
  avg_daily_units: 0.57,
  days_of_stock_left: 3.5,
  on_order: 0,
  in_draft: 0,
  buy_multiple: null,
  suggested_quantity: 8,
  last_cost: 100,
  estimated_cost: 800,
  reasons: ['LOW'],
  supplier_id: 's1',
  supplier_name: 'Lanka Wholesale',
  supplier_phone: null,
  ...over,
});

const group = (items: ReorderItem[], over: Partial<ReorderGroup> = {}): ReorderGroup => ({
  supplier_id: 's1',
  supplier_name: 'Lanka Wholesale',
  supplier_phone: null,
  items,
  estimated_cost: 0,
  ...over,
});

const sugg = (groups: ReorderGroup[]): ReorderSuggestions => ({
  params: { days: 14, cover_days: 7, lead_days: 1, period: { from: '2026-10-11', to: '2026-10-24' } },
  rule: 'rule',
  suppliers: groups,
  totals: { products: 0, out: 0, units: 0, estimated_cost: 0 },
});

describe('suggestion selection', () => {
  it('starts with every line ticked at its suggested quantity; sizes of one product are separate lines', () => {
    const a = item({});
    const b = item({ variant_id: 'v1', suggested_quantity: 3 });
    const sel = initialSelection(sugg([group([a, b])]));
    expect(sel.qty).toEqual({ [itemKey(a)]: 8, [itemKey(b)]: 3 });
    expect(Object.values(sel.picked)).toEqual([true, true]);
    expect(itemKey(a)).not.toBe(itemKey(b));
  });

  it('the order body holds only ticked lines with a quantity, for the group supplier or the one chosen', () => {
    const a = item({});
    const b = item({ product_id: 'p2', display_name: 'Tea' });
    const c = item({ product_id: 'p3', display_name: 'Dhal' });
    const g = group([a, b, c]);
    const qty = { [itemKey(a)]: 8, [itemKey(b)]: 4, [itemKey(c)]: 0 };
    const picked = { [itemKey(a)]: true, [itemKey(b)]: false, [itemKey(c)]: true };
    expect(orderBodyFor(g, qty, picked)).toEqual({ supplier_id: 's1', lines: [{ product_id: 'p1', variant_id: null, ordered_qty: 8 }] });
    const none = group([a], { supplier_id: null, supplier_name: null });
    expect(orderBodyFor(none, qty, picked, { supplier_id: 's9' }).supplier_id).toBe('s9');
    expect(orderBodyFor(none, qty, picked).supplier_id).toBeNull();
  });

  it('filters by text (name, SKU, category) and reason', () => {
    const a = item({ reasons: ['OUT'] });
    expect(matchesFilter(a, { text: '', reason: 'ALL' })).toBe(true);
    expect(matchesFilter(a, { text: 'sug', reason: 'ALL' })).toBe(true);
    expect(matchesFilter(a, { text: 'groc', reason: 'ALL' })).toBe(true);
    expect(matchesFilter(a, { text: 'tea', reason: 'ALL' })).toBe(false);
    expect(matchesFilter(a, { text: '', reason: 'OUT' })).toBe(true);
    expect(matchesFilter(a, { text: '', reason: 'FAST' })).toBe(false);
  });

  it('the text to copy lists ticked lines only', () => {
    const a = item({});
    const b = item({ product_id: 'p2', display_name: 'Tea' });
    const text = suggestionText(group([a, b]), { [itemKey(a)]: 8, [itemKey(b)]: 4 }, { [itemKey(a)]: true, [itemKey(b)]: false });
    expect(text).toBe('Order for Lanka Wholesale:\n8 x Sugar');
  });

  it('says how long stock lasts', () => {
    expect(daysLeftText(null)).toBe('No sales');
    expect(daysLeftText(0.4)).toBe('Under a day');
    expect(daysLeftText(3.5)).toBe('3.5 days');
  });
});

describe('statuses', () => {
  it('what each status allows', () => {
    expect([canEditLines('DRAFT'), canEditLines('SENT')]).toEqual([true, false]);
    expect([canSend('DRAFT'), canSend('SENT')]).toEqual([true, false]);
    expect(['DRAFT', 'SENT', 'PARTIAL', 'RECEIVED', 'CANCELLED'].map((s) => canReceive(s as never))).toEqual([false, true, true, false, false]);
    expect(['DRAFT', 'SENT', 'PARTIAL', 'RECEIVED', 'CANCELLED'].map((s) => canCancel(s as never))).toEqual([true, true, true, false, false]);
  });
});

describe('receive form', () => {
  const line = (id: string, ordered: number, received: number, cost = 100): PoLine => ({
    id,
    product_id: `p-${id}`,
    variant_id: null,
    name: `Item ${id}`,
    unit: null,
    ordered_qty: ordered,
    received_qty: received,
    remaining_qty: Math.max(0, ordered - received),
    unit_cost: cost,
    line_total: ordered * cost,
    note: null,
    stock_counted: true,
    stock_on_hand: 0,
  });
  const po = { lines: [line('a', 10, 4), line('b', 6, 0, 12.5)] };

  it('starts with what is still missing at the line cost', () => {
    expect(receiveDefaults(po)).toEqual({
      a: { qty: '6', cost: '100.00', updateCost: false },
      b: { qty: '6', cost: '12.50', updateCost: false },
    });
  });

  it('sends only lines that arrived, the cost only when it changed or is to be kept', () => {
    const e = receiveDefaults(po);
    e.a!.qty = '3';
    e.b!.qty = '0';
    const r = receiveBody(po, e, false);
    expect(r).toEqual({ ok: true, body: { lines: [{ item_id: 'a', received_qty: 3 }] } });

    e.a!.cost = '90';
    e.a!.updateCost = true;
    expect(receiveBody(po, e, false)).toEqual({ ok: true, body: { lines: [{ item_id: 'a', received_qty: 3, unit_cost: 90, update_product_cost: true }] } });
  });

  it('refuses nothing arrived (unless closing short) and bad numbers', () => {
    const e = receiveDefaults(po);
    e.a!.qty = '';
    e.b!.qty = '0';
    expect(receiveBody(po, e, false)).toEqual({ ok: false, error: 'Enter what arrived for at least one product.' });
    expect(receiveBody(po, e, true).ok).toBe(true);
    e.a!.qty = '2.5';
    expect(receiveBody(po, e, false)).toMatchObject({ ok: false });
    e.a!.qty = '2';
    e.a!.cost = 'abc';
    expect(receiveBody(po, e, false)).toMatchObject({ ok: false });
    e.a!.cost = '0';
    e.a!.updateCost = true;
    expect(receiveBody(po, e, false)).toMatchObject({ ok: false });
  });
});

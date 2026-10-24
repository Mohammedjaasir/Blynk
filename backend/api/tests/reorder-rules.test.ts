import { describe, it, expect } from 'vitest';
import {
  avgDailyUnits,
  daysOfStockLeft,
  fastMoverCutoff,
  groupBySupplier,
  packMultiple,
  roundUpToMultiple,
  suggest,
  type SuggestInput,
} from '../src/modules/purchasing/reorder.rules.js';
import { purchaseOrderText, whatsappLink, whatsappPhone } from '../src/modules/purchasing/purchase-orders.text.js';

/** Reorder suggestion maths and the shareable order text (pure; owner, 2026-10-25). */
const base: SuggestInput = {
  units: 28,
  days: 14,
  onHand: 10,
  reserved: 0,
  lowStockThreshold: 5,
  onOrder: 0,
  coverDays: 7,
  leadDays: 1,
};

describe('velocity', () => {
  it('averages units over the window (2 decimals)', () => {
    expect(avgDailyUnits(28, 14)).toBe(2);
    expect(avgDailyUnits(8, 14)).toBe(0.57);
    expect(avgDailyUnits(0, 14)).toBe(0);
    expect(avgDailyUnits(5, 0)).toBe(0);
  });

  it('days of stock left is available / daily, one decimal, null without sales', () => {
    expect(daysOfStockLeft(10, 2)).toBe(5);
    expect(daysOfStockLeft(2, 0.57)).toBe(3.5);
    expect(daysOfStockLeft(10, 0)).toBeNull();
    expect(daysOfStockLeft(-3, 2)).toBe(0);
  });

  it('the fast-mover cutoff is the 80th percentile of sellers, never below 1 a day', () => {
    expect(fastMoverCutoff([])).toBe(1);
    expect(fastMoverCutoff([0, 0, 0.3, 0.4])).toBe(1);
    expect(fastMoverCutoff([1, 2, 3, 4, 10])).toBe(10);
    expect(fastMoverCutoff([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(9);
  });
});

describe('pack sizes', () => {
  it('reads a buy-in multiple only from "case/box/carton of N"', () => {
    expect(packMultiple('Case of 12')).toBe(12);
    expect(packMultiple('box x 24')).toBe(24);
    expect(packMultiple('Carton × 6')).toBe(6);
    expect(packMultiple('500 g')).toBeNull();
    expect(packMultiple('1 L')).toBeNull();
    expect(packMultiple('Pack of 6')).toBeNull();
    expect(packMultiple('Case of 1')).toBeNull();
    expect(packMultiple(null)).toBeNull();
  });

  it('rounds up to whole packs', () => {
    expect(roundUpToMultiple(5, 6)).toBe(6);
    expect(roundUpToMultiple(12, 6)).toBe(12);
    expect(roundUpToMultiple(13, 6)).toBe(18);
    expect(roundUpToMultiple(5, null)).toBe(5);
  });
});

describe('suggested quantity', () => {
  it('= ceil(daily x (cover + lead)) + low-stock level - available - on order', () => {
    // 2/day x (7 + 1) = 16, + 5 safety = 21, - 10 available = 11
    const s = suggest(base);
    expect(s.target_stock).toBe(21);
    expect(s.suggested_quantity).toBe(11);
    expect(s.days_of_stock_left).toBe(5);
  });

  it('subtracts what is already on order, and never goes below zero', () => {
    expect(suggest({ ...base, onOrder: 4 }).suggested_quantity).toBe(7);
    expect(suggest({ ...base, onOrder: 50 }).suggested_quantity).toBe(0);
    expect(suggest({ ...base, onHand: 500 }).suggested_quantity).toBe(0);
  });

  it('reserved units are not available', () => {
    const s = suggest({ ...base, onHand: 10, reserved: 4 });
    expect(s.available).toBe(6);
    expect(s.suggested_quantity).toBe(15);
  });

  it('a product that does not sell is topped back up to its low-stock level', () => {
    const s = suggest({ ...base, units: 0, onHand: 2 });
    expect(s.avg_daily_units).toBe(0);
    expect(s.days_of_stock_left).toBeNull();
    expect(s.suggested_quantity).toBe(3);
    expect(suggest({ ...base, units: 0, onHand: 9 }).suggested_quantity).toBe(0);
  });

  it('rounds up to whole packs after the maths', () => {
    expect(suggest({ ...base, units: 0, onHand: 0, packSize: 'Case of 6' }).suggested_quantity).toBe(6);
    expect(suggest({ ...base, units: 0, onHand: 0, packSize: '500 g' }).suggested_quantity).toBe(5);
    expect(suggest({ ...base, packSize: 'Box x 12' }).suggested_quantity).toBe(12);
  });

  it('reason chips: out, low, will not last, fast mover', () => {
    expect(suggest({ ...base, onHand: 0 }).reasons).toEqual(['OUT', 'FAST']);
    expect(suggest({ ...base, onHand: 4, fastCutoff: 5 }).reasons).toEqual(['LOW', 'WONT_LAST']);
    expect(suggest({ ...base, onHand: 10, fastCutoff: 5 }).reasons).toEqual(['WONT_LAST']);
    expect(suggest({ ...base, onHand: 40, fastCutoff: 5 }).reasons).toEqual([]);
    expect(suggest({ ...base, units: 0, onHand: 2 }).reasons).toEqual(['LOW']);
    expect(suggest({ ...base, onHand: 20, fastCutoff: 2 }).reasons).toEqual(['FAST']);
  });

  it('longer lead time buys more', () => {
    expect(suggest({ ...base, leadDays: 4 }).suggested_quantity).toBe(suggest(base).suggested_quantity + 6);
  });
});

describe('grouping', () => {
  const line = (supplier: string | null, name: string, left: number | null, cost = 10) => ({
    supplier_id: supplier,
    supplier_name: supplier ? supplier.toUpperCase() : null,
    supplier_phone: null,
    days_of_stock_left: left,
    display_name: name,
    estimated_cost: cost,
  });

  it('suppliers A-Z with the unknown supplier last, soonest to run out first, cost summed', () => {
    const groups = groupBySupplier([
      line(null, 'Z item', 1),
      line('b', 'Beta', 5),
      line('a', 'Alpha late', 9),
      line('a', 'Alpha soon', 2, 5.5),
      line('a', 'Alpha unknown', null),
    ]);
    expect(groups.map((g) => g.supplier_id)).toEqual(['a', 'b', null]);
    expect(groups[0]!.items.map((i) => i.display_name)).toEqual(['Alpha soon', 'Alpha late', 'Alpha unknown']);
    expect(groups[0]!.estimated_cost).toBe(25.5);
  });
});

describe('order text', () => {
  it('Sri Lankan numbers become wa.me numbers', () => {
    expect(whatsappPhone('0771234567')).toBe('94771234567');
    expect(whatsappPhone('+94 77 123 4567')).toBe('94771234567');
    expect(whatsappPhone('771234567')).toBe('94771234567');
    expect(whatsappPhone('0094771234567')).toBe('94771234567');
    expect(whatsappPhone('')).toBeNull();
    expect(whatsappPhone('12345')).toBeNull();
  });

  it('reads "Order for <supplier>:" then one line per product', () => {
    const text = purchaseOrderText({
      supplier_name: 'Lanka Wholesale',
      po_number: 'BP-0007',
      expected_on: '2026-10-27',
      notes: 'Deliver before noon',
      lines: [
        { name: 'Sugar (1 kg)', quantity: 10 },
        { name: 'Dhal', quantity: 0 },
        { name: 'Tea', quantity: 6 },
      ],
    });
    expect(text).toBe(
      ['Order for Lanka Wholesale:', '10 x Sugar (1 kg)', '6 x Tea', 'Needed by: 27 Oct 2026', 'Note: Deliver before noon', 'Ref: BP-0007 (Blynk)'].join('\n')
    );
    expect(purchaseOrderText({ supplier_name: null, po_number: 'BP-1', expected_on: null, notes: null, lines: [{ name: 'X', quantity: 1 }] })).toBe(
      'Order for supplier:\n1 x X\nRef: BP-1 (Blynk)'
    );
  });

  it('the wa.me link carries the encoded text', () => {
    const url = whatsappLink('Order for A:\n1 x B', '0771234567');
    expect(url.startsWith('https://wa.me/94771234567?text=')).toBe(true);
    expect(decodeURIComponent(url.split('text=')[1]!)).toBe('Order for A:\n1 x B');
  });
});

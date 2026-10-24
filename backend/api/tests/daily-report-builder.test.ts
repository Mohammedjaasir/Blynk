import { describe, it, expect } from 'vitest';
import { REPORT_MAX_CHARS, buildDailyReport, dateLabel, gsmSafe, lkr, smsParts, type DailyReportSnapshot } from '../src/modules/daily-report/daily-report.builder.js';

/** The daily report text is a pure function of a snapshot (owner, 2026-10-25): plain GSM English, compact, capped. */
const full: DailyReportSnapshot = {
  date: '2026-10-25',
  orders_placed: 42,
  orders_delivered: 38,
  orders_cancelled: 2,
  sales_lkr: 123450.4,
  cash_collected_lkr: 98000,
  avg_basket_lkr: 3248.68,
  new_customers: 5,
  top_products: [
    { name: 'Milk 1L', quantity: 12 },
    { name: 'Eggs 10 pack', quantity: 9 },
    { name: 'Rice 5kg', quantity: 7 },
  ],
  low_stock_count: 6,
  low_stock_names: ['Milk 1L', 'Eggs', 'Rice'],
  avg_rating: 4.64,
  ratings_count: 12,
  repeat_orders: 3,
  tips_lkr: 400,
};

const plain = (t: string) => /^[\x20-\x7E]*$/.test(t) && !/[[\]{}^~\\|]/.test(t);

describe('buildDailyReport', () => {
  it('has every field, in one plain line', () => {
    const t = buildDailyReport(full);
    expect(t).toBe(
      'Blynk Sun 25 Oct: Orders 42 placed, 38 delivered, 2 cancelled. Sales LKR 123,450. Cash LKR 98,000. Avg basket LKR 3,249. New customers 5. ' +
        'Top: Milk 1L x12, Eggs 10 pack x9, Rice 5kg x7. Low stock 6 (Milk 1L, Eggs, Rice). Rating 4.6 (12). Repeat orders 3. Tips LKR 400.'
    );
    expect(t.length).toBeLessThanOrEqual(REPORT_MAX_CHARS);
    expect(plain(t)).toBe(true);
    expect(smsParts(t)).toBeLessThanOrEqual(3);
  });

  it('an empty day is short and still sensible', () => {
    const t = buildDailyReport({
      ...full,
      orders_placed: 0,
      orders_delivered: 0,
      orders_cancelled: 0,
      sales_lkr: 0,
      cash_collected_lkr: 0,
      avg_basket_lkr: 0,
      new_customers: 0,
      top_products: [],
      low_stock_count: 0,
      low_stock_names: [],
      avg_rating: null,
      ratings_count: 0,
      repeat_orders: 0,
      tips_lkr: 0,
    });
    expect(t).toBe('Blynk Sun 25 Oct: Orders 0 placed, 0 delivered, 0 cancelled. Sales LKR 0. Cash LKR 0. New customers 0.');
    expect(smsParts(t)).toBe(1);
  });

  it('leaves out the optional lines that have nothing to say', () => {
    const t = buildDailyReport({ ...full, avg_rating: null, ratings_count: 0, repeat_orders: 0, tips_lkr: null, low_stock_count: 0, low_stock_names: [] });
    expect(t).not.toMatch(/Rating|Repeat|Tips|Low stock/);
    expect(t).toMatch(/Top: Milk 1L x12/);
  });

  it('shows the low stock count even when no names are known', () => {
    expect(buildDailyReport({ ...full, low_stock_names: [] })).toMatch(/Low stock 6\./);
  });

  it('truncates long names and stays under the cap', () => {
    const long = 'Extra Special Premium Organic Basmati Rice Family Value Pack 25kg';
    const t = buildDailyReport({
      ...full,
      top_products: [
        { name: long, quantity: 1234 },
        { name: long + ' B', quantity: 999 },
        { name: long + ' C', quantity: 888 },
      ],
      low_stock_names: [long, long + ' B', long + ' C'],
    });
    expect(t.length).toBeLessThanOrEqual(REPORT_MAX_CHARS);
    expect(t).toContain('...');
    expect(t).not.toContain(long);
    expect(t).toMatch(/Sales LKR 123,450\./); // the core line always stays
    expect(t).toMatch(/New customers 5\./);
  });

  it('never exceeds the cap, whatever the names and numbers', () => {
    const huge = 'N'.repeat(300);
    const t = buildDailyReport({
      ...full,
      sales_lkr: 987654321.9,
      cash_collected_lkr: 987654321,
      top_products: [1, 2, 3].map((i) => ({ name: huge + i, quantity: 99999 })),
      low_stock_names: [huge, huge, huge],
      low_stock_count: 999,
    });
    expect(t.length).toBeLessThanOrEqual(REPORT_MAX_CHARS);
    expect(plain(t)).toBe(true);
  });

  it('sends only plain GSM text: no emoji, no curly quotes, no Sinhala or Tamil letters', () => {
    const t = buildDailyReport({
      ...full,
      top_products: [
        { name: 'Milk “Fresh” 🥛', quantity: 3 },
        { name: 'Dad’s Curry [hot] {x}', quantity: 2 },
        { name: 'සිංහල தமிழ்', quantity: 1 },
      ],
      low_stock_names: ['Café €5'],
    });
    expect(plain(t)).toBe(true);
    expect(t).toContain('Milk "Fresh" x3');
    expect(t).toContain("Dad's Curry hot x x2");
    expect(t).toContain('item x1'); // a name with no plain letters left
  });

  it('formats money and dates without any locale', () => {
    expect(lkr(0)).toBe('0');
    expect(lkr(999.5)).toBe('1,000');
    expect(lkr(1234567.2)).toBe('1,234,567');
    expect(dateLabel('2026-01-05')).toBe('Mon 5 Jan');
  });

  it('counts SMS parts: 160 in one, then 153 each', () => {
    expect(smsParts('')).toBe(0);
    expect(smsParts('a'.repeat(160))).toBe(1);
    expect(smsParts('a'.repeat(161))).toBe(2);
    expect(smsParts('a'.repeat(306))).toBe(2);
    expect(smsParts('a'.repeat(307))).toBe(3);
  });

  it('gsmSafe maps and strips', () => {
    expect(gsmSafe('A–B × 2\n…')).toBe('A-B x 2 ...');
    expect(gsmSafe('😀')).toBe('');
  });
});

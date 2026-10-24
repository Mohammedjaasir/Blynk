import { describe, it, expect } from 'vitest';
import {
  batchTitle,
  chipLines,
  colomboToday,
  dayText,
  discardedText,
  parseBatchForm,
  summaryCount,
  unitsText,
} from '../lib/expiry';
import type { ExpirySummary } from '../api/expiry';

const summary: ExpirySummary = {
  today: '2026-10-25',
  expired: { batches: 2, units: 9 },
  week: { batches: 1, units: 1 },
  month: { batches: 0, units: 0 },
  within_3_days: 1,
  total_active: 7,
};

describe('expiry lib', () => {
  it('colomboToday is the Colombo day, not the UTC day', () => {
    expect(colomboToday(new Date('2026-10-24T19:00:00Z'))).toBe('2026-10-25');
    expect(colomboToday(new Date('2026-10-24T18:00:00Z'))).toBe('2026-10-24');
  });

  it('words', () => {
    expect(dayText('2026-10-25')).toBe('25 Oct 2026');
    expect(unitsText(1)).toBe('1 unit');
    expect(unitsText(1200)).toBe('1,200 units');
    expect(batchTitle({ product_name: 'Milk', variant_label: '1 L' })).toBe('Milk (1 L)');
    expect(batchTitle({ product_name: 'Milk', variant_label: null })).toBe('Milk');
    expect(discardedText('Milk', 4)).toBe('Milk discarded. 4 units taken off the stock count.');
    expect(discardedText('Milk', 0)).toBe('Milk discarded. Stock count unchanged.');
  });

  it('chips skip empty buckets and say nothing without a summary', () => {
    expect(chipLines(null)).toEqual([]);
    expect(chipLines(summary).map((c) => [c.severity, c.bucket])).toEqual([
      ['expired', 'expired'],
      ['red', 'week'],
    ]);
    expect(chipLines(summary)[0].text).toBe('2 expired (9 units)');
    expect(summaryCount(summary, 'week')).toBe(1);
    expect(summaryCount(summary, 'all')).toBe(7);
    expect(summaryCount(null, 'all')).toBeNull();
  });

  it('checks the batch form', () => {
    const base = { quantity: '12', expires_on: '2026-11-20', batch_code: ' L-4 ', note: '' };
    expect(parseBatchForm(base, '2026-10-25')).toEqual({ value: { quantity: 12, expires_on: '2026-11-20', batch_code: 'L-4', note: null } });
    expect('error' in parseBatchForm({ ...base, quantity: '' }, '2026-10-25')).toBe(true);
    expect('error' in parseBatchForm({ ...base, quantity: '0' }, '2026-10-25')).toBe(true);
    expect('error' in parseBatchForm({ ...base, quantity: '2.5' }, '2026-10-25')).toBe(true);
    expect('error' in parseBatchForm({ ...base, expires_on: '' }, '2026-10-25')).toBe(true);
    expect('error' in parseBatchForm({ ...base, expires_on: '2026-02-30' }, '2026-10-25')).toBe(true);
    expect('error' in parseBatchForm({ ...base, expires_on: '2024-01-01' }, '2026-10-25')).toBe(true); // too long ago
    expect('error' in parseBatchForm({ ...base, expires_on: '2026-10-20' }, '2026-10-25')).toBe(false); // stock found out of date
    expect('error' in parseBatchForm({ ...base, batch_code: 'x'.repeat(61) }, '2026-10-25')).toBe(true);
  });
});

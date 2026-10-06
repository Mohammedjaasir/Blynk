import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { catalogErrorMessage, parseDisplayOrder, planReorder } from '../lib/catalog';
import { replacedImages } from '../lib/image';
import { MAX_IMPORT_PAYLOAD_BYTES, importPayloadBytes, importTooLargeMessage } from '../lib/productImport';

describe('planReorder (promotions up/down)', () => {
  const rows = (...orders: number[]) => orders.map((display_order, i) => ({ id: `p${i + 1}`, display_order }));

  it('swaps two distinct neighbours, sending just those two', () => {
    expect(planReorder(rows(1, 2, 3), 'p2', 1)).toEqual([
      { id: 'p2', display_order: 3 },
      { id: 'p3', display_order: 2 },
    ]);
  });

  it('renumbers 10, 20, 30... in the new order when the neighbours are equal, so the move always shows', () => {
    expect(planReorder(rows(0, 0, 0), 'p3', -1)).toEqual([
      { id: 'p1', display_order: 10 },
      { id: 'p3', display_order: 20 },
      { id: 'p2', display_order: 30 },
    ]);
  });

  it('only sends the rows whose number changed', () => {
    expect(planReorder(rows(10, 5, 5, 40), 'p2', 1)).toEqual([
      { id: 'p3', display_order: 20 },
      { id: 'p2', display_order: 30 },
    ]);
  });

  it('stays inside the 0-1000 range for a long list', () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ id: `p${i}`, display_order: 0 }));
    const items = planReorder(many, 'p1', -1);
    expect(Math.max(...items.map((i) => i.display_order))).toBeLessThanOrEqual(1000);
  });

  it('does nothing at either end', () => {
    expect(planReorder(rows(1, 2), 'p1', -1)).toEqual([]);
    expect(planReorder(rows(1, 2), 'p2', 1)).toEqual([]);
  });
});

describe('parseDisplayOrder', () => {
  it('accepts whole numbers in range and treats empty as 0', () => {
    expect(parseDisplayOrder('7', 1000)).toEqual({ value: 7 });
    expect(parseDisplayOrder(' ', 1000)).toEqual({ value: 0 });
    expect(parseDisplayOrder('1000', 1000)).toEqual({ value: 1000 });
  });

  it.each(['1.5', '-1', 'abc', '1001'])('refuses %s for promotions with an inline message', (input) => {
    expect(parseDisplayOrder(input, 1000)).toEqual({ error: 'Order must be a whole number from 0 to 1000.' });
  });

  it('has no upper bound when none is given', () => {
    expect(parseDisplayOrder('5000')).toEqual({ value: 5000 });
    expect(parseDisplayOrder('2.5')).toEqual({ error: 'Order must be a whole number, 0 or more.' });
  });
});

describe('replacedImages', () => {
  it('lists only the old files the saved record no longer uses', () => {
    expect(replacedImages(['a', 'b'], ['a', null])).toEqual(['b']);
    expect(replacedImages([null, undefined], ['x'])).toEqual([]);
    expect(replacedImages(['a', 'a'], [null])).toEqual(['a']);
    // Moved from one field to the other: still in use.
    expect(replacedImages(['a', null], [null, 'a'])).toEqual([]);
  });
});

describe('import request size', () => {
  it('measures the exact request body', () => {
    expect(importPayloadBytes([{ a: 1 }], true)).toBe(JSON.stringify({ rows: [{ a: 1 }], dry_run: true }).length);
  });

  it('passes a small import and stops one over 1 MB with a split suggestion', () => {
    expect(importTooLargeMessage([{ name: 'Milk' }], true)).toBeNull();
    const rows = Array.from({ length: 1000 }, () => ({ description: 'x'.repeat(1200) }));
    expect(importPayloadBytes(rows, true)).toBeGreaterThan(MAX_IMPORT_PAYLOAD_BYTES);
    expect(importTooLargeMessage(rows, true)).toMatch(/too big to send at once \(1\.\d MB; the limit is 1 MB\)\. Split it into files of about \d+ rows/);
  });

  it('a 413 from the API is explained, not shown raw', () => {
    expect(catalogErrorMessage(new ApiError('request entity too large', 413, 'PAYLOAD_TOO_LARGE'))).toMatch(/too much to send at once/);
    expect(catalogErrorMessage(new ApiError('too big', 413, 'FILE_TOO_LARGE'))).toBe('That image is larger than 2 MB. Choose a smaller one.');
  });
});

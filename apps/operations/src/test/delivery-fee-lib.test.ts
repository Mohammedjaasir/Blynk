import { describe, expect, it } from 'vitest';
import {
  BASE_PER_KM_DEFAULTS,
  basePerKmFee,
  basePerKmOf,
  basePerKmPreview,
  basePerKmText,
  basketFreeDeliveryText,
  parseBaseKm,
  parseBaseLkr,
  parseBasePerKm,
  parsePerKmLkr,
  parseRadiusKm,
  parseSmallOrderFeeLkr,
  parseSmallOrderMin,
  smallOrderFeeBody,
  smallOrderFeeOf,
  smallOrderFeeSummary,
} from '../lib/deliveryFee';

/** Delivery fee base + per km, small-order fee, radius (2026-10-25 fees contract). */

const F = BASE_PER_KM_DEFAULTS; // 120 up to 2 km, then 40 per started km

describe('basePerKmFee: base up to base_km, then every started km', () => {
  it.each([
    [1.5, 120],
    [2.0, 120],
    [2.1, 160],
    [3.0, 160],
    [3.4, 200],
    [4.8, 240],
    [5.6, 280],
    [0, 120],
    [-1, 120],
    [Number.NaN, 120],
  ])('%s km -> LKR %s (default 120 / 2 km / 40)', (km, fee) => {
    expect(basePerKmFee(km, F)).toBe(fee);
  });

  it('rounds the distance to 2 decimals first and ignores float noise', () => {
    expect(basePerKmFee(2.004, F)).toBe(120); // rounds to 2.00
    expect(basePerKmFee(2.005, F)).toBe(160); // rounds to 2.01
    expect(basePerKmFee(0.1 + 0.2 + 1.7, F)).toBe(120); // 2.0000000000000004
    expect(basePerKmFee(3.0000000001, F)).toBe(160);
  });

  it('works with a fractional base and per-km with decimals', () => {
    const f = { base_lkr: 99.5, base_km: 0.5, per_km_lkr: 12.25 };
    expect(basePerKmFee(0.5, f)).toBe(99.5);
    expect(basePerKmFee(0.51, f)).toBe(111.75);
    expect(basePerKmFee(5.5, f)).toBe(160.75); // 5 extra km
  });

  it('applies the optional cap', () => {
    expect(basePerKmFee(5.6, F, 250)).toBe(250);
    expect(basePerKmFee(3.4, F, 250)).toBe(200);
    expect(basePerKmFee(5.6, F, null)).toBe(280);
  });
});

describe('preview and texts', () => {
  it('lists the seven preview distances in order', () => {
    expect(basePerKmPreview(F).map((r) => [r.km, r.fee])).toEqual([
      [1.5, 120],
      [2, 120],
      [2.1, 160],
      [3, 160],
      [3.4, 200],
      [4.8, 240],
      [5.6, 280],
    ]);
    expect(basePerKmPreview(F, 200).map((r) => r.fee)).toEqual([120, 120, 160, 160, 200, 200, 200]);
  });

  it('words the formula', () => {
    expect(basePerKmText(F)).toBe('LKR 120 up to 2 km, then LKR 40 for each extra km');
    expect(basePerKmText({ base_lkr: 99.5, base_km: 1.5, per_km_lkr: 30 }, 250)).toBe(
      'LKR 99.50 up to 1.5 km, then LKR 30 for each extra km · max LKR 250'
    );
  });

  it('falls back to the defaults for values an older API leaves out', () => {
    expect(basePerKmOf({})).toEqual(F);
    expect(basePerKmOf({ base_lkr: 150 })).toEqual({ base_lkr: 150, base_km: 2, per_km_lkr: 40 });
  });
});

describe('base + per km parsers', () => {
  it('base fee: 0..1000, 2 decimals', () => {
    expect(parseBaseLkr('120')).toEqual({ value: 120 });
    expect(parseBaseLkr('0')).toEqual({ value: 0 });
    expect(parseBaseLkr('LKR 99.50')).toEqual({ value: 99.5 });
    expect(parseBaseLkr('')).toHaveProperty('error');
    expect(parseBaseLkr('abc')).toHaveProperty('error');
    expect(parseBaseLkr('10.555')).toEqual({ error: 'Base fee: Use at most 2 decimals.' });
    expect(parseBaseLkr('1000.01')).toEqual({ error: 'Base fee: Enter at most 1,000.' });
  });

  it('covers the first km: 0.5..20, 1 decimal', () => {
    expect(parseBaseKm('2')).toEqual({ value: 2 });
    expect(parseBaseKm('0.5')).toEqual({ value: 0.5 });
    expect(parseBaseKm('20 km')).toEqual({ value: 20 });
    expect(parseBaseKm('0.4')).toHaveProperty('error');
    expect(parseBaseKm('0')).toHaveProperty('error');
    expect(parseBaseKm('20.5')).toHaveProperty('error');
    expect(parseBaseKm('2.25')).toEqual({ error: 'Covers the first km: Use at most 1 decimal.' });
  });

  it('per extra km: 0..1000, 2 decimals', () => {
    expect(parsePerKmLkr('40')).toEqual({ value: 40 });
    expect(parsePerKmLkr('0')).toEqual({ value: 0 });
    expect(parsePerKmLkr('1001')).toHaveProperty('error');
    expect(parsePerKmLkr('1.234')).toHaveProperty('error');
  });

  it('parseBasePerKm returns all three or the first problem', () => {
    expect(parseBasePerKm({ base: '120', baseKm: '2', perKm: '40' })).toEqual({ value: F });
    expect(parseBasePerKm({ base: 'x', baseKm: '2', perKm: '40' })).toHaveProperty('error');
    expect(parseBasePerKm({ base: '120', baseKm: '0.1', perKm: '40' })).toHaveProperty('error');
    expect(parseBasePerKm({ base: '120', baseKm: '2', perKm: '' })).toHaveProperty('error');
  });
});

describe('small-order fee', () => {
  it('parses the amount (1..100000) and the fee (0.01..1000)', () => {
    expect(parseSmallOrderMin('1000')).toEqual({ value: 1000 });
    expect(parseSmallOrderMin('1')).toEqual({ value: 1 });
    expect(parseSmallOrderMin('0.99')).toHaveProperty('error');
    expect(parseSmallOrderMin('100001')).toHaveProperty('error');
    expect(parseSmallOrderMin('1000.123')).toHaveProperty('error');
    expect(parseSmallOrderFeeLkr('50')).toEqual({ value: 50 });
    expect(parseSmallOrderFeeLkr('0.01')).toEqual({ value: 0.01 });
    expect(parseSmallOrderFeeLkr('0')).toHaveProperty('error');
    expect(parseSmallOrderFeeLkr('1000.5')).toHaveProperty('error');
    expect(parseSmallOrderFeeLkr('5.123')).toHaveProperty('error');
  });

  it('builds the PATCH body, or the first problem', () => {
    expect(smallOrderFeeBody({ enabled: true, min: '1,500', fee: '60' })).toEqual({
      small_order_fee: { enabled: true, min_subtotal_lkr: 1500, fee_lkr: 60 },
    });
    expect(smallOrderFeeBody({ enabled: false, min: '', fee: '60' })).toHaveProperty('error');
    expect(smallOrderFeeBody({ enabled: true, min: '1000', fee: '0' })).toHaveProperty('error');
  });

  it('defaults to off / 1000 / 50 when the API does not send it', () => {
    expect(smallOrderFeeOf(null)).toEqual({ enabled: false, min_subtotal_lkr: 1000, fee_lkr: 50 });
    expect(smallOrderFeeOf({ small_order_fee: { enabled: true, min_subtotal_lkr: 800, fee_lkr: 30 } }).min_subtotal_lkr).toBe(800);
  });

  it('summarises it', () => {
    expect(smallOrderFeeSummary({ enabled: true, min_subtotal_lkr: 1000, fee_lkr: 50 })).toBe(
      'Customers whose items total under LKR 1,000 pay LKR 50 on top of delivery.'
    );
  });
});

describe('free delivery wording and delivery radius', () => {
  it('names the amount typed, or points at the field', () => {
    expect(basketFreeDeliveryText('3000')).toBe('Free delivery when the item total is at least LKR 3,000.');
    expect(basketFreeDeliveryText('2999.5')).toBe('Free delivery when the item total is at least LKR 2,999.50.');
    expect(basketFreeDeliveryText('')).toBe('Free delivery when the item total is at least the amount below.');
    expect(basketFreeDeliveryText('abc')).toBe('Free delivery when the item total is at least the amount below.');
  });

  it('radius: 0.5..50 km, at most 2 decimals', () => {
    expect(parseRadiusKm('4')).toEqual({ value: 4 });
    expect(parseRadiusKm('6 km')).toEqual({ value: 6 });
    expect(parseRadiusKm('0.5')).toEqual({ value: 0.5 });
    expect(parseRadiusKm('12.25')).toEqual({ value: 12.25 });
    expect(parseRadiusKm('0.4')).toHaveProperty('error');
    expect(parseRadiusKm('50.01')).toHaveProperty('error');
    expect(parseRadiusKm('1.234')).toEqual({ error: 'Delivery radius: Use at most 2 decimals.' });
    expect(parseRadiusKm('')).toHaveProperty('error');
  });
});

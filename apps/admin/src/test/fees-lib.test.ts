import { describe, it, expect } from 'vitest';
import {
  BASE_PER_KM_EXAMPLE_KMS,
  basePerKmFee,
  basePerKmPreview,
  basePerKmSummary,
  parseBaseFee,
  parseBaseKm,
  parsePerKmFee,
} from '../lib/deliveryFee';
import { parseRadiusKm } from '../lib/deliveryRadius';
import {
  DEFAULT_SMALL_ORDER_FEE,
  parseSmallOrderFeeAmount,
  parseSmallOrderMin,
  smallOrderFeeNeedsMigration,
  smallOrderFeeText,
  storedSmallOrderFee,
} from '../lib/smallOrderFee';
import type { CheckoutSettings } from '../api/types';

/**
 * Delivery fee formula, small-order fee and delivery radius (owner, 2026-10-25;
 * docs/superpowers/plans/2026-10-25-fees.md). The formula mirrors the API.
 */

const DEFAULTS = { baseLkr: 120, baseKm: 2, perKmLkr: 40 };

describe('basePerKmFee - base + per started km', () => {
  it('matches the contract table: 1.5 -> 120, 2.0 -> 120, 2.1 -> 160, 3.0 -> 160, 3.4 -> 200, 4.8 -> 240, 5.6 -> 280', () => {
    const table: [number, number][] = [
      [1.5, 120],
      [2, 120],
      [2.1, 160],
      [3, 160],
      [3.4, 200],
      [4.8, 240],
      [5.6, 280],
    ];
    for (const [km, fee] of table) expect(basePerKmFee(km, DEFAULTS), `${km} km`).toBe(fee);
  });

  it('charges the base for a trip of 0 km, a missing or a negative distance', () => {
    expect(basePerKmFee(0, DEFAULTS)).toBe(120);
    expect(basePerKmFee(-1, DEFAULTS)).toBe(120);
    expect(basePerKmFee(Number.NaN, DEFAULTS)).toBe(120);
  });

  it('rounds the distance to 2 decimals first: 2.004 km is still within a 2 km base, 2.006 starts a new km', () => {
    expect(basePerKmFee(2.004, DEFAULTS)).toBe(120);
    expect(basePerKmFee(2.006, DEFAULTS)).toBe(160);
  });

  it('is not fooled by float noise at an exact km boundary', () => {
    // 3.1 - 0.1 is 3.0000000000000004 in floating point: still exactly 3 extra km, not 4.
    expect(basePerKmFee(3.1, { baseLkr: 100, baseKm: 0.1, perKmLkr: 10 })).toBe(130);
    expect(basePerKmFee(2.3, { baseLkr: 100, baseKm: 1.3, perKmLkr: 10 })).toBe(110);
    expect(basePerKmFee(4, DEFAULTS)).toBe(200);
  });

  it('applies the optional maximum fee, and none when blank', () => {
    expect(basePerKmFee(5.6, DEFAULTS, 250)).toBe(250);
    expect(basePerKmFee(2.1, DEFAULTS, 250)).toBe(160);
    expect(basePerKmFee(5.6, DEFAULTS, null)).toBe(280);
    expect(basePerKmFee(5.6, DEFAULTS, undefined)).toBe(280);
  });

  it('keeps 2 decimals', () => {
    expect(basePerKmFee(3.4, { baseLkr: 99.5, baseKm: 2, perKmLkr: 37.25 })).toBe(174);
    expect(basePerKmFee(2.5, { baseLkr: 99.99, baseKm: 2, perKmLkr: 0.01 })).toBe(100);
  });

  it('a 0 per-km fee is a flat base', () => {
    expect(basePerKmFee(9, { baseLkr: 80, baseKm: 2, perKmLkr: 0 })).toBe(80);
  });
});

describe('basePerKmPreview / basePerKmSummary', () => {
  it('previews 1.5, 2, 2.1, 3, 3.4, 4.8 and 5.6 km', () => {
    expect(BASE_PER_KM_EXAMPLE_KMS).toEqual([1.5, 2, 2.1, 3, 3.4, 4.8, 5.6]);
    expect(basePerKmPreview(DEFAULTS)).toEqual([
      { km: 1.5, fee: 120 },
      { km: 2, fee: 120 },
      { km: 2.1, fee: 160 },
      { km: 3, fee: 160 },
      { km: 3.4, fee: 200 },
      { km: 4.8, fee: 240 },
      { km: 5.6, fee: 280 },
    ]);
    expect(basePerKmPreview(DEFAULTS, 200).map((r) => r.fee)).toEqual([120, 120, 160, 160, 200, 200, 200]);
  });

  it('says it the way the customer cart does', () => {
    expect(basePerKmSummary(DEFAULTS)).toBe('LKR 120 up to 2 km, then LKR 40 for each extra km');
    expect(basePerKmSummary({ baseLkr: 99.5, baseKm: 2.5, perKmLkr: 37.25 })).toBe(
      'LKR 99.50 up to 2.5 km, then LKR 37.25 for each extra km'
    );
  });
});

describe('base + per km parsers', () => {
  it('base fee: 0..1000, 2 decimals', () => {
    expect(parseBaseFee('120')).toEqual({ value: 120 });
    expect(parseBaseFee('LKR 1,000')).toEqual({ value: 1000 });
    expect(parseBaseFee('0')).toEqual({ value: 0 });
    expect(parseBaseFee('99.5')).toEqual({ value: 99.5 });
    expect(parseBaseFee('')).toHaveProperty('error');
    expect(parseBaseFee('abc')).toHaveProperty('error');
    expect(parseBaseFee('-5')).toHaveProperty('error');
    expect(parseBaseFee('1000.01')).toHaveProperty('error');
    expect(parseBaseFee('1.234')).toHaveProperty('error');
  });

  it('covers the first km: 0.5..20, 1 decimal', () => {
    expect(parseBaseKm('2')).toEqual({ value: 2 });
    expect(parseBaseKm('0.5')).toEqual({ value: 0.5 });
    expect(parseBaseKm('20')).toEqual({ value: 20 });
    expect(parseBaseKm('2.5')).toEqual({ value: 2.5 });
    expect(parseBaseKm('0.4')).toHaveProperty('error');
    expect(parseBaseKm('20.5')).toHaveProperty('error');
    expect(parseBaseKm('2.25')).toHaveProperty('error');
    expect(parseBaseKm('')).toHaveProperty('error');
    expect(parseBaseKm('two')).toHaveProperty('error');
  });

  it('each extra km: 0..1000, 2 decimals', () => {
    expect(parsePerKmFee('40')).toEqual({ value: 40 });
    expect(parsePerKmFee('0')).toEqual({ value: 0 });
    expect(parsePerKmFee('37.5')).toEqual({ value: 37.5 });
    expect(parsePerKmFee('1001')).toHaveProperty('error');
    expect(parsePerKmFee('4.999')).toHaveProperty('error');
    expect(parsePerKmFee('')).toHaveProperty('error');
  });
});

describe('small-order fee helpers', () => {
  it('item total under: 1..100,000, 2 decimals', () => {
    expect(parseSmallOrderMin('1000')).toEqual({ value: 1000 });
    expect(parseSmallOrderMin('1')).toEqual({ value: 1 });
    expect(parseSmallOrderMin('100,000')).toEqual({ value: 100000 });
    expect(parseSmallOrderMin('999.5')).toEqual({ value: 999.5 });
    expect(parseSmallOrderMin('0')).toHaveProperty('error');
    expect(parseSmallOrderMin('0.5')).toHaveProperty('error');
    expect(parseSmallOrderMin('100001')).toHaveProperty('error');
    expect(parseSmallOrderMin('10.123')).toHaveProperty('error');
    expect(parseSmallOrderMin('')).toHaveProperty('error');
    expect(parseSmallOrderMin('x')).toHaveProperty('error');
  });

  it('fee: 0.01..1000, 2 decimals', () => {
    expect(parseSmallOrderFeeAmount('50')).toEqual({ value: 50 });
    expect(parseSmallOrderFeeAmount('0.01')).toEqual({ value: 0.01 });
    expect(parseSmallOrderFeeAmount('1000')).toEqual({ value: 1000 });
    expect(parseSmallOrderFeeAmount('0')).toHaveProperty('error');
    expect(parseSmallOrderFeeAmount('1000.01')).toHaveProperty('error');
    expect(parseSmallOrderFeeAmount('1.005')).toHaveProperty('error');
    expect(parseSmallOrderFeeAmount('')).toHaveProperty('error');
  });

  const base: CheckoutSettings = {
    coupons_enabled: false,
    new_customer_free_deliveries: { enabled: true, count: 2, since: '2026-10-08T18:30:00.000Z' },
    updated_at: null,
  };

  it('falls back to the defaults (off, LKR 1,000 / LKR 50) when the API has none', () => {
    expect(storedSmallOrderFee(null)).toEqual({ enabled: false, min_subtotal_lkr: 1000, fee_lkr: 50 });
    expect(storedSmallOrderFee(base)).toEqual(DEFAULT_SMALL_ORDER_FEE);
    const set = { enabled: true, min_subtotal_lkr: 1500, fee_lkr: 75 };
    expect(storedSmallOrderFee({ ...base, small_order_fee: set })).toEqual(set);
  });

  it('flags the missing migration only when the API says ready is false', () => {
    expect(smallOrderFeeNeedsMigration({ ...base, small_order_fee_ready: false })).toBe(true);
    expect(smallOrderFeeNeedsMigration({ ...base, small_order_fee_ready: true })).toBe(false);
    expect(smallOrderFeeNeedsMigration(base)).toBe(false);
    expect(smallOrderFeeNeedsMigration(null)).toBe(false);
  });

  it('describes the stored fee', () => {
    expect(smallOrderFeeText({ enabled: false, min_subtotal_lkr: 1000, fee_lkr: 50 })).toBe('off');
    expect(smallOrderFeeText({ enabled: true, min_subtotal_lkr: 1000, fee_lkr: 50 })).toBe(
      'LKR 50 when the items come to less than LKR 1,000'
    );
  });
});

describe('parseRadiusKm', () => {
  it('0.5..50 km, 2 decimals', () => {
    expect(parseRadiusKm('4')).toEqual({ km: 4 });
    expect(parseRadiusKm('6 km')).toEqual({ km: 6 });
    expect(parseRadiusKm('0.5')).toEqual({ km: 0.5 });
    expect(parseRadiusKm('50')).toEqual({ km: 50 });
    expect(parseRadiusKm('4.25')).toEqual({ km: 4.25 });
    expect(parseRadiusKm('0.49')).toHaveProperty('error');
    expect(parseRadiusKm('50.01')).toHaveProperty('error');
    expect(parseRadiusKm('4.255')).toHaveProperty('error');
    expect(parseRadiusKm('')).toHaveProperty('error');
    expect(parseRadiusKm('six')).toHaveProperty('error');
  });
});

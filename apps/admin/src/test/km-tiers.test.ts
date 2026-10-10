import { describe, it, expect } from 'vitest';
import {
  formatTierLkr,
  kmCounted,
  parseFeeCap,
  parseTierAmount,
  parseTierDrafts,
  tierAmounts,
  tierExampleText,
  tierTotal,
  tiersOrNull,
  tiersSummary,
  tiersToDrafts,
} from '../lib/kmTiers';
import {
  describePay,
  fillDraftBlanks,
  linearTierDrafts,
  modelDraftFrom,
  modelDraftToInput,
  newPayDraft,
  payDraftFrom,
  payDraftToInput,
} from '../lib/riderPay';
import type { PayParams } from '../api/types';

/**
 * Per-km tier pricing (owner, 2026-10-10): every started km counts and the
 * last tier's amount repeats. The API is the authority; these pin the
 * mirror the editors use for live examples and client-side checks.
 */

const TIERS = [
  { km: 1, lkr: 100 },
  { km: 2, lkr: 60 },
  { km: 3, lkr: 50 },
];

describe('kmTiers formula (owner, 2026-10-10)', () => {
  it('counts every started km, at least 1', () => {
    expect(kmCounted(2.3)).toBe(3);
    expect(kmCounted(2)).toBe(2);
    expect(kmCounted(0.4)).toBe(1);
    expect(kmCounted(0)).toBe(1);
    expect(kmCounted(-1)).toBe(1);
    expect(kmCounted(Number.NaN)).toBe(1);
  });

  it('repeats the last tier and sums, with an optional cap', () => {
    expect(tierAmounts(TIERS, 5)).toEqual([100, 60, 50, 50, 50]);
    expect(tierAmounts(TIERS, 1)).toEqual([100]);
    expect(tierAmounts([], 3)).toEqual([]);
    expect(tierTotal(TIERS, 3)).toBe(210);
    expect(tierTotal(TIERS, 5)).toBe(310);
    expect(tierTotal(TIERS, 2.3)).toBe(210);
    expect(tierTotal(TIERS, 5, 250)).toBe(250);
    expect(tierTotal(TIERS, 1, 250)).toBe(100);
    expect(tierTotal(TIERS, 5, null)).toBe(310);
    expect(tierTotal([{ km: 1, lkr: 0.1 }, { km: 2, lkr: 0.2 }], 2)).toBe(0.3);
  });

  it('writes the live example the contract shows', () => {
    expect(tierExampleText(TIERS, 3)).toBe('3 km = LKR 100 + 60 + 50 = LKR 210');
    expect(tierExampleText(TIERS, 5)).toBe('5 km = LKR 100 + 60 + 50 + 50 + 50 = LKR 310');
    expect(tierExampleText(TIERS, 1)).toBe('1 km = LKR 100');
    expect(tierExampleText(TIERS, 5, 250)).toBe('5 km = LKR 100 + 60 + 50 + 50 + 50 = LKR 310, capped at LKR 250');
    expect(tierExampleText([{ km: 1, lkr: 62.5 }], 2)).toBe('2 km = LKR 62.50 + 62.50 = LKR 125');
    expect(tierExampleText([], 3)).toBe('');
    expect(formatTierLkr(1250)).toBe('1,250');
    expect(formatTierLkr(99.9)).toBe('99.90');
  });

  it('summarises tiers in plain words', () => {
    expect(tiersSummary(TIERS)).toBe('km 1 LKR 100, km 2 LKR 60, km 3+ LKR 50');
    expect(tiersSummary([{ km: 1, lkr: 80 }])).toBe('LKR 80 per km');
    expect(tiersSummary([])).toBe('no km amounts set');
    expect(tiersToDrafts(TIERS)).toEqual(['100', '60', '50']);
    expect(tiersToDrafts([{ km: 1, lkr: 62.5 }])).toEqual(['62.5']);
    expect(tiersToDrafts(null)).toEqual([]);
  });

  it('validates amounts (0..1000, 2 decimals), rows (1..10) and the cap (0..10000, blank = none)', () => {
    expect(parseTierAmount('0')).toEqual({ value: 0 });
    expect(parseTierAmount(' 1000 ')).toEqual({ value: 1000 });
    expect(parseTierAmount('LKR 62.50')).toEqual({ value: 62.5 });
    expect(parseTierAmount('1000.01')).toHaveProperty('error');
    expect(parseTierAmount('12.345')).toEqual({ error: 'Use at most 2 decimal places.' });
    expect(parseTierAmount('')).toHaveProperty('error');
    expect(parseTierAmount('-5')).toHaveProperty('error');

    expect(parseTierDrafts(['100', '60', '50'])).toEqual({ tiers: TIERS });
    const bad = parseTierDrafts(['100', 'abc', '2000']);
    expect(bad).toHaveProperty('errors.rows.1');
    expect(bad).toHaveProperty('errors.rows.2');
    expect(bad).not.toHaveProperty('errors.rows.0');
    expect(parseTierDrafts([])).toHaveProperty('errors.list');
    expect(parseTierDrafts(Array(11).fill('10'))).toHaveProperty('errors.list');
    expect(parseTierDrafts(Array(10).fill('10'))).toHaveProperty('tiers');
    expect(tiersOrNull(['100', ''])).toBeNull();
    expect(tiersOrNull(['100'])).toEqual([{ km: 1, lkr: 100 }]);

    expect(parseFeeCap('')).toEqual({ cap: null });
    expect(parseFeeCap(' 400 ')).toEqual({ cap: 400 });
    expect(parseFeeCap('0')).toEqual({ cap: 0 });
    expect(parseFeeCap('10000')).toEqual({ cap: 10000 });
    expect(parseFeeCap('10000.5')).toHaveProperty('error');
    expect(parseFeeCap('1.234')).toHaveProperty('error');
    expect(parseFeeCap('x')).toHaveProperty('error');
  });
});

const DEFAULTS: PayParams = { model: 'DISTANCE', percent: 80, fixed_lkr: 80, base_lkr: 50, per_km_lkr: 20, min_lkr: null };

describe('rider pay with per-km tiers (owner, 2026-10-10)', () => {
  it('describes tier pay, and linear pay as before', () => {
    expect(describePay({ ...DEFAULTS, distance_mode: 'TIERS', km_tiers: TIERS, min_lkr: 120 })).toBe(
      'By km: km 1 LKR 100, km 2 LKR 60, km 3+ LKR 50 · min LKR 120'
    );
    expect(describePay({ ...DEFAULTS, distance_mode: 'LINEAR', km_tiers: TIERS })).toBe('LKR 50 + LKR 20/km');
    expect(describePay(DEFAULTS)).toBe('LKR 50 + LKR 20/km');
  });

  it('starts tier boxes from the linear pay when no tiers are stored', () => {
    expect(linearTierDrafts('50', '20')).toEqual(['70', '20']);
    expect(linearTierDrafts(50, 12.5)).toEqual(['62.5', '12.5']);
    expect(linearTierDrafts('', '20')).toEqual(['']);
    expect(modelDraftFrom(DEFAULTS).tiers).toEqual(['70', '20']);
    expect(modelDraftFrom(DEFAULTS).distanceMode).toBeUndefined();
    expect(modelDraftFrom({ ...DEFAULTS, distance_mode: 'TIERS', km_tiers: TIERS })).toMatchObject({
      distanceMode: 'TIERS',
      tiers: ['100', '60', '50'],
    });
  });

  it('builds the store default body for each distance mode', () => {
    const d = { model: 'DISTANCE' as const, percent: '80', fixed: '80', base: '50', perKm: '20', min: '' };
    expect(modelDraftToInput({ ...d, distanceMode: 'TIERS', tiers: ['100', '60', '50'] })).toEqual({
      input: { model: 'DISTANCE', distance_mode: 'TIERS', km_tiers: TIERS, min_lkr: null },
    });
    expect(modelDraftToInput({ ...d, distanceMode: 'LINEAR', tiers: ['100'] })).toEqual({
      input: { model: 'DISTANCE', base_lkr: 50, per_km_lkr: 20, distance_mode: 'LINEAR', min_lkr: null },
    });
    // An API from before the tiers (mode unknown): the old body.
    expect(modelDraftToInput(d)).toEqual({ input: { model: 'DISTANCE', base_lkr: 50, per_km_lkr: 20, min_lkr: null } });
    expect(modelDraftToInput({ ...d, distanceMode: 'TIERS', tiers: ['100', '1001'] })).toHaveProperty('errors.tiers.rows.1');
  });

  it("builds a rider's own body: tiers with the minimum, linear pinned, store default clears", () => {
    const base = { payType: 'COMMISSION' as const, percent: '80', fixed: '90', base: '50', perKm: '20', min: '100' };
    expect(payDraftToInput({ ...base, model: 'DISTANCE', distanceMode: 'TIERS', tiers: ['100', '60', '50'] })).toEqual({
      input: { pay_type: 'COMMISSION', pay_model: 'DISTANCE', distance_mode: 'TIERS', km_tiers: TIERS, min_lkr: 100 },
    });
    expect(payDraftToInput({ ...base, model: 'DISTANCE', distanceMode: 'LINEAR' })).toEqual({
      input: { pay_type: 'COMMISSION', pay_model: 'DISTANCE', base_lkr: 50, per_km_lkr: 20, distance_mode: 'LINEAR', min_lkr: 100 },
    });
    expect(payDraftToInput({ ...base, model: 'DISTANCE', distanceMode: 'TIERS', tiers: [] })).toHaveProperty('errors.tiers.list');
    expect(payDraftToInput({ ...base, model: 'DEFAULT', distanceMode: 'TIERS', tiers: ['1'] })).toEqual({
      input: { pay_type: 'COMMISSION', pay_model: null, commission_percent: null },
    });
  });

  it("reads a rider's own mode, else the effective / store default one", () => {
    const tierDefaults: PayParams = { ...DEFAULTS, distance_mode: 'TIERS', km_tiers: TIERS };
    const own = { fixed_lkr: null, base_lkr: null, per_km_lkr: null, min_lkr: null };
    expect(
      payDraftFrom(
        {
          pay_type: 'COMMISSION',
          commission_percent: null,
          pay_model: 'DISTANCE',
          own: { ...own, distance_mode: 'TIERS', km_tiers: [{ km: 1, lkr: 90 }] },
        },
        { ...DEFAULTS, distance_mode: 'LINEAR', km_tiers: [] }
      )
    ).toMatchObject({ model: 'DISTANCE', distanceMode: 'TIERS', tiers: ['90'] });
    // null = the store default's mode and tiers.
    expect(
      payDraftFrom(
        { pay_type: 'COMMISSION', commission_percent: null, pay_model: 'DISTANCE', own: { ...own, distance_mode: null, km_tiers: null } },
        tierDefaults
      )
    ).toMatchObject({ distanceMode: 'TIERS', tiers: ['100', '60', '50'] });
    expect(newPayDraft(tierDefaults)).toMatchObject({ distanceMode: 'TIERS', tiers: ['100', '60', '50'] });
    expect(newPayDraft(null)).toMatchObject({ distanceMode: undefined, tiers: [''] });
    // The store default loading late fills the mode and empty tier boxes.
    expect(fillDraftBlanks(newPayDraft(null), tierDefaults)).toMatchObject({ distanceMode: 'TIERS', tiers: ['100', '60', '50'] });
  });
});

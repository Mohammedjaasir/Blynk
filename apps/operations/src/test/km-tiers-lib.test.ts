import { describe, expect, it } from 'vitest';
import type { PayParams } from '../api/types';
import {
  kmCounted,
  linearToRows,
  parseMaxFee,
  parseTierAmount,
  parseTierRows,
  tierAmountText,
  tierBreakdown,
  tierExampleText,
  tierTotal,
  tiersIfValid,
  tiersSummary,
  tiersToRows,
} from '../lib/kmTiers';
import { describePay, fillDraftBlanks, newPayDraft, payDraftFrom, payDraftToInput } from '../lib/riderPay';

/** Per-km tier pricing (owner, 2026-10-10): the formula and the editors' helpers. */

const OWNER_TIERS = [
  { km: 1, lkr: 100 },
  { km: 2, lkr: 60 },
  { km: 3, lkr: 50 },
];

describe('kmCounted: every started km counts, at least 1', () => {
  it.each([
    [2.3, 3],
    [2.0, 2],
    [0.4, 1],
    [0, 1],
    [-3, 1],
    [Number.NaN, 1],
    [1.0000000001, 1], // float noise is not a started km
    [10.01, 11],
  ])('%s km -> %s', (km, expected) => {
    expect(kmCounted(km)).toBe(expected);
  });
});

describe('tierTotal / tierBreakdown', () => {
  it('sums km 1..n with the last row repeating (contract examples)', () => {
    expect(tierTotal(OWNER_TIERS, 3)).toBe(210);
    expect(tierTotal(OWNER_TIERS, 5)).toBe(310);
    expect(tierTotal(OWNER_TIERS, 1)).toBe(100);
    expect(tierTotal(OWNER_TIERS, 0.4)).toBe(100);
    expect(tierTotal(OWNER_TIERS, 2.3)).toBe(210);
    expect(tierBreakdown(OWNER_TIERS, 5).amounts).toEqual([100, 60, 50, 50, 50]);
  });

  it('a single row is a plain per-km price', () => {
    expect(tierTotal([{ km: 1, lkr: 40 }], 4)).toBe(160);
  });

  it('applies the optional cap only when the sum is higher', () => {
    expect(tierBreakdown(OWNER_TIERS, 5, 250)).toMatchObject({ sum: 310, total: 250, capped: true });
    expect(tierBreakdown(OWNER_TIERS, 2, 250)).toMatchObject({ sum: 160, total: 160, capped: false });
    expect(tierTotal(OWNER_TIERS, 5, 0)).toBe(0);
    expect(tierTotal(OWNER_TIERS, 5, null)).toBe(310);
  });

  it('rounds decimal sums to cents', () => {
    expect(tierTotal([{ km: 1, lkr: 0.1 }, { km: 2, lkr: 0.2 }], 2)).toBe(0.3);
  });
});

describe('texts', () => {
  it('amounts: whole without decimals, else 2 decimals', () => {
    expect(tierAmountText(100)).toBe('100');
    expect(tierAmountText(12.5)).toBe('12.50');
    expect(tierAmountText(1500)).toBe('1,500');
  });

  it('the live example', () => {
    expect(tierExampleText(OWNER_TIERS, 3)).toBe('3 km = LKR 100 + 60 + 50 = LKR 210');
    expect(tierExampleText(OWNER_TIERS, 5)).toBe('5 km = LKR 100 + 60 + 50 + 50 + 50 = LKR 310');
    expect(tierExampleText(OWNER_TIERS, 1)).toBe('1 km = LKR 100');
    expect(tierExampleText(OWNER_TIERS, 5, 250)).toBe('5 km = LKR 100 + 60 + 50 + 50 + 50 = LKR 310, capped at LKR 250');
    expect(tierExampleText([{ km: 1, lkr: 62.5 }], 2)).toBe('2 km = LKR 62.50 + 62.50 = LKR 125');
  });

  it('the one-line summary', () => {
    expect(tiersSummary(OWNER_TIERS)).toBe('km 1 LKR 100, km 2 LKR 60, km 3+ LKR 50');
    expect(tiersSummary([{ km: 1, lkr: 40 }])).toBe('LKR 40 per km');
    expect(tiersSummary([])).toBe('no km amounts set');
  });
});

describe('rows <-> tiers', () => {
  it('tiersToRows sorts by km and keeps up to 2 decimals', () => {
    expect(tiersToRows([{ km: 2, lkr: 12.5 }, { km: 1, lkr: 100 }])).toEqual(['100', '12.5']);
    expect(tiersToRows(null)).toEqual([]);
  });

  it('linearToRows pays what base + per km pays for whole km', () => {
    expect(linearToRows(50, 20)).toEqual(['70', '20']);
    expect(linearToRows(0, 20)).toEqual(['20']);
  });

  it('parseTierRows numbers the km 1..n and reports the first bad row', () => {
    expect(parseTierRows(['100', ' 60 ', 'LKR 50'])).toEqual({ tiers: OWNER_TIERS });
    expect(parseTierRows(['0'])).toEqual({ tiers: [{ km: 1, lkr: 0 }] });
    const bad = parseTierRows(['100', '1000.01', 'x']);
    expect(bad).toEqual({
      error: 'km 2: Enter at most 1,000.',
      rowErrors: [undefined, 'Enter at most 1,000.', 'Enter a number, like 100 or 62.50.'],
    });
    expect(parseTierRows([])).toMatchObject({ error: 'Add at least km 1.' });
    expect(parseTierRows(Array(11).fill('10'))).toMatchObject({ error: 'Use at most 10 rows.' });
    expect(tiersIfValid(['1', ''])).toBeNull();
    expect(tiersIfValid(['1', '2'])).toEqual([
      { km: 1, lkr: 1 },
      { km: 2, lkr: 2 },
    ]);
  });

  it('parseTierAmount: 0..1000, 2 decimals', () => {
    expect(parseTierAmount('1000')).toEqual({ value: 1000 });
    expect(parseTierAmount('1,000')).toEqual({ value: 1000 });
    expect(parseTierAmount('10.555')).toEqual({ error: 'Use at most 2 decimals.' });
    expect(parseTierAmount('-5')).toEqual({ error: 'Enter a number, like 100 or 62.50.' });
    expect(parseTierAmount('')).toEqual({ error: 'Enter an amount (0 is fine).' });
  });

  it('parseMaxFee: blank = no cap, else 0..10000', () => {
    expect(parseMaxFee('')).toEqual({ value: null });
    expect(parseMaxFee('0')).toEqual({ value: 0 });
    expect(parseMaxFee('10000')).toEqual({ value: 10000 });
    expect(parseMaxFee('10000.5')).toEqual({ error: 'Enter at most 10,000.' });
  });
});

describe('rider pay drafts with per-km tiers', () => {
  const linearDefault: PayParams = { model: 'DISTANCE', percent: 80, fixed_lkr: 80, base_lkr: 50, per_km_lkr: 20, min_lkr: null };
  const tiersDefault: PayParams = { ...linearDefault, distance_mode: 'TIERS', km_tiers: OWNER_TIERS };

  it('describePay shows the tiers in TIERS mode and base + per km otherwise (older API = LINEAR)', () => {
    expect(describePay(linearDefault)).toBe('LKR 50 + LKR 20 per km');
    expect(describePay({ ...tiersDefault, min_lkr: 120 })).toBe('Per km: km 1 LKR 100, km 2 LKR 60, km 3+ LKR 50 · min LKR 120');
  });

  it('a new draft follows the store default way and its tiers; LINEAR defaults start rows from base + per km', () => {
    expect(newPayDraft(tiersDefault)).toMatchObject({ distanceMode: 'TIERS', tiers: ['100', '60', '50'] });
    expect(newPayDraft(linearDefault)).toMatchObject({ distanceMode: 'LINEAR', tiers: ['70', '20'] });
    expect(newPayDraft(null)).toMatchObject({ distanceMode: 'LINEAR', tiers: [] });
  });

  it("a rider's own way and tiers win; null follows the store default", () => {
    const own = { fixed_lkr: null, base_lkr: null, per_km_lkr: null, min_lkr: null };
    const mine = payDraftFrom(
      {
        pay_type: 'COMMISSION',
        commission_percent: null,
        pay_model: 'DISTANCE',
        own: { ...own, distance_mode: 'TIERS', km_tiers: [{ km: 1, lkr: 90 }] },
      },
      linearDefault
    );
    expect(mine).toMatchObject({ distanceMode: 'TIERS', tiers: ['90'] });
    const following = payDraftFrom(
      { pay_type: 'COMMISSION', commission_percent: null, pay_model: 'DISTANCE', own: { ...own, distance_mode: null, km_tiers: null } },
      tiersDefault
    );
    expect(following).toMatchObject({ distanceMode: 'TIERS', tiers: ['100', '60', '50'] });
  });

  it('fillDraftBlanks seeds rows from base + per km even before the defaults load', () => {
    const draft = { ...newPayDraft(null), base: '40', perKm: '10' };
    expect(fillDraftBlanks(draft, null).tiers).toEqual(['50', '10']);
  });

  it('payDraftToInput sends distance_mode + km_tiers (TIERS) or base + per km (LINEAR)', () => {
    const base = { ...newPayDraft(linearDefault), payType: 'COMMISSION' as const, model: 'DISTANCE' as const };
    expect(payDraftToInput({ ...base, distanceMode: 'TIERS', tiers: ['100', '60'], min: '90' })).toEqual({
      input: {
        pay_type: 'COMMISSION',
        pay_model: 'DISTANCE',
        distance_mode: 'TIERS',
        km_tiers: [
          { km: 1, lkr: 100 },
          { km: 2, lkr: 60 },
        ],
        min_lkr: 90,
      },
    });
    expect(payDraftToInput({ ...base, distanceMode: 'LINEAR' })).toEqual({
      input: { pay_type: 'COMMISSION', pay_model: 'DISTANCE', distance_mode: 'LINEAR', base_lkr: 50, per_km_lkr: 20, min_lkr: null },
    });
    expect(payDraftToInput({ ...base, distanceMode: 'TIERS', tiers: ['100', 'abc'] })).toEqual({
      errors: { tiers: 'km 2: Enter a number, like 100 or 62.50.', tierRows: [undefined, 'Enter a number, like 100 or 62.50.'] },
    });
  });
});

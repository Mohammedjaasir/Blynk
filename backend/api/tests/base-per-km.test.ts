import { describe, it, expect } from 'vitest';
import { DEFAULT_BASE_PER_KM, basePerKmFrom, priceByBaseAndKm } from '../src/modules/pricing/km-tiers.js';

/** Owner's brother, 2026-10-25: LKR 120 covers the first 2 km, then +LKR 40 for each started km. */
describe('priceByBaseAndKm', () => {
  it.each([
    [0, 120],
    [0.4, 120],
    [1.5, 120],
    [2.0, 120],
    [2.01, 160],
    [2.1, 160],
    [3.0, 160],
    [3.4, 200],
    [4.0, 200],
    [4.8, 240],
    [5.6, 280],
    [6.0, 280],
  ])('%s km costs LKR %s', (km, lkr) => {
    expect(priceByBaseAndKm(DEFAULT_BASE_PER_KM, km).total).toBe(lkr);
  });

  it('counts the started km beyond the base', () => {
    expect(priceByBaseAndKm(DEFAULT_BASE_PER_KM, 2.1).extra_km).toBe(1);
    expect(priceByBaseAndKm(DEFAULT_BASE_PER_KM, 4.8).extra_km).toBe(3);
    expect(priceByBaseAndKm(DEFAULT_BASE_PER_KM, 1).extra_km).toBe(0);
  });

  it('survives floating point noise on the covered distance', () => {
    expect(priceByBaseAndKm(DEFAULT_BASE_PER_KM, 2.0000000001).total).toBe(120);
    expect(priceByBaseAndKm(DEFAULT_BASE_PER_KM, 0.1 + 0.2 + 1.7).total).toBe(120);
  });

  it('follows whatever the admin sets', () => {
    expect(priceByBaseAndKm({ base_lkr: 100, base_km: 1.5, per_km_lkr: 25.5 }, 1.5).total).toBe(100);
    expect(priceByBaseAndKm({ base_lkr: 100, base_km: 1.5, per_km_lkr: 25.5 }, 3).total).toBe(151);
    expect(priceByBaseAndKm({ base_lkr: 0, base_km: 1, per_km_lkr: 30 }, 0.5).total).toBe(0);
  });

  it('applies the optional cap', () => {
    const p = priceByBaseAndKm(DEFAULT_BASE_PER_KM, 9, 300);
    expect(p).toMatchObject({ sum: 400, total: 300, capped: true });
    expect(priceByBaseAndKm(DEFAULT_BASE_PER_KM, 5.6, 300).capped).toBe(false);
  });

  it('a bad stored rule falls back to the defaults field by field', () => {
    expect(basePerKmFrom(undefined)).toEqual(DEFAULT_BASE_PER_KM);
    expect(basePerKmFrom({ base_lkr: 150, base_km: 'x', per_km_lkr: -5 })).toEqual({ base_lkr: 150, base_km: 2, per_km_lkr: 40 });
  });
});

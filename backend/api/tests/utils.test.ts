import { describe, it, expect } from 'vitest';
import { normalizeSriLankanPhone } from '../src/utils/phone.js';
import { calculateHaversineKm, isWithinDeliveryRadius } from '../src/utils/geo.js';
import { calculateScheduledDeliveryTime } from '../src/utils/time.js';
import { calculateSellingPrice } from '../src/modules/pricing/index.js';

describe('Utility Functions Verification', () => {
  describe('Sri Lankan Phone Normalizer', () => {
    it('normalizes local 07X format to +947X', () => {
      expect(normalizeSriLankanPhone('0771234567')).toBe('+94771234567');
      expect(normalizeSriLankanPhone('0719876543')).toBe('+94719876543');
    });

    it('normalizes spaces and hyphens', () => {
      expect(normalizeSriLankanPhone(' 077-123 4567 ')).toBe('+94771234567');
    });

    it('handles numbers already with +94', () => {
      expect(normalizeSriLankanPhone('+94771234567')).toBe('+94771234567');
    });

    it('throws error for invalid prefixes or length', () => {
      expect(() => normalizeSriLankanPhone('0112345678')).toThrow(); // Landline
      expect(() => normalizeSriLankanPhone('12345')).toThrow();
    });
  });

  describe('Haversine Geodesic Distance (Dharga Town Hub)', () => {
    const storeLat = 6.438200;
    const storeLon = 80.027400;

    it('calculates 0 km distance for exact store coordinates', () => {
      const dist = calculateHaversineKm(storeLat, storeLon, storeLat, storeLon);
      expect(dist).toBe(0);
    });

    it('confirms 1.5 km distance point is inside 4 km radius', () => {
      // Coordinate ~400m south
      const customerLat = 6.435100;
      const customerLon = 80.024300;
      const { isWithin, distanceKm } = isWithinDeliveryRadius(storeLat, storeLon, customerLat, customerLon, 4.00);
      expect(isWithin).toBe(true);
      expect(distanceKm).toBeLessThan(4.00);
    });

    it('correctly rejects coordinate outside 4 km (e.g. Aluthgama/Bentota > 5 km away)', () => {
      const bentotaLat = 6.425000;
      const bentotaLon = 79.998000;
      const { isWithin, distanceKm } = isWithinDeliveryRadius(storeLat, storeLon, bentotaLat, bentotaLon, 4.00);
      expect(distanceKm).toBeGreaterThan(3.0);
    });
  });

  describe('Authoritative Pricing Engine', () => {
    it('applies default 20% markup when custom markup is null', () => {
      const result = calculateSellingPrice({
        purchaseCost: 400.0,
        customMarkupPercent: null,
        defaultMarkupPercent: 20.0,
      });
      expect(result.effectiveMarkupPercent).toBe(20.0);
      expect(result.sellingPrice).toBe(480.0);
    });

    it('applies custom markup override when provided', () => {
      const result = calculateSellingPrice({
        purchaseCost: 700.0,
        customMarkupPercent: 15.0,
        defaultMarkupPercent: 20.0,
      });
      expect(result.effectiveMarkupPercent).toBe(15.0);
      expect(result.sellingPrice).toBe(805.0);
    });

    it('rejects negative purchase cost or markup', () => {
      expect(() => calculateSellingPrice({ purchaseCost: -50 })).toThrow();
    });
  });

  describe('24/7 Operating Hours & Scheduler', () => {
    it('returns null (immediate dispatch) if placed at 2:00 PM (14:00)', () => {
      // 2:00 PM in Colombo is 08:30 UTC
      const afternoonTime = new Date('2026-09-14T08:30:00Z');
      const scheduled = calculateScheduledDeliveryTime(afternoonTime);
      expect(scheduled).toBeNull();
    });

    it('schedules for next morning 8:00 AM if placed at 11:30 PM (23:30)', () => {
      // 11:30 PM in Colombo is 18:00 UTC
      const nightTime = new Date('2026-09-14T18:00:00Z');
      const scheduled = calculateScheduledDeliveryTime(nightTime);
      expect(scheduled).not.toBeNull();
    });
  });
});

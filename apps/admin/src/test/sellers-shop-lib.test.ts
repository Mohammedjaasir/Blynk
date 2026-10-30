import { describe, it, expect } from 'vitest';
import {
  EMPTY_PRODUCT_FORM,
  commissionBody,
  extendFreePeriod,
  freeDaysLeft,
  freePeriodText,
  newSellerProductBody,
  parseFreeDays,
  parsePastedPoint,
  productStatusTone,
  shopLocationBody,
} from '../lib/sellers';

const NOW = new Date('2026-11-01T06:00:00.000Z');

describe('free commission period', () => {
  it('counts whole days rounded up and never below 0', () => {
    expect(freeDaysLeft('2026-11-02T05:00:00.000Z', NOW)).toBe(1);
    expect(freeDaysLeft('2026-11-02T07:00:00.000Z', NOW)).toBe(2);
    expect(freeDaysLeft('2026-10-30T00:00:00.000Z', NOW)).toBe(0);
    expect(freeDaysLeft(null, NOW)).toBeNull();
    expect(freeDaysLeft('nonsense', NOW)).toBeNull();
  });

  it('reads as a sentence', () => {
    expect(freePeriodText('2026-11-24T05:00:00.000Z', NOW)).toBe('Commission-free until 24 Nov 2026 (23 days left)');
    expect(freePeriodText('2026-11-02T05:00:00.000Z', NOW)).toMatch(/\(1 day left\)$/);
    expect(freePeriodText('2026-10-30T05:00:00.000Z', NOW)).toMatch(/^Commission-free period ended on 30 Oct 2026/);
    expect(freePeriodText(null, NOW)).toBe('No commission-free period.');
  });

  it('extends from the end when running, else from now', () => {
    expect(extendFreePeriod('2026-11-10T00:00:00.000Z', 30, NOW)).toBe('2026-12-10T00:00:00.000Z');
    expect(extendFreePeriod('2026-10-01T00:00:00.000Z', 30, NOW)).toBe('2026-12-01T06:00:00.000Z');
    expect(extendFreePeriod(null, 30, NOW)).toBe('2026-12-01T06:00:00.000Z');
  });

  it('free_days is a whole number 0 to 365, and only sent when the API reports it', () => {
    expect(parseFreeDays('0')).toEqual({ value: 0 });
    expect(parseFreeDays(' 30 ')).toEqual({ value: 30 });
    expect(parseFreeDays('366')).toHaveProperty('error');
    expect(parseFreeDays('1.5')).toHaveProperty('error');
    expect(parseFreeDays('')).toHaveProperty('error');
    expect(commissionBody('5', {})).toEqual({ body: { default_percent: 5, categories: [] } });
    expect(commissionBody('5', {}, '45')).toEqual({ body: { default_percent: 5, categories: [], free_days: 45 } });
    expect(commissionBody('5', {}, 'x')).toHaveProperty('error');
  });
});

describe('add product for a seller', () => {
  const full = {
    ...EMPTY_PRODUCT_FORM,
    name: ' Cheese Roll ',
    category_id: 'c1',
    unit: 'piece',
    image_url: 'https://media.blynk.lk/products/x.webp',
    seller_price: '120',
    selling_price: '150.5',
  };

  it('builds the body and leaves optional fields out', () => {
    expect(newSellerProductBody(full)).toEqual({
      body: { name: 'Cheese Roll', category_id: 'c1', unit: 'piece', image_url: 'https://media.blynk.lk/products/x.webp', seller_price: 120, selling_price: 150.5 },
    });
    expect(newSellerProductBody({ ...full, stock_quantity: '0', barcode: ' 99 ' })).toMatchObject({ body: { stock_quantity: 0, barcode: '99' } });
  });

  it('names every problem, the photo included', () => {
    const r = newSellerProductBody(EMPTY_PRODUCT_FORM);
    expect(r).toHaveProperty('errors');
    expect(Object.keys((r as { errors: object }).errors).sort()).toEqual(['category_id', 'image_url', 'name', 'selling_price', 'seller_price', 'unit'].sort());
    expect((newSellerProductBody({ ...full, image_url: null }) as { errors: Record<string, string> }).errors.image_url).toBe('Add a photo of the product.');
    expect(newSellerProductBody({ ...full, stock_quantity: '1.5' })).toHaveProperty('errors.stock_quantity');
    expect(newSellerProductBody({ ...full, selling_price: '0' })).toHaveProperty('errors.selling_price');
  });

  it('chips: live green, paused amber, off grey', () => {
    expect([productStatusTone('LIVE'), productStatusTone('PAUSED'), productStatusTone('OFF')]).toEqual(['active', 'offer', 'muted']);
  });
});

describe('shop location', () => {
  it('reads a pasted pair, a Maps link and a spaced pair', () => {
    expect(parsePastedPoint('7.290572, 80.633728')).toEqual({ lat: 7.290572, lng: 80.633728 });
    expect(parsePastedPoint('7.290572 80.633728')).toEqual({ lat: 7.290572, lng: 80.633728 });
    expect(parsePastedPoint('https://www.google.com/maps/place/Shop/@7.290572,80.633728,17z')).toEqual({ lat: 7.290572, lng: 80.633728 });
    expect(parsePastedPoint('https://www.google.com/maps?q=6.9,79.8')).toEqual({ lat: 6.9, lng: 79.8 });
    expect(parsePastedPoint('-1.5, 200')).toBeNull();
    expect(parsePastedPoint('hello')).toBeNull();
    expect(parsePastedPoint('')).toBeNull();
  });

  it('builds the PUT body or says what is wrong', () => {
    expect(shopLocationBody('7.29', '80.63', ' near the clock ')).toEqual({ body: { latitude: 7.29, longitude: 80.63, how_to_find: 'near the clock' } });
    expect(shopLocationBody('7.29', '80.63', '')).toEqual({ body: { latitude: 7.29, longitude: 80.63 } });
    expect(shopLocationBody('91', 'x', '')).toHaveProperty('errors.latitude');
    expect(shopLocationBody('91', 'x', '')).toHaveProperty('errors.longitude');
    expect(shopLocationBody('7', '80', 'x'.repeat(201))).toHaveProperty('errors.how_to_find');
  });
});

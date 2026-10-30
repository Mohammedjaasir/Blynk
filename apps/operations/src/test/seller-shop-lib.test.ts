import { describe, expect, it } from 'vitest';
import {
  EMPTY_SHOP_PRODUCT,
  PHOTO_REQUIRED_TEXT,
  belowSellerPriceNote,
  colomboDayOf,
  daysLeftText,
  endOfColomboDay,
  extendedUntil,
  freePeriod,
  locationBody,
  newShopProductBody,
  parseFreeDays,
  parseLatLng,
  productCountsText,
  productsLiveText,
} from '../lib/sellerShop';

const NOW = new Date('2026-10-30T06:00:00.000Z');

describe('productCountsText / productsLiveText', () => {
  it('counts live, paused and off', () => {
    expect(productCountsText([])).toBe('No products yet.');
    expect(productCountsText([{ status: 'LIVE' }, { status: 'LIVE' }, { status: 'PAUSED' }, { status: 'OFF' }])).toBe('2 live, 1 paused, 1 off');
    expect(productCountsText([{ status: 'LIVE' }])).toBe('1 live');
  });
  it('reads "N products live" for the sellers list', () => {
    expect(productsLiveText(0)).toBe('0 products live');
    expect(productsLiveText(1)).toBe('1 product live');
    expect(productsLiveText(4, 4)).toBe('4 products live');
    expect(productsLiveText(4, 6)).toBe('4 of 6 products live');
  });
});

describe('newShopProductBody', () => {
  const good = { ...EMPTY_SHOP_PRODUCT, name: ' Apple Pie ', category_id: 'c1', unit: '1 pc', image_url: 'https://cdn/x.webp', seller_price: '100', selling_price: '130.50' };
  it('builds the body, leaving blank optional fields out', () => {
    expect(newShopProductBody(good)).toEqual({
      body: { name: 'Apple Pie', category_id: 'c1', unit: '1 pc', image_url: 'https://cdn/x.webp', seller_price: 100, selling_price: 130.5 },
    });
    const full = newShopProductBody({ ...good, pack_size: '6 pack', description: 'Fresh', barcode: '123', stock_quantity: '12' });
    expect(full).toEqual({
      body: {
        name: 'Apple Pie', category_id: 'c1', unit: '1 pc', pack_size: '6 pack', description: 'Fresh', image_url: 'https://cdn/x.webp',
        seller_price: 100, selling_price: 130.5, barcode: '123', stock_quantity: 12,
      },
    });
  });
  it('needs a photo, a category, a unit and both prices', () => {
    const r = newShopProductBody(EMPTY_SHOP_PRODUCT);
    expect('errors' in r && Object.keys(r.errors).sort()).toEqual(['category_id', 'image_url', 'name', 'seller_price', 'selling_price', 'unit']);
    expect('errors' in r && r.errors.image_url).toBe(PHOTO_REQUIRED_TEXT);
  });
  it('refuses bad prices and stock', () => {
    const r = newShopProductBody({ ...good, seller_price: '0', selling_price: '12.345', stock_quantity: '-2' });
    expect('errors' in r && r.errors.seller_price).toMatch(/more than 0/);
    expect('errors' in r && r.errors.selling_price).toMatch(/2 decimals/);
    expect('errors' in r && r.errors.stock_quantity).toMatch(/whole number/);
  });
  it('warns, without blocking, when the customer price is below the seller price', () => {
    expect(belowSellerPriceNote('100', '90')).toMatch(/lower than the seller/);
    expect(belowSellerPriceNote('100', '130')).toBeNull();
    expect(belowSellerPriceNote('', '130')).toBeNull();
  });
});

describe('parseLatLng', () => {
  it('reads a pasted lat,lng in the usual shapes', () => {
    expect(parseLatLng('7.290572, 80.633728')).toEqual({ lat: 7.290572, lng: 80.633728 });
    expect(parseLatLng('  7.29 80.63 ')).toEqual({ lat: 7.29, lng: 80.63 });
    expect(parseLatLng('6.9271,79.8612')).toEqual({ lat: 6.9271, lng: 79.8612 });
  });
  it('reads Google Maps links', () => {
    expect(parseLatLng('https://www.google.com/maps/@7.2906,80.6337,17z')).toEqual({ lat: 7.2906, lng: 80.6337 });
    expect(parseLatLng('https://www.google.com/maps?q=7.29,80.63')).toEqual({ lat: 7.29, lng: 80.63 });
    expect(parseLatLng('https://maps.google.com/?q=7.29%2C80.63')).toEqual({ lat: 7.29, lng: 80.63 });
    expect(parseLatLng('https://www.google.com/maps/place/Shop/data=!3d7.29!4d80.63')).toEqual({ lat: 7.29, lng: 80.63 });
  });
  it('refuses text without a valid position', () => {
    expect(parseLatLng('')).toBeNull();
    expect(parseLatLng('Kandy')).toBeNull();
    expect(parseLatLng('95, 80')).toBeNull();
    expect(parseLatLng('7.2, 200')).toBeNull();
    expect(parseLatLng('100%')).toBeNull();
  });
});

describe('locationBody', () => {
  it('builds the PUT body', () => {
    expect(locationBody({ latitude: '7.29', longitude: '80.63', how_to_find: ' Next to the bus stand ' })).toEqual({
      body: { latitude: 7.29, longitude: 80.63, how_to_find: 'Next to the bus stand' },
    });
    expect(locationBody({ latitude: '7.29', longitude: '80.63', how_to_find: '' })).toEqual({ body: { latitude: 7.29, longitude: 80.63 } });
  });
  it('flags each bad field', () => {
    const r = locationBody({ latitude: 'x', longitude: '181', how_to_find: 'a'.repeat(201) });
    expect('errors' in r && Object.keys(r.errors).sort()).toEqual(['how_to_find', 'latitude', 'longitude']);
  });
});

describe('commission-free period', () => {
  it('counts whole days left, rounded up, and flags an ended period', () => {
    expect(freePeriod(null, NOW)).toEqual({ state: 'none' });
    expect(freePeriod(undefined, NOW)).toEqual({ state: 'none' });
    expect(freePeriod('2026-11-22T06:00:00.000Z', NOW)).toEqual({ state: 'active', until: '2026-11-22T06:00:00.000Z', daysLeft: 23 });
    expect(freePeriod('2026-10-30T18:00:00.000Z', NOW)).toMatchObject({ state: 'active', daysLeft: 1 });
    expect(freePeriod('2026-10-30T06:00:00.000Z', NOW)).toEqual({ state: 'ended', until: '2026-10-30T06:00:00.000Z' });
    expect(freePeriod('2026-10-01T06:00:00.000Z', NOW)).toMatchObject({ state: 'ended' });
  });
  it('words the days', () => {
    expect(daysLeftText(1)).toBe('1 day left');
    expect(daysLeftText(23)).toBe('23 days left');
  });
  it('extends from the end of a running period, or from now', () => {
    expect(extendedUntil('2026-11-10T00:00:00.000Z', NOW)).toBe('2026-12-10T00:00:00.000Z');
    expect(extendedUntil('2026-10-01T00:00:00.000Z', NOW)).toBe('2026-11-29T06:00:00.000Z');
    expect(extendedUntil(null, NOW)).toBe('2026-11-29T06:00:00.000Z');
  });
  it('uses the end of the Colombo day', () => {
    expect(endOfColomboDay('2026-11-22')).toBe('2026-11-22T18:29:59.000Z');
    expect(colomboDayOf('2026-11-22T18:29:59.000Z')).toBe('2026-11-22');
  });
  it('checks the free days setting', () => {
    expect(parseFreeDays('30')).toEqual({ value: 30 });
    expect(parseFreeDays('0')).toEqual({ value: 0 });
    expect('error' in parseFreeDays('366')).toBe(true);
    expect('error' in parseFreeDays('')).toBe(true);
    expect('error' in parseFreeDays('2.5')).toBe(true);
  });
});

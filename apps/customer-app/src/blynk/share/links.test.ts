import { describe, expect, test } from 'vitest';
import {
  normaliseReferralCode, productIdFromRoute, productShareText, productUrl, referralCodeFromSearch, referralShareText,
  referralUrl, routeFromHash,
} from './links';

describe('product links (Flutter share_links.dart)', () => {
  test('a product shares https://blynk.lk/p/<id>', () => {
    expect(productUrl('3f2a9c1e-0000-4000-8000-000000000001')).toBe('https://blynk.lk/p/3f2a9c1e-0000-4000-8000-000000000001');
    expect(productShareText('Fresh milk', 'abc_1')).toBe('Fresh milk on Blynk\nhttps://blynk.lk/p/abc_1');
  });

  test('only an https base, its origin only', () => {
    expect(productUrl('abc', 'https://shop.example.lk/some/path?x=1#y')).toBe('https://shop.example.lk/p/abc');
    expect(productUrl('abc', 'http://blynk.lk')).toBeNull();
    expect(productUrl('abc', 'not a url')).toBeNull();
    expect(productShareText('Milk', 'abc', 'http://blynk.lk')).toBe('Milk on Blynk');
  });

  test('never a link for an id that is not one', () => {
    expect(productUrl('a/b')).toBeNull();
    expect(productUrl('')).toBeNull();
    expect(productUrl('x'.repeat(65))).toBeNull();
    expect(productShareText('Milk', '../etc')).toBe('Milk on Blynk');
  });

  test('reads /p/<id> routes, query and hash ignored', () => {
    expect(productIdFromRoute('/p/abc-1')).toBe('abc-1');
    expect(productIdFromRoute('/p/abc-1/')).toBe('abc-1');
    expect(productIdFromRoute('/p/abc-1?utm_source=wa')).toBe('abc-1');
    expect(productIdFromRoute('/p/')).toBeNull();
    expect(productIdFromRoute('/p/a/b')).toBeNull();
    expect(productIdFromRoute('/product/abc')).toBeNull();
    expect(productIdFromRoute(null)).toBeNull();
  });
});

describe('hash routes (the site redirects /p/<id> to /app/#/p/<id>)', () => {
  test('a shared product opens the product page', () => {
    expect(routeFromHash('#/p/abc-1')).toBe('/p/abc-1');
    expect(routeFromHash('#/p/abc-1?ref=x')).toBe('/p/abc-1');
    expect(routeFromHash('#!/p/abc')).toBe('/p/abc');
  });
  test('old Flutter hash routes map onto this app', () => {
    expect(routeFromHash('#/refer')).toBe('/refer');
    expect(routeFromHash('#/points/')).toBe('/points');
    expect(routeFromHash('#/dental/clinics')).toBe('/doctors');
    expect(routeFromHash('#/dental/appointments')).toBe('/doctors/appointments');
  });
  test('anything else is ignored', () => {
    expect(routeFromHash('')).toBeNull();
    expect(routeFromHash('#')).toBeNull();
    expect(routeFromHash('#/')).toBeNull();
    expect(routeFromHash('#section')).toBeNull();
    expect(routeFromHash('#/p/a/b')).toBeNull();
    expect(routeFromHash('#/admin')).toBeNull();
  });
});

describe('referral links (Flutter referral_link.dart)', () => {
  test('a referral shares <site>/app/?ref=CODE', () => {
    expect(referralUrl('NIMAL42')).toBe('https://blynk.lk/app/?ref=NIMAL42');
    expect(referralShareText('NIMAL42')).toBe(
      'Join me on Blynk and get a reward on your first order. Use my code NIMAL42 or this link:\nhttps://blynk.lk/app/?ref=NIMAL42',
    );
  });
  test('no link for a code that is not plain letters and digits, or without https', () => {
    expect(referralUrl('NIM AL')).toBeNull();
    expect(referralUrl('NIMAL', 'http://blynk.lk')).toBeNull();
    expect(referralShareText('NIM-AL')).toBe('Join me on Blynk and get a reward on your first order. Use my code NIM-AL when you sign up.');
  });
  test('?ref= is normalised: trimmed and upper-cased', () => {
    expect(referralCodeFromSearch('?ref=nimal42')).toBe('NIMAL42');
    expect(referralCodeFromSearch('?utm=x&ref=%20ab12%20')).toBe('AB12');
    expect(normaliseReferralCode('  ab12 ')).toBe('AB12');
  });
  test('?ref= must match the code pattern', () => {
    expect(referralCodeFromSearch('?ref=ab')).toBeNull(); // too short
    expect(referralCodeFromSearch('?ref=AB-12')).toBeNull();
    expect(referralCodeFromSearch(`?ref=${'A'.repeat(33)}`)).toBeNull();
    expect(referralCodeFromSearch('?other=1')).toBeNull();
    expect(referralCodeFromSearch('')).toBeNull();
  });
});

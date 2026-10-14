import { describe, it, expect, afterEach } from 'vitest';
import {
  checkoutHash,
  formatPayHereAmount,
  md5Upper,
  notifySignature,
  PAYHERE_CHECKOUT_URLS,
  splitName,
  verifyNotifySignature,
} from '../src/modules/payments/payhere.js';
import { decryptSecret, encryptSecret, paymentSecretKeyConfigured, PaymentSecretKeyMissingError } from '../src/modules/payments/secret-box.js';

/**
 * PayHere hash and md5sig (migration 047; owner, 2026-10-14), no database,
 * no network. Expected values were computed independently (Python hashlib)
 * from PayHere's published formulas:
 *   hash   = UPPER(MD5(merchant_id + order_id + amount(2dp) + currency + UPPER(MD5(secret))))
 *   md5sig = UPPER(MD5(merchant_id + order_id + payhere_amount + payhere_currency + status_code + UPPER(MD5(secret))))
 */
const SECRET = '4Ph3reSandboxSecretForTests8xY2';
const MERCHANT = '1211149';
const ORDER = 'BL-20261014-1234';

describe('PayHere amount formatting', () => {
  it('always two decimals, no thousands separator', () => {
    expect(formatPayHereAmount(1250)).toBe('1250.00');
    expect(formatPayHereAmount('1250.5')).toBe('1250.50');
    expect(formatPayHereAmount(12345.678)).toBe('12345.68');
    expect(formatPayHereAmount(1.005)).toBe('1.01');
    expect(formatPayHereAmount(0.1 + 0.2)).toBe('0.30');
    expect(() => formatPayHereAmount(-1)).toThrow();
    expect(() => formatPayHereAmount('abc')).toThrow();
  });
});

describe('PayHere checkout hash', () => {
  it('uppercases MD5 of the secret', () => {
    expect(md5Upper(SECRET)).toBe('FCB3D0D2C6372630DF1EF141D67E6E4D');
  });

  it('matches the independently computed hash', () => {
    expect(checkoutHash({ merchantId: MERCHANT, orderId: ORDER, amount: 1250, currency: 'LKR', merchantSecret: SECRET })).toBe(
      'F645902EA7DE05C71A26C9BFEA8E4BEC'
    );
    // Formatted the same whether the amount is a number or a string.
    expect(checkoutHash({ merchantId: MERCHANT, orderId: 'ItemNo12345', amount: '1000', currency: 'LKR', merchantSecret: SECRET })).toBe(
      '18E088A5394AF36368EEC4A1454348C9'
    );
  });

  it('changes when the amount or the secret changes', () => {
    const base = { merchantId: MERCHANT, orderId: ORDER, amount: 1250, currency: 'LKR', merchantSecret: SECRET };
    const h = checkoutHash(base);
    expect(checkoutHash({ ...base, amount: 1250.01 })).not.toBe(h);
    expect(checkoutHash({ ...base, merchantSecret: SECRET + 'x' })).not.toBe(h);
  });

  it('knows the sandbox and live checkout URLs', () => {
    expect(PAYHERE_CHECKOUT_URLS).toEqual({
      sandbox: 'https://sandbox.payhere.lk/pay/checkout',
      live: 'https://www.payhere.lk/pay/checkout',
    });
  });
});

describe('PayHere md5sig verification', () => {
  const posted = {
    merchant_id: MERCHANT,
    order_id: ORDER,
    payhere_amount: '1250.00',
    payhere_currency: 'LKR',
    status_code: '2',
    md5sig: 'DC972C0CF8A82F73663CCE3195609AA1',
  };

  it('computes the documented signature', () => {
    expect(
      notifySignature({ merchantId: MERCHANT, orderId: ORDER, payhereAmount: '1250.00', payhereCurrency: 'LKR', statusCode: '2', merchantSecret: SECRET })
    ).toBe('DC972C0CF8A82F73663CCE3195609AA1');
    expect(
      notifySignature({ merchantId: MERCHANT, orderId: ORDER, payhereAmount: '1250.00', payhereCurrency: 'LKR', statusCode: '-2', merchantSecret: SECRET })
    ).toBe('F2525057468F0358536451CF18E9444B');
  });

  it('accepts a valid signature (case-insensitive hex)', () => {
    expect(verifyNotifySignature(posted, SECRET)).toBe(true);
    expect(verifyNotifySignature({ ...posted, md5sig: posted.md5sig.toLowerCase() }, SECRET)).toBe(true);
  });

  it('rejects a tampered amount, status, order, currency or a wrong secret', () => {
    expect(verifyNotifySignature({ ...posted, payhere_amount: '1.00' }, SECRET)).toBe(false);
    expect(verifyNotifySignature({ ...posted, payhere_amount: '1250.0' }, SECRET)).toBe(false);
    expect(verifyNotifySignature({ ...posted, status_code: '-2' }, SECRET)).toBe(false);
    expect(verifyNotifySignature({ ...posted, order_id: 'BL-20261014-9999' }, SECRET)).toBe(false);
    expect(verifyNotifySignature({ ...posted, payhere_currency: 'USD' }, SECRET)).toBe(false);
    expect(verifyNotifySignature(posted, 'another-secret')).toBe(false);
  });

  it('rejects empty or malformed signatures without throwing', () => {
    expect(verifyNotifySignature({ ...posted, md5sig: '' }, SECRET)).toBe(false);
    expect(verifyNotifySignature({ ...posted, md5sig: 'zz' }, SECRET)).toBe(false);
    expect(verifyNotifySignature({ ...posted, md5sig: undefined as unknown as string }, SECRET)).toBe(false);
  });
});

describe('name split for PayHere', () => {
  it('first word / the rest; single names are repeated; empty gets a placeholder', () => {
    expect(splitName('Nimal Perera')).toEqual({ first_name: 'Nimal', last_name: 'Perera' });
    expect(splitName('  Mohamed  Ali  Hassan ')).toEqual({ first_name: 'Mohamed', last_name: 'Ali Hassan' });
    expect(splitName('Kasun')).toEqual({ first_name: 'Kasun', last_name: 'Kasun' });
    expect(splitName(null)).toEqual({ first_name: 'Blynk', last_name: 'Customer' });
  });
});

describe('merchant secret encryption at rest', () => {
  const original = process.env.PAYMENT_SECRET_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.PAYMENT_SECRET_KEY;
    else process.env.PAYMENT_SECRET_KEY = original;
  });

  it('round-trips, never stores the plain text, and uses a fresh IV each time', () => {
    process.env.PAYMENT_SECRET_KEY = 'k'.repeat(40);
    const a = encryptSecret(SECRET);
    const b = encryptSecret(SECRET);
    expect(a).not.toContain(SECRET);
    expect(a).not.toBe(b);
    expect(a.startsWith('v1:')).toBe(true);
    expect(decryptSecret(a)).toBe(SECRET);
  });

  it('refuses to encrypt without a key (>= 32 chars)', () => {
    delete process.env.PAYMENT_SECRET_KEY;
    expect(paymentSecretKeyConfigured()).toBe(false);
    expect(() => encryptSecret(SECRET)).toThrow(PaymentSecretKeyMissingError);
    process.env.PAYMENT_SECRET_KEY = 'short';
    expect(paymentSecretKeyConfigured()).toBe(false);
  });

  it('cannot be read with another key or after tampering', () => {
    process.env.PAYMENT_SECRET_KEY = 'k'.repeat(40);
    const stored = encryptSecret(SECRET);
    const parts = stored.split(':');
    const flipped = Buffer.from(parts[3], 'base64');
    flipped[0] ^= 1;
    expect(decryptSecret([parts[0], parts[1], parts[2], flipped.toString('base64')].join(':'))).toBeNull();
    process.env.PAYMENT_SECRET_KEY = 'z'.repeat(40);
    expect(decryptSecret(stored)).toBeNull();
    delete process.env.PAYMENT_SECRET_KEY;
    expect(decryptSecret(stored)).toBeNull();
    expect(decryptSecret('garbage')).toBeNull();
    expect(decryptSecret(null)).toBeNull();
  });
});

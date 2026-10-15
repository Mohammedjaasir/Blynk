import { describe, it, expect } from 'vitest';
import { ApiError } from '../api/client';
import {
  WALLET_KIND_LABEL,
  orderValue,
  paidByWalletOnly,
  parseReturnPoints,
  parseWalletAdjust,
  parseWalletRefund,
  readWalletForm,
  signedLkr,
  walletErrorMessage,
  walletExpiryText,
  walletFormFrom,
  walletKindLabel,
  walletUsed,
} from '../lib/wallet';

/** Blynk Wallet helpers (owner, 2026-10-15; docs/api/wallet.md). */

describe('wallet labels and money', () => {
  it('labels every ledger kind, and passes an unknown kind through', () => {
    expect(WALLET_KIND_LABEL.ORDER_PAYMENT).toBe('Paid for order');
    expect(WALLET_KIND_LABEL.ORDER_PAYMENT_RETURNED).toBe('Wallet payment returned');
    expect(WALLET_KIND_LABEL.REFUND_ORDER_CANCELLED).toBe('Order cancelled refund');
    expect(WALLET_KIND_LABEL.REFUND_ITEM).toBe('Item refund');
    expect(WALLET_KIND_LABEL.REFUND_DELIVERY_FEE).toBe('Delivery fee refund');
    expect(WALLET_KIND_LABEL.ADJUSTMENT).toBe('Adjustment');
    expect(WALLET_KIND_LABEL.EXPIRED).toBe('Expired');
    expect(walletKindLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });

  it('signs LKR amounts', () => {
    expect(signedLkr(120)).toBe('+LKR 120');
    expect(signedLkr(-1250.5)).toBe('−LKR 1,250.5');
    expect(signedLkr(0)).toBe('LKR 0');
  });

  it('reads the wallet share of an order; the order value adds it back', () => {
    expect(walletUsed({})).toBe(0);
    expect(walletUsed({ wallet_amount_used: null })).toBe(0);
    expect(walletUsed({ wallet_amount_used: '300.00' })).toBe(300);
    expect(orderValue({ total_amount: 850, wallet_amount_used: 300 })).toBe(1150);
    expect(paidByWalletOnly({ total_amount: 0, wallet_amount_used: 300 })).toBe(true);
    expect(paidByWalletOnly({ total_amount: 0, wallet_amount_used: 0 })).toBe(false);
    expect(paidByWalletOnly({ total_amount: 10, wallet_amount_used: 300 })).toBe(false);
  });
});

describe('parseWalletAdjust', () => {
  it('accepts + and - with up to 2 decimals', () => {
    expect(parseWalletAdjust('500')).toEqual({ value: 500 });
    expect(parseWalletAdjust('+12.50')).toEqual({ value: 12.5 });
    expect(parseWalletAdjust('-50')).toEqual({ value: -50 });
    expect(parseWalletAdjust('−1,000')).toEqual({ value: -1000 });
  });

  it('refuses blank, 0, 3 decimals, words and more than LKR 100,000', () => {
    expect(parseWalletAdjust('')).toHaveProperty('error');
    expect(parseWalletAdjust('0')).toEqual({ error: 'The amount cannot be 0.' });
    expect(parseWalletAdjust('1.005')).toEqual({ error: 'The amount can have at most 2 decimals.' });
    expect(parseWalletAdjust('abc')).toHaveProperty('error');
    expect(parseWalletAdjust('100000')).toEqual({ value: 100000 });
    expect(parseWalletAdjust('-100000.01')).toEqual({ error: 'The amount can be at most LKR 100,000 either way.' });
  });
});

describe('parseWalletRefund', () => {
  const limits = { kind: 'REFUND_ITEM' as const, refundable: 1030, deliveryFeeRefundable: 150 };

  it('accepts up to what is still refundable', () => {
    expect(parseWalletRefund('120', limits)).toEqual({ value: 120 });
    expect(parseWalletRefund('1030', limits)).toEqual({ value: 1030 });
  });

  it('refuses 0, too many decimals and more than refundable', () => {
    expect(parseWalletRefund('', limits)).toEqual({ error: 'Enter the amount to refund.' });
    expect(parseWalletRefund('0', limits)).toEqual({ error: 'The amount must be more than 0.' });
    expect(parseWalletRefund('-5', limits)).toHaveProperty('error');
    expect(parseWalletRefund('1.234', limits)).toEqual({ error: 'The amount can have at most 2 decimals.' });
    expect(parseWalletRefund('1030.01', limits)).toEqual({ error: 'Only LKR 1,030 is left to refund on this order.' });
  });

  it('caps a delivery fee refund at the fee left', () => {
    const fee = { ...limits, kind: 'REFUND_DELIVERY_FEE' as const };
    expect(parseWalletRefund('150', fee)).toEqual({ value: 150 });
    expect(parseWalletRefund('151', fee)).toEqual({ error: 'Only LKR 150 of the delivery fee is left to refund.' });
  });
});

describe('parseReturnPoints', () => {
  it('blank is 0; whole numbers up to returnable', () => {
    expect(parseReturnPoints('', 40)).toEqual({ value: 0 });
    expect(parseReturnPoints('40', 40)).toEqual({ value: 40 });
    expect(parseReturnPoints('41', 40)).toEqual({ error: 'At most 40 points can be given back on this order.' });
    expect(parseReturnPoints('2.5', 40)).toEqual({ error: 'Points must be a whole number.' });
  });
});

describe('wallet settings form', () => {
  const saved = { enabled: true, expiry_months: 0, max_use_percent: 100, updated_at: null };

  it('round-trips the saved setting', () => {
    expect(readWalletForm(walletFormFrom(saved))).toEqual({ value: { enabled: true, expiry_months: 0, max_use_percent: 100 } });
  });

  it('expiry is a whole number 0-120; max use a whole number 1-100', () => {
    const form = walletFormFrom(saved);
    expect(readWalletForm({ ...form, expiry_months: '121' })).toEqual({
      error: 'The expiry months can be at most 120.',
      field: 'expiry_months',
    });
    expect(readWalletForm({ ...form, expiry_months: '1.5' })).toEqual({
      error: 'The expiry months must be a whole number.',
      field: 'expiry_months',
    });
    expect(readWalletForm({ ...form, max_use_percent: '0' })).toMatchObject({ field: 'max_use_percent' });
    expect(readWalletForm({ ...form, max_use_percent: '50.5' })).toMatchObject({ field: 'max_use_percent' });
  });

  it('explains expiry', () => {
    expect(walletExpiryText(0)).toBe('Credits never expire.');
    expect(walletExpiryText(1)).toMatch(/expire 1 month after/);
    expect(walletExpiryText(12)).toMatch(/expire 12 months after/);
  });
});

describe('walletErrorMessage', () => {
  const err = (code: string, details?: unknown) => new ApiError(code, 422, code, details);

  it('words every documented refusal', () => {
    expect(walletErrorMessage(err('WALLET_INSUFFICIENT', { balance: 450 }), 'x')).toBe(
      'That would take the wallet below LKR 0 - the balance is LKR 450.'
    );
    expect(walletErrorMessage(err('WALLET_INSUFFICIENT'), 'x', { balance: 20 })).toMatch(/LKR 20/);
    expect(walletErrorMessage(err('NOTHING_TO_REFUND'), 'x')).toBe('Nothing left to refund on this order.');
    expect(walletErrorMessage(err('REFUND_EXCEEDS_REFUNDABLE', { refundable: 80 }), 'x')).toMatch(/only LKR 80 can still be refunded/);
    expect(walletErrorMessage(err('REFUND_EXCEEDS_DELIVERY_FEE'), 'x')).toMatch(/delivery fee/);
    expect(walletErrorMessage(err('POINTS_RETURN_EXCEEDS'), 'x')).toMatch(/points/);
    expect(walletErrorMessage(new ApiError('', 403, 'CANNOT_RECORD_FOR_SELF'), 'x')).toMatch(/your own account/);
    expect(walletErrorMessage(new ApiError('', 404, 'ORDER_NOT_FOUND'), 'x')).toBe('This order was not found.');
    expect(walletErrorMessage(new ApiError('', 404, 'CUSTOMER_NOT_FOUND'), 'x')).toBe('This customer was not found.');
    expect(walletErrorMessage(new ApiError('', 500, 'BOOM'), 'Could not refund.')).toBe('Could not refund.');
  });
});

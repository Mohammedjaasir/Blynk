import { describe, it, expect } from 'vitest';
import { ApiError } from '../api/client';
import { gatewayMethodLabel, paymentGatewayErrorMessage, paymentLabel, refundNeeded } from '../lib/payments';
import { STATUS_LABEL, isPackable, laneOf, primaryAction, type BoardOrderLike } from '../lib/orders';
import { STATUS_ORDER } from '../lib/insights';

describe('paymentLabel (docs/api/payhere.md section 5)', () => {
  it.each([
    ['COD', 'PENDING', 'Cash on delivery'],
    ['COD', 'PAID', 'Cash collected'],
    ['ONLINE', 'PAID', 'Paid online'],
    ['ONLINE', 'PENDING', 'Payment pending'],
    ['ONLINE', 'FAILED', 'Payment failed'],
    ['ONLINE', 'REFUNDED', 'Refunded / chargeback'],
    ['COD', 'REFUNDED', 'Refunded / chargeback'],
  ])('%s + %s -> %s', (method, status, text) => {
    expect(paymentLabel({ payment_method: method, payment_status: status })?.text).toBe(text);
  });

  it('is null when the API sent no payment method', () => {
    expect(paymentLabel({})).toBeNull();
  });

  it('flags refund_required only when true', () => {
    expect(refundNeeded({ payment: { refund_required: true } })).toBe(true);
    expect(refundNeeded({ payment: { refund_required: false } })).toBe(false);
    expect(refundNeeded({ payment: null })).toBe(false);
    expect(refundNeeded({})).toBe(false);
  });

  it('names gateway methods', () => {
    expect(gatewayMethodLabel('VISA')).toBe('Visa');
    expect(gatewayMethodLabel('SOMETHING')).toBe('SOMETHING');
    expect(gatewayMethodLabel(null)).toBeNull();
  });

  it('words the settings refusals', () => {
    expect(paymentGatewayErrorMessage(new ApiError('x', 422, 'PAYMENT_SECRET_KEY_MISSING'))).toMatch(/PAYMENT_SECRET_KEY/);
    expect(paymentGatewayErrorMessage(new ApiError('x', 422, 'PAYHERE_NOT_CONFIGURED'))).toMatch(/not configured/);
    expect(paymentGatewayErrorMessage(new ApiError('x', 403, 'CREDENTIALS_ADMIN_ONLY'))).toMatch(/Only an Admin/);
    expect(paymentGatewayErrorMessage(new ApiError('x', 500, 'OTHER'))).toBeNull();
  });
});

describe('AWAITING_PAYMENT', () => {
  const order: BoardOrderLike = {
    order_status: 'AWAITING_PAYMENT',
    items_summary: { total: 2, pending: 2, sourced: 0, packed: 0, unavailable: 0, substituted: 0 },
    active_delivery: null,
  };
  it('is labelled, has its own lane and is never packable', () => {
    expect(STATUS_LABEL.AWAITING_PAYMENT).toBe('Awaiting payment');
    expect(laneOf(order)).toBe('awaitingPayment');
    expect(isPackable(order)).toBe(false);
    expect(primaryAction(order, 'ADMIN')).toBeNull();
  });
  it('is listed in the status breakdown', () => {
    expect(STATUS_ORDER).toContain('AWAITING_PAYMENT');
  });
});

describe('Admin cancel and bill total for online payments', () => {
  it('lets an Admin cancel an awaiting-payment order (the note dialog applies)', async () => {
    const { allowedActions } = await import('../lib/orders');
    const { needsNote } = await import('../components/OrderDialogs');
    const o: BoardOrderLike = {
      order_status: 'AWAITING_PAYMENT',
      items_summary: { total: 1, pending: 1, sourced: 0, packed: 0, unavailable: 0, substituted: 0 },
      active_delivery: null,
    };
    expect(allowedActions(o, 'ADMIN')).toEqual(['cancel']);
    expect(primaryAction(o, 'ADMIN')).toBeNull();
    expect(needsNote('cancel')).toBe(true);
  });

  it('words the bill total by payment', async () => {
    const { totalLabel } = await import('../components/OrderBill');
    expect(totalLabel('COD', 'PENDING')).toBe('Total · cash to collect');
    expect(totalLabel('COD', 'PAID')).toBe('Total · cash collected');
    expect(totalLabel('ONLINE', 'PAID')).toBe('Total · paid online');
    expect(totalLabel('ONLINE', 'PENDING')).toBe('Total');
    expect(totalLabel(undefined, undefined)).toBe('Total · cash to collect');
  });
});

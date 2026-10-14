import { describe, expect, test, vi } from 'vitest';
import { ApiError } from '@/blynk/api/client';
import { checkoutSignature } from '@/blynk/orders/checkout';
import { placeErrorCopy } from '@/blynk/orders/errors';
import {
  awaitingPayment, isOpenOrder, mayCancel, payByLine, paymentLine, progressOf, statusLabel, statusSentence,
} from '@/blynk/orders/status';
import { checkoutRefusal } from './api';
import {
  allowedAction, formEntries, formHtml, formNeedsEmail, parseCheckout, returnKind, submitWebForm, type CheckoutForm,
} from './form';
import { effectiveMethod, emailStep, methodBody, onlineInfo, payOptions, validEmail, windowNote } from './method';
import { canPayAgain, isFinal, keepsPolling, nextPoll, phaseOf, POLL } from './result';

const ON = { enabled: true, provider: 'PAYHERE', methods_note: 'Visa, Mastercard, eZ Cash', payment_window_minutes: 20 };
const OFF = { ...ON, enabled: false };
const API = 'https://api.blynk.lk/api/v1';
const LOCAL_API = 'http://localhost:4610/api/v1';

const RAW = {
  action_url: 'https://sandbox.payhere.lk/pay/checkout',
  method: 'POST',
  mode: 'sandbox',
  expires_at: '2026-10-14T10:20:00.000Z',
  fields: {
    merchant_id: '1211149',
    return_url: 'https://blynk.lk/app/payment/return?order=o-1',
    cancel_url: 'https://blynk.lk/app/payment/cancel?order=o-1',
    notify_url: 'https://api.blynk.lk/api/v1/payments/payhere/notify',
    order_id: 'BL-20261014-1234',
    items: 'Blynk order BL-20261014-1234',
    currency: 'LKR',
    amount: '1250.00',
    first_name: 'Nimal',
    last_name: 'Perera',
    email: '',
    phone: '+94771234567',
    address: 'No. 1, Test Lane',
    city: 'Dharga Town',
    country: 'Sri Lanka',
    custom_1: 'o-1',
    hash: 'ABCDEF0123456789ABCDEF0123456789',
  },
};

describe('payment method selection', () => {
  test('only cash on delivery while online payment is off or missing', () => {
    expect(payOptions(OFF, 1000).map((o) => o.method)).toEqual(['COD']);
    expect(payOptions(null, 1000).map((o) => o.method)).toEqual(['COD']);
    expect(effectiveMethod('ONLINE', OFF, 1000)).toBe('COD');
    expect(effectiveMethod('ONLINE', undefined, 1000)).toBe('COD');
  });

  test('both while it is on, with the methods note and the payment window', () => {
    const rows = payOptions(ON, 1000);
    expect(rows.map((o) => [o.method, o.title, o.enabled])).toEqual([['COD', 'Cash on delivery', true], ['ONLINE', 'Pay online (card, wallet)', true]]);
    expect(rows[1].sub).toBe('Visa, Mastercard, eZ Cash');
    expect(payOptions({ ...ON, methods_note: null }, 1000)[1].sub).toMatch(/PayHere/);
    expect(windowNote(ON)).toBe('Pay within 20 minutes of placing the order.');
    expect(effectiveMethod('ONLINE', ON, 1000)).toBe('ONLINE');
    expect(effectiveMethod('COD', ON, 1000)).toBe('COD');
  });

  test('a total of 0 cannot be paid online (NOTHING_TO_PAY_ONLINE): the row is disabled and the order goes as COD', () => {
    const rows = payOptions(ON, 0);
    expect(rows[1].enabled).toBe(false);
    expect(effectiveMethod('ONLINE', ON, 0)).toBe('COD');
    // the fee is still being quoted: the choice stands
    expect(effectiveMethod('ONLINE', ON, null)).toBe('ONLINE');
  });

  test('checkout-info wins over GET /store; the body only carries ONLINE', () => {
    expect(onlineInfo(ON, OFF)).toBe(OFF);
    expect(onlineInfo(ON, undefined)).toBe(ON);
    expect(onlineInfo(null, null)).toBeNull();
    expect(methodBody('ONLINE')).toEqual({ payment_method: 'ONLINE' });
    expect(methodBody('COD')).toEqual({});
  });

  test('paying online is a different checkout (its own idempotency key) from cash on delivery', () => {
    const base = { items: [{ product_id: 'p1', quantity: 1 }], addressId: 'a1' };
    const cod = checkoutSignature(base);
    expect(checkoutSignature({ ...base, extra: {} })).toBe(cod);
    expect(checkoutSignature({ ...base, extra: { payment_method: 'ONLINE' } })).not.toBe(cod);
  });

  test('refusals switch back to cash on delivery', () => {
    for (const code of ['ONLINE_PAYMENT_UNAVAILABLE', 'NOTHING_TO_PAY_ONLINE']) {
      expect(placeErrorCopy(new ApiError('x', 422, code)).action).toBe('payment');
    }
  });
});

describe('email requirement', () => {
  test('ask before paying when the profile has none; customers save it, other roles only fill the form', () => {
    expect(emailStep('rizna@example.lk', 'CUSTOMER')).toBe('none');
    expect(emailStep(null, 'CUSTOMER')).toBe('askAndSave');
    expect(emailStep('', undefined)).toBe('askAndSave');
    expect(emailStep('not-an-email', 'CUSTOMER')).toBe('askAndSave');
    expect(emailStep(null, 'RIDER')).toBe('askOnly');
    expect(validEmail(' a@b.lk ')).toBe(true);
    expect(validEmail('a@b')).toBe(false);
  });

  test('an empty email field is filled with the typed one; a server email is kept', () => {
    const f = parseCheckout(RAW, API);
    expect(formNeedsEmail(f)).toBe(true);
    const e = formEntries(f, ' nimal@example.lk ');
    expect(Object.fromEntries(e).email).toBe('nimal@example.lk');
    const withEmail = parseCheckout({ ...RAW, fields: { ...RAW.fields, email: 'server@example.lk' } }, API);
    expect(formNeedsEmail(withEmail)).toBe(false);
    expect(Object.fromEntries(formEntries(withEmail, 'typed@example.lk')).email).toBe('server@example.lk');
  });
});

describe('checkout form building from the API fields', () => {
  test('every field is kept, in order, and the hashed ones are never changed', () => {
    const f = parseCheckout(RAW, API);
    expect(f).toMatchObject({ action_url: RAW.action_url, method: 'POST', mode: 'sandbox', expires_at: RAW.expires_at });
    const e = formEntries(f, 'x@y.lk');
    expect(e.map(([k]) => k)).toEqual(Object.keys(RAW.fields));
    const o = Object.fromEntries(e);
    for (const k of ['merchant_id', 'order_id', 'amount', 'currency', 'hash', 'return_url', 'cancel_url', 'notify_url', 'custom_1'] as const) {
      expect(o[k]).toBe(RAW.fields[k]);
    }
  });

  test('numbers become strings; a missing required field or an unexpected page is refused', () => {
    const f = parseCheckout({ ...RAW, fields: { ...RAW.fields, merchant_id: 1211149 } }, API);
    expect(f.fields.merchant_id).toBe('1211149');
    const { hash: _h, ...noHash } = RAW.fields;
    expect(() => parseCheckout({ ...RAW, fields: noHash }, API)).toThrow(/missing hash/);
    expect(() => parseCheckout({ ...RAW, action_url: 'https://evil.example/pay' }, API)).toThrow(ApiError);
    expect(() => parseCheckout({ ...RAW, action_url: 'http://sandbox.payhere.lk/pay/checkout' }, API)).toThrow(ApiError);
    expect(() => parseCheckout({ ...RAW, method: 'GET' }, API)).toThrow(/POST/);
  });

  test('only PayHere over https; a local mock only with a local API', () => {
    expect(allowedAction('https://sandbox.payhere.lk/pay/checkout', API)).toBe(true);
    expect(allowedAction('https://www.payhere.lk/pay/checkout', API)).toBe(true);
    expect(allowedAction('https://payhere.lk.evil.example/pay', API)).toBe(false);
    expect(allowedAction('http://localhost:4610/payhere/pay/checkout', API)).toBe(false);
    expect(allowedAction('http://localhost:4610/payhere/pay/checkout', LOCAL_API)).toBe(true);
    expect(allowedAction('javascript:alert(1)', LOCAL_API)).toBe(false);
  });

  test('native: a self-submitting HTML page with every field escaped', () => {
    const f = parseCheckout({ ...RAW, fields: { ...RAW.fields, address: '1 "Main" <St> & Co' } }, API);
    const html = formHtml(f.action_url, formEntries(f, 'a@b.lk'));
    expect(html).toContain('<form id="f" method="POST" action="https://sandbox.payhere.lk/pay/checkout"');
    expect(html).toContain('name="hash" value="ABCDEF0123456789ABCDEF0123456789"');
    expect(html).toContain('value="1 &quot;Main&quot; &lt;St&gt; &amp; Co"');
    expect(html).toContain('document.getElementById("f").submit()');
  });

  test('web: a hidden POST form in this tab, submitted', () => {
    const made: Record<string, unknown>[] = [];
    const submit = vi.fn();
    const doc = {
      body: { appendChild: vi.fn() },
      createElement: (tag: string) => {
        const el: Record<string, unknown> = { tag, style: {}, children: [] as unknown[] };
        el.appendChild = (c: unknown) => (el.children as unknown[]).push(c);
        if (tag === 'form') el.submit = submit;
        made.push(el);
        return el;
      },
    } as unknown as Document;
    const f = parseCheckout(RAW, API);
    const form = submitWebForm(doc, f.action_url, formEntries(f, 'a@b.lk')) as unknown as Record<string, unknown>;
    expect(form).toMatchObject({ method: 'POST', action: RAW.action_url, target: '_self' });
    const inputs = form.children as Record<string, string>[];
    expect(inputs).toHaveLength(Object.keys(RAW.fields).length);
    expect(inputs.every((i) => i.type === 'hidden')).toBe(true);
    expect(inputs.find((i) => i.name === 'amount')?.value).toBe('1250.00');
    expect(submit).toHaveBeenCalledTimes(1);
  });

  test('native: the WebView spots PayHere sending the customer back', () => {
    const f = parseCheckout(RAW, API) as CheckoutForm;
    expect(returnKind('https://blynk.lk/app/payment/return?order=o-1&status=2', f)).toBe('return');
    expect(returnKind('https://blynk.lk/app/payment/cancel?order=o-1', f)).toBe('cancel');
    expect(returnKind('https://sandbox.payhere.lk/pay/checkout', f)).toBeNull();
  });

  test('checkout refusals', () => {
    expect(checkoutRefusal(new ApiError('x', 409, 'ORDER_ALREADY_PAID'))).toBe('paid');
    expect(checkoutRefusal(new ApiError('x', 409, 'PAYMENT_EXPIRED'))).toBe('expired');
    expect(checkoutRefusal(new ApiError('x', 409, 'ORDER_NOT_AWAITING_PAYMENT'))).toBe('notAwaiting');
    expect(checkoutRefusal(new ApiError('x', 422, 'ONLINE_PAYMENT_UNAVAILABLE'))).toBe('unavailable');
    expect(checkoutRefusal(new Error('x'))).toBe('other');
  });
});

describe('return / cancel polling', () => {
  const NOW = Date.parse('2026-10-14T10:00:00.000Z');
  const EXP = '2026-10-14T10:20:00.000Z';
  const o = (order_status: string, payment_status: string, extra: Record<string, unknown> = {}) =>
    ({ order_status, payment_status, payment_method: 'ONLINE', payment_expires_at: EXP, ...extra }) as never;
  const at = (from: 'return' | 'cancel', elapsedMs = 0, now = NOW) => ({ now, from, elapsedMs });

  test('paid only when the server says so (PLACED + PAID); the return URL alone is still waiting', () => {
    expect(phaseOf(null, at('return'))).toBe('checking');
    expect(phaseOf(o('AWAITING_PAYMENT', 'PENDING'), at('return'))).toBe('waiting');
    expect(phaseOf(o('PLACED', 'PAID'), at('return'))).toBe('paid');
    expect(phaseOf(o('PACKED', 'PAID'), at('cancel'))).toBe('paid');
  });

  test('failed: try again until it expires', () => {
    const p = phaseOf(o('AWAITING_PAYMENT', 'FAILED'), at('return'));
    expect(p).toBe('failed');
    expect(canPayAgain(p)).toBe(true);
    expect(keepsPolling(p)).toBe(false);
  });

  test('cancel_url: not paid (pay now), still polled in case a late success arrives', () => {
    const p = phaseOf(o('AWAITING_PAYMENT', 'PENDING'), at('cancel'));
    expect(p).toBe('notPaid');
    expect(canPayAgain(p)).toBe(true);
    expect(keepsPolling(p)).toBe(true);
  });

  test('expired: past payment_expires_at, or cancelled by the expiry worker', () => {
    const later = Date.parse(EXP) + 1000;
    expect(phaseOf(o('AWAITING_PAYMENT', 'PENDING'), at('return', 0, later))).toBe('expired');
    expect(phaseOf(o('CANCELLED', 'PENDING'), at('return', 0, later))).toBe('expired');
    expect(phaseOf(o('CANCELLED', 'PENDING'), at('return'))).toBe('cancelled');
    expect(isFinal('expired')).toBe(true);
    expect(canPayAgain('expired')).toBe(false);
  });

  test('a cash order has nothing to pay here', () => {
    expect(phaseOf({ order_status: 'PLACED', payment_status: 'PENDING', payment_method: 'COD' } as never, at('return'))).toBe('cod');
  });

  test('polls every 2.5 s for up to a minute, then "we haven\'t heard yet" with Check again (never pay twice)', () => {
    const waiting = o('AWAITING_PAYMENT', 'PENDING');
    expect(nextPoll(phaseOf(waiting, at('return', 5000)), 5000)).toEqual({ again: true, delayMs: POLL.everyMs });
    const late = phaseOf(waiting, at('return', POLL.limitMs));
    expect(late).toBe('timeout');
    expect(nextPoll(late, POLL.limitMs)).toEqual({ again: false, delayMs: 0 });
    expect(canPayAgain(late)).toBe(false);
    expect(nextPoll('paid', 1000).again).toBe(false);
    expect(nextPoll('failed', 1000).again).toBe(false);
    expect(nextPoll('notPaid', POLL.limitMs + 1).again).toBe(false);
  });
});

describe('order screens', () => {
  const base = { total_amount: 1250, payment_expires_at: '2026-10-14T10:20:00.000Z' };
  test('"Paid online"; "Awaiting payment — pay by HH:MM" (Sri Lanka time) while AWAITING_PAYMENT', () => {
    expect(paymentLine({ ...base, order_status: 'PLACED', payment_status: 'PAID', payment_method: 'ONLINE' })).toBe('Paid online');
    expect(paymentLine({ ...base, order_status: 'AWAITING_PAYMENT', payment_status: 'PENDING', payment_method: 'ONLINE' })).toBe('Awaiting payment — pay by 3:50 PM');
    expect(paymentLine({ ...base, order_status: 'AWAITING_PAYMENT', payment_status: 'FAILED', payment_method: 'ONLINE' })).toBe('Payment failed — try again by 3:50 PM');
    expect(paymentLine({ ...base, order_status: 'CANCELLED', payment_status: 'PENDING', payment_method: 'ONLINE' })).toMatch(/Not paid/);
    expect(paymentLine({ ...base, order_status: 'DELIVERED', payment_status: 'PAID', payment_method: 'COD' })).toBe('Paid in cash');
    expect(payByLine({ payment_expires_at: null })).toBe('Awaiting payment');
  });

  test('AWAITING_PAYMENT: label, sentence, first step, polled, cancellable when the server allows', () => {
    const w = { order_status: 'AWAITING_PAYMENT' as const, payment_method: 'ONLINE', scheduled_for: null, delivery: null, payment_expires_at: base.payment_expires_at };
    expect(statusLabel('AWAITING_PAYMENT')).toBe('Waiting for payment');
    expect(statusSentence(w)).toBe('Pay online by 3:50 PM to confirm your order.');
    expect(progressOf('AWAITING_PAYMENT')).toEqual({ step: 0, stopped: false });
    expect(isOpenOrder('AWAITING_PAYMENT')).toBe(true);
    expect(awaitingPayment(w)).toBe(true);
    expect(awaitingPayment({ ...w, payment_method: 'COD' })).toBe(false);
    expect(mayCancel({ order_status: 'AWAITING_PAYMENT', can_cancel: true })).toBe(true);
  });
});

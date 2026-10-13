import { expect, test } from 'vitest';
import {
  discountRows, isOpenOrder, itemCountText, itemTitle, orderTime, paymentLine, progressOf, statusLabel, statusSentence, statusTone, timelineLabel,
} from './status';

test('labels and tones follow the approved wording', () => {
  expect(statusLabel('PLACED')).toBe('Order placed');
  expect(statusLabel('OUT_FOR_DELIVERY')).toBe('Out for delivery');
  expect(statusLabel('CUSTOMER_UNAVAILABLE')).toBe("We couldn't reach you");
  expect(statusLabel('SOMETHING_NEW')).toBe('Status unavailable');
  expect(statusTone('DELIVERED')).toBe('success');
  expect(statusTone('FAILED')).toBe('problem');
  expect(statusTone('PACKED')).toBe('active');
});

test('the sentence reads the rider handover step', () => {
  expect(statusSentence({ order_status: 'PLACED', scheduled_for: null, delivery: null })).toBe("We've received your order.");
  expect(statusSentence({ order_status: 'PACKED', scheduled_for: null, delivery: { assignment_status: 'ASSIGNED', assigned_at: null, picked_up_at: null, delivered_at: null } }))
    .toBe('A rider has been assigned.');
  expect(statusSentence({ order_status: 'OUT_FOR_DELIVERY', scheduled_for: null, delivery: { assignment_status: 'ARRIVED_AT_CUSTOMER', assigned_at: null, picked_up_at: null, delivered_at: null } }))
    .toBe('Your rider has arrived.');
});

test('progress steps and open orders', () => {
  expect(progressOf('PLACED')).toEqual({ step: 0, stopped: false });
  expect(progressOf('OUT_FOR_DELIVERY')).toEqual({ step: 2, stopped: false });
  expect(progressOf('DELIVERED')).toEqual({ step: 3, stopped: false });
  expect(progressOf('CANCELLED').stopped).toBe(true);
  expect(isOpenOrder('PACKED')).toBe(true);
  expect(isOpenOrder('DELIVERED')).toBe(false);
});

test('a PACKED after a failed attempt is a redelivery', () => {
  expect(timelineLabel({ old_status: 'FAILED', new_status: 'PACKED' })).toBe('Packed again for redelivery');
  expect(timelineLabel({ old_status: 'PLACED', new_status: 'PACKED' })).toBe('Packed');
});

test('payment line is cash on delivery until paid', () => {
  expect(paymentLine({ order_status: 'PLACED', payment_status: 'PENDING', total_amount: 1176 })).toBe('Cash on delivery — pay LKR 1,176 to the rider');
  expect(paymentLine({ order_status: 'DELIVERED', payment_status: 'PAID', total_amount: 1176 })).toBe('Paid in cash');
  expect(paymentLine({ order_status: 'CANCELLED', payment_status: 'PENDING', total_amount: 1176 })).toBe('Nothing to pay');
});

test('item count and Sri Lanka time', () => {
  expect(itemCountText({ items: [{ quantity: 2 }, { quantity: 1 }] as never })).toBe('3 items');
  expect(itemCountText({ items: [{ quantity: 1 }] as never })).toBe('1 item');
  expect(orderTime('2026-10-13T16:11:00.000Z')).toBe('13 Oct, 9:41 PM');
  expect(orderTime(null)).toBe('');
});

test('discount rows name what took money off', () => {
  expect(discountRows({ discount_amount: 0, birthday_discount_amount: 0, referral_discount_amount: 0, points_discount_amount: 0, coupon_code: null })).toEqual([]);
  expect(discountRows({ discount_amount: 150, birthday_discount_amount: 0, referral_discount_amount: 0, points_discount_amount: 50, coupon_code: 'SAVE10' }))
    .toEqual([{ label: 'Blynk Points', amount: 50 }, { label: 'Discount (SAVE10)', amount: 100 }]);
});

test('item titles never repeat the unit', () => {
  expect(itemTitle('Anti-Dandruff Shampoo 180ml', '180 ml')).toBe('Anti-Dandruff Shampoo 180ml');
  expect(itemTitle('Big Onions', '1 kg')).toBe('Big Onions · 1 kg');
  expect(itemTitle('Big Onions', null)).toBe('Big Onions');
});

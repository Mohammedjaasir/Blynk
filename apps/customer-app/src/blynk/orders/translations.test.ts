import { afterEach, describe, expect, test } from 'vitest';
import { ApiError } from '@/blynk/api/client';
import { setLang } from '@/blynk/i18n/lang';
import { arrivingText, lastSeenText, trackingView } from '@/blynk/tracking/model';
import { TIP_COPY, starWord, TAG_COPY, parseCustomTip } from '@/blynk/ratings/model';
import { ASK_COPY, requestErrorText, statusChip, validateRequest } from '@/blynk/requests/model';
import { boughtText } from '@/blynk/repeat/buyAgain';
import { repeatErrorText } from '@/blynk/repeat/payload';
import { nextLine, scheduleText, suggestName, timeLabel } from '@/blynk/repeat/schedule';
import { productShareText, referralShareText } from '@/blynk/share/links';
import { cancelErrorText, OUTSIDE_AREA, placeErrorCopy, stockRefusalNote } from './errors';
import { reorderMessage } from './reorder';
import { itemCaption, itemCountText, orderTime, paymentLine, progressSteps, statusLabel, statusSentence } from './status';

const SI = /[඀-෿]/;
const TA = /[஀-௿]/;

afterEach(() => setLang('en'));

describe('G4 words follow the chosen language (orders, tracking, ratings, requests, repeat, share)', () => {
  test('English stays as it was', () => {
    expect(statusLabel('PACKED')).toBe('Packed');
    expect(itemCountText({ items: [{ quantity: 2 }] as never })).toBe('2 items');
    expect(orderTime('2026-10-13T16:11:00Z')).toBe('13 Oct, 9:41 PM');
    expect(progressSteps()).toEqual(['Order received', 'Packed', 'On the way', 'Delivered']);
  });

  test('Sinhala', () => {
    setLang('si');
    expect(statusLabel('DELIVERED')).toMatch(SI);
    expect(statusSentence({ order_status: 'CANCELLED', scheduled_for: null, delivery: null })).toMatch(SI);
    expect(paymentLine({ order_status: 'PLACED', payment_status: 'PENDING', total_amount: 450 })).toContain('LKR');
    expect(paymentLine({ order_status: 'PLACED', payment_status: 'PENDING', total_amount: 450 })).toMatch(SI);
    expect(orderTime('2026-10-13T16:11:00Z')).toBe('13 ඔක්, 9:41 PM');
    expect(progressSteps()).toHaveLength(4);
    expect(progressSteps()[0]).toMatch(SI);
    expect(itemCaption('UNAVAILABLE')?.text).toMatch(SI);
    expect(placeErrorCopy(new ApiError('x', 422, 'COUPON_EXPIRED'))).toEqual({
      title: 'කූපනය කල් ඉකුත් වුණා', message: 'ඒ කූපනය කල් ඉකුත් වෙලා.', action: 'coupon',
    });
    expect(OUTSIDE_AREA.title).toMatch(SI);
    expect(cancelErrorText(new ApiError('x', 400, 'ORDER_ALREADY_CANCELLED'))).toMatch(SI);
    expect(stockRefusalNote({ kind: 'only', product_id: 'p', variant_id: null, available: 3 })).toContain('3');
    expect(reorderMessage({ addedUnits: 2, unavailable: ['Milk'], offline: false }).text).toContain('Milk');
    expect(arrivingText(301)).toMatch(SI);
    expect(lastSeenText(45_000)).toMatch(SI);
    expect(TAG_COPY.ON_TIME.label).toMatch(SI);
    expect(starWord(5)).toMatch(SI);
    expect(TIP_COPY.walletCta(100)).toContain('LKR 100');
    expect(parseCustomTip('abc').error).toMatch(SI);
    expect(ASK_COPY.cta).toMatch(SI);
    expect(statusChip('PLANNED').label).toMatch(SI);
    expect(validateRequest({ name: '' })).toMatchObject({ ok: false });
    expect(requestErrorText(new Error('x'))).toMatch(SI);
    expect(scheduleText('WEEKLY', 1, '08:00')).toMatch(SI);
    expect(timeLabel('13:45')).toContain('1:45');
    expect(suggestName('DAILY', null)).toMatch(SI);
    expect(boughtText(6)).toContain('6');
    expect(repeatErrorText(new ApiError('x', 409, 'BASKET_LIMIT'))).toMatch(SI);
    expect(nextLine({ status: 'PAUSED', skipNext: false, nextRunAt: null, frequency: 'DAILY' }).title).toMatch(SI);
    expect(productShareText('Milk', 'abc_1')).toMatch(SI);
    expect(referralShareText('NIMAL42')).toContain('NIMAL42');
  });

  test('Tamil', () => {
    setLang('ta');
    expect(statusLabel('OUT_FOR_DELIVERY')).toMatch(TA);
    expect(statusSentence({ order_status: 'DELIVERED', scheduled_for: null, delivery: null })).toMatch(TA);
    expect(orderTime('2026-10-13T16:11:00Z')).toBe('13 அக், 9:41 PM');
    expect(placeErrorCopy(new Error('boom')).title).toMatch(TA);
    expect(cancelErrorText(new Error('boom'))).toMatch(TA);
    expect(arrivingText(301)).toContain('6');
    expect(arrivingText(301)).toMatch(TA);
    expect(trackingView({ current: null, heading: null, closed: false, unavailable: false }, null, 0).caption.text).toMatch(TA);
    expect(TAG_COPY.LATE.label).toMatch(TA);
    expect(TIP_COPY.checkoutTitle).toMatch(TA);
    expect(ASK_COPY.title).toMatch(TA);
    expect(scheduleText('DAILY', null, '07:30')).toMatch(TA);
    expect(boughtText(1)).toMatch(TA);
    expect(productShareText('Milk', 'abc_1')).toMatch(TA);
  });

  test('back to English after a switch', () => {
    setLang('si');
    setLang('en');
    expect(statusLabel('DELIVERED')).toBe('Delivered');
    expect(scheduleText('DAILY', null, '07:30')).toBe('Every day at 7:30 am');
  });
});

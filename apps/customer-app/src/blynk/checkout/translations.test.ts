import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '@/blynk/api/client';
import { addressErrorText } from '@/blynk/address/api';
import { COPY, recipientNameError } from '@/blynk/address/forms';
import { ADDRESS_BOOK, labelText } from '@/blynk/address/words';
import { setLang } from '@/blynk/i18n/lang';
import { PAY } from '@/blynk/payments/copy';
import { payOptions } from '@/blynk/payments/method';
import { couponErrorText, couponInputError, discountLabel } from './coupon';
import { DETAILS_COPY } from './details';
import { LEAD_COPY } from './leadTime';
import { balanceLine, birthdayBanner } from './rewards';
import { SLOT_COPY } from './slots';
import { CART } from './words';

const SINHALA = /[඀-෿]/;
const TAMIL = /[஀-௿]/;

afterEach(() => setLang('en'));

describe('checkout, address and payment words in Sinhala and Tamil', () => {
  it('stay English by default', () => {
    expect(CART.emptyTitle).toBe('Your cart is empty');
    expect(PAY.cod).toBe('Cash on delivery');
    expect(couponInputError('')).toBe('Enter a code.');
    expect(labelText('Home')).toBe('Home');
    expect(labelText('Work')).toBe('Work');
    expect(labelText('Other')).toBe('Other');
    expect(ADDRESS_BOOK.title).toBe('Saved addresses');
  });

  it('render Sinhala', () => {
    setLang('si');
    expect(CART.emptyTitle).toMatch(SINHALA);
    expect(CART.deliverTo('Home')).toMatch(SINHALA);
    expect(PAY.placeCod('LKR 100')).toContain('LKR 100');
    expect(PAY.placeCod('LKR 100')).toMatch(SINHALA);
    expect(couponInputError('')).toMatch(SINHALA);
    expect(couponErrorText(new ApiError('x', 422, 'COUPON_EXPIRED'))).toMatch(SINHALA);
    expect(discountLabel('COUPON', 'SAVE10')).toContain('SAVE10');
    expect(SLOT_COPY.asap).toMatch(SINHALA);
    expect(LEAD_COPY.needs('Ribbon Cake', 2, 'Fri 17 Oct')).toMatch(SINHALA);
    expect(LEAD_COPY.needs('Ribbon Cake', 2, 'Fri 17 Oct')).toContain('Ribbon Cake');
    expect(DETAILS_COPY.forSomeoneElseSub(true)).not.toBe(DETAILS_COPY.forSomeoneElseSub(false));
    expect(birthdayBanner({ eligible: true, percent: 10 })).toContain('10%');
    expect(balanceLine({ balance: 5, valueLkr: 50 } as never)).toMatch(SINHALA);
    expect(recipientNameError('N')).toBe(COPY.nameBad);
    expect(COPY.nameBad).toMatch(SINHALA);
    expect(addressErrorText(new ApiError('x', 404, 'ADDRESS_NOT_FOUND'))).toMatch(SINHALA);
    expect(labelText('Home')).toBe('ගෙදර');
    expect(labelText('Work')).toBe('වැඩ');
    expect(labelText('Other')).toBe('වෙනත්');
    expect(labelText('Aunty')).toBe('Aunty');
    expect(payOptions(null, 100)[0]!.title).toMatch(SINHALA);
  });

  it('render Tamil', () => {
    setLang('ta');
    expect(CART.emptyTitle).toMatch(TAMIL);
    expect(CART.legal.before + CART.legal.privacy + CART.legal.between + CART.legal.terms + CART.legal.after).toMatch(TAMIL);
    expect(PAY.failedSub('')).toMatch(TAMIL);
    expect(PAY.failedSub('4:30 PM')).toContain('4:30 PM');
    expect(couponErrorText(new ApiError('x', 422, 'COUPON_NOT_FOUND'))).toMatch(TAMIL);
    expect(SLOT_COPY.title).toMatch(TAMIL);
    expect(LEAD_COPY.pickSlot(null)).toMatch(TAMIL);
    expect(COPY.lineBad).toMatch(TAMIL);
    expect(addressErrorText(new ApiError('x', 401, 'UNAUTHENTICATED'))).toMatch(TAMIL);
    expect(labelText('Home')).toBe('வீடு');
    expect(labelText('Work')).toBe('வேலை');
    expect(labelText('Other')).toBe('மற்றவை');
    expect(payOptions(null, 100)[1]!.title).toMatch(TAMIL);
  });

  it('go back to English when the language is switched back', () => {
    setLang('ta');
    setLang('en');
    expect(CART.emptyTitle).toBe('Your cart is empty');
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '@/blynk/api/client';
import { authErrorText, REFUSED_FALLBACK } from '@/blynk/auth/forms';
import { LOGIN_WORDS, OTP_WORDS } from '@/blynk/auth/words';
import { appointmentBadge, formatAppointmentDate, holdCountdownText, validatePatient } from '@/blynk/doctors/format';
import { setLang } from '@/blynk/i18n/lang';
import { POLICIES, policyUrl } from '@/blynk/legal/policies';
import { entryLabel, formatPointsDate, howItWorks, pointsBalanceText } from '@/blynk/rewards/models';
import { usualsAddedMessage as usualsMessage } from '@/blynk/rewards/usuals';
import { WALLET_COPY } from '@/blynk/wallet/copy';
import { kindLabel } from '@/blynk/wallet/models';
import { accountErrorText } from './errors';
import { DELETE_COPY } from './deleteFlow';
import { faqsWithHours } from './support';
import { ACCOUNT_SCREEN } from './screenWords';
import { noticeFor } from './cleanup';

const SI = /[඀-෿]/;
const TA = /[஀-௿]/;

afterEach(() => setLang('en'));

describe('G5 words follow the chosen language', () => {
  it('stays English by default', () => {
    expect(LOGIN_WORDS.title).toBe('Login');
    expect(authErrorText(new ApiError('x', 400, 'OTP_EXPIRED'))).toBe('This code has expired. Tap Resend OTP for a new one.');
    expect(pointsBalanceText(120, 120)).toMatch(/^120 Blynk Points = /);
    expect(WALLET_COPY.title).toBe('Blynk Wallet');
  });

  it('Sinhala', () => {
    setLang('si');
    expect(LOGIN_WORDS.title).toMatch(SI);
    expect(OTP_WORDS.resendIn(12)).toContain('12');
    expect(authErrorText(new ApiError('x', 400, 'OTP_EXPIRED'))).toMatch(SI);
    expect(authErrorText(new ApiError('x', 400, 'INVALID_OTP', { remaining_attempts: 2 }))).toContain('2');
    expect(REFUSED_FALLBACK.RIDER_PENDING_APPROVAL).toMatch(SI);
    expect(accountErrorText(new Error('x'))).toMatch(SI);
    expect(noticeFor('deleted')).toMatch(SI);
    expect(DELETE_COPY.points).toHaveLength(4);
    expect(DELETE_COPY.confirm).toMatch(SI);
    expect(ACCOUNT_SCREEN.logOut).toMatch(SI);
    expect(ACCOUNT_SCREEN.shareMessage('https://x.lk')).toContain('https://x.lk');
    expect(faqsWithHours('8 AM - 9 PM')[1].a).toContain('8 AM - 9 PM');
    expect(faqsWithHours('8 AM - 9 PM')).toHaveLength(6);
    expect(WALLET_COPY.title).toMatch(SI);
    expect(WALLET_COPY.refundAdded(450)).toContain('450');
    expect(kindLabel('REFUND_ITEM')).toMatch(SI);
    expect(pointsBalanceText(5, 5)).toMatch(SI);
    expect(entryLabel({ kind: 'EARN', orderNumber: 'BL-1' })).toContain('BL-1');
    expect(howItWorks({ earnPoints: 1, earnPerLkr: 100, lkrPerPoint: 1, minRedeemPoints: 10, maxRedeemPercent: 50, expiryMonths: 6 })).toHaveLength(5);
    expect(formatPointsDate(new Date(2027, 2, 14))).toBe('2027 මාර්තු 14');
    expect(usualsMessage({ addedUnits: 3, unavailable: [] }).text).toMatch(SI);
    expect(POLICIES.terms.label).toMatch(SI);
    expect(policyUrl('terms')).toBe('https://blynk.lk/terms');
  });

  it('Tamil', () => {
    setLang('ta');
    expect(LOGIN_WORDS.title).toMatch(TA);
    expect(authErrorText(new ApiError('x', 429, 'TOO_MANY_REQUESTS', { retry_after_seconds: 120 }))).toContain('2');
    expect(accountErrorText(new Error('x'))).toMatch(TA);
    expect(DELETE_COPY.title).toMatch(TA);
    expect(WALLET_COPY.maxUse('50%')).toContain('50%');
    expect(formatPointsDate(new Date(2027, 2, 14))).toBe('14 மார்ச் 2027');
    expect(formatAppointmentDate(new Date(2026, 5, 7))).toMatch(TA);
    expect(holdCountdownText(65_000)).toContain('1:05');
    expect(appointmentBadge({ status: 'CANCELLED_BY_CUSTOMER', heldUntil: null, startAt: null }, new Date()).label).toMatch(TA);
    expect(validatePatient({ name: '', phone: '', notes: '' }).errors.name).toMatch(TA);
  });
});

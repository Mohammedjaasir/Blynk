import { expect, test, vi } from 'vitest';
import { LEGAL, openPolicyWith, POLICIES, POLICY_ORDER, policyUrl } from './policies';

test('policy links point at the landing site pages', () => {
  expect(policyUrl('privacy')).toBe('https://blynk.lk/privacy');
  expect(policyUrl('terms')).toBe('https://blynk.lk/terms');
  expect(policyUrl('refunds')).toBe('https://blynk.lk/refunds');
  expect(POLICY_ORDER).toEqual(['terms', 'privacy', 'refunds']);
  expect(`${LEGAL.agreePrefix}${POLICIES.terms.label}${LEGAL.and}${POLICIES.privacy.label}${LEGAL.agreeSuffix}`)
    .toBe('By continuing you agree to the Terms and Privacy Policy.');
});

test('web opens a new tab (the app stays); a phone opens the browser', () => {
  const open = vi.fn();
  const openURL = vi.fn(() => Promise.resolve(true));
  expect(openPolicyWith('refunds', { os: 'web', open, openURL })).toBe('https://blynk.lk/refunds');
  expect(open).toHaveBeenCalledWith('https://blynk.lk/refunds', '_blank', 'noopener,noreferrer');
  expect(openURL).not.toHaveBeenCalled();
  openPolicyWith('terms', { os: 'android', openURL });
  expect(openURL).toHaveBeenCalledWith('https://blynk.lk/terms');
});

test('a phone without a browser does not throw', async () => {
  const openURL = vi.fn(() => Promise.reject(new Error('no browser')));
  expect(() => openPolicyWith('privacy', { os: 'ios', openURL })).not.toThrow();
  await Promise.resolve();
});

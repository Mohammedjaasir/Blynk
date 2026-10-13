import { expect, test } from 'vitest';
import { ApiError } from '@/blynk/api/client';
import { authErrorText, cleanReferral, needsNewCode, parseBirthday, referralOk, validName } from './forms';

test('a name needs 2+ characters with a letter, trimmed, at most 60', () => {
  expect(validName('  Nimal   Perera ')).toBe('Nimal Perera');
  expect(validName('A')).toBeNull();
  expect(validName('   ')).toBeNull();
  expect(validName('12')).toBeNull();
  expect(validName('නිමල්')).toBe('නිමල්');
  expect(validName('x'.repeat(61))).toBeNull();
});

test('referral codes are upper-cased A-Z0-9, 3 to 32', () => {
  expect(cleanReferral('ab-12 c')).toBe('AB12C');
  expect(referralOk('AB')).toBe(false);
  expect(referralOk('AB1')).toBe(true);
  expect(referralOk('A'.repeat(33))).toBe(false);
});

test('birthday: real dates only, age 5 to 120, never in the future', () => {
  const today = new Date(2026, 9, 13);
  expect(parseBirthday('7', '3', '1990', today)).toBe('1990-03-07');
  expect(parseBirthday('31', '2', '1990', today)).toBeNull();
  expect(parseBirthday('29', '2', '2000', today)).toBe('2000-02-29');
  expect(parseBirthday('14', '10', '2026', today)).toBeNull();
  expect(parseBirthday('13', '10', '2021', today)).toBe('2021-10-13');
  expect(parseBirthday('14', '10', '2021', today)).toBeNull();
  expect(parseBirthday('1', '1', '1900', today)).toBeNull();
  expect(parseBirthday('', '1', '1990', today)).toBeNull();
  expect(parseBirthday('1', '13', '1990', today)).toBeNull();
});

test('error copy uses the backend details', () => {
  expect(authErrorText(new ApiError('x', 401, 'INVALID_OTP', { remaining_attempts: 2 }))).toBe('Wrong code. 2 attempts left.');
  expect(authErrorText(new ApiError('x', 401, 'INVALID_OTP', { remaining_attempts: 1 }))).toBe('Wrong code. 1 attempt left.');
  expect(authErrorText(new ApiError('x', 429, 'TOO_MANY_REQUESTS', { retry_after_seconds: 1700 }))).toBe('Too many codes requested. Try again in 29 min.');
  expect(authErrorText(new ApiError('Server words', 400, 'SOMETHING_NEW'))).toBe('Server words');
  expect(needsNewCode(new ApiError('x', 410, 'OTP_EXPIRED'))).toBe(true);
  expect(needsNewCode(new ApiError('x', 401, 'INVALID_OTP', { remaining_attempts: 2 }))).toBe(false);
  expect(needsNewCode(new ApiError('x', 401, 'INVALID_OTP'))).toBe(true);
});

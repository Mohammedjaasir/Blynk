import { expect, test } from 'vitest';
import { formatPhone, toE164 } from './phone';

test('normalises every form the backend accepts to E.164', () => {
  for (const raw of ['0771234567', '94771234567', '+94771234567', '771234567', ' 077 123-4567 ', '(077) 123 4567']) {
    expect(toE164(raw)).toBe('+94771234567');
  }
});

test('accepts every Sri Lankan mobile operator prefix and nothing else', () => {
  for (const p of ['70', '71', '72', '74', '75', '76', '77', '78']) expect(toE164(`0${p}1234567`)).toBe(`+94${p}1234567`);
  for (const p of ['73', '79', '11', '81']) expect(toE164(`0${p}1234567`)).toBeNull();
});

test('rejects wrong lengths, letters, other countries and empty input', () => {
  for (const raw of ['', '   ', '07712345', '077123456789', '+9477123456a', '+14155550123', '+91771234567']) {
    expect(toE164(raw)).toBeNull();
  }
  expect(toE164(null)).toBeNull();
  expect(toE164(undefined)).toBeNull();
});

test('formats a number for display', () => {
  expect(formatPhone('+94771234567')).toBe('+94 77 123 4567');
});

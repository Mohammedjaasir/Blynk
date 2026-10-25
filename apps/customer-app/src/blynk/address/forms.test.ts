import { expect, test } from 'vitest';
import {
  ADDRESS_TAGS, COPY, lineError, metresBetween, notesError, numParam, otherPhoneError, phoneError, recipientNameError, safeReturn,
  resolveLabel, suggestTag, TAG_NAME_MAX, tagFromLabel, townFromHub, validateAddress,
} from './forms';

const ok = { name: 'Nimal Perera', phone: '077 123 4567', other: '', line: '12/3 Main Street, near the mosque', notes: '' };
const pin = { lat: 6.4413, lng: 80.0114 };

test('recipient names follow the Flutter rule (2-80, letters, spaces and \' - .)', () => {
  expect(recipientNameError('Nimal Perera')).toBeNull();
  expect(recipientNameError("D'Silva-Fernando Jr.")).toBeNull();
  expect(recipientNameError('ரமேஷ்')).toBeNull();
  expect(recipientNameError('නිමල් පෙරේරා')).toBeNull();
  expect(recipientNameError('N')).toBe(COPY.nameBad);
  expect(recipientNameError('Nimal 2')).toBe(COPY.nameBad);
  expect(recipientNameError('x'.repeat(81))).toBe(COPY.nameBad);
});

test('phones must be Sri Lankan mobiles; the other phone is optional and must differ', () => {
  expect(phoneError('0771234567')).toBeNull();
  expect(phoneError('+94 77 123 4567')).toBeNull();
  expect(phoneError('0112345678')).toBe(COPY.phoneBad);
  expect(otherPhoneError('', '0771234567')).toBeNull();
  expect(otherPhoneError('0712345678', '0771234567')).toBeNull();
  expect(otherPhoneError('+94771234567', '0771234567')).toBe(COPY.otherSame);
  expect(otherPhoneError('123', '0771234567')).toBe(COPY.phoneBad);
});

test('address lines are 3-150 of letters, digits, spaces and \' - . , / # ( )', () => {
  expect(lineError('No. 12/3, Main St (near #5)')).toBeNull();
  expect(lineError('ab')).toBe(COPY.lineBad);
  expect(lineError('12 Main St!')).toBe(COPY.lineBad);
  expect(lineError('a'.repeat(151))).toBe(COPY.lineBad);
  expect(notesError('')).toBeNull();
  expect(notesError('Blue gate; call me!')).toBeNull();
  expect(notesError('<script>')).toBe(COPY.notesBad);
});

test('validateAddress cleans the values and needs a pin', () => {
  const r = validateAddress({ ...ok, name: '  Nimal   Perera ', other: '0712345678', notes: ' Blue gate ' }, pin);
  expect(r.errors).toEqual({});
  expect(r.details).toEqual({
    recipient_name: 'Nimal Perera',
    recipient_phone: '+94771234567',
    alternate_phone: '+94712345678',
    address_line1: '12/3 Main Street, near the mosque',
    delivery_instructions: 'Blue gate',
  });
  expect(validateAddress(ok, pin).details).toMatchObject({ alternate_phone: null, delivery_instructions: null });
  const bad = validateAddress({ ...ok, phone: '12', line: '' }, null);
  expect(bad.details).toBeNull();
  expect(bad.errors).toEqual({ phone: COPY.phoneBad, line: COPY.lineBad, pin: COPY.pinMissing });
});

test('the town comes from the hub name', () => {
  expect(townFromHub('Dharga Town Central Dark Store')).toBe('Dharga Town');
  expect(townFromHub('Dharga Town Hub')).toBe('Dharga Town');
  expect(townFromHub('Beruwala')).toBe('Beruwala');
  expect(townFromHub(null)).toBe('Dharga Town');
  expect(townFromHub('Dark Store')).toBe('Dharga Town');
});

test('only in-app return paths are followed', () => {
  expect(safeReturn('/cart')).toBe('/cart');
  expect(safeReturn(['/addresses?return=/cart'])).toBe('/addresses?return=/cart');
  expect(safeReturn('//evil.example')).toBeNull();
  expect(safeReturn('https://evil.example')).toBeNull();
  expect(safeReturn(undefined)).toBeNull();
});

test('numbers from params and distances', () => {
  expect(numParam('6.44')).toBe(6.44);
  expect(numParam('')).toBeNull();
  expect(numParam('x')).toBeNull();
  expect(Math.round(metresBetween({ lat: 6.4413, lng: 80.0114 }, { lat: 6.4382, lng: 80.0274 }))).toBeGreaterThan(1700);
  expect(metresBetween(pin, pin)).toBe(0);
});

// Owner, 2026-10-25: "all the addresses show as Home - we have to be able to name them differently".
test('an address is saved as Home, Work, or the name the customer typed for Other', () => {
  expect(ADDRESS_TAGS).toEqual(['Home', 'Work', 'Other']);
  expect(resolveLabel('Home', 'ignored')).toBe('Home');
  expect(resolveLabel('Work', 'ignored')).toBe('Work');
  expect(resolveLabel('Other', "  Mum's   house ")).toBe("Mum's house");
  expect(resolveLabel('Other', '')).toBe('Other');
  expect(resolveLabel('Other', '   ')).toBe('Other');
  expect(resolveLabel('Other', 'x'.repeat(60))).toHaveLength(TAG_NAME_MAX);
});

test('the form starts from the stored label, and a second address is not another "Home"', () => {
  expect(tagFromLabel('Home')).toEqual({ tag: 'Home', custom: '' });
  expect(tagFromLabel('work')).toEqual({ tag: 'Work', custom: '' });
  expect(tagFromLabel('Other')).toEqual({ tag: 'Other', custom: '' });
  expect(tagFromLabel("Mum's house")).toEqual({ tag: 'Other', custom: "Mum's house" });
  expect(tagFromLabel('')).toEqual({ tag: 'Home', custom: '' });
  expect(tagFromLabel(null)).toEqual({ tag: 'Home', custom: '' });
  expect(suggestTag([])).toBe('Home');
  expect(suggestTag(['Work'])).toBe('Home');
  expect(suggestTag(['Work', 'home'])).toBe('Other');
});

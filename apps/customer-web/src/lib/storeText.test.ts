import { formatClock, formatHours, radiusText } from './storeText';
import { store } from '../test/fixtures';

test('formats clock times', () => {
  expect(formatClock('08:00')).toBe('8 AM');
  expect(formatClock('21:30')).toBe('9:30 PM');
  expect(formatClock('00:00')).toBe('12 AM');
  expect(formatClock('12:00')).toBe('12 PM');
  expect(formatClock('nope')).toBeNull();
});
test('hours and radius hide when the store is missing', () => {
  expect(formatHours(null)).toBeNull();
  expect(radiusText(null)).toBeNull();
  expect(formatHours(store)).toBe('8 AM – 9 PM');
  expect(radiusText({ ...store, radius_km: 5 })).toBe('Groceries delivered within 5 km');
});

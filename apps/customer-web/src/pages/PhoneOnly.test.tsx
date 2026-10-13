import { isDesktopBlocked } from './PhoneOnly';

test('blocks wide screens unless ?desktop=1', () => {
  expect(isDesktopBlocked(1280, '')).toBe(true);
  expect(isDesktopBlocked(1280, '?desktop=1')).toBe(false);
  expect(isDesktopBlocked(390, '')).toBe(false);
  expect(isDesktopBlocked(899, '')).toBe(false);
  expect(isDesktopBlocked(900, '')).toBe(true);
});

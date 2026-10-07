import { describe, expect, it } from 'vitest';
import { EXIT_WINDOW_MS, backActionFor } from '../components/AndroidBackButton';

/** Android back button (owner, 2026-10-07: it used to close the app on every press). */
describe('Android back button', () => {
  it('goes back to the previous screen from an inner screen', () => {
    expect(backActionFor('/orders/abc', true, 0, 10_000)).toBe('back');
  });
  it('goes to the main screen when there is nothing to go back to', () => {
    expect(backActionFor('/orders/abc', false, 0, 10_000)).toBe('home');
  });
  it('on the main, sign-in and welcome screens: a hint first, exit only on a second press in time', () => {
    for (const root of ['/', '/login', '/welcome']) {
      expect(backActionFor(root, true, 0, 10_000)).toBe('hint');
      expect(backActionFor(root, true, 10_000, 10_000 + EXIT_WINDOW_MS - 1)).toBe('exit');
      expect(backActionFor(root, true, 10_000, 10_000 + EXIT_WINDOW_MS + 1)).toBe('hint');
    }
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { getBuyAgainShown, hideUsuals, setBuyAgainShown } from './shownStore';

afterEach(() => setBuyAgainShown(null));

describe('"Your usuals" stays away when Buy again already shows the same products', () => {
  it('hides when every usual is already in Buy again', () => {
    expect(hideUsuals({ resolved: true, ids: ['a', 'b', 'c'] }, ['a'])).toBe(true);
    expect(hideUsuals({ resolved: true, ids: ['a', 'b'] }, ['b', 'a'])).toBe(true);
  });

  it('shows when the last order has something Buy again does not', () => {
    expect(hideUsuals({ resolved: true, ids: ['a', 'b'] }, ['a', 'z'])).toBe(false);
  });

  it('shows when Buy again has nothing to show (failed, or no history) or no usuals are listed', () => {
    expect(hideUsuals({ resolved: true, ids: [] }, ['a'])).toBe(false);
    expect(hideUsuals({ resolved: true, ids: ['a'] }, [])).toBe(false);
  });

  it('waits while Buy again is still loading, so nothing flashes in and out', () => {
    expect(hideUsuals({ resolved: false, ids: [] }, ['a'])).toBe(true);
  });

  it('has no opinion when no Buy again rail is mounted', () => {
    expect(hideUsuals(null, ['a'])).toBe(false);
  });

  it('keeps and replaces what the rail published', () => {
    expect(getBuyAgainShown()).toBeNull();
    setBuyAgainShown({ resolved: true, ids: ['a'] });
    expect(getBuyAgainShown()).toEqual({ resolved: true, ids: ['a'] });
    setBuyAgainShown(null);
    expect(getBuyAgainShown()).toBeNull();
  });
});

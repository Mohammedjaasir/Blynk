import { describe, expect, it } from 'vitest';
import { bannerHeight } from './carousel';

/** The promotion card follows the photo's shape (owner, 2026-10-24: "it should fit to it"). */
describe('bannerHeight', () => {
  it('is the width divided by the photo shape', () => {
    expect(bannerHeight(360, 2)).toBe(180);
    expect(bannerHeight(360, 2.6)).toBe(138);
    expect(bannerHeight(360, 1)).toBe(300); // a square photo is capped
  });
  it('keeps a floor for very wide photos and the standard height without one', () => {
    expect(bannerHeight(360, 8)).toBe(96);
    expect(bannerHeight(360, null, 180)).toBe(180);
    expect(bannerHeight(360, 0, 180)).toBe(180);
  });
});

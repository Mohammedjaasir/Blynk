import { describe, expect, it } from 'vitest';
import { placedLayout } from './placedLayout';

describe('placedLayout', () => {
  it('uses one column of min(width - 48, 360) at every phone width', () => {
    expect(placedLayout(320, 640).column).toBe(272);
    expect(placedLayout(360, 780).column).toBe(312);
    expect(placedLayout(390, 844).column).toBe(342);
    expect(placedLayout(430, 932).column).toBe(360);
    expect(placedLayout(1280, 800).column).toBe(360);
  });

  it('shrinks the check on short phones', () => {
    expect(placedLayout(320, 640).check).toBe(100);
    expect(placedLayout(390, 844).check).toBe(120);
  });

  it('keeps the rider inside the column and clear of the check', () => {
    for (const [w, h] of [[320, 640], [360, 780], [390, 844], [430, 932]]) {
      const l = placedLayout(w, h);
      expect(l.mascot).toBeGreaterThan(60);
      expect(l.mascotLeft).toBeGreaterThanOrEqual(0);
      expect(l.mascotLeft + l.mascot).toBeLessThanOrEqual((l.column - l.check) / 2);
    }
  });
});

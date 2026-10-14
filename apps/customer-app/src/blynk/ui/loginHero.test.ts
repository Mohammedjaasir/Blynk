import { expect, test } from 'vitest';
import { HERO, HERO_ITEMS, loginHeroLayout, nextHeadline } from './loginHero';
import { LOGIN } from './strings';

const FORM = 330;

test('headlines take turns and wrap round', () => {
  expect(nextHeadline(0, 3)).toBe(1);
  expect(nextHeadline(2, 3)).toBe(0);
  expect(nextHeadline(5, 0)).toBe(0);
  expect(LOGIN.headlines.length).toBeGreaterThanOrEqual(3);
});

test.each([[360, 640], [390, 844], [430, 932], [375, 667]])('full scene and the form both fit at %ix%i', (width, height) => {
  const l = loginHeroLayout({ width, height, topInset: 0, formH: FORM });
  expect(l.mode).toBe('full');
  expect(l.heroH - HERO.overlap + FORM).toBeLessThanOrEqual(height);
  if (l.mode === 'full') {
    expect(l.rider).toBeLessThanOrEqual(l.sceneH);
    expect(l.rider).toBeGreaterThanOrEqual(90);
  }
});

test('a tall phone keeps the hero to about half the window', () => {
  const l = loginHeroLayout({ width: 430, height: 932, topInset: 47, formH: FORM });
  expect(l.heroH).toBeLessThanOrEqual(HERO.maxH);
});

test('keyboard up (short window): one headline row, the form still fits', () => {
  for (const height of [380, 400, 480]) {
    // the measured form is ~290 pt (360 wide); 310 is the screen's first guess
    const l = loginHeroLayout({ width: 390, height, topInset: 0, formH: 310 });
    expect(l.mode).toBe('compact');
    expect(l.heroH - l.overlap + 310).toBeLessThanOrEqual(height);
  }
});

test('items sit inside the scene box', () => {
  for (const it of HERO_ITEMS) {
    expect(it.x).toBeGreaterThan(0); expect(it.x).toBeLessThan(1);
    expect(it.y).toBeGreaterThan(0); expect(it.y).toBeLessThan(1);
  }
});

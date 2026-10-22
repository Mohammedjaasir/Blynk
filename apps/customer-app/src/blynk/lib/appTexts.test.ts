import { describe, expect, it } from 'vitest';
import type { StoreInfo } from '../api/types';
import { store } from '../test/fixtures';
import { aisleColor, appColor, appLines, appText, inkOn, underAmount, withAlpha } from './appTexts';
import { filterChips } from './filters';
import { payOptions } from '../payments/method';

const withTexts = (app_texts: StoreInfo['app_texts']): StoreInfo => ({ ...store, app_texts });

describe('app texts (Admin / Ops overrides, owner 2026-10-18)', () => {
  it('a word staff set wins; blank, missing or no store keeps the app\'s own', () => {
    expect(appText(withTexts({ cart_bar_line: 'Weekend deals!' }), 'cart_bar_line', 'Great picks')).toBe('Weekend deals!');
    expect(appText(withTexts({ cart_bar_line: '  ' }), 'cart_bar_line', 'Great picks')).toBe('Great picks');
    expect(appText(store, 'cart_bar_line', 'Great picks')).toBe('Great picks');
    expect(appText(null, 'cart_bar_line', 'Great picks')).toBe('Great picks');
  });

  it('lists, the Under amount and aisle colours', () => {
    expect(appLines(withTexts({ login_headlines: ['Hi'] }), 'login_headlines', ['A', 'B'])).toEqual(['Hi']);
    expect(appLines(withTexts({ login_headlines: [] }), 'login_headlines', ['A', 'B'])).toEqual(['A', 'B']);
    expect(underAmount(withTexts({ home_under_amount: 500 }))).toBe(500);
    expect(underAmount(store)).toBe(300);
    expect(filterChips(500)[1]!.label).toBe('Under LKR 500');
    expect(aisleColor(withTexts({ aisle_colors: { c1: '#FFEEDD' } }), 'c1')).toBe('#FFEEDD');
    expect(aisleColor(withTexts({ aisle_colors: { c1: 'red' } }), 'c1')).toBeNull();
    expect(aisleColor(store, 'c1')).toBeNull();
  });

  it('surface colours, with readable words on them', () => {
    expect(appColor(withTexts({ cart_bar_bg: '#112233' }), 'cart_bar_bg', '#FFE141')).toBe('#112233');
    expect(appColor(withTexts({ cart_bar_bg: 'blue' }), 'cart_bar_bg', '#FFE141')).toBe('#FFE141');
    expect(appColor(store, 'hero_bg_top', '#2E0C66')).toBe('#2E0C66');
    expect(inkOn('#112233')).toBe('#FFFFFF');
    expect(inkOn('#FFE141')).toBe('#1A1D2E');
  });

  it('the "coming soon" payment line can be reworded', () => {
    expect(payOptions(null, 100, undefined, 'Card payments soon')[1]!.sub).toBe('Card payments soon');
  });
});

it('offer tile colours: the fade takes Admin / Ops\' colour at any opacity, black when none is set (owner, 2026-10-22)', () => {
  expect(withAlpha('#FFFFFF', 0.78)).toBe('rgba(255,255,255,0.78)');
  expect(withAlpha('#12151f', 0)).toBe('rgba(18,21,31,0)');
  expect(withAlpha('not a colour', 0.5)).toBe('rgba(0,0,0,0.5)');
  expect(appColor(withTexts({ vs_text: '#12151F', vs_shade: '#FFFFFF' }), 'vs_text', '#FFFFFF')).toBe('#12151F');
  expect(appColor(null, 'vs_shade', '#000000')).toBe('#000000');
});

import { describe, it, expect } from 'vitest';
import { formatDate, lkr, parsePrice, todayColombo } from '../lib/format';
import { groupCategories, productState } from '../lib/products';
import { looksLikePhone } from '../pages/SignIn';
import { CATEGORIES, product, submission } from './fixtures';

describe('format helpers', () => {
  it('formats money as LKR with two decimals', () => {
    expect(lkr(1250.5)).toBe('LKR 1,250.50');
    expect(lkr(null)).toBe('-');
  });

  it('reads typed prices', () => {
    expect(parsePrice('1,250.50')).toBe(1250.5);
    expect(parsePrice(' 300 ')).toBe(300);
    expect(parsePrice('12.345')).toBeNull();
    expect(parsePrice('abc')).toBeNull();
    expect(parsePrice('')).toBeNull();
    expect(parsePrice('-5')).toBeNull();
  });

  it('shows dates in Colombo time', () => {
    expect(formatDate('2026-10-15')).toBe('15 Oct 2026');
    expect(formatDate('2026-10-14T20:00:00.000Z')).toBe('15 Oct 2026');
    expect(todayColombo(new Date('2026-10-14T20:00:00.000Z'))).toBe('2026-10-15');
  });
});

describe('phone numbers', () => {
  it.each(['0771234567', '+94771234567', '94 77 123 4567', '077-123-4567'])('accepts %s', (n) => {
    expect(looksLikePhone(n)).toBe(true);
  });
  it.each(['12', 'abc', '', '077123'])('rejects %s', (n) => {
    expect(looksLikePhone(n)).toBe(false);
  });
});

describe('product status chips', () => {
  it('Live, Off, Waiting, Not approved', () => {
    expect(productState(product()).chip.label).toBe('Live');
    expect(productState(product({ is_active: false })).chip.label).toBe('Off');
    expect(productState(product({ live: false, pending: submission() })).chip.label).toBe('Waiting for approval');
    expect(productState(product({ live: false, last_rejected: submission({ status: 'REJECTED' }) })).chip.label).toBe('Not approved');
    expect(productState(product({ live: false })).chip.label).toBe('Off');
  });
  it('a live product with a waiting edit keeps Live and adds a second chip', () => {
    const state = productState(product({ pending: submission({ kind: 'EDIT' }) }));
    expect(state.chip.label).toBe('Live');
    expect(state.extra?.label).toBe('Change waiting for approval');
  });
});

describe('category groups', () => {
  it('puts sub-categories under their main category, A-Z', () => {
    const groups = groupCategories(CATEGORIES);
    expect(groups.map((g) => g.main.name)).toEqual(['Fruit', 'Pantry']);
    expect(groups[1]!.children.map((c) => c.name)).toEqual(['Rice', 'Spreads']);
    expect(groups[0]!.children).toEqual([]);
  });
});

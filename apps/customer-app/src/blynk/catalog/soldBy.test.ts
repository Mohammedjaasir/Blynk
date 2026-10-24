import { describe, expect, test } from 'vitest';
import { soldByText } from './soldBy';

describe('sold by label', () => {
  test('names the shop of a seller product', () => {
    expect(soldByText({ sold_by: 'Jaffna Spice House' })).toBe('Sold by Jaffna Spice House');
    expect(soldByText({ sold_by: '  Galle Sweets ' })).toBe('Sold by Galle Sweets');
  });
  test('shows nothing for Blynk products, blanks or an older server', () => {
    expect(soldByText({})).toBeNull();
    expect(soldByText({ sold_by: null })).toBeNull();
    expect(soldByText({ sold_by: '   ' })).toBeNull();
  });
});

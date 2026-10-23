import { describe, expect, it } from 'vitest';
import { clockText, closedByHours, hoursBadge, hoursButton, hoursText, unavailableText } from './hours';

const base = { available_window: null, window_closed: false, is_available: true };
const juice = (over: object = {}) => ({ ...base, available_window: { from: '06:00', until: '18:00' }, ...over });

describe('time-limited products (owner, 2026-10-23)', () => {
  it('writes times as people say them', () => {
    expect(clockText('06:00')).toBe('6 am');
    expect(clockText('18:30')).toBe('6:30 pm');
    expect(clockText('00:00')).toBe('12 am');
    expect(clockText('12:00')).toBe('12 pm');
  });

  it('a product with no hours says nothing about them', () => {
    expect(hoursText(base)).toBeNull();
    expect(hoursBadge(base)).toBeNull();
    expect(hoursButton(base)).toBeNull();
    expect(unavailableText({ ...base, is_available: false })).toBe('Sold out');
  });

  it('shut by its hours: the hours replace "Sold out"', () => {
    const p = juice({ window_closed: true, is_available: false });
    expect(closedByHours(p)).toBe(true);
    expect(hoursText(p)).toBe('6 am – 6 pm');
    expect(unavailableText(p)).toBe('6 am – 6 pm');
    expect(hoursBadge(p)).toBe('Only 6 am – 6 pm');
    expect(hoursButton(p)).toBe('Available 6 am – 6 pm');
  });

  it('open inside its hours: "Until 6 pm" on the page, nothing on the button', () => {
    const p = juice();
    expect(closedByHours(p)).toBe(false);
    expect(hoursBadge(p)).toBe('Until 6 pm');
    expect(hoursButton(p)).toBeNull();
  });

  it('sold out while inside its hours is still "Sold out"', () => {
    expect(unavailableText(juice({ is_available: false }))).toBe('Sold out');
  });

  it('a malformed window is ignored', () => {
    expect(hoursText({ available_window: { from: '6am', until: '6pm' } })).toBeNull();
  });
});

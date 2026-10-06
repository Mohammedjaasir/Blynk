import { describe, expect, it } from 'vitest';
import { blockedDay, formatBlockedDate } from '../lib/dental';

describe('blocked dates (YYYY-MM-DD from the API)', () => {
  it('keeps a plain calendar date exactly as sent', () => {
    expect(blockedDay('2026-10-06')).toBe('2026-10-06');
    expect(formatBlockedDate('2026-10-06')).toBe('Tue, 06 Oct 2026');
  });

  it('formats from the calendar day, so no device time zone moves it', () => {
    // `new Date('2026-10-06')` would be UTC midnight - the 5th in the Americas.
    // The formatter never builds a local Date from the string.
    expect(formatBlockedDate('2026-01-01')).toBe('Thu, 01 Jan 2026');
    expect(formatBlockedDate('2026-12-31')).toBe('Thu, 31 Dec 2026');
  });

  it('still reads an ISO timestamp as the day it is in Colombo', () => {
    expect(blockedDay('2026-10-05T18:30:00.000Z')).toBe('2026-10-06');
    expect(blockedDay('2026-10-06T00:00:00.000Z')).toBe('2026-10-06');
    expect(formatBlockedDate('2026-10-05T18:30:00.000Z')).toBe('Tue, 06 Oct 2026');
  });

  it('shows anything unreadable as it came', () => {
    expect(blockedDay('not a date')).toBeNull();
    expect(formatBlockedDate('not a date')).toBe('not a date');
  });
});

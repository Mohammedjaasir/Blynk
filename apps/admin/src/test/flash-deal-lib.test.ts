import { describe, expect, it } from 'vitest';
import {
  canStartFlash,
  clockText,
  closingTimeIso,
  endNowPayload,
  flashEndOf,
  flashEndsAt,
  flashPreview,
  flashRowText,
  flashSellingPrice,
  isFlashRunning,
  leftText,
  parseCustomMinutes,
  parseFlashPrice,
  runningFlashDeals,
  startPayload,
} from '../lib/flashDeal';

/** 2026-10-25 10:00 Colombo = 04:30 UTC. */
const NOW = new Date('2026-10-25T04:30:00.000Z');
const at = (min: number) => new Date(NOW.getTime() + min * 60_000).toISOString();

describe('flash price', () => {
  it('must be above 0, at most 2 decimals and below the selling price', () => {
    expect(parseFlashPrice('220', 250)).toEqual({ value: 220 });
    expect(parseFlashPrice(' 199.5 ', 250)).toEqual({ value: 199.5 });
    expect(parseFlashPrice('', 250)).toHaveProperty('error');
    expect(parseFlashPrice('0', 250)).toHaveProperty('error');
    expect(parseFlashPrice('abc', 250)).toHaveProperty('error');
    expect(parseFlashPrice('10.123', 250)).toHaveProperty('error');
    expect(parseFlashPrice('-5', 250)).toHaveProperty('error');
  });

  it('refuses a price at or above the selling price, in the server\'s words', () => {
    expect(parseFlashPrice('250', 250)).toEqual({ error: 'The flash price must be lower than the selling price (LKR 250.00).' });
    expect(parseFlashPrice('300', 250)).toHaveProperty('error');
    expect(parseFlashPrice('100', null)).toHaveProperty('error');
  });

  it('the selling price is the calculated one, and a product with sizes has no quick action', () => {
    expect(flashSellingPrice({ calculated_selling_price: 250, selling_price: 999 })).toBe(250);
    expect(flashSellingPrice({ selling_price: '120.5' })).toBe(120.5);
    expect(flashSellingPrice({})).toBeNull();
    expect(flashSellingPrice({ calculated_selling_price: 0 })).toBeNull();
    expect(canStartFlash({ calculated_selling_price: 250 })).toBe(true);
    expect(canStartFlash({ calculated_selling_price: 250, has_variants: true })).toBe(false);
    expect(canStartFlash({})).toBe(false);
  });
});

describe('how long it runs', () => {
  it('1 h, 2 h and 4 h end that long from now', () => {
    expect(flashEndsAt('1h', NOW)).toEqual({ iso: at(60) });
    expect(flashEndsAt('2h', NOW)).toEqual({ iso: at(120) });
    expect(flashEndsAt('4h', NOW)).toEqual({ iso: at(240) });
  });

  it('custom is whole minutes, 5 to 1440', () => {
    expect(flashEndsAt('custom', NOW, { customMinutes: '90' })).toEqual({ iso: at(90) });
    expect(flashEndsAt('custom', NOW, { customMinutes: '1440' })).toEqual({ iso: at(1440) });
    expect(parseCustomMinutes('4')).toHaveProperty('error');
    expect(parseCustomMinutes('1441')).toHaveProperty('error');
    expect(parseCustomMinutes('1.5')).toHaveProperty('error');
    expect(parseCustomMinutes('')).toHaveProperty('error');
    expect(flashEndsAt('custom', NOW, { customMinutes: 'x' })).toHaveProperty('error');
  });

  it('until closing time is today\'s close in Colombo, and only while that is still ahead', () => {
    // 21:00 Colombo = 15:30 UTC
    expect(closingTimeIso({ close: '21:00' }, NOW)).toBe('2026-10-25T15:30:00.000Z');
    expect(flashEndsAt('closing', NOW, { closingIso: '2026-10-25T15:30:00.000Z' })).toEqual({ iso: '2026-10-25T15:30:00.000Z' });
    // 10:00 Colombo, closing 10:02 is under the 5-minute minimum; closing already past
    expect(closingTimeIso({ close: '10:02' }, NOW)).toBeNull();
    expect(closingTimeIso({ close: '09:00' }, NOW)).toBeNull();
    expect(closingTimeIso(null, NOW)).toBeNull();
    expect(flashEndsAt('closing', NOW, { closingIso: null })).toHaveProperty('error');
  });

  it('a Colombo evening before midnight UTC still uses the Colombo day', () => {
    // 2026-10-25 23:30 Colombo = 18:00 UTC; the next close is the same Colombo day
    const late = new Date('2026-10-25T18:00:00.000Z');
    expect(closingTimeIso({ close: '23:45' }, late)).toBe('2026-10-25T18:15:00.000Z');
    expect(closingTimeIso({ close: '23:00' }, late)).toBeNull();
  });
});

describe('what customers see', () => {
  it('shows the price, the struck price, the % off and the countdown', () => {
    const p = flashPreview(220, 250, at(119), NOW);
    expect(p).toEqual({
      price: 'LKR 220.00',
      was: 'LKR 250.00',
      percent: '12% off',
      endsIn: 'Ends in 1h 59m',
      until: 'until today 11:59 AM',
    });
  });

  it('says tomorrow when the end is on the next Colombo day', () => {
    expect(flashPreview(220, 250, at(14 * 60 + 30), NOW).until).toBe('until tomorrow 12:30 AM');
  });

  it('keeps the % off at least 1', () => {
    expect(flashPreview(249.99, 250, at(60), NOW).percent).toBe('1% off');
  });

  it('time words', () => {
    expect(leftText(45 * 60_000)).toBe('45m');
    expect(leftText(2 * 3_600_000)).toBe('2h');
    expect(leftText(90 * 60_000 + 1)).toBe('1h 31m');
    expect(leftText(0)).toBe('0m');
    expect(clockText('2026-10-25T15:30:00.000Z')).toBe('9 PM');
    expect(clockText('2026-10-25T04:30:00.000Z')).toBe('10 AM');
    expect(clockText('2026-10-25T18:15:00.000Z')).toBe('11:45 PM');
  });
});

describe('the update that starts and ends a deal (the existing product update)', () => {
  it('starting sends the offer price and its end', () => {
    expect(startPayload(220, at(120))).toEqual({ offer_price: 220, offer_ends_at: at(120) });
  });

  it('ending clears both', () => {
    expect(endNowPayload()).toEqual({ offer_price: null, offer_ends_at: null });
  });
});

describe('flash deals running', () => {
  const P = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    calculated_selling_price: 250,
    offer_price: 200,
    offer_active: true,
    offer_ends_at: at(60),
    ...over,
  });

  it('an active offer ending within 24 h is running; later, ended, or without an end is not', () => {
    expect(isFlashRunning(P('a'), NOW)).toBe(true);
    expect(isFlashRunning(P('b', { offer_ends_at: at(24 * 60) }), NOW)).toBe(true);
    expect(isFlashRunning(P('c', { offer_ends_at: at(24 * 60 + 1) }), NOW)).toBe(false);
    expect(isFlashRunning(P('d', { offer_ends_at: at(-1) }), NOW)).toBe(false);
    expect(isFlashRunning(P('e', { offer_ends_at: null }), NOW)).toBe(false);
    expect(isFlashRunning(P('f', { offer_price: null }), NOW)).toBe(false);
    expect(isFlashRunning(P('g', { offer_active: false }), NOW)).toBe(false);
    expect(flashEndOf(P('a'), NOW)).toBe(NOW.getTime() + 60 * 60_000);
  });

  it('lists them soonest first', () => {
    const list = [P('later', { offer_ends_at: at(300) }), P('none', { offer_ends_at: null }), P('soon', { offer_ends_at: at(20) })];
    expect(runningFlashDeals(list, NOW).map((p) => p.id)).toEqual(['soon', 'later']);
  });

  it('the row tag says how long is left and when it ends', () => {
    expect(flashRowText(P('a', { offer_ends_at: at(119) }), NOW)).toBe('Flash deal · 1h 59m left (ends 11:59 AM)');
    expect(flashRowText(P('a', { offer_ends_at: null }), NOW)).toBeNull();
  });
});

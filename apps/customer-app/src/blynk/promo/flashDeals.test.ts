import { describe, expect, it } from 'vitest';
import type { Product } from '../api/types';
import {
  flashCandidates, flashCountdown, flashEndMs, flashPillText, flashRail, flashRailKey, flashSpeech, flashUrgent, isFlashDeal,
  FLASH_RAIL_MAX,
} from './flashDeals';

const NOW = Date.parse('2026-10-25T10:00:00.000Z');
const inMs = (ms: number) => new Date(NOW + ms).toISOString();
const H = 3_600_000;
const M = 60_000;

const product = (id: string, over: Partial<Product> = {}): Product => ({
  id, category_id: 'c1', category_name: 'Snacks', name: `P ${id}`, slug: id, description: null, unit: 'pc', pack_size: null,
  image_url: null, image_focal_x: null, image_focal_y: null, selling_price: 100, offer_price: 80, offer_ends_at: inMs(3 * H),
  offer_kind: 'PRODUCT', is_available: true, ...over,
});

describe('which offers are flash deals', () => {
  it('an active offer ending within 24 hours is one, with its end time', () => {
    const p = product('a', { offer_ends_at: inMs(90 * M) });
    expect(isFlashDeal(p, NOW)).toBe(true);
    expect(flashEndMs(p, NOW)).toBe(NOW + 90 * M);
  });

  it('24 hours exactly counts, a minute more does not', () => {
    expect(isFlashDeal(product('a', { offer_ends_at: inMs(24 * H) }), NOW)).toBe(true);
    expect(isFlashDeal(product('b', { offer_ends_at: inMs(24 * H + M) }), NOW)).toBe(false);
  });

  it('an offer with no end date, or one that has ended, is not one', () => {
    expect(isFlashDeal(product('a', { offer_ends_at: null }), NOW)).toBe(false);
    expect(isFlashDeal(product('b', { offer_ends_at: inMs(-1000) }), NOW)).toBe(false);
    expect(isFlashDeal(product('c', { offer_ends_at: inMs(0) }), NOW)).toBe(false);
  });

  it('needs a real offer: no offer price, or a price at/above the selling price, is not one', () => {
    expect(isFlashDeal(product('a', { offer_price: null }), NOW)).toBe(false);
    expect(isFlashDeal(product('b', { offer_price: 100 }), NOW)).toBe(false);
    expect(isFlashDeal(product('c', { offer_price: 120 }), NOW)).toBe(false);
  });

  it('an unreadable end date is not one', () => {
    expect(isFlashDeal(product('a', { offer_ends_at: 'soon' }), NOW)).toBe(false);
  });

  it('stops being one the moment the clock passes the end (the price goes back to normal)', () => {
    const p = product('a', { offer_ends_at: inMs(5000) });
    expect(isFlashDeal(p, NOW + 4999)).toBe(true);
    expect(isFlashDeal(p, NOW + 5000)).toBe(false);
  });
});

describe('the countdown words', () => {
  it('a ticking clock under two hours, hours and minutes from two hours on', () => {
    expect(flashCountdown(1 * H + 59 * M + 12_000)).toBe('01:59:12');
    expect(flashCountdown(59 * M + 59_000)).toBe('00:59:59');
    expect(flashCountdown(2 * H)).toBe('2h 0m');
    expect(flashCountdown(2 * H + 10 * M)).toBe('2h 10m');
    expect(flashCountdown(23 * H + 59 * M + 1000)).toBe('24h 0m');
  });

  it('rounds up so it never shows less than is left, and the last second reads 00:00:01', () => {
    expect(flashCountdown(1)).toBe('00:00:01');
    expect(flashCountdown(2 * H + 1000)).toBe('2h 1m');
  });

  it('is null when nothing is left or the input is unusable', () => {
    expect(flashCountdown(0)).toBeNull();
    expect(flashCountdown(-5)).toBeNull();
    expect(flashCountdown(Number.NaN)).toBeNull();
  });

  it('the pill reads "Ends in ..." and goes (null) at zero', () => {
    expect(flashPillText(NOW + 1 * H + 59 * M + 12_000, NOW)).toBe('Ends in 01:59:12');
    expect(flashPillText(NOW + 2 * H + 10 * M, NOW)).toBe('Ends in 2h 10m');
    expect(flashPillText(NOW, NOW)).toBeNull();
  });

  it('a screen reader hears whole minutes, never the ticking seconds', () => {
    expect(flashSpeech(NOW + 1 * H + 59 * M + 12_000, NOW)).toBe('Ends in 2 hours');
    expect(flashSpeech(NOW + 2 * H + 10 * M, NOW)).toBe('Ends in 2 hours 10 minutes');
    expect(flashSpeech(NOW + 1 * H, NOW)).toBe('Ends in 1 hour');
    expect(flashSpeech(NOW + 45_000, NOW)).toBe('Ends in 1 minute');
    expect(flashSpeech(NOW, NOW)).toBeNull();
  });
});

describe('urgency under an hour', () => {
  it('turns urgent below an hour, not at or above it, and not once it is over', () => {
    expect(flashUrgent(NOW + H, NOW)).toBe(false);
    expect(flashUrgent(NOW + H - 1, NOW)).toBe(true);
    expect(flashUrgent(NOW + 1000, NOW)).toBe(true);
    expect(flashUrgent(NOW, NOW)).toBe(false);
    expect(flashUrgent(NOW - 1, NOW)).toBe(false);
  });
});

describe('the Home rail', () => {
  const list = [
    product('later', { offer_ends_at: inMs(10 * H) }),
    product('soon', { offer_ends_at: inMs(30 * M) }),
    product('tie-b', { offer_ends_at: inMs(2 * H) }),
    product('tie-a', { offer_ends_at: inMs(2 * H) }),
    product('far', { offer_ends_at: inMs(48 * H) }),
    product('open-ended', { offer_ends_at: null }),
    product('sold-out', { offer_ends_at: inMs(1 * H), is_available: false }),
    product('ended', { offer_ends_at: inMs(-H) }),
  ];

  it('lists orderable flash deals soonest first, ties in catalogue order', () => {
    const r = flashRail(flashCandidates(list), NOW);
    expect(r.products.map((p) => p.id)).toEqual(['soon', 'tie-b', 'tie-a', 'later']);
    expect(r.nearestEndMs).toBe(NOW + 30 * M);
  });

  it('candidates keep only orderable products with an offer and an end date', () => {
    expect(flashCandidates(list).map((p) => p.id)).toEqual(['later', 'soon', 'tie-b', 'tie-a', 'far', 'ended']);
    expect(flashCandidates(null)).toEqual([]);
  });

  it('is empty (so Home hides it) when none is ending within 24 h', () => {
    const r = flashRail(flashCandidates([product('far', { offer_ends_at: inMs(48 * H) })]), NOW);
    expect(r).toEqual({ products: [], nearestEndMs: null });
  });

  it('shows at most 12 and skips a repeated product', () => {
    const many = Array.from({ length: 20 }, (_, i) => product(`p${i}`, { offer_ends_at: inMs((i + 1) * M) }));
    expect(flashRail(many, NOW).products).toHaveLength(FLASH_RAIL_MAX);
    const dup = flashRail([many[0], many[0], many[1]], NOW);
    expect(dup.products.map((p) => p.id)).toEqual(['p0', 'p1']);
  });

  it('drops a deal when its end passes and moves the countdown to the next one', () => {
    const c = flashCandidates(list);
    const later = flashRail(c, NOW + 31 * M);
    expect(later.products.map((p) => p.id)).toEqual(['tie-b', 'tie-a', 'later']);
    expect(later.nearestEndMs).toBe(NOW + 2 * H);
    expect(flashRail(c, NOW + 11 * H).products).toEqual([]);
  });

  it('a deal enters the rail when its end comes within 24 h', () => {
    const c = flashCandidates([product('far', { offer_ends_at: inMs(25 * H) })]);
    expect(flashRail(c, NOW).products).toEqual([]);
    expect(flashRail(c, NOW + 2 * H).products.map((p) => p.id)).toEqual(['far']);
  });

  it('the key changes only when the list changes, so the rail re-renders only then', () => {
    const c = flashCandidates(list);
    expect(flashRailKey(c, NOW)).toBe('soon,tie-b,tie-a,later');
    expect(flashRailKey(c, NOW + 1000)).toBe(flashRailKey(c, NOW));
    expect(flashRailKey(c, NOW + 31 * M)).toBe('tie-b,tie-a,later');
  });
});

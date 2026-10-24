import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiError } from '@/blynk/api/client';
import { featureOn, isNotReady, markNotReady, noteNotReady, resetFeatureGate, storeSaysOn } from '@/blynk/lib/featureGate';
import { checkoutSignature } from '@/blynk/orders/checkout';
import { MemoryStorage, store } from '../test/fixtures';
import {
  canEditRating, canRate, checkoutTip, checkoutTipOptions, deliveredAt, GOOD_TAGS, keepTags, parseCustomTip, parseRating,
  parseRatingAnswer, PROBLEM_TAGS, promptCandidate, RATING_TAGS, ratingBody, ratingStage, readPrompted, riderTipOf, starWord,
  TAG_COPY, tagsFor, TIP_COPY, toggleTag, totalWithTip, walletTipChoices, withPrompted,
} from './model';

const NOW = new Date('2026-10-24T10:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

type O = Parameters<typeof canRate>[0] & { id: string; created_at?: string; placed_at?: string | null };
const order = (o: Partial<O> = {}): O => ({
  id: 'o1', order_status: 'DELIVERED', created_at: hoursAgo(30), placed_at: hoursAgo(30),
  delivery: { assignment_status: 'DELIVERED', assigned_at: null, picked_up_at: null, delivered_at: hoursAgo(28) }, history: [], ...o,
});

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('tags', () => {
  test('every contract tag has customer wording', () => {
    for (const t of RATING_TAGS) expect(TAG_COPY[t].label.length).toBeGreaterThan(3);
    expect(TAG_COPY.MISSING_ITEM.label).toBe('Item missing');
    expect(TAG_COPY.ON_TIME.label).toBe('Right on time');
    // no raw codes leak into the words
    for (const t of RATING_TAGS) expect(TAG_COPY[t].label).not.toMatch(/_/);
  });

  test('chips follow the stars: good for 4-5, problems for 1-2, both for 3 (problems first)', () => {
    expect(tagsFor(0)).toEqual([]);
    expect(tagsFor(5)).toEqual(GOOD_TAGS);
    expect(tagsFor(4)).toEqual(GOOD_TAGS);
    expect(tagsFor(1)).toEqual(PROBLEM_TAGS);
    expect(tagsFor(3).slice(0, PROBLEM_TAGS.length)).toEqual(PROBLEM_TAGS);
    expect(tagsFor(3)).toHaveLength(RATING_TAGS.length);
    expect(GOOD_TAGS.every((t) => TAG_COPY[t].good)).toBe(true);
    expect(PROBLEM_TAGS.every((t) => !TAG_COPY[t].good)).toBe(true);
  });

  test('changing the stars keeps only tags still offered; toggling adds and removes', () => {
    expect(keepTags(['ON_TIME', 'LATE'], 5)).toEqual(['ON_TIME']);
    expect(keepTags(['ON_TIME', 'LATE'], 2)).toEqual(['LATE']);
    expect(keepTags(['ON_TIME', 'LATE'], 3)).toEqual(['ON_TIME', 'LATE']);
    expect(toggleTag(['FRESH'], 'ON_TIME')).toEqual(['FRESH', 'ON_TIME']);
    expect(toggleTag(['FRESH', 'ON_TIME'], 'FRESH')).toEqual(['ON_TIME']);
  });

  test('star words', () => {
    expect(starWord(0)).toBe('Tap a star to rate');
    expect(starWord(5)).toBe('Loved it!');
    expect(starWord(1)).toBe('Very bad');
    expect(starWord(7)).toBe('Tap a star to rate');
  });
});

describe('rating body', () => {
  test('null without a valid star count', () => {
    expect(ratingBody({ stars: 0 })).toBeNull();
    expect(ratingBody({ stars: 6 })).toBeNull();
    expect(ratingBody({ stars: 2.5 })).toBeNull();
  });

  test('tags deduped and matched to the stars; comment trimmed, capped at 500, dropped when empty', () => {
    expect(ratingBody({ stars: 5, tags: ['FRESH', 'FRESH', 'LATE'], comment: '  great  ' })).toEqual({ stars: 5, tags: ['FRESH'], comment: 'great' });
    expect(ratingBody({ stars: 4, tags: [], comment: '   ' })).toEqual({ stars: 4 });
    expect(ratingBody({ stars: 1, comment: 'x'.repeat(600) })!.comment).toHaveLength(500);
  });
});

describe('parsing', () => {
  test('a rating row (unknown tags dropped, edit window from created_at)', () => {
    const r = parseRating({ stars: 4, tags: ['FRESH', 'NOPE'], comment: ' ok ', created_at: hoursAgo(2) })!;
    expect(r.stars).toBe(4);
    expect(r.tags).toEqual(['FRESH']);
    expect(r.comment).toBe('ok');
    expect(r.editableUntil!.getTime()).toBe(new Date(hoursAgo(2)).getTime() + 24 * 3_600_000);
    expect(parseRating(null)).toBeNull();
    expect(parseRating({ stars: 0 })).toBeNull();
    expect(parseRating({ stars: '5', created_at: hoursAgo(1), editable_until: hoursAgo(-3) })!.editableUntil!.toISOString()).toBe(hoursAgo(-3));
  });

  test('the answer: { rating } or the row itself, with any tip on the order', () => {
    expect(parseRatingAnswer({ rating: null })).toEqual({ rating: null, tip: 0 });
    expect(parseRatingAnswer({ rating: { stars: 5 }, rider_tip: '100.00' }).tip).toBe(100);
    expect(parseRatingAnswer({ stars: 3, tip: { amount_lkr: 50 } })).toMatchObject({ rating: { stars: 3 }, tip: 50 });
    expect(parseRatingAnswer(undefined)).toEqual({ rating: null, tip: 0 });
  });

  test('the tip on an order: number or NUMERIC string, 0 when none', () => {
    expect(riderTipOf({ rider_tip: '200.00' })).toBe(200);
    expect(riderTipOf({ rider_tip: 50 })).toBe(50);
    expect(riderTipOf({})).toBe(0);
    expect(riderTipOf(null)).toBe(0);
  });
});

describe('when the card shows', () => {
  test('delivered time: delivery row, then the order field, then history', () => {
    expect(deliveredAt(order())!.toISOString()).toBe(hoursAgo(28));
    expect(deliveredAt({ delivery: null, history: [], delivered_at: hoursAgo(5) })!.toISOString()).toBe(hoursAgo(5));
    expect(deliveredAt({ delivery: null, history: [{ id: 'h', order_id: 'o', old_status: 'OUT_FOR_DELIVERY', new_status: 'DELIVERED', created_at: hoursAgo(9) }] })!.toISOString()).toBe(hoursAgo(9));
    expect(deliveredAt({ delivery: null, history: [] })).toBeNull();
  });

  test('rate within 14 days of delivery; never before delivery', () => {
    expect(canRate(order(), NOW)).toBe(true);
    expect(canRate(order({ order_status: 'OUT_FOR_DELIVERY' }), NOW)).toBe(false);
    expect(canRate(order({ delivery: { assignment_status: 'DELIVERED', assigned_at: null, picked_up_at: null, delivered_at: hoursAgo(15 * 24) } }), NOW)).toBe(false);
    // unknown delivery time: the server decides
    expect(canRate(order({ delivery: null }), NOW)).toBe(true);
  });

  test('stages: ask, rated and changeable for 24 h, rated, hidden', () => {
    const fresh = parseRating({ stars: 5, created_at: hoursAgo(1) });
    const old = parseRating({ stars: 5, created_at: hoursAgo(25) });
    expect(ratingStage(order(), null, NOW)).toBe('ask');
    expect(ratingStage(order(), fresh, NOW)).toBe('rated-editable');
    expect(ratingStage(order(), old, NOW)).toBe('rated');
    expect(ratingStage(order({ order_status: 'CANCELLED' }), null, NOW)).toBe('hidden');
    expect(canEditRating(fresh, NOW)).toBe(true);
    expect(canEditRating(old, NOW)).toBe(false);
    expect(canEditRating(null, NOW)).toBe(false);
  });
});

describe('tips', () => {
  test('wallet tips: only what the balance covers, none once tipped or while the wallet is off', () => {
    expect(walletTipChoices({ enabled: true, balance: 500 }, 0)).toEqual([50, 100, 200]);
    expect(walletTipChoices({ enabled: true, balance: 120 }, 0)).toEqual([50, 100]);
    expect(walletTipChoices({ enabled: true, balance: 40 }, 0)).toEqual([]);
    expect(walletTipChoices({ enabled: true, balance: 500 }, 100)).toEqual([]);
    expect(walletTipChoices({ enabled: false, balance: 500 }, 0)).toEqual([]);
    expect(walletTipChoices(null, 0)).toEqual([]);
  });

  test('checkout-info tip_options: whole 1..1000, deduped, sorted; anything else = off', () => {
    expect(checkoutTipOptions([200, 50, 100, 50])).toEqual([50, 100, 200]);
    expect(checkoutTipOptions(['100', 0, -5, 2000, 12.5])).toEqual([100]);
    expect(checkoutTipOptions(undefined)).toEqual([]);
    expect(checkoutTipOptions('50,100')).toEqual([]);
  });

  test('custom tip: whole rupees up to 1000', () => {
    expect(parseCustomTip('')).toEqual({ amount: 0, error: null });
    expect(parseCustomTip('150')).toEqual({ amount: 150, error: null });
    expect(parseCustomTip('1,000')).toEqual({ amount: 1000, error: null });
    expect(parseCustomTip('1001').error).toMatch(/up to LKR 1,000/);
    expect(parseCustomTip('12.5').error).toMatch(/whole amount/);
    expect(parseCustomTip('abc').error).toBeTruthy();
    expect(parseCustomTip('0')).toEqual({ amount: 0, error: null });
  });

  test('the checkout tip goes only with cash and while tips are offered, capped at 1000', () => {
    const options = [50, 100, 200];
    expect(checkoutTip(100, { options, cash: true })).toBe(100);
    expect(checkoutTip(100, { options, cash: false })).toBe(0);
    expect(checkoutTip(100, { options: [], cash: true })).toBe(0);
    expect(checkoutTip(5000, { options, cash: true })).toBe(1000);
    expect(checkoutTip(-1, { options, cash: true })).toBe(0);
    expect(checkoutTip(Number.NaN, { options, cash: true })).toBe(0);
  });

  test('To Pay with the tip on top; unknown stays unknown', () => {
    expect(totalWithTip(1250.5, 100)).toBe(1350.5);
    expect(totalWithTip(0, 50)).toBe(50);
    expect(totalWithTip(800, 0)).toBe(800);
    expect(totalWithTip(null, 100)).toBeNull();
    expect(totalWithTip(800, -20)).toBe(800);
  });

  test('a different tip is a different order (idempotency key); no tip keeps the old signature', () => {
    const base = { items: [{ product_id: 'a', quantity: 1 }], addressId: 'ad' };
    const none = checkoutSignature(base);
    expect(checkoutSignature({ ...base, extra: { rider_tip_lkr: 0 } })).toBe(none);
    const t100 = checkoutSignature({ ...base, extra: { rider_tip_lkr: 100 } });
    expect(t100).not.toBe(none);
    expect(checkoutSignature({ ...base, extra: { rider_tip_lkr: 200 } })).not.toBe(t100);
  });

  test('copy', () => {
    expect(TIP_COPY.checkoutNote).toBe('100% goes to your rider, paid in cash with your order.');
    expect(TIP_COPY.walletCta(100)).toBe('Tip LKR 100');
  });
});

describe('the one-time prompt', () => {
  test('the newest delivered order in its window that was not asked about', () => {
    const a = order({ id: 'a' });
    const b = order({ id: 'b', delivery: { assignment_status: 'DELIVERED', assigned_at: null, picked_up_at: null, delivered_at: hoursAgo(2) } });
    const placed = order({ id: 'c', order_status: 'PLACED', delivery: null, created_at: hoursAgo(1) });
    expect(promptCandidate([a, b, placed], [], NOW)!.id).toBe('b');
    // asked about the newest already: never falls back to an older one
    expect(promptCandidate([a, b], ['b'], NOW)).toBeNull();
    expect(promptCandidate([placed], [], NOW)).toBeNull();
    const old = order({ id: 'old', delivery: { assignment_status: 'DELIVERED', assigned_at: null, picked_up_at: null, delivered_at: hoursAgo(20 * 24) } });
    expect(promptCandidate([old], [], NOW)).toBeNull();
    expect(promptCandidate([], [], NOW)).toBeNull();
  });

  test('asked-about orders are kept per customer, short', () => {
    let raw: string | null = null;
    raw = withPrompted(raw, 'u1', 'o1');
    raw = withPrompted(raw, 'u2', 'o9');
    raw = withPrompted(raw, 'u1', 'o2');
    expect(readPrompted(raw, 'u1')).toEqual(['o1', 'o2']);
    expect(readPrompted(raw, 'u2')).toEqual(['o9']);
    expect(readPrompted('not json', 'u1')).toEqual([]);
    for (let i = 0; i < 40; i++) raw = withPrompted(raw, 'u1', `x${i}`);
    expect(readPrompted(raw, 'u1')).toHaveLength(30);
    expect(readPrompted(raw, 'u1').at(-1)).toBe('x39');
  });
});

describe('feature gate', () => {
  afterEach(() => resetFeatureGate());

  test('on only while GET /store says so', () => {
    expect(storeSaysOn(null, 'ratings')).toBe(false);
    expect(storeSaysOn(store, 'ratings')).toBe(false);
    expect(storeSaysOn({ ...store, ratings_enabled: true } as typeof store, 'ratings')).toBe(true);
    expect(storeSaysOn({ ...store, product_requests_enabled: true } as typeof store, 'requests')).toBe(true);
    expect(storeSaysOn({ ...store, product_requests_enabled: 'yes' } as unknown as typeof store, 'requests')).toBe(false);
  });

  test('a 503 *_NOT_READY turns it off for this run', () => {
    const on = { ...store, ratings_enabled: true, product_requests_enabled: true } as typeof store;
    expect(featureOn(on, 'ratings')).toBe(true);
    expect(isNotReady(new ApiError('x', 503, 'RATINGS_NOT_READY'), 'ratings')).toBe(true);
    expect(isNotReady(new ApiError('x', 500, 'RATINGS_NOT_READY'))).toBe(false);
    expect(isNotReady(new ApiError('x', 503, 'SOMETHING'))).toBe(false);
    expect(noteNotReady(new ApiError('x', 409, 'WALLET_LOW'), 'ratings')).toBe(false);
    expect(featureOn(on, 'ratings')).toBe(true);
    expect(noteNotReady(new ApiError('x', 503, 'RATINGS_NOT_READY'), 'ratings')).toBe(true);
    expect(featureOn(on, 'ratings')).toBe(false);
    expect(featureOn(on, 'requests')).toBe(true);
    markNotReady('requests');
    expect(featureOn(on, 'requests')).toBe(false);
  });
});

describe('api', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()); });
  afterEach(() => { vi.unstubAllGlobals(); resetFeatureGate(); });

  async function signIn() {
    const { signIn: s } = await import('@/blynk/auth/session');
    s({ access_token: 'a', refresh_token: 'r', user: { id: 'u1', phone: '+94770000000', role: 'CUSTOMER', full_name: 'Nimal', email: null } });
  }

  test('rating: GET 404 = none; POST sends the clean body; NOT_READY hides the feature', async () => {
    await signIn();
    const { fetchRating, sendRating, sendWalletTip, isWalletLow } = await import('./api');
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/orders/o1/rating') && (!init?.method || init.method === 'GET')) return json(404, { success: false, error: { code: 'RATING_NOT_FOUND', message: 'none' } });
      if (url.endsWith('/orders/o1/rating')) return json(201, { success: true, data: { rating: { stars: 5, tags: ['FRESH'], created_at: NOW.toISOString() } } });
      if (url.endsWith('/orders/o1/tip')) return json(409, { success: false, error: { code: 'WALLET_LOW', message: 'low' } });
      return json(503, { success: false, error: { code: 'RATINGS_NOT_READY', message: 'x' } });
    }));
    expect(await fetchRating('o1')).toEqual({ rating: null, tip: 0 });
    const saved = await sendRating('o1', { stars: 5, tags: ['FRESH', 'LATE'], comment: ' yum ' });
    expect(saved.rating!.stars).toBe(5);
    expect(JSON.parse(String(calls[1].init!.body))).toEqual({ stars: 5, tags: ['FRESH'], comment: 'yum' });
    await expect(sendWalletTip('o1', 100)).rejects.toSatisfy(isWalletLow);
    expect(JSON.parse(String(calls[2].init!.body))).toEqual({ amount_lkr: 100 });
    const on = { ...store, ratings_enabled: true } as typeof store;
    expect(featureOn(on, 'ratings')).toBe(true);
    await expect(fetchRating('o2')).rejects.toThrow();
    expect(featureOn(on, 'ratings')).toBe(false);
  });
});

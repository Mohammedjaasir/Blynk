import { describe, expect, it } from 'vitest';
import { liveBanner, liveFees, livePromo, liveVs } from '../../demo/homeLive';
import { aisleOffer } from '../../demo/storeLive';
import type { CatalogData } from '../catalog/CatalogContext';
import type { StoreInfo } from '../api/types';
import { ancestorsOf, topLevelOf } from '../lib/categories';
import { resolveHero } from '../promo/heroBanner';
import { earnEstimate, rewardsSummary } from '../checkout/rewards';
import { dairy, milk, store, sugar } from '../test/fixtures';
import { freeDeliveryClaim, NO_CLAIM, type FreeClaim } from './freeClaim';
import {
  cartEarn, cartPointsLine, homeMessage, placedPointsLine, POINTS_COPY, pointsFor, pointsRuleOf,
} from './pointsPromo';

/*
 * Owner, 2026-10-14: "remove completely free delivery - instead of that, for 100 LKR order 1 Blynk
 * point". Every surface is checked for free deliveries on/off x points on/off x guest/signed in:
 * no free-delivery claim unless Admin / Ops have it on, Points while they are on, and neutral true
 * words when neither is.
 */

const now = new Date('2026-10-13T06:00:00Z');
function catalog(): CatalogData {
  const categories = [dairy];
  return { products: [milk, sugar], aisles: categories, categories, promotions: [], groups: [], tree: [], topOf: topLevelOf(categories), chainOf: ancestorsOf(categories) };
}
const rule100 = { enabled: true, earn_points: 1, earn_per_lkr: 100, lkr_per_point: 1, min_redeem_points: 100 };
const flat = { ...store, delivery_fee_mode: 'FLAT' as const, delivery_fee_lkr: 100 };
const freeOff = { ...flat, new_customer_free_deliveries: { ...store.new_customer_free_deliveries, enabled: false } };

type Case = { free: boolean; points: boolean; signedIn: boolean };
const CASES: Case[] = [false, true].flatMap((free) => [false, true].flatMap((points) => [false, true].map((signedIn) => ({ free, points, signedIn }))));

function setup({ free, points, signedIn }: Case): { s: StoreInfo; claim: FreeClaim } {
  const s: StoreInfo = { ...(free ? flat : freeOff), points_program: points ? rule100 : null };
  // a signed-in customer with free deliveries left (checkout-info says 2), or a guest hearing the store's offer
  const claim = freeDeliveryClaim({ storeCount: free ? 2 : 0, signedIn, status: signedIn ? { enabled: free, remaining: free ? 2 : 0 } : null });
  return { s, claim };
}

const FREE_WORDS = /free/i;

describe('pointsRuleOf (GET /store points_program)', () => {
  it('only while on, with sane numbers', () => {
    expect(pointsRuleOf({ ...store, points_program: rule100 })).toEqual({ earnPoints: 1, earnPerLkr: 100, lkrPerPoint: 1, minRedeemPoints: 100 });
    expect(pointsRuleOf({ ...store, points_program: null })).toBeNull();
    expect(pointsRuleOf(store)).toBeNull(); // an older API
    expect(pointsRuleOf({ ...store, points_program: { ...rule100, enabled: false } })).toBeNull();
    expect(pointsRuleOf({ ...store, points_program: { ...rule100, earn_per_lkr: 0 } })).toBeNull();
    expect(pointsRuleOf({ ...store, points_program: { ...rule100, earn_points: 0 } })).toBeNull();
    expect(pointsRuleOf(null)).toBeNull();
  });

  it('words the live rule', () => {
    expect(POINTS_COPY.rule({ earnPoints: 1, earnPerLkr: 100 })).toBe('1 point for every LKR 100');
    expect(POINTS_COPY.rule({ earnPoints: 2, earnPerLkr: 250 })).toBe('2 points for every LKR 250');
    expect(POINTS_COPY.fee({ earnPoints: 1, earnPerLkr: 100 })).toEqual(['1', 'pt / LKR 100']);
  });
});

describe('pointsFor = the server rule (backend points.rules.ts pointsEarned)', () => {
  const r = { earnPoints: 1, earnPerLkr: 100 };
  it('full steps of earn_per_lkr only', () => {
    expect(pointsFor(r, 99.99)).toBe(0);
    expect(pointsFor(r, 100)).toBe(1);
    expect(pointsFor(r, 1050)).toBe(10);
    expect(pointsFor({ earnPoints: 3, earnPerLkr: 100 }, 250)).toBe(6);
    // floating point: a sum just under the step still lands on it (server: round2 + 1e-9)
    expect(0.7 + 0.1).toBeLessThan(0.8);
    expect(pointsFor({ earnPoints: 1, earnPerLkr: 0.8 }, 0.7 + 0.1)).toBe(1);
    expect(pointsFor(r, 0)).toBe(0);
    expect(pointsFor(r, -5)).toBe(0);
    expect(pointsFor(null, 500)).toBe(0);
  });

  it('checkout: the part paid with points never earns; a free-delivery discount is not off the items', () => {
    const quote = { points: { enabled: true, balance: 200, value_lkr: 200, earn_points: 1, earn_per_lkr: 100, lkr_per_point: 1, min_redeem_points: 10, max_redeem_percent: 50 } } as never;
    // 1050 items + 150 fee, points pay 50% of 1200 = 600 -> items that earn: 1050 - 0 - 200 (the balance caps it)
    const used = rewardsSummary({ subtotal: 1050, deliveryFee: 150, quote, usePoints: true });
    expect(used.points.points).toBe(200);
    expect(used.earn).toBe(8);
    expect(rewardsSummary({ subtotal: 1050, deliveryFee: 150, quote, usePoints: false }).earn).toBe(10);
    expect(earnEstimate(null, 1000)).toBe(0);
  });
});

describe('homeMessage: points first, then free deliveries, else neutral', () => {
  it.each(CASES)('free %o', (c) => {
    const { s, claim } = setup(c);
    const m = homeMessage(pointsRuleOf(s), claim);
    expect(m.kind).toBe(c.points ? 'points' : c.free ? 'free' : 'none');
  });
});

describe('Home surfaces in every combination', () => {
  it.each(CASES)('%o', (c) => {
    const { s, claim } = setup(c);
    const vs = liveVs(catalog(), s, now, claim)!;
    const fees = liveFees(s, claim);
    const banner = liveBanner(catalog(), s, now, claim);
    const hero = resolveHero(null, banner);
    const promo = livePromo(s, claim);
    const all = JSON.stringify([vs.title, vs.kicker, fees, hero.title, hero.lines, promo]);

    if (c.points) {
      expect(vs.title).toBe('EARN BLYNK POINTS');
      expect(vs.kicker).toEqual(['1 point for every LKR 100 · No packaging or platform fee']);
      expect(fees[2]).toEqual(['1', 'pt / LKR 100']);
      expect(hero.title).toEqual(['EARN', 'POINTS']);
      expect(hero.lines).toEqual(['1 point for every LKR 100', 'Groceries starting at LKR 253']);
      // guests and signed-in customers alike, and no free-delivery words even when it is on too
      expect(all).not.toMatch(FREE_WORDS);
    } else if (c.free) {
      expect(all).toMatch(FREE_WORDS);
      expect(hero.title).toEqual(['FREE', 'DELIVERY']);
    } else {
      // neither: neutral, true words and no gaps
      expect(all).not.toMatch(FREE_WORDS);
      expect(all).not.toMatch(/point/i);
      expect(vs.kicker).toEqual(['NO PACKAGING FEE', '&', 'NO PLATFORM FEE']);
      expect(vs.title.length).toBeGreaterThan(0);
      expect(hero.title).toEqual(['FRESH', 'GROCERIES']);
      expect(hero.lines).toEqual(['Groceries starting at LKR 253']);
      expect(fees[2]).toEqual(['LKR', 'Delivery LKR 100']);
    }
    expect(fees.slice(0, 2)).toEqual([['0', 'Packaging fee'], ['0', 'Platform fee']]);
  });

  it('a hero CUSTOM line with {points_rule} is filled while points are on and skipped while off', () => {
    const custom = { mode: 'CUSTOM' as const, title: ['BIG', 'SALE'] as [string, string], lines: ['Earn {points_rule}', 'From {min_price}'], cta_label: 'SHOP', cta_target: null, items: ['milk'], ends_at: null };
    const on = liveBanner(catalog(), { ...freeOff, points_program: rule100 }, now, NO_CLAIM);
    expect(resolveHero(custom, on, now).lines).toEqual(['Earn 1 point for every LKR 100', 'From LKR 253']);
    expect(resolveHero(custom, on, now).title).toEqual(['BIG', 'SALE']); // the owner's words stay
    const off = liveBanner(catalog(), freeOff, now, NO_CLAIM);
    expect(resolveHero(custom, off, now).lines).toEqual(['From LKR 253']);
  });

  it('aisle screen: a category offer, else points, else the free deliveries, else nothing', () => {
    const plain = { ...dairy, offer_percent: null };
    expect(aisleOffer(plain, { ...flat, points_program: rule100 }, now)).toEqual({ title: 'EARN BLYNK POINTS', sub: '1 point for every LKR 100' });
    expect(aisleOffer(plain, flat, now)?.title).toMatch(/FREE DELIVERY/);
    expect(aisleOffer(plain, freeOff, now)).toBeNull();
  });
});

describe('cart and Order placed', () => {
  const rule = pointsRuleOf({ ...store, points_program: rule100 });

  it('guest or signed in, from the rule or the checkout estimate; hidden at 0 or while off', () => {
    expect(cartEarn({ rule, itemTotal: 1050, quoted: null })).toBe(10);
    expect(cartEarn({ rule, itemTotal: 1050, quoted: { earn: 7 } })).toBe(7); // the quote knows the discount
    expect(cartEarn({ rule: null, itemTotal: 1050, quoted: null })).toBe(0);
    expect(cartPointsLine({ signedIn: true, earn: 10 })).toBe("You'll earn 10 Blynk Points on this order");
    expect(cartPointsLine({ signedIn: true, earn: 1 })).toBe("You'll earn 1 Blynk Point on this order");
    expect(cartPointsLine({ signedIn: false, earn: 10 })).toBe('Sign in to earn 10 Blynk Points on this order');
    expect(cartPointsLine({ signedIn: false, earn: 0 })).toBeNull();
    expect(cartPointsLine({ signedIn: true, earn: cartEarn({ rule, itemTotal: 99, quoted: null }) })).toBeNull();
  });

  it("Order placed: the server's points_earn_preview, worded for the delivery", () => {
    expect(placedPointsLine({ points_earn_preview: 12, order_status: 'PLACED' })).toBe("You'll earn 12 Blynk Points when it's delivered");
    expect(placedPointsLine({ points_earn_preview: 0, order_status: 'PLACED' })).toBeNull();
    expect(placedPointsLine({ order_status: 'PLACED' })).toBeNull(); // an older API
    expect(placedPointsLine({ points_earn_preview: 12, order_status: 'CANCELLED' })).toBeNull();
    expect(placedPointsLine(null)).toBeNull();
  });
});

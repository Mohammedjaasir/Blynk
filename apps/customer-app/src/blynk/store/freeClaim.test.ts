import { describe, expect, it } from 'vitest';
import { claimFee, claimLine, claimPromoLine, claimTitle, freeDeliveryClaim, NO_CLAIM } from './freeClaim';

const on = (remaining: number) => ({ enabled: true, remaining });

describe('freeDeliveryClaim', () => {
  it('owner, 2026-10-16: never claims free delivery any more, whatever the inputs say', () => {
    expect(freeDeliveryClaim({ storeCount: 2, signedIn: false })).toEqual(NO_CLAIM);
    expect(freeDeliveryClaim({ storeCount: 0, signedIn: false })).toEqual(NO_CLAIM);
    expect(freeDeliveryClaim({ storeCount: 2, signedIn: false, status: on(0) })).toEqual(NO_CLAIM);
    expect(freeDeliveryClaim({ storeCount: 2, signedIn: true })).toEqual(NO_CLAIM);
    expect(freeDeliveryClaim({ storeCount: 2, signedIn: true, status: null })).toEqual(NO_CLAIM);
    expect(freeDeliveryClaim({ storeCount: 2, signedIn: true, status: on(2) })).toEqual(NO_CLAIM);
    expect(freeDeliveryClaim({ storeCount: 0, signedIn: true, status: on(1) })).toEqual(NO_CLAIM);
  });
});

describe('claim wording', () => {
  it('guest copy always says "new customers"', () => {
    const g = { kind: 'new-customer', count: 2 } as const;
    expect(claimLine(g)).toBe('First 2 deliveries free for new customers');
    expect(claimLine({ kind: 'new-customer', count: 1 })).toBe('First delivery free for new customers');
    expect(claimPromoLine(g)).toBe('Free delivery on your first 2 orders for new customers');
    expect(claimTitle(g)).toBe('FIRST 2 DELIVERIES FREE');
    expect(claimFee(g)).toEqual(['2', 'Free · new users']);
  });

  it('personal copy says the real number left', () => {
    expect(claimLine({ kind: 'personal', count: 2 })).toBe('Your next 2 deliveries free');
    expect(claimLine({ kind: 'personal', count: 1 })).toBe('1 free delivery left');
    expect(claimTitle({ kind: 'personal', count: 1 })).toBe('1 FREE DELIVERY LEFT');
    expect(claimPromoLine({ kind: 'personal', count: 1 })).toBe('Your next delivery is free');
  });

  it('no claim: every helper returns null', () => {
    expect([claimLine(NO_CLAIM), claimTitle(NO_CLAIM), claimFee(NO_CLAIM), claimPromoLine(NO_CLAIM)]).toEqual([null, null, null, null]);
  });
});

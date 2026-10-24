import { describe, it, expect } from 'vitest';
import {
  approvalBody,
  changedFields,
  effectiveSelling,
  lkr,
  margin,
  parseCommission,
  parseMoney,
  reasonProblem,
  sellerActions,
  sellerPriceChanged,
  sellingPriceRequired,
  statusCounts,
  type AdminSubmission,
} from '../lib/sellers';

/** Seller portal rules shown in Admin (the API re-checks every one of them). */
const base = {
  seller_price: 80,
  product: null,
  payload: { name: 'Jaffna curry powder' },
} as Pick<AdminSubmission, 'kind' | 'seller_price' | 'product' | 'payload'>;
const live = { id: 'p1', name: 'Jaffna curry powder', selling_price: 120, purchase_cost: 80 };
const names = (id: string | null | undefined) => (id === 'c1' ? 'Spices' : id === 'c2' ? 'Pantry' : '—');

describe('money and reasons', () => {
  it('reads an amount typed with commas and at most 2 decimals', () => {
    expect(parseMoney('1,250.5')).toEqual({ value: 1250.5 });
    expect(parseMoney('')).toHaveProperty('error');
    expect(parseMoney('0')).toHaveProperty('error');
    expect(parseMoney('12.345')).toHaveProperty('error');
    expect(parseMoney('abc')).toHaveProperty('error');
    expect(parseMoney('99999999')).toHaveProperty('error');
  });

  it('commission is 0 to 100', () => {
    expect(parseCommission('0')).toEqual({ value: 0 });
    expect(parseCommission('7.5')).toEqual({ value: 7.5 });
    expect(parseCommission('101')).toHaveProperty('error');
    expect(parseCommission('')).toHaveProperty('error');
    expect(parseCommission('-1')).toHaveProperty('error');
  });

  it('a reason needs 3 to 300 characters', () => {
    expect(reasonProblem('  ')).toMatch(/reason/);
    expect(reasonProblem('no')).toMatch(/reason/);
    expect(reasonProblem('Blurry photo')).toBeNull();
    expect(reasonProblem('x'.repeat(301))).toMatch(/300/);
  });

  it('writes LKR with cents', () => {
    expect(lkr(1250)).toBe('LKR 1,250.00');
    expect(lkr('80')).toBe('LKR 80.00');
    expect(lkr(null)).toBe('LKR 0.00');
  });
});

describe('seller decisions', () => {
  it('offers only the steps that make sense', () => {
    expect(sellerActions('PENDING')).toEqual({ approve: true, reject: true, suspend: false });
    expect(sellerActions('APPROVED')).toEqual({ approve: false, reject: false, suspend: true });
    expect(sellerActions('REJECTED')).toEqual({ approve: true, reject: false, suspend: false });
    expect(sellerActions('SUSPENDED')).toEqual({ approve: true, reject: false, suspend: false });
  });

  it('counts sellers per status', () => {
    expect(statusCounts([{ status: 'PENDING' }, { status: 'PENDING' }, { status: 'APPROVED' }])).toEqual({
      PENDING: 2,
      APPROVED: 1,
      REJECTED: 0,
      SUSPENDED: 0,
    });
  });
});

describe('approving a submission', () => {
  it('margin is selling minus the seller price, and flags selling below cost', () => {
    expect(margin(100, 80)).toEqual({ amount: 20, percent: 25, belowCost: false });
    expect(margin(80, 80).belowCost).toBe(false);
    expect(margin(70, 80)).toEqual({ amount: -10, percent: -12.5, belowCost: true });
  });

  it('a new product always needs a selling price; an edit only when the seller price changed', () => {
    const fresh = { ...base, kind: 'NEW' as const };
    expect(sellingPriceRequired(fresh)).toBe(true);
    const same = { ...base, kind: 'EDIT' as const, product: live };
    expect(sellerPriceChanged(same)).toBe(false);
    expect(sellingPriceRequired(same)).toBe(false);
    const cheaper = { ...same, seller_price: 90 };
    expect(sellerPriceChanged(cheaper)).toBe(true);
    expect(sellingPriceRequired(cheaper)).toBe(true);
  });

  it('the price that applies is the typed one, else the live one for an edit that keeps its price', () => {
    const same = { ...base, kind: 'EDIT' as const, product: live };
    expect(effectiveSelling(same, null)).toBe(120);
    expect(effectiveSelling(same, 130)).toBe(130);
    expect(effectiveSelling({ ...base, kind: 'NEW' as const }, null)).toBeNull();
  });

  it('builds the approve body, refusing a missing price where one is needed', () => {
    const fresh = { ...base, kind: 'NEW' as const };
    expect(approvalBody(fresh, '', '')).toHaveProperty('error');
    expect(approvalBody(fresh, '120', '')).toEqual({ body: { selling_price: 120 } });
    expect(approvalBody(fresh, '120', 'c2')).toEqual({ body: { selling_price: 120, category_id: 'c2' } });
    const same = { ...base, kind: 'EDIT' as const, product: live };
    expect(approvalBody(same, '', '')).toEqual({ body: {} });
    const cheaper = { ...same, seller_price: 90 };
    expect(approvalBody(cheaper, '', '')).toEqual({ error: expect.stringMatching(/changed their price/) });
    expect(approvalBody(cheaper, 'abc', '')).toHaveProperty('error');
  });
});

describe('what an edit changes', () => {
  const edit = {
    kind: 'EDIT' as const,
    seller_price: 90,
    product: live,
    payload: { name: 'Jaffna curry powder 250g', category_id: 'c2', unit: 'pack', description: 'Hot' },
  };

  it('lists only the fields that differ from the live product, with category names and the price', () => {
    const changes = changedFields(
      edit,
      { name: 'Jaffna curry powder', category_id: 'c1', unit: 'pack', description: 'Hot', purchase_cost: 80, selling_price: 120 },
      names
    );
    expect(changes.map((c) => [c.label, c.live, c.proposed])).toEqual([
      ['Name', 'Jaffna curry powder', 'Jaffna curry powder 250g'],
      ['Category', 'Spices', 'Pantry'],
      ["Seller's price", 'LKR 80.00', 'LKR 90.00'],
    ]);
  });

  it('without the live product only the name and the price can be compared; a new product has no changes', () => {
    expect(changedFields(edit, null, names).map((c) => c.label)).toEqual(['Name', "Seller's price"]);
    expect(changedFields({ ...edit, kind: 'NEW' }, null, names)).toEqual([]);
  });

  it('a field the payload leaves out keeps the live value', () => {
    expect(changedFields({ ...edit, seller_price: 80, payload: { unit: 'kg' } }, { name: 'x', unit: 'kg' }, names)).toEqual([]);
  });
});

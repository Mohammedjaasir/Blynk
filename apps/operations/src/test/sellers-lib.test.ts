import { describe, it, expect } from 'vitest';
import {
  approvalBody,
  categoryTree,
  commissionBody,
  dayText,
  newSellerBody,
  normalisePhone,
  notReady,
  payoutRequesters,
  phoneInUseText,
  type CategoryRate,
  approvedPoint,
  changedFields,
  distanceText,
  effectiveSelling,
  googleMapsUrl,
  locationReasonProblem,
  locationWaiting,
  osmEmbedUrl,
  pendingPoint,
  pointText,
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

/** Seller portal rules shown in Ops (Ops' own copy of Admin's lib/sellers.ts; the API re-checks every one of them). */
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

describe('shop location helpers (migration 053)', () => {
  it('reads the approved and the waiting point, tolerating an API without them', () => {
    expect(approvedPoint({ latitude: 7.29, longitude: 80.63 })).toEqual({ lat: 7.29, lng: 80.63 });
    expect(approvedPoint({ latitude: 7.29, longitude: null })).toBeNull();
    expect(approvedPoint({})).toBeNull();
    expect(pendingPoint({ pending_latitude: 6.03, pending_longitude: 80.21 })).toEqual({ lat: 6.03, lng: 80.21 });
    expect(locationWaiting({ location_status: 'PENDING', pending_latitude: 6.03, pending_longitude: 80.21 })).toBe(true);
    expect(locationWaiting({ location_status: 'REJECTED', pending_latitude: 6.03, pending_longitude: 80.21 })).toBe(false);
    expect(locationWaiting({})).toBe(false);
  });

  it('builds the map links and texts', () => {
    const p = { lat: 7.290572, lng: 80.633728 };
    expect(googleMapsUrl(p)).toBe('https://www.google.com/maps?q=7.290572,80.633728');
    const embed = new URL(osmEmbedUrl(p));
    expect(embed.origin + embed.pathname).toBe('https://www.openstreetmap.org/export/embed.html');
    expect(embed.searchParams.get('marker')).toBe('7.290572,80.633728');
    const [minLng, minLat, maxLng, maxLat] = embed.searchParams.get('bbox')!.split(',').map(Number);
    expect(minLng! < p.lng && p.lng < maxLng! && minLat! < p.lat && p.lat < maxLat!).toBe(true);
    expect(pointText(p)).toBe('7.290572, 80.633728');
    expect(distanceText(3.2)).toBe('3.2 km from the Blynk store');
    expect(distanceText(12)).toBe('12.0 km from the Blynk store');
    expect(distanceText(null)).toBeNull();
    expect(distanceText(undefined)).toBeNull();
  });

  it('a rejection reason is 3 to 200 characters', () => {
    expect(locationReasonProblem(' ab ')).toMatch(/at least 3/);
    expect(locationReasonProblem('x'.repeat(201))).toBe('At most 200 characters.');
    expect(locationReasonProblem('Pin is in the sea')).toBeNull();
  });
});

describe('seller rules (lib)', () => {
  it('reads Sri Lankan mobile numbers', () => {
    expect(normalisePhone('077 123 4567')).toBe('+94771234567');
    expect(normalisePhone('+94 77-123-4567')).toBe('+94771234567');
    expect(normalisePhone('94771234567')).toBe('+94771234567');
    expect(normalisePhone('0112345678')).toBeNull();
    expect(normalisePhone('12345')).toBeNull();
  });

  it('builds the add-seller body: blank commission = category rates, approve on/off', () => {
    const form = { shop_name: ' Kandy Crafts ', phone: '0771234567', contact_name: '', address: ' 5 Main St ', commission: '', approve: true };
    expect(newSellerBody(form)).toEqual({ body: { shop_name: 'Kandy Crafts', phone: '+94771234567', address: '5 Main St', status: 'APPROVED' } });
    expect(newSellerBody({ ...form, commission: '4', approve: false })).toMatchObject({ body: { commission_percent: 4, status: 'PENDING' } });
    expect(newSellerBody({ ...form, shop_name: 'K' })).toMatchObject({ field: 'shop_name' });
    expect(newSellerBody({ ...form, phone: '123' })).toMatchObject({ field: 'phone' });
    expect(newSellerBody({ ...form, commission: '101' })).toMatchObject({ field: 'commission' });
  });

  it('says which kind of account has the number', () => {
    expect(phoneInUseText('CUSTOMER')).toBe('This number already has a Blynk account (customer).');
    expect(phoneInUseText('OPERATIONS')).toBe('This number already has a Blynk account (staff).');
    expect(phoneInUseText(undefined)).toBe('This number already has a Blynk account.');
  });

  it('orders categories main first with their sub-categories, and builds the commission body', () => {
    const rows: CategoryRate[] = [
      { category_id: 'c2', name: 'Toffee', parent_id: 'c1', percent: null },
      { category_id: 'c1', name: 'Sweets', parent_id: null, percent: 3 },
      { category_id: 'c3', name: 'Pickles', parent_id: null, percent: 4 },
      { category_id: 'c4', name: 'Orphan', parent_id: 'gone', percent: null },
    ];
    expect(categoryTree(rows).map((t) => [t.row.name, t.depth])).toEqual([
      ['Sweets', 0],
      ['Toffee', 1],
      ['Pickles', 0],
      ['Orphan', 0],
    ]);
    expect(commissionBody('2', { c1: '3', c2: '' })).toEqual({
      body: { default_percent: 2, categories: [{ category_id: 'c1', percent: 3 }, { category_id: 'c2', percent: null }] },
    });
    expect(commissionBody('', {})).toHaveProperty('error');
    expect(commissionBody('2', { c1: '200' })).toHaveProperty('error');
  });

  it('lists the sellers that have a payout request waiting', () => {
    const waiting = payoutRequesters([{ seller: { id: 's1' } }, { seller: { id: 's1' } }, { seller: { id: 's2' } }]);
    expect([...waiting].sort()).toEqual(['s1', 's2']);
    expect(waiting.has('s3')).toBe(false);
  });
});

describe('Ops helpers', () => {
  it('treats every *_NOT_READY code as "after the database update"', () => {
    expect(notReady({ code: 'SELLER_REQUESTS_NOT_READY' })).toBe(true);
    expect(notReady({ code: 'LOCATION_NOT_READY' })).toBe(true);
    expect(notReady({ code: 'VALIDATION_ERROR' })).toBe(false);
    expect(notReady(null)).toBe(false);
  });

  it('writes days in Sri Lanka time, from a day or an instant', () => {
    expect(dayText('2026-10-22')).toBe('22 Oct 2026');
    expect(dayText('2026-10-20T20:00:00.000Z')).toBe('21 Oct 2026');
    expect(dayText(null)).toBe('');
  });
});

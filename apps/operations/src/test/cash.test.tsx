import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { CashReconciliation, OrderDetail } from '../api/types';
import { cashRiderLabel, cashRiderOrder, colomboToday, differenceText } from '../pages/Cash';
import { ADMIN_WITH_RIDER, OPERATIONS_STAFF, fail, ok, renderAs } from './helpers';

/**
 * More -> Cash (backend migration 019) and the coupon discount on the order
 * screens (migration 018). The API side - figures per Sri Lanka day, who may
 * record or delete - is tested against PostgreSQL in
 * backend/api/tests/cash-reconciliation.test.ts.
 */

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const RECON: CashReconciliation = {
  date: '2026-09-30',
  timezone: 'Asia/Colombo',
  riders: [
    { rider_id: 'r1', rider_name: 'Farhan Mohamed', rider_phone: '+94779876543', deliveries: 3, handins: 1, collected: 2150, handed_in: 2000, difference: -150, status: 'SHORT', pay_type: 'COMPANY', kept_share: 0, expected_handin: 2150 },
    { rider_id: 'r2', rider_name: 'Imran', rider_phone: '+94779876500', deliveries: 1, handins: 1, collected: 500, handed_in: 520, difference: 20, status: 'OVER', pay_type: 'COMPANY', kept_share: 0, expected_handin: 500 },
  ],
  totals: { collected: 2650, handed_in: 2520, kept_share: 0, expected_handin: 2650, difference: -130, status: 'SHORT' },
};

/** A commission rider keeps their share out of the cash (owner, 2026-10-09):
 * 2,150 collected, 160 kept, so 1,990 to hand in; 2,000 handed in is over by 10. */
const RECON_COMMISSION: CashReconciliation = {
  date: '2026-09-30',
  timezone: 'Asia/Colombo',
  riders: [
    { rider_id: 'r1', rider_name: 'Farhan Mohamed', rider_phone: '+94779876543', deliveries: 2, handins: 1, collected: 2150, handed_in: 2000, difference: 10, status: 'OVER', pay_type: 'COMMISSION', kept_share: 160, expected_handin: 1990 },
    { rider_id: 'r2', rider_name: 'Imran', rider_phone: '+94779876500', deliveries: 1, handins: 1, collected: 500, handed_in: 500, difference: 0, status: 'BALANCED', pay_type: 'COMPANY', kept_share: 0, expected_handin: 500 },
  ],
  totals: { collected: 2650, handed_in: 2500, kept_share: 160, expected_handin: 2490, difference: 10, status: 'OVER' },
};

const RIDERS = [
  { id: 'r1', full_name: 'Farhan Mohamed', phone: '+94779876543', vehicle_type: 'MOTORCYCLE', vehicle_registration_number: 'WP-1', open_deliveries: 0 },
];

const HANDIN = {
  id: 'h1',
  rider_id: 'r1',
  rider_name: 'Farhan Mohamed',
  amount: 2000,
  handin_date: '2026-09-30',
  note: 'Evening',
  recorded_by_name: 'Ops Person',
  created_at: '2026-09-30T14:00:00Z',
};

describe('Cash screen', () => {
  it('words differences and knows the Sri Lanka day', () => {
    expect(differenceText(-150, 'SHORT')).toBe('Short LKR 150');
    expect(differenceText(20, 'OVER')).toBe('Over LKR 20');
    expect(differenceText(0, 'BALANCED')).toBe('Balanced');
    // 20:00 UTC is already the next day in Colombo.
    expect(colomboToday(new Date('2026-09-30T20:00:00Z'))).toBe('2026-10-01');
  });

  it('is reachable from More and shows each rider short or over', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more', {
      'GET /admin/settings/delivery-fee': () => ok({ fee_lkr: 100, updated_at: null }),
      'GET /admin/cash/reconciliation': () => ok(RECON),
      'GET /admin/cash/handins': () => ok({ handins: [HANDIN] }),
    });
    await user.click(await screen.findByRole('link', { name: 'Cash' }));
    const list = await screen.findByRole('list', { name: 'Cash by rider' }, { timeout: 5000 });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Farhan Mohamed');
    expect(rows[0]).toHaveTextContent('Collected LKR 2,150 (3 deliveries)');
    expect(rows[0]).toHaveTextContent('Handed in LKR 2,000');
    expect(rows[0]).toHaveClass('cash-row--short');
    expect(within(rows[0]).getByText('Short LKR 150')).toHaveClass('cash-diff--short');
    expect(within(rows[1]).getByText('Over LKR 20')).toHaveClass('cash-diff--over');
    expect(screen.getByRole('region', { name: 'All riders' })).toHaveTextContent('Short LKR 130');
    expect(api.find('GET', '/admin/cash/reconciliation')[0].query.date).toBe(colomboToday());
    // Operations may not delete a hand-in (the API refuses; so no button).
    expect(within(screen.getByRole('list', { name: 'Hand-ins' })).queryByRole('button')).toBeNull();
  });

  it('a commission rider shows "Hand in X, keep Y" and short/over against what they should hand in (owner, 2026-10-09)', async () => {
    renderAs(OPERATIONS_STAFF, '/more/cash', {
      'GET /admin/cash/reconciliation': () => ok(RECON_COMMISSION),
      'GET /admin/cash/handins': () => ok({ handins: [] }),
    });
    const list = await screen.findByRole('list', { name: 'Cash by rider' });
    const [commission, company] = within(list).getAllByRole('listitem');
    expect(commission).toHaveTextContent('Hand in LKR 1,990, keep LKR 160');
    expect(within(commission).getByText('Over LKR 10')).toHaveClass('cash-diff--over');
    // The company rider reads exactly as before: no keep line.
    expect(company).not.toHaveTextContent(/keep/i);
    expect(within(company).getByText('Balanced')).toBeInTheDocument();
    const totals = screen.getByRole('region', { name: 'All riders' });
    expect(totals).toHaveTextContent('Riders keepLKR 160');
    expect(totals).toHaveTextContent('To hand inLKR 2,490');
    expect(totals).toHaveTextContent('Over LKR 10');
  });

  it('a day with only company riders shows no keep or hand-in lines', async () => {
    renderAs(OPERATIONS_STAFF, '/more/cash', {
      'GET /admin/cash/reconciliation': () => ok(RECON),
      'GET /admin/cash/handins': () => ok({ handins: [] }),
    });
    await screen.findByRole('list', { name: 'Cash by rider' });
    expect(screen.queryByText(/keep/i)).toBeNull();
    expect(screen.queryByText('To hand in')).toBeNull();
  });

  it('records a hand-in', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/cash', {
      'GET /admin/riders': () => ok({ riders: RIDERS }),
      'GET /admin/cash/reconciliation': () => ok(RECON),
      'GET /admin/cash/handins': () => ok({ handins: [] }),
      'POST /admin/cash/handins': (call) => ok({ handin: { ...HANDIN, amount: call.body.amount, handin_date: call.body.handin_date } }),
    });
    await user.click(await screen.findByRole('button', { name: 'Record hand-in for Farhan Mohamed' }, { timeout: 5000 }));
    const dialog = screen.getByRole('dialog', { name: 'Record hand-in' });
    await within(dialog).findByRole('option', { name: 'Farhan Mohamed' });
    await user.click(within(dialog).getByRole('button', { name: 'Record' }));
    expect(within(dialog).getByText('Enter the amount handed in.')).toBeInTheDocument();
    expect(api.find('POST', '/admin/cash/handins')).toHaveLength(0);
    await user.type(within(dialog).getByLabelText(/^Amount/), '150');
    await user.type(within(dialog).getByLabelText(/^Note/), 'Late drop');
    await user.click(within(dialog).getByRole('button', { name: 'Record' }));
    expect(api.find('POST', '/admin/cash/handins').map((c) => c.body)).toEqual([
      { rider_id: 'r1', amount: 150, handin_date: colomboToday(), note: 'Late drop' },
    ]);
    expect(await screen.findByText('LKR 150 from Farhan Mohamed recorded.')).toBeInTheDocument();
  });

  it('the picker offers inactive riders too, marked "(inactive)", and records for them', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/cash', {
      'GET /admin/riders': (call) =>
        ok({
          riders:
            call.query.include_inactive === 'true'
              ? [
                  { ...RIDERS[0], is_active: true },
                  // Disabled, with no staff account: only include_inactive lists them.
                  { id: 'r9', full_name: 'Old Rider', phone: '+94770000009', vehicle_type: 'MOTORCYCLE', vehicle_registration_number: 'WP-9', open_deliveries: 0, is_active: false },
                ]
              : RIDERS,
        }),
      'GET /admin/cash/reconciliation': () => ok(RECON),
      'GET /admin/cash/handins': () => ok({ handins: [] }),
      'POST /admin/cash/handins': (call) => ok({ handin: { ...HANDIN, rider_id: 'r9', rider_name: 'Old Rider', amount: call.body.amount } }),
    });
    await user.click(await screen.findByRole('button', { name: 'Record hand-in' }, { timeout: 5000 }));
    const dialog = screen.getByRole('dialog', { name: 'Record hand-in' });
    await within(dialog).findByRole('option', { name: 'Old Rider (inactive)' });
    expect(within(dialog).getByRole('option', { name: 'Farhan Mohamed' })).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByRole('combobox'), 'r9');
    await user.type(within(dialog).getByLabelText(/^Amount/), '300');
    await user.click(within(dialog).getByRole('button', { name: 'Record' }));
    expect(api.find('POST', '/admin/cash/handins').map((c) => c.body)).toMatchObject([{ rider_id: 'r9', amount: 300 }]);
    expect(api.find('GET', '/admin/riders').map((c) => c.query.include_inactive)).toEqual(['true']);
  });

  it('orders active riders first and labels inactive ones', () => {
    const base = { phone: '+9477', vehicle_type: 'MOTORCYCLE', vehicle_registration_number: 'X', open_deliveries: 0 };
    const rows = [
      { ...base, id: 'a', full_name: 'Zed', is_active: false },
      { ...base, id: 'b', full_name: 'Kamal', is_active: true },
      { ...base, id: 'c', full_name: 'Amal', is_active: false },
      { ...base, id: 'd', full_name: 'Nimal' },
    ];
    expect(cashRiderOrder(rows).map(cashRiderLabel)).toEqual(['Kamal', 'Nimal', 'Amal (inactive)', 'Zed (inactive)']);
  });

  it('an admin can delete a mistaken hand-in', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/more/cash', {
      'GET /admin/cash/reconciliation': () => ok(RECON),
      'GET /admin/cash/handins': () => ok({ handins: [HANDIN] }),
      'DELETE /admin/cash/handins/:id': () => ok({ deleted: true }),
    });
    await user.click(await screen.findByRole('button', { name: 'Delete hand-in of LKR 2,000' }, { timeout: 5000 }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(api.find('DELETE', '/admin/cash/handins/h1')).toHaveLength(1);
  });

  it('shows the API error', async () => {
    renderAs(OPERATIONS_STAFF, '/more/cash', {
      'GET /admin/cash/reconciliation': () => fail(500, 'INTERNAL', 'boom'),
      'GET /admin/cash/handins': () => ok({ handins: [] }),
    });
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent('The Blynk API had a problem');
  });
});

describe('Coupon discount on the order screens', () => {
  const order: OrderDetail = {
    id: 'o1',
    order_number: 'BL-20260930-0042',
    order_status: 'PLACED',
    payment_method: 'COD',
    payment_status: 'PENDING',
    subtotal_amount: 1600,
    delivery_fee: 100,
    discount_amount: 160,
    coupon_code: 'SAVE10',
    total_amount: 1540,
    placed_at: '2026-09-30T04:30:00Z',
    scheduled_for: null,
    delivery_recipient_name: 'Ahmed Rizvi',
    delivery_recipient_phone: '+94771234567',
    delivery_address_line1: '14 Mosque Road',
    delivery_address_line2: null,
    delivery_city: 'Dharga Town',
    delivery_instructions: null,
    cancellation_reason: null,
    items: [{ id: 'i1', product_name_snapshot: 'Kotmale Fresh Milk 1L', unit_snapshot: '1 L', quantity: 2, item_status: 'PENDING' }],
    history: [],
    delivery: null,
  };

  it('the order detail shows the bill with the discount; the cash to collect is the total', async () => {
    renderAs(ADMIN_WITH_RIDER, '/orders/o1', { 'GET /admin/orders/:id': () => ok({ order }) });
    const bill = await screen.findByLabelText('Bill', {}, { timeout: 5000 });
    expect(bill).toHaveTextContent('ItemsLKR 1,600');
    expect(bill).toHaveTextContent('DeliveryLKR 100');
    expect(bill).toHaveTextContent('Discount (SAVE10)−LKR 160');
    expect(bill).toHaveTextContent('Total · cash to collectLKR 1,540');
  });

  it('the packing slip lists the discount and collects the total', async () => {
    renderAs(ADMIN_WITH_RIDER, '/orders/o1/slip', { 'GET /admin/orders/:id': () => ok({ order }) });
    const slip = await screen.findByRole('article', { name: 'Packing slip' }, { timeout: 5000 });
    expect(slip).toHaveTextContent('Discount (SAVE10)−LKR 160');
    expect(slip).toHaveTextContent('TotalLKR 1,540');
    expect(slip).toHaveTextContent('Cash to collect (COD)LKR 1,540');
  });
});

import { cleanup, configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import { OPERATIONS_STAFF, fail, ok, renderAs, type Call } from './helpers';
import { pushOpenPath } from '../lib/growth';
import {
  addSellerState,
  applicationCounts,
  localPhone,
  readAddSellerState,
  sortApplications,
  telHref,
  type SellerApplication,
} from '../lib/sellerApplications';

/**
 * More -> Seller applications (2026-10-27 plan, section S2): shops that applied at blynk.lk/seller,
 * reviewed on the phone. Same API as Admin (/admin/seller-applications).
 */
configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 40_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const APPS: SellerApplication[] = [
  {
    id: 'ap1',
    shop_name: 'Sunrise Spices',
    owner_name: 'Kamal Perera',
    phone: '+94771234567',
    email: 'kamal@example.com',
    town: 'Aluthgama',
    what_they_sell: 'Spices and dry fish',
    message: 'Please call after 4',
    status: 'NEW',
    staff_note: null,
    created_at: '2026-10-27T05:00:00.000Z',
  },
  {
    id: 'ap2',
    shop_name: 'Lanka Sweets',
    owner_name: 'Nimali Silva',
    phone: '+94719876543',
    email: null,
    town: 'Dharga Town',
    what_they_sell: 'Short eats',
    message: null,
    status: 'CONTACTED',
    staff_note: 'Visit on Friday',
    created_at: '2026-10-26T05:00:00.000Z',
  },
  {
    id: 'ap3',
    shop_name: 'Old Shop',
    owner_name: 'Somebody',
    phone: '+94701112223',
    email: null,
    town: 'Bentota',
    what_they_sell: 'Toys',
    message: null,
    status: 'DECLINED',
    staff_note: null,
    created_at: '2026-10-20T05:00:00.000Z',
  },
];

const handlers = {
  'GET /admin/seller-applications': () => ok({ applications: APPS, new_count: 1 }),
  'PATCH /admin/seller-applications/:id': (c: Call) =>
    ok({ application: { ...APPS[0], ...c.body, handled_by_name: 'Ops', handled_at: '2026-10-27T06:00:00.000Z' }, new_count: 0 }),
  'GET /admin/sellers': () => ok({ sellers: [] }),
  'GET /admin/seller-payout-requests': () => ok({ payout_requests: [] }),
  'POST /admin/sellers': (c: Call) =>
    ok({ seller: { id: 's9', shop_name: c.body.shop_name, status: c.body.status, phone: c.body.phone, created_at: '2026-10-27T06:00:00.000Z', products_live: 0, submissions_pending: 0, due: 0 } }),
  'GET /admin/seller-submissions': () => ok({ submissions: [] }),
};

describe('seller application helpers', () => {
  it('shows the number the way staff dial it and builds the call link', () => {
    expect(localPhone('+94771234567')).toBe('077 123 4567');
    expect(telHref('+94771234567')).toBe('tel:+94771234567');
  });
  it('counts by status and sorts NEW first, then newest first', () => {
    expect(applicationCounts(APPS)).toEqual({ ALL: 3, NEW: 1, CONTACTED: 1, APPROVED: 0, DECLINED: 1 });
    expect(sortApplications([...APPS].reverse()).map((a) => a.id)).toEqual(['ap1', 'ap2', 'ap3']);
  });
  it('hands the application to the Add seller sheet and reads it back', () => {
    const state = addSellerState(APPS[0]);
    expect(state.addSeller).toEqual({ application_id: 'ap1', shop_name: 'Sunrise Spices', contact_name: 'Kamal Perera', phone: '077 123 4567' });
    expect(readAddSellerState(state)).toEqual(state.addSeller);
    expect(readAddSellerState(undefined)).toBeNull();
  });
  it('the "New seller application" push opens the applications screen', () => {
    expect(pushOpenPath({ type: 'staff_seller_application', application_id: 'ap1' })).toBe('/more/seller-applications');
    expect(pushOpenPath({ type: 'staff_order', order_id: 'o7' })).toBe('/orders');
  });
});

describe('More -> Seller applications', () => {
  it('has a More card with the NEW count that leads to the list', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, '/more', handlers);
    const link = await screen.findByRole('link', { name: /^Seller applications/ });
    expect(link).toHaveAttribute('href', '/more/seller-applications');
    expect(await within(link).findByLabelText('1 new applications')).toBeInTheDocument();
    await user.click(link);
    expect(await screen.findByRole('listitem', { name: 'Application Sunrise Spices' })).toBeInTheDocument();
  });

  it('lists the applications as cards with a tap-to-call phone and filters by status', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, '/more/seller-applications', handlers);
    const first = await screen.findByRole('listitem', { name: 'Application Sunrise Spices' });
    expect(first).toHaveTextContent('Kamal Perera');
    expect(first).toHaveTextContent('Aluthgama');
    expect(first).toHaveTextContent('Sells: Spices and dry fish');
    expect(first).toHaveTextContent('“Please call after 4”');
    expect(within(first).getByRole('link', { name: /Call Kamal Perera on 077 123 4567/ })).toHaveAttribute('href', 'tel:+94771234567');
    expect(within(first).getByRole('link', { name: 'kamal@example.com' })).toHaveAttribute('href', 'mailto:kamal@example.com');
    expect(screen.getByRole('listitem', { name: 'Application Lanka Sweets' })).toHaveTextContent('Note: Visit on Friday');

    expect(screen.getByRole('button', { name: 'All (3)' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Contacted (1)' }));
    expect(screen.queryByRole('listitem', { name: 'Application Sunrise Spices' })).toBeNull();
    expect(screen.getByRole('listitem', { name: 'Application Lanka Sweets' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Approved (0)' }));
    expect(await screen.findByText('No applications here')).toBeInTheDocument();
  });

  it('sets the status and a staff note with one save', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/seller-applications', handlers);
    await user.click(await screen.findByRole('button', { name: 'Update Sunrise Spices' }));
    const sheet = screen.getByRole('dialog', { name: 'Update Sunrise Spices' });
    await user.click(within(sheet).getByRole('button', { name: 'Contacted' }));
    await user.type(within(sheet).getByRole('textbox'), 'Rang, will send photos');
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/seller-applications/ap1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/seller-applications/ap1')[0]!.body).toEqual({ status: 'CONTACTED', staff_note: 'Rang, will send photos' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Update Sunrise Spices' })).toBeNull());
    expect(within(screen.getByRole('listitem', { name: 'Application Sunrise Spices' })).getByText('Contacted')).toBeInTheDocument();
  });

  it('shows the server error and keeps the sheet when saving fails', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, '/more/seller-applications', {
      ...handlers,
      'PATCH /admin/seller-applications/:id': () => fail(400, 'VALIDATION_ERROR', 'The note is too long'),
    });
    await user.click(await screen.findByRole('button', { name: 'Update Sunrise Spices' }));
    const sheet = screen.getByRole('dialog', { name: 'Update Sunrise Spices' });
    await user.click(within(sheet).getByRole('button', { name: 'Declined' }));
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(await within(sheet).findByRole('alert')).toBeInTheDocument();
  });

  it('"Add as seller" opens the Add seller sheet with the shop, name and phone filled in, then marks the application Approved', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/seller-applications', handlers);
    await user.click(await screen.findByRole('button', { name: 'Add Sunrise Spices as seller' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add seller' });
    expect(within(sheet).getByLabelText('Shop name')).toHaveValue('Sunrise Spices');
    expect(within(sheet).getByLabelText('Phone')).toHaveValue('077 123 4567');
    expect(within(sheet).getByLabelText('Contact name (optional)')).toHaveValue('Kamal Perera');
    await user.click(within(sheet).getByRole('button', { name: 'Add seller' }));
    await waitFor(() => expect(api.find('POST', '/admin/sellers')).toHaveLength(1));
    expect(api.find('POST', '/admin/sellers')[0]!.body).toMatchObject({ shop_name: 'Sunrise Spices', phone: '+94771234567', contact_name: 'Kamal Perera', status: 'APPROVED' });
    await waitFor(() => expect(api.find('PATCH', '/admin/seller-applications/ap1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/seller-applications/ap1')[0]!.body).toEqual({ status: 'APPROVED' });
  });

  it('the Sellers screen opened normally has an empty Add seller sheet', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, '/more/sellers', handlers);
    await user.click(await screen.findByRole('button', { name: 'Add seller' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add seller' });
    expect(within(sheet).getByLabelText('Shop name')).toHaveValue('');
    expect(within(sheet).getByLabelText('Phone')).toHaveValue('');
  });

  it('says to run migration 064 while the server is not ready', async () => {
    renderAs(OPERATIONS_STAFF, '/more/seller-applications', {
      ...handlers,
      'GET /admin/seller-applications': () => fail(503, 'SELLER_APPLICATIONS_NOT_READY'),
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('run database migration 064 in Coolify');
  });

  it('shows an empty state when nobody has applied', async () => {
    renderAs(OPERATIONS_STAFF, '/more/seller-applications', {
      ...handlers,
      'GET /admin/seller-applications': () => ok({ applications: [], new_count: 0 }),
    });
    expect(await screen.findByText('No applications yet')).toBeInTheDocument();
  });
});

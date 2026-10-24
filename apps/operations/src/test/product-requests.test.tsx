import { cleanup, configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import { OPERATIONS_STAFF, fail, ok, renderAs, type Call } from './helpers';

/**
 * Catalog -> Product requests (plan 2026-10-24-groups-ratings-requests.md §C) against a fake
 * API shaped like the contract.
 */
configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 40_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const GROUPS = [
  {
    key: 'oat milk',
    name: 'Oat milk',
    count: 12,
    last_requested_at: '2026-10-23T10:00:00.000Z',
    status: 'NEW',
    category_name: 'Dairy',
    requests: [
      { id: 'q1', name: 'Oat milk', note: 'Alpro please', customer_name: 'Nimali Perera', created_at: '2026-10-23T10:00:00.000Z' },
      { id: 'q2', name: 'oat milk', note: null, customer_name: null, created_at: '2026-10-22T10:00:00.000Z' },
    ],
  },
  {
    key: 'kithul treacle',
    name: 'Kithul treacle',
    count: 3,
    last_requested_at: '2026-10-24T03:00:00.000Z',
    status: 'PLANNED',
    category_name: null,
    requests: [],
  },
];

const list = (call: Call) => {
  const rows = call.query.status ? GROUPS.filter((g) => g.status === call.query.status) : GROUPS;
  return ok({ groups: call.query.sort === 'newest' ? [...rows].reverse() : rows });
};

const PRODUCT = { id: 'p-oat', name: 'Alpro Oat Drink 1L', unit: '1 L', sku: 'ALP-OAT-1L', is_active: true };

describe('Catalog -> Product requests', () => {
  it('opens from the Catalog hub (with the count of new names) and lists groups, most requested first', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/catalog', { 'GET /admin/product-requests': list });
    const card = await screen.findByRole('link', { name: /Product requests/ });
    await waitFor(() => expect(card).toHaveTextContent('Product requests1'));
    await user.click(card);
    const oat = await screen.findByRole('listitem', { name: 'Oat milk' });
    expect(within(oat).getByTestId('request-count')).toHaveTextContent('12 requests');
    expect(oat).toHaveTextContent('Dairy');
    expect(within(oat).getByText('New')).toBeInTheDocument();
    expect(oat).toHaveTextContent('Nimali Perera');
    expect(oat).toHaveTextContent('“Alpro please”');
    expect(api.find('GET', '/admin/product-requests').at(-1)?.query).toEqual({ sort: 'popular' });

    await user.click(screen.getByRole('button', { name: 'Newest' }));
    await waitFor(() => expect(api.find('GET', '/admin/product-requests').at(-1)?.query).toEqual({ sort: 'newest' }));
    await user.click(screen.getByRole('button', { name: 'Planned' }));
    await waitFor(() => expect(screen.queryByRole('listitem', { name: 'Oat milk' })).toBeNull());
    expect(api.find('GET', '/admin/product-requests').at(-1)?.query).toEqual({ sort: 'newest', status: 'PLANNED' });
  });

  it('marks a group planned for the whole name key', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/catalog/product-requests', {
      'GET /admin/product-requests': list,
      'PATCH /admin/product-requests/:key': () => ok({ updated: 12 }),
    });
    await user.click(await screen.findByRole('button', { name: 'Planned: Oat milk' }));
    const dialog = screen.getByRole('dialog', { name: 'Mark as planned' });
    await user.type(within(dialog).getByRole('textbox'), 'Supplier visit Friday');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/product-requests/oat%20milk')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/product-requests/oat%20milk')[0].body).toEqual({ status: 'PLANNED', staff_note: 'Supplier visit Friday' });
    expect(await screen.findByText('"Oat milk" marked planned.')).toBeInTheDocument();
  });

  it('Added needs the product, picked with the product search', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/catalog/product-requests', {
      'GET /admin/product-requests': list,
      'GET /admin/products': () => ok({ products: [PRODUCT], pagination: {} }),
      'PATCH /admin/product-requests/:key': () => ok({ updated: 12 }),
    });
    await user.click(await screen.findByRole('button', { name: 'Added: Oat milk' }));
    const dialog = screen.getByRole('dialog', { name: 'Mark as added' });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Choose the product it was added as.');
    expect(api.find('PATCH', '/admin/product-requests/oat%20milk')).toHaveLength(0);

    await user.type(within(dialog).getByRole('searchbox'), 'oat');
    await user.click(await within(dialog).findByRole('button', { name: 'Choose Alpro Oat Drink 1L' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/product-requests/oat%20milk')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/product-requests/oat%20milk')[0].body).toEqual({ status: 'ADDED', product_id: 'p-oat' });
    expect(await screen.findByText('"Oat milk" marked added. Everyone who asked is told it is available.')).toBeInTheDocument();
  });

  it('says the migration is missing instead of failing', async () => {
    renderAs(OPERATIONS_STAFF, '/catalog/product-requests', {
      'GET /admin/product-requests': () => fail(503, 'PRODUCT_REQUESTS_NOT_READY'),
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Product requests need database update 056');
  });
});

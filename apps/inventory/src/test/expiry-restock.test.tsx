import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { tokenStore } from '../api/client';
import type { StockDetail } from '../api/types';
import { ADMIN, fail, ok, pageOf, renderAs, stockRow } from './helpers';

/**
 * Expiry dates (wave 2, 2026-10-25; migration 059): the restock screen's optional "Expiry date". Sent as
 * expires_on only for stock received and only when filled in; the screen works exactly as before without it.
 */
beforeEach(() => {
  tokenStore.clear();
  vi.restoreAllMocks();
});

const detail: StockDetail = {
  product_id: 'p-milk',
  product_name: 'Kotmale Fresh Milk 1L',
  tracking_mode: 'TRACKED',
  quantity_on_hand: 12,
  quantity_reserved: 0,
  quantity_available: 12,
  low_stock_threshold: 5,
  is_low_stock: false,
  adjustments: [],
};

const handlers = (adjust?: () => unknown) => ({
  'GET /admin/inventory': () => ok(pageOf('inventory', [stockRow({ quantity_on_hand: 12 })])),
  'GET /admin/inventory/:productId': () => ok(detail),
  'POST /admin/inventory/:productId/adjust': adjust ?? (() => ok({ inventory: { quantity_on_hand: 36 } })),
});

async function openAdjust() {
  await userEvent.click(await screen.findByRole('button', { name: 'Adjust stock' }));
  return screen.findByRole('dialog', { name: /Adjust stock/ });
}

describe('restock with an expiry date', () => {
  it('sends expires_on with the restock when a date is picked', async () => {
    const { api } = renderAs(ADMIN, '/stock?product=p-milk', handlers());
    const dialog = await openAdjust();
    await userEvent.type(within(dialog).getByLabelText('Units received'), '24');
    fireEvent.change(within(dialog).getByLabelText(/^Expiry date/), { target: { value: '2026-12-31' } });
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Carton from the distributor');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record adjustment' }));
    await waitFor(() => expect(api.find('POST', '/admin/inventory/p-milk/adjust')).toHaveLength(1));
    expect(api.find('POST', '/admin/inventory/p-milk/adjust')[0].body).toEqual({
      adjustment_type: 'PURCHASE_RESTOCK',
      quantity_delta: 24,
      notes: 'Carton from the distributor',
      expires_on: '2026-12-31',
    });
  });

  it('is left out when empty, and hidden for a write-off', async () => {
    const { api } = renderAs(ADMIN, '/stock?product=p-milk', handlers());
    const dialog = await openAdjust();
    await userEvent.type(within(dialog).getByLabelText('Units received'), '5');
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Top up');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record adjustment' }));
    await waitFor(() => expect(api.find('POST', '/admin/inventory/p-milk/adjust')).toHaveLength(1));
    expect(api.find('POST', '/admin/inventory/p-milk/adjust')[0].body).not.toHaveProperty('expires_on');
  });

  it('hides the field for a write-off', async () => {
    renderAs(ADMIN, '/stock?product=p-milk', handlers());
    const dialog = await openAdjust();
    expect(within(dialog).getByLabelText(/^Expiry date/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByLabelText(/Damage write-off/));
    expect(within(dialog).queryByLabelText(/^Expiry date/)).not.toBeInTheDocument();
  });

  it('refuses a date that is too old, sending nothing', async () => {
    const { api } = renderAs(ADMIN, '/stock?product=p-milk', handlers());
    const dialog = await openAdjust();
    await userEvent.type(within(dialog).getByLabelText('Units received'), '5');
    fireEvent.change(within(dialog).getByLabelText(/^Expiry date/), { target: { value: '2010-01-01' } });
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Top up');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record adjustment' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('too far in the past');
    expect(api.find('POST', '/admin/inventory/p-milk/adjust')).toHaveLength(0);
  });

  it('before migration 059 the 503 says to clear the date', async () => {
    renderAs(ADMIN, '/stock?product=p-milk', handlers(() => fail(503, 'EXPIRY_NOT_READY')));
    const dialog = await openAdjust();
    await userEvent.type(within(dialog).getByLabelText('Units received'), '5');
    fireEvent.change(within(dialog).getByLabelText(/^Expiry date/), { target: { value: '2026-12-31' } });
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Top up');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record adjustment' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Clear the expiry date');
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, mockApi, ok, type Call, type Reply } from './mockApi';
import { payoutRequest, renderApp, seller, signInStoredSession, statement, worldHandler } from './fixtures';
import type { PayoutRequest } from '../api/types';

beforeEach(() => signInStoredSession());

/** The fake API with payment requests kept in `requests` (POST adds one, DELETE withdraws). */
function payWorld(
  requests: PayoutRequest[],
  opts: { post?: (call: Call) => Reply | undefined; status?: 'APPROVED' | 'PENDING'; due?: number } = {}
) {
  return mockApi(
    worldHandler({
      seller: seller({ status: opts.status ?? 'APPROVED' }),
      statement: statement(opts.due !== undefined ? { due: opts.due } : {}),
      extra: (call) => {
        if (call.method === 'GET' && call.path === '/seller/payout-requests') return ok({ requests: [...requests] });
        if (call.method === 'POST' && call.path === '/seller/payout-requests') {
          const custom = opts.post?.(call);
          if (custom) return custom;
          const request = payoutRequest({
            id: `pr${requests.length + 10}`,
            amount: call.body.amount,
            method: call.body.method,
            bank_details: call.body.bank_details ?? null,
            note: call.body.note ?? null,
            created_at: new Date().toISOString(),
          });
          requests.unshift(request);
          return { status: 201, data: { request } };
        }
        const del = call.method === 'DELETE' && call.path.match(/^\/seller\/payout-requests\/(.+)$/);
        if (del) {
          const index = requests.findIndex((r) => r.id === del[1]);
          if (index >= 0) requests.splice(index, 1);
          return ok({});
        }
        return undefined;
      },
    })
  );
}

async function dueTile() {
  const term = await screen.findByText(/blynk still owes you/i, { selector: 'dt' }, { timeout: 15_000 });
  return within(term.parentElement as HTMLElement);
}

describe('ask for payment', () => {
  it('asks for the amount due by bank transfer, then shows the open request', async () => {
    const requests: PayoutRequest[] = [];
    const api = payWorld(requests);
    renderApp('/statement');

    await userEvent.click(await (await dueTile()).findByRole('button', { name: /ask for payment/i }));
    const dialog = within(await screen.findByRole('dialog', { name: /ask for payment/i }));
    expect(dialog.getByLabelText(/^amount/i)).toHaveValue('3000');

    await userEvent.click(dialog.getByRole('radio', { name: /bank transfer/i }));
    await userEvent.type(dialog.getByLabelText(/your bank details/i), 'BOC Aluthgama, M. Nimal, 0012345678');
    await userEvent.type(dialog.getByLabelText(/note for blynk/i), 'Thank you');
    await userEvent.click(dialog.getByRole('button', { name: /send my request/i }));

    expect(await screen.findByText(/blynk will transfer lkr 3,000\.00 to your bank/i)).toBeInTheDocument();
    expect(api.find('POST', '/seller/payout-requests')[0]!.body).toEqual({
      amount: 3000,
      method: 'BANK',
      bank_details: 'BOC Aluthgama, M. Nimal, 0012345678',
      note: 'Thank you',
    });
    const open = await screen.findByRole('article', { name: /payment request waiting for blynk/i });
    expect(open).toHaveTextContent('LKR 3,000.00');
    expect(open).toHaveTextContent(/bank transfer/i);
    // While one is open there is no second "Ask for payment".
    expect((await dueTile()).queryByRole('button', { name: /ask for payment/i })).not.toBeInTheDocument();
    expect((await dueTile()).getByText(/you asked for lkr 3,000\.00/i)).toBeInTheDocument();
  });

  it('can ask for part of it, as cash at the store', async () => {
    const api = payWorld([]);
    renderApp('/statement');
    await userEvent.click(await (await dueTile()).findByRole('button', { name: /ask for payment/i }));
    const dialog = within(await screen.findByRole('dialog'));
    const amount = dialog.getByLabelText(/^amount/i);
    await userEvent.clear(amount);
    await userEvent.type(amount, '1,500');
    await userEvent.click(dialog.getByRole('radio', { name: /cash at the store/i }));
    expect(dialog.queryByLabelText(/your bank details/i)).not.toBeInTheDocument();
    await userEvent.click(dialog.getByRole('button', { name: /send my request/i }));
    expect(await screen.findByText(/collect lkr 1,500\.00 in cash at the blynk store/i)).toBeInTheDocument();
    expect(api.find('POST', '/seller/payout-requests')[0]!.body).toEqual({ amount: 1500, method: 'CASH' });
  });

  it('checks the amount and the bank details before sending', async () => {
    const api = payWorld([]);
    renderApp('/statement');
    await userEvent.click(await (await dueTile()).findByRole('button', { name: /ask for payment/i }));
    const dialog = within(await screen.findByRole('dialog'));
    const amount = dialog.getByLabelText(/^amount/i);
    await userEvent.clear(amount);
    await userEvent.type(amount, '5000');
    await userEvent.click(dialog.getByRole('radio', { name: /bank transfer/i }));
    await userEvent.click(dialog.getByRole('button', { name: /send my request/i }));
    expect(await dialog.findByText(/more than blynk owes you \(lkr 3,000\.00\)/i)).toBeInTheDocument();
    expect(dialog.getByText(/add your bank, branch, account name and account number/i)).toBeInTheDocument();
    expect(api.find('POST', '/seller/payout-requests')).toHaveLength(0);

    await userEvent.click(dialog.getByRole('button', { name: /ask for all of it/i }));
    expect(amount).toHaveValue('3000');
  });

  it('explains 409 PAYOUT_REQUEST_OPEN and brings in the open request', async () => {
    const requests: PayoutRequest[] = [];
    payWorld(requests, {
      post: () => {
        // Asked from another phone a moment ago.
        requests.push(payoutRequest({ id: 'pr-other', amount: 2000, method: 'CASH', bank_details: null }));
        return fail(409, 'PAYOUT_REQUEST_OPEN', 'There is an open request.');
      },
    });
    renderApp('/statement');
    await userEvent.click(await (await dueTile()).findByRole('button', { name: /ask for payment/i }));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.click(dialog.getByRole('radio', { name: /cash at the store/i }));
    await userEvent.click(dialog.getByRole('button', { name: /send my request/i }));
    expect(await dialog.findByRole('alert')).toHaveTextContent(/you already have a payment request waiting/i);
    await userEvent.click(dialog.getByRole('button', { name: /close/i }));
    expect(await screen.findByRole('article', { name: /payment request waiting for blynk/i })).toHaveTextContent('LKR 2,000.00');
  });

  it('shows 400 AMOUNT_OVER_DUE next to the amount', async () => {
    payWorld([], { post: () => fail(400, 'AMOUNT_OVER_DUE', 'Amount is over the due.') });
    renderApp('/statement');
    await userEvent.click(await (await dueTile()).findByRole('button', { name: /ask for payment/i }));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.click(dialog.getByRole('radio', { name: /cash at the store/i }));
    await userEvent.click(dialog.getByRole('button', { name: /send my request/i }));
    expect(await dialog.findByText(/that is more than blynk owes you\. ask for the amount due or less/i)).toBeInTheDocument();
    expect(dialog.getByLabelText(/^amount/i)).toHaveAttribute('aria-invalid', 'true');
  });

  it('withdraws the open request', async () => {
    const requests = [payoutRequest({ id: 'pr5' })];
    const api = payWorld(requests);
    renderApp('/statement');
    const open = await screen.findByRole('article', { name: /payment request waiting for blynk/i });
    expect(open).toHaveTextContent(/boc aluthgama/i);
    await userEvent.click(within(open).getByRole('button', { name: /withdraw request/i }));
    await userEvent.click(within(open).getByRole('button', { name: /yes, withdraw it/i }));
    expect(await screen.findByText(/your payment request was withdrawn/i)).toBeInTheDocument();
    expect(api.find('DELETE', '/seller/payout-requests/pr5')).toHaveLength(1);
    expect(screen.queryByRole('article', { name: /payment request waiting for blynk/i })).not.toBeInTheDocument();
    expect(await (await dueTile()).findByRole('button', { name: /ask for payment/i })).toBeInTheDocument();
  });

  it('lists earlier requests: paid, and not paid with the reason', async () => {
    payWorld([
      payoutRequest({ id: 'a', amount: 6000, status: 'PAID', handled_at: '2026-10-15T05:00:00.000Z' }),
      payoutRequest({ id: 'b', amount: 900, method: 'CASH', status: 'DECLINED', decline_reason: 'Asked twice by mistake.' }),
    ]);
    renderApp('/statement');
    expect(await screen.findByRole('heading', { name: /your payment requests/i })).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'LKR 6,000.00, Paid' })).toHaveTextContent(/paid 15 oct 2026/i);
    expect(screen.getByRole('listitem', { name: 'LKR 900.00, Not paid' })).toHaveTextContent(/reason: asked twice by mistake/i);
  });

  it('puts the last bank details in again', async () => {
    payWorld([payoutRequest({ id: 'old', status: 'PAID', bank_details: 'HNB Beruwala 998877' })]);
    renderApp('/statement');
    await userEvent.click(await (await dueTile()).findByRole('button', { name: /ask for payment/i }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByRole('radio', { name: /bank transfer/i })).toBeChecked();
    expect(dialog.getByLabelText(/your bank details/i)).toHaveValue('HNB Beruwala 998877');
  });

  it('asks from the all-time view only (the due changes with the dates)', async () => {
    payWorld([]);
    renderApp('/statement');
    await (await dueTile()).findByRole('button', { name: /ask for payment/i });
    await userEvent.click(screen.getByRole('button', { name: /this month/i }));
    await userEvent.click(await (await dueTile()).findByRole('button', { name: /show all time to ask for payment/i }));
    expect(await screen.findByText('Showing all time')).toBeInTheDocument();
    expect(await (await dueTile()).findByRole('button', { name: /ask for payment/i })).toBeInTheDocument();
  });

  it('says there is nothing to ask for when nothing is due', async () => {
    payWorld([], { due: 0 });
    renderApp('/statement');
    expect(await (await dueTile()).findByText(/nothing to ask for right now/i)).toBeInTheDocument();
    expect((await dueTile()).queryByRole('button', { name: /ask for payment/i })).not.toBeInTheDocument();
  });

  it('is not offered before the shop is approved', async () => {
    payWorld([], { status: 'PENDING' });
    renderApp('/statement');
    await screen.findByText('Showing all time');
    expect(screen.queryByRole('button', { name: /ask for payment/i })).not.toBeInTheDocument();
  });

  it('is left out quietly while the server is not ready (503 SELLER_REQUESTS_NOT_READY)', async () => {
    mockApi(
      worldHandler({
        extra: (call) =>
          call.path.startsWith('/seller/payout-requests') ? fail(503, 'SELLER_REQUESTS_NOT_READY', 'Not ready.') : undefined,
      })
    );
    renderApp('/statement');
    expect(await screen.findByText('Showing all time')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ask for payment/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/payment requests/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('hides it gently when sending finds the server not ready', async () => {
    payWorld([], { post: () => fail(503, 'SELLER_REQUESTS_NOT_READY', 'Not ready.') });
    renderApp('/statement');
    await userEvent.click(await (await dueTile()).findByRole('button', { name: /ask for payment/i }));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.click(dialog.getByRole('radio', { name: /cash at the store/i }));
    await userEvent.click(dialog.getByRole('button', { name: /send my request/i }));
    expect(await screen.findByText(/asking for payment is not switched on yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ask for payment/i })).not.toBeInTheDocument();
  });
});

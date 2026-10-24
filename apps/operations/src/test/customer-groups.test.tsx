import { cleanup, configure, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { SmsOfferEstimate } from '../api/types';
import { OPERATIONS_STAFF, ok, renderAs, type Call } from './helpers';

/**
 * "Send to" customer groups on Notifications and SMS offers (plan
 * 2026-10-24-groups-ratings-requests.md §A): live counts per group, and the `audience`
 * that is sent.
 */
configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 40_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

/** A fake push audience: fewer customers for a narrower group. */
function pushCount(call: Call) {
  const byGroup: Record<string, number> = { LAPSED: 4, NEW: 2, BIG_SPENDERS: 3, NEVER_ORDERED: 5 };
  const customers = call.query.group ? byGroup[call.query.group] ?? 0 : 20;
  return ok({ push_enabled: true, customers, devices: customers + 1 });
}

describe('Notifications: Send to', () => {
  it('counts the chosen group live and sends its audience', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/notifications', {
      'GET /admin/push-broadcasts/audience': pushCount,
      'GET /admin/push-broadcasts': () => ok({ broadcasts: [{ id: 'b0', title: 'Hi', body: 'Old', queued: 4, sent_at: '2026-10-20T04:00:00Z', sent_by: 'Ops', audience: { group: 'LAPSED', days: 14 } }] }),
      'POST /admin/push-broadcasts': () => ok({ id: 'b1', queued: 4 }),
    });
    expect(await screen.findByTestId('audience')).toHaveTextContent('20 customers (21 devices) allowed notifications.');
    expect(screen.getByText(/Haven't ordered in 14 days · by Ops/)).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: "Haven't ordered in N days" }));
    await waitFor(() => expect(screen.getByTestId('audience')).toHaveTextContent(`4 customers (5 devices) in "Haven't ordered in 14 days"`));
    const days = screen.getByRole('textbox', { name: "Days for Haven't ordered in N days" });
    fireEvent.change(days, { target: { value: '30' } });
    await waitFor(() => expect(api.find('GET', '/admin/push-broadcasts/audience').at(-1)?.query).toEqual({ group: 'LAPSED', days: '30' }));

    await user.click(screen.getByRole('button', { name: /Store is open/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send notification' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Send notification' }));
    expect(screen.getByRole('alertdialog', { name: 'Confirm sending' })).toHaveTextContent("Send this to 4 customers (Haven't ordered in 30 days) now?");
    await user.click(screen.getByRole('button', { name: 'Yes, send' }));
    await waitFor(() => expect(api.find('POST', '/admin/push-broadcasts')).toHaveLength(1));
    expect(api.find('POST', '/admin/push-broadcasts')[0].body.audience).toEqual({ group: 'LAPSED', days: 30 });
  });

  it('stops on numbers out of range, and sends no audience for every customer', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/notifications', {
      'GET /admin/push-broadcasts/audience': pushCount,
      'GET /admin/push-broadcasts': () => ok({ broadcasts: [] }),
      'POST /admin/push-broadcasts': () => ok({ id: 'b1', queued: 20 }),
    });
    await screen.findByTestId('audience');
    await user.click(screen.getByRole('button', { name: /Store is open/ }));
    await user.click(screen.getByRole('radio', { name: 'Big spenders' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Days for Big spenders' }), { target: { value: '10' } });
    expect(await screen.findByText('Days must be a whole number from 30 to 365.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send notification' })).toBeDisabled();

    await user.click(screen.getByRole('radio', { name: 'All customers' }));
    await waitFor(() => expect(screen.getByTestId('audience')).toHaveTextContent('20 customers'));
    await user.click(screen.getByRole('button', { name: 'Send notification' }));
    await user.click(screen.getByRole('button', { name: 'Yes, send' }));
    await waitFor(() => expect(api.find('POST', '/admin/push-broadcasts')).toHaveLength(1));
    expect(api.find('POST', '/admin/push-broadcasts')[0].body).not.toHaveProperty('audience');
  });
});

describe('SMS offers: Send to', () => {
  function estimate(call: Call) {
    const a = call.body.audience;
    const recipients = typeof a === 'object' && a.group === 'NEW' ? 6 : 10;
    const e: SmsOfferEstimate = {
      audience: a,
      recipients,
      by_language: { si: 0, ta: 0, en: recipients },
      without_language: 0,
      opted_out: 1,
      parts_per_sms: { en: 1 },
      sms_parts_total: recipients,
      missing_languages: [],
      languages: ['en'],
    };
    return ok({ estimate: e });
  }

  it('estimates and sends a group with its numbers; older choices stay words', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more/sms-offers', {
      'GET /admin/sms-offers': () =>
        ok({
          offers: [
            {
              id: 'o0',
              audience: { group: 'BIG_SPENDERS', days: 90, min_spend_lkr: 5000 },
              fallback_language: 'en',
              message_si: null,
              message_ta: null,
              message_en: 'Thanks!',
              recipient_count: 3,
              sms_parts_total: 3,
              created_at: '2026-10-20T04:00:00Z',
              sent_by_name: 'Ops',
              sent_by_role: 'OPERATIONS',
            },
          ],
        }),
      'POST /admin/sms-offers/estimate': estimate,
      'POST /admin/sms-offers': () => ({ status: 201, data: { offer: { id: 'o1', created_at: '2026-10-24T04:00:00Z', recipients: 6, sms_parts_total: 6 } } }),
    });
    expect(await screen.findByText('Big spenders: LKR 5,000+ in 90 days')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Ordered in last 90 days' }));
    await waitFor(() => expect(api.find('POST', '/admin/sms-offers/estimate').at(-1)?.body.audience).toBe('ORDERED_90D'));

    await user.click(screen.getByRole('radio', { name: 'New customers (last N days)' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Days for New customers (last N days)' }), { target: { value: '7' } });
    await waitFor(() => expect(api.find('POST', '/admin/sms-offers/estimate').at(-1)?.body.audience).toEqual({ group: 'NEW', days: 7 }));
    expect(await screen.findByTestId('group-count')).toHaveTextContent('6 customers can get it');

    fireEvent.change(await screen.findByLabelText(/^English text/, { selector: 'textarea' }), { target: { value: 'Welcome gift: 10% off' } });
    const send = screen.getByRole('button', { name: 'Send offer' });
    await waitFor(() => expect(send).toBeEnabled());
    await user.click(send);
    await user.click(within(screen.getByRole('dialog', { name: 'Send offer' })).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.find('POST', '/admin/sms-offers')).toHaveLength(1));
    expect(api.find('POST', '/admin/sms-offers')[0].body).toEqual({
      audience: { group: 'NEW', days: 7 },
      fallback_language: 'en',
      messages: { en: 'Welcome gift: 10% off' },
    });
  });
});

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { ToastProvider } from '../components/ui';
import { tokenStore } from '../api/client';
import { audienceFromDraft, audienceLabel, audienceQuery, blankAudienceDraft } from '../lib/customerGroups';
import { mockApi, ok, type Call, type Reply } from './mockApi';

/** "Send to" customer groups on Notifications and SMS offers (2026-10-24 plan, section A). */
// Many clicks and typing on a busy machine.
vi.setConfig({ testTimeout: 20_000 });
configure({ asyncUtilTimeout: 5_000 });

const ADMIN = { id: 'a1', phone: '+94775551122', full_name: 'Nawaz Mansoor', email: null, role: 'ADMIN' };

function renderAt(route: string, handler: (c: Call) => Reply | undefined) {
  tokenStore.save('access', 'refresh');
  const api = mockApi((c) => (c.path === '/auth/me' ? ok(ADMIN) : handler(c)));
  render(
    <MemoryRouter initialEntries={[route]}>
      <ToastProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>
  );
  return api;
}

afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

describe('customer groups (lib)', () => {
  it('builds the audience with the API defaults and checks the numbers', () => {
    const d = blankAudienceDraft();
    expect(audienceFromDraft(d)).toEqual({ audience: { group: 'ALL' }, problem: null });
    expect(audienceFromDraft({ ...d, group: 'LAPSED' }).audience).toEqual({ group: 'LAPSED', days: 14 });
    expect(audienceFromDraft({ ...d, group: 'NEW' }).audience).toEqual({ group: 'NEW', days: 14 });
    expect(audienceFromDraft({ ...d, group: 'BIG_SPENDERS' }).audience).toEqual({ group: 'BIG_SPENDERS', days: 90, min_spend_lkr: 5000 });
    expect(audienceFromDraft({ ...d, group: 'NEVER_ORDERED' }).audience).toEqual({ group: 'NEVER_ORDERED' });
    expect(audienceFromDraft({ ...d, group: 'LAPSED', days: { ...d.days, LAPSED: '6' } }).problem).toMatch(/7 to 90/);
    expect(audienceFromDraft({ ...d, group: 'NEW', days: { ...d.days, NEW: '61' } }).problem).toMatch(/1 to 60/);
    expect(audienceFromDraft({ ...d, group: 'BIG_SPENDERS', days: { ...d.days, BIG_SPENDERS: '29' } }).problem).toMatch(/30 to 365/);
    expect(audienceFromDraft({ ...d, group: 'BIG_SPENDERS', min_spend_lkr: '' }).problem).toMatch(/Minimum spend/);
    expect(audienceFromDraft({ ...d, group: 'LAPSED', days: { ...d.days, LAPSED: '1.5' } }).problem).toMatch(/whole number/);
  });

  it('makes the preview query and the history words', () => {
    expect(audienceQuery({ group: 'BIG_SPENDERS', days: 90, min_spend_lkr: 5000 })).toBe('group=BIG_SPENDERS&days=90&min_spend_lkr=5000');
    expect(audienceQuery({ group: 'NEVER_ORDERED' })).toBe('group=NEVER_ORDERED');
    expect(audienceLabel({ group: 'LAPSED', days: 14 })).toBe("Haven't ordered in 14 days");
    expect(audienceLabel({ group: 'NEW', days: 7 })).toBe('New customers (last 7 days)');
    expect(audienceLabel({ group: 'BIG_SPENDERS', days: 90, min_spend_lkr: 5000 })).toBe('Big spenders: LKR 5,000+ in 90 days');
    expect(audienceLabel(null)).toBe('All customers');
    // Offers sent before groups carry the old words.
    expect(audienceLabel('ORDERED_30D')).toBe('Ordered in last 30 days');
  });
});

describe('Send to on Notifications', () => {
  it('counts the chosen group live, sends it with the audience, and shows the group in the history', async () => {
    const user = userEvent.setup();
    let sent = false;
    const api = renderAt('/notifications', (c) => {
      if (c.path === '/admin/push-broadcasts/audience') {
        const group = c.query.get('group');
        if (!group) return ok({ push_enabled: true, customers: 42, devices: 50 });
        return ok({ push_enabled: true, customers: group === 'LAPSED' ? Number(c.query.get('days')) : 3, devices: 9 });
      }
      if (c.method === 'GET' && c.path === '/admin/push-broadcasts')
        return ok({
          broadcasts: sent
            ? [{ id: 'b1', title: 'We miss you', body: 'Come back', queued: 30, sent_at: '2026-10-24T05:00:00.000Z', sent_by: 'Nawaz', audience: { group: 'LAPSED', days: 30 } }]
            : [],
        });
      if (c.method === 'POST' && c.path === '/admin/push-broadcasts') {
        sent = true;
        return ok({ id: 'b1', queued: 30 });
      }
      return undefined;
    });

    expect(await screen.findByTestId('audience')).toHaveTextContent('42 customers (50 devices) allowed notifications.');
    // Every customer: the preview is asked without a group, as before.
    expect(api.find('GET', '/admin/push-broadcasts/audience')[0]!.query.get('group')).toBeNull();

    await user.selectOptions(screen.getByLabelText('Send to'), 'LAPSED');
    await waitFor(() => expect(screen.getByTestId('audience')).toHaveTextContent('14 customers (9 devices) in this group'));
    const days = screen.getByLabelText('No order for (days)');
    await user.clear(days);
    await user.type(days, '3');
    expect(await screen.findByText(/Days must be a whole number from 7 to 90/)).toBeInTheDocument();
    await user.clear(days);
    await user.type(days, '30');
    await waitFor(() => expect(screen.getByTestId('audience')).toHaveTextContent('30 customers'));
    const lapsedCalls = api.find('GET', '/admin/push-broadcasts/audience').filter((c) => c.query.get('group') === 'LAPSED');
    expect(lapsedCalls.at(-1)!.query.get('days')).toBe('30');

    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'We miss you');
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Come back');
    await user.click(screen.getByRole('button', { name: 'Send notification' }));
    expect(screen.getByRole('alertdialog', { name: 'Confirm sending' })).toHaveTextContent("Haven't ordered in 30 days");
    await user.click(screen.getByRole('button', { name: 'Yes, send' }));
    await waitFor(() => expect(api.find('POST', '/admin/push-broadcasts')).toHaveLength(1));
    expect(api.find('POST', '/admin/push-broadcasts')[0]!.body).toEqual({
      title: 'We miss you',
      body: 'Come back',
      audience: { group: 'LAPSED', days: 30 },
    });
    expect(await screen.findByTestId('sent-group')).toHaveTextContent("Haven't ordered in 30 days");
  });

  it('cannot send while a group number is out of range', async () => {
    const user = userEvent.setup();
    renderAt('/notifications', (c) => {
      if (c.path === '/admin/push-broadcasts/audience') return ok({ push_enabled: true, customers: 5, devices: 5 });
      if (c.path === '/admin/push-broadcasts') return ok({ broadcasts: [] });
      return undefined;
    });
    await screen.findByTestId('audience');
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Hello');
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Fresh fish today');
    expect(screen.getByRole('button', { name: 'Send notification' })).toBeEnabled();
    await user.selectOptions(screen.getByLabelText('Send to'), 'BIG_SPENDERS');
    const min = screen.getByLabelText('Minimum spend (LKR)');
    await user.clear(min);
    expect(await screen.findByText(/Minimum spend must be/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send notification' })).toBeDisabled();
  });
});

describe('Send to on SMS offers', () => {
  it('estimates and sends for the chosen group and shows groups in the sent list', async () => {
    const user = userEvent.setup();
    const api = renderAt('/sms-offers', (c) => {
      if (c.path === '/admin/sms-offers/estimate') {
        const big = c.body?.audience?.group === 'BIG_SPENDERS';
        return ok({
          estimate: {
            audience: c.body?.audience,
            recipients: big ? 7 : 35,
            by_language: { si: 0, ta: 0, en: big ? 7 : 35 },
            without_language: 0,
            opted_out: 1,
            parts_per_sms: {},
            sms_parts_total: big ? 7 : 35,
            missing_languages: c.body?.messages?.en ? [] : ['en'],
            languages: ['en'],
          },
        });
      }
      if (c.method === 'GET' && c.path === '/admin/sms-offers')
        return ok({
          offers: [
            {
              id: 'so1',
              audience: { group: 'NEW', days: 7 },
              fallback_language: 'en',
              message_si: null,
              message_ta: null,
              message_en: 'Welcome gift',
              recipient_count: 4,
              sms_parts_total: 4,
              created_at: '2026-10-20T05:00:00.000Z',
              sent_by_name: 'Nawaz',
              sent_by_role: 'ADMIN',
            },
          ],
        });
      if (c.method === 'POST' && c.path === '/admin/sms-offers')
        return ok({ offer: { id: 'so2', created_at: '2026-10-24T05:00:00.000Z', recipients: 7, sms_parts_total: 7 } });
      return undefined;
    });

    expect(await screen.findByTestId('sms-group-count')).toHaveTextContent('35 customers can get offers by SMS.');
    const table = await screen.findByRole('table', { name: 'Sent offers' });
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('New customers (last 7 days)');

    await user.selectOptions(screen.getByLabelText('Send to'), 'BIG_SPENDERS');
    const min = screen.getByLabelText('Minimum spend (LKR)');
    await user.clear(min);
    await user.type(min, '10000');
    await waitFor(() => expect(screen.getByTestId('sms-group-count')).toHaveTextContent('7 customers in this group'));
    expect(api.find('POST', '/admin/sms-offers/estimate').at(-1)!.body.audience).toEqual({
      group: 'BIG_SPENDERS',
      days: 90,
      min_spend_lkr: 10000,
    });

    await user.click(screen.getByRole('textbox', { name: 'English text' }));
    await user.paste('Thank you: 10% off');
    const send = screen.getByRole('button', { name: 'Send offer' });
    await waitFor(() => expect(send).toBeEnabled());
    await user.click(send);
    const dialog = screen.getByRole('dialog', { name: 'Send offer' });
    expect(dialog).toHaveTextContent('Big spenders: LKR 10,000+ in 90 days');
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.find('POST', '/admin/sms-offers')).toHaveLength(1));
    expect(api.find('POST', '/admin/sms-offers')[0]!.body).toEqual({
      audience: { group: 'BIG_SPENDERS', days: 90, min_spend_lkr: 10000 },
      fallback_language: 'en',
      messages: { en: 'Thank you: 10% off' },
    });
  });
});

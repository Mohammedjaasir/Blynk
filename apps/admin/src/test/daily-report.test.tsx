import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { ToastProvider } from '../components/ui';
import { tokenStore } from '../api/client';
import { mockApi, ok, fail, type Call, type Reply } from './mockApi';

/** Daily report (owner, 2026-10-25): switch, time, numbers, today's text, Send now. */
const ADMIN = { id: 'a1', phone: '+94775551122', full_name: 'Nawaz Mansoor', email: null, role: 'ADMIN' };
const SETTING = '/admin/settings/daily-report';
const PREVIEW = '/admin/daily-report/preview';
const SEND = '/admin/daily-report/send-now';

const TEXT = 'Blynk Sun 25 Oct: Orders 42 placed, 38 delivered, 2 cancelled. Sales LKR 123,450. Cash LKR 98,000. New customers 5.';
const setting = (over: object = {}) => ({
  enabled: false,
  send_at: '21:00',
  phones: ['+94771234567'],
  last_sent_date: null,
  last_sent_at: null,
  last_sent_kind: null,
  last_manual_at: null,
  updated_at: null,
  ...over,
});
const preview = { date: '2026-10-25', text: TEXT, chars: TEXT.length, parts: 1 };

function renderPage(handler: (c: Call) => Reply | undefined) {
  tokenStore.save('access', 'refresh');
  const api = mockApi((c) => (c.path === '/auth/me' ? ok(ADMIN) : handler(c)));
  render(
    <MemoryRouter initialEntries={['/daily-report']}>
      <ToastProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>
  );
  return api;
}

const standard = (current = setting()) => (c: Call): Reply | undefined => {
  if (c.path === SETTING && c.method === 'GET') return ok(current);
  if (c.path === PREVIEW && c.method === 'POST') return ok(preview);
  if (c.path === SETTING && c.method === 'PUT') return ok({ ...current, ...c.body, updated_at: '2026-10-25T10:00:00Z' });
  return undefined;
};

// Cold component runs on a slow machine take several seconds per interaction.
vi.setConfig({ testTimeout: 30000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Daily report page', () => {
  it('shows the settings, today so far in monospace with its length and SMS parts, and when it last went out', async () => {
    renderPage(standard(setting({ enabled: true, last_sent_at: '2026-10-24T15:31:00.000Z', last_sent_kind: 'auto' })));

    // The first render of a cold test run is slow.
    expect(await screen.findByRole('heading', { name: 'Daily report' }, { timeout: 15000 })).toBeInTheDocument();
    expect(await screen.findByRole('checkbox', { name: 'Send the daily report' })).toBeChecked();
    expect((screen.getByLabelText('Send at') as HTMLInputElement).value).toBe('21:00');
    expect(screen.getByText('077 123 4567')).toBeInTheDocument();

    const text = await screen.findByTestId('report-text');
    expect(text).toHaveTextContent(TEXT);
    expect(text.tagName).toBe('PRE');
    expect(text.style.fontFamily).toMatch(/monospace/);
    expect(screen.getByTestId('report-count')).toHaveTextContent(`${TEXT.length} of 480 characters, 1 SMS part`);
    expect(screen.getByTestId('report-last-sent')).toHaveTextContent('Last sent 24 Oct 2026, 9:01 pm (Sri Lanka time), automatically.');
  }, 30000);

  it('adds a number (validated, normalised) and saves the switch, time and numbers', async () => {
    const user = userEvent.setup();
    const api = renderPage(standard());
    await screen.findByRole('checkbox', { name: 'Send the daily report' });

    await user.type(screen.getByLabelText('Add a number'), '0112345678');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText(/Sri Lankan mobile number/)).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Add a number'));
    await user.type(screen.getByLabelText('Add a number'), '077 123 4567');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('That number is already on the list.')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Add a number'));
    await user.type(screen.getByLabelText('Add a number'), '0779876543');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText('077 987 6543')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Send the daily report' }));
    fireEvent.change(screen.getByLabelText('Send at'), { target: { value: '20:30' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.find('PUT', SETTING)).toHaveLength(1));
    expect(api.find('PUT', SETTING)[0].body).toEqual({ enabled: true, send_at: '20:30', phones: ['+94771234567', '+94779876543'] });
    expect(await screen.findByText('Daily report saved.')).toBeInTheDocument();
  });

  it('removes a number', async () => {
    const user = userEvent.setup();
    const api = renderPage(standard(setting({ phones: ['+94771234567', '+94779876543'] })));
    await screen.findByText('077 987 6543');
    await user.click(screen.getByRole('button', { name: 'Remove 077 987 6543' }));
    expect(screen.queryByText('077 987 6543')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PUT', SETTING)).toHaveLength(1));
    expect(api.find('PUT', SETTING)[0].body.phones).toEqual(['+94771234567']);
  });

  it('will not switch the report on without a number', async () => {
    const user = userEvent.setup();
    const api = renderPage(standard(setting({ phones: [] })));
    await user.click(await screen.findByRole('checkbox', { name: 'Send the daily report' }));
    expect(screen.getByText('Add at least one number before switching the report on.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(api.find('PUT', SETTING)).toHaveLength(0);
  });

  it('Send now sends to the saved numbers, then waits out the cooldown', async () => {
    const user = userEvent.setup();
    const sentAt = new Date().toISOString();
    let sent = false;
    const api = renderPage((c) => {
      if (c.path === SEND && c.method === 'POST') {
        sent = true;
        return ok({ ...preview, recipients: 1, sent_at: sentAt });
      }
      if (c.path === SETTING && c.method === 'GET') return ok(sent ? setting({ last_sent_at: sentAt, last_sent_kind: 'manual', last_manual_at: sentAt }) : setting());
      return standard()(c);
    });
    const button = await screen.findByRole('button', { name: 'Send now' });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    await waitFor(() => expect(api.find('POST', SEND)).toHaveLength(1));
    expect(await screen.findByText('Report sent to 1 number.')).toBeInTheDocument();
    const waiting = await screen.findByRole('button', { name: /Send now \(\d+s\)/ });
    expect(waiting).toBeDisabled();
    expect(screen.getByTestId('report-last-sent')).toHaveTextContent('with Send now');
  });

  it('shows the cooldown message when the server refuses', async () => {
    const user = userEvent.setup();
    renderPage((c) => (c.path === SEND ? fail(429, 'DAILY_REPORT_COOLDOWN', 'The report was just sent. Try again in 90 seconds.') : standard()(c)));
    await user.click(await screen.findByRole('button', { name: 'Send now' }));
    expect(await screen.findByText('The report was just sent. Try again in 90 seconds.')).toBeInTheDocument();
  });

  it('Send now waits for unsaved changes, and needs a saved number', async () => {
    const user = userEvent.setup();
    renderPage(standard(setting({ phones: [] })));
    expect(await screen.findByRole('button', { name: 'Send now' })).toBeDisabled();
    expect(screen.getByText('Add and save a number to use Send now.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Add a number'), '0771234567');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('button', { name: 'Send now' })).toBeDisabled();
    expect(screen.getByText('Save your changes first: Send now uses the saved numbers.')).toBeInTheDocument();
  });

  it('refreshes the preview', async () => {
    const user = userEvent.setup();
    const api = renderPage(standard());
    await screen.findByTestId('report-text');
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(api.find('POST', PREVIEW)).toHaveLength(2));
  });
});

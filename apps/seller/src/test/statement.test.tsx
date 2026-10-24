import { describe, it, expect, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, mockApi } from './mockApi';
import { renderApp, signInStoredSession, statement, worldHandler } from './fixtures';

beforeEach(() => signInStoredSession());

function total(label: RegExp) {
  const term = screen.getByText(label, { selector: 'dt' });
  return within(term.parentElement as HTMLElement);
}

describe('statement', () => {
  it('shows the totals, the per-product lines and the payouts', async () => {
    mockApi(worldHandler());
    renderApp('/statement');
    expect(await screen.findByRole('heading', { name: /statement/i })).toBeInTheDocument();

    await screen.findByText('Showing all time');
    expect(total(/^sold$/i).getByText('LKR 10,000.00')).toBeInTheDocument();
    expect(total(/blynk commission \(10%\)/i).getByText('LKR 1,000.00')).toBeInTheDocument();
    expect(total(/you earned/i).getByText('LKR 9,000.00')).toBeInTheDocument();
    expect(total(/paid to you/i).getByText('LKR 6,000.00')).toBeInTheDocument();
    expect(total(/still owes you/i).getByText('LKR 3,000.00')).toBeInTheDocument();

    expect(screen.getByText('Kithul Treacle')).toBeInTheDocument();
    expect(screen.getByText('20 sold')).toBeInTheDocument();
    expect(screen.getByText('LKR 9,000.00', { selector: '.line__amount' })).toBeInTheDocument();
    expect(screen.getByText('Mango Jam')).toBeInTheDocument();

    expect(screen.getByText(/15 oct 2026/i)).toBeInTheDocument();
    expect(screen.getByText(/bank transfer/i)).toBeInTheDocument();
    expect(screen.getByText('LKR 6,000.00', { selector: '.line__amount' })).toBeInTheDocument();
  });

  it('asks for the chosen dates and says which dates are shown', async () => {
    const api = mockApi(worldHandler());
    renderApp('/statement');
    await screen.findByText('Showing all time');
    expect(api.find('GET', '/seller/statement')[0]!.query.toString()).toBe('');

    await userEvent.type(screen.getByLabelText('From'), '2026-10-01');
    await userEvent.type(screen.getByLabelText('To'), '2026-10-20');
    await userEvent.click(screen.getByRole('button', { name: /show these dates/i }));

    expect(await screen.findByText(/showing 1 oct 2026 to 20 oct 2026/i)).toBeInTheDocument();
    const last = api.find('GET', '/seller/statement').at(-1)!;
    expect(last.query.get('from')).toBe('2026-10-01');
    expect(last.query.get('to')).toBe('2026-10-20');
  });

  it('does not ask when the From date is after the To date', async () => {
    const api = mockApi(worldHandler());
    renderApp('/statement');
    await screen.findByText('Showing all time');
    await userEvent.type(screen.getByLabelText('From'), '2026-10-20');
    await userEvent.type(screen.getByLabelText('To'), '2026-10-01');
    await userEvent.click(screen.getByRole('button', { name: /show these dates/i }));
    expect(await screen.findByText(/"from" date must not be after the "to" date/i)).toBeInTheDocument();
    expect(api.find('GET', '/seller/statement')).toHaveLength(1);
  });

  it('has quick ranges, and All time clears the dates', async () => {
    const api = mockApi(worldHandler());
    renderApp('/statement');
    await screen.findByText('Showing all time');
    await userEvent.click(screen.getByRole('button', { name: /this month/i }));
    await screen.findByText(/^showing 1 /i);
    const month = api.find('GET', '/seller/statement').at(-1)!;
    expect(month.query.get('from')).toMatch(/^\d{4}-\d{2}-01$/);
    expect(month.query.get('to')).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await userEvent.click(screen.getByRole('button', { name: /all time/i }));
    await screen.findByText('Showing all time');
    expect(api.find('GET', '/seller/statement').at(-1)!.query.toString()).toBe('');
  });

  it('shows empty states when nothing sold and nothing was paid', async () => {
    mockApi(
      worldHandler({
        statement: statement({ gross: 0, commission: 0, earned: 0, paid: 0, due: 0, lines: [], payouts: [] }),
      })
    );
    renderApp('/statement');
    expect(await screen.findByText(/nothing sold in these dates/i)).toBeInTheDocument();
    expect(screen.getByText(/no payments yet/i)).toBeInTheDocument();
    expect(total(/still owes you/i).getByText('LKR 0.00')).toBeInTheDocument();
  });

  it('shows an error with a way to try again', async () => {
    let first = true;
    mockApi((call) => {
      if (call.path === '/seller/statement' && first) {
        first = false;
        return fail(500, 'INTERNAL', 'The statement is not available right now.');
      }
      return worldHandler()(call);
    });
    renderApp('/statement');
    expect(await screen.findByRole('alert')).toHaveTextContent(/statement is not available/i);
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('LKR 10,000.00', { selector: 'dd' })).toBeInTheDocument();
  });
});

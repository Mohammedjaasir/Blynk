import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { AvailableHours } from '../pages/AvailableHours';
import { tokenStore } from '../api/client';
import { clockText, isOpenNow, windowLabel, windowProblem, windowsPayload } from '../lib/availability';
import { mockApi, ok, type Call } from './mockApi';

/**
 * Available hours (owner, 2026-10-23): the page that limits products and categories to hours of
 * the day. The API contract is tested against PostgreSQL in backend/api/tests/availability-windows.test.ts.
 */
vi.setConfig({ testTimeout: 20_000 });

const JUICE = { kind: 'CATEGORY' as const, id: 'c-juice', from: '06:00', until: '18:00', name: 'Juices', parent_name: 'Beverages', open_now: true };

describe('available hours rules (same as the API)', () => {
  it('says times as people do', () => {
    expect(clockText('06:00')).toBe('6 am');
    expect(clockText('18:30')).toBe('6:30 pm');
    expect(clockText('00:00')).toBe('12 am');
  });

  it('needs two different times', () => {
    expect(windowProblem({ from: '06:00', until: '18:00' })).toBeNull();
    expect(windowProblem({ from: '22:00', until: '02:00' })).toBeNull();
    expect(windowProblem({ from: '06:00', until: '06:00' })).toMatch(/differ/);
    expect(windowProblem({ from: '', until: '18:00' })).toMatch(/both times/);
  });

  it('opens from the first minute to just before the last, past midnight when it runs over', () => {
    const at = (hhmm: string) => new Date(`2026-10-06T${hhmm}:00+05:30`);
    expect(isOpenNow({ from: '06:00', until: '18:00' }, at('05:59'))).toBe(false);
    expect(isOpenNow({ from: '06:00', until: '18:00' }, at('17:59'))).toBe(true);
    expect(isOpenNow({ from: '06:00', until: '18:00' }, at('18:00'))).toBe(false);
    expect(isOpenNow({ from: '22:00', until: '02:00' }, at('23:00'))).toBe(true);
  });

  it('names a sub-category with its main category and sends only the four fields', () => {
    expect(windowLabel(JUICE)).toBe('Beverages › Juices');
    expect(windowsPayload([JUICE])).toEqual({ windows: [{ kind: 'CATEGORY', id: 'c-juice', from: '06:00', until: '18:00' }] });
  });
});

describe('Available hours page', () => {
  beforeEach(() => tokenStore.save('access', 'refresh'));
  afterEach(() => {
    tokenStore.clear();
    vi.unstubAllGlobals();
  });

  const handler = (state: { saved: unknown[] }) => (c: Call) => {
    if (c.method === 'GET' && c.path === '/admin/settings/availability-windows') return ok({ windows: [JUICE], updated_at: null });
    if (c.method === 'PUT' && c.path === '/admin/settings/availability-windows') {
      state.saved = c.body.windows;
      return ok({ windows: [{ ...JUICE, from: c.body.windows[0].from }], updated_at: '2026-10-23T10:00:00Z' });
    }
    if (c.method === 'GET' && c.path === '/admin/categories') {
      return ok({
        categories: [
          { id: 'c-bev', name: 'Beverages', slug: 'beverages', is_active: true, display_order: 1, parent_id: null },
          { id: 'c-juice', name: 'Juices', slug: 'juices', is_active: true, display_order: 1, parent_id: 'c-bev' },
        ],
      });
    }
    return undefined;
  };

  it('lists what is limited and saves a changed time with PUT', async () => {
    const user = userEvent.setup();
    const state = { saved: [] as unknown[] };
    mockApi(handler(state));
    render(
      <MemoryRouter>
        <ToastProvider>
          <AvailableHours />
        </ToastProvider>
      </MemoryRouter>
    );
    expect(await screen.findByText('Beverages › Juices')).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();

    const from = screen.getByLabelText('Beverages › Juices from');
    await user.clear(from);
    await user.type(from, '07:00');
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(state.saved).toEqual([{ kind: 'CATEGORY', id: 'c-juice', from: '07:00', until: '18:00' }]));
  });

  it('adds a category to the list', async () => {
    const user = userEvent.setup();
    mockApi(handler({ saved: [] }));
    render(
      <MemoryRouter>
        <ToastProvider>
          <AvailableHours />
        </ToastProvider>
      </MemoryRouter>
    );
    await screen.findByText('Beverages › Juices');
    await user.selectOptions(screen.getAllByRole('combobox')[0]!, 'CATEGORY');
    await user.click(screen.getByRole('button', { name: 'Add to the list' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a category.');
    await user.selectOptions(screen.getAllByRole('combobox')[1]!, 'c-bev');
    await user.click(screen.getByRole('button', { name: 'Add to the list' }));
    expect(await screen.findByLabelText('Beverages from')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});

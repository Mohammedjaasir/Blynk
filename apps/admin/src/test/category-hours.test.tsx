import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { tokenStore } from '../api/client';
import { Categories } from '../pages/Categories';
import { hoursById, hoursRowText, parseHoursInput, withCategoryHours } from '../lib/categoryHours';
import { fail, mockApi, ok, type Call } from './mockApi';

/**
 * Available hours on the Categories page (owner's brother, 2026-10-24: "I can't find the time setting thing ...
 * for category or products"): a From / Until dialog per category over GET/PUT
 * /admin/settings/availability-windows (PUT replaces the whole list).
 */
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const cat = (id: string, name: string, order: number, parent_id: string | null = null) => ({
  id,
  name,
  slug: name.toLowerCase(),
  description: null,
  image_url: null,
  display_order: order,
  is_active: true,
  parent_id,
  product_count: 0,
});
const CATEGORIES = [cat('c-bev', 'Beverages', 10), cat('c-juice', 'Juices', 10, 'c-bev'), cat('c-gro', 'Grocery', 20)];
const ROLLS = { kind: 'PRODUCT' as const, id: 'p-roll', from: '07:00', until: '19:00' };
const view = (w: { kind: 'PRODUCT' | 'CATEGORY'; id: string; from: string; until: string }, name: string) => ({
  ...w,
  name,
  parent_name: null,
  open_now: true,
});

function renderCategories(
  state: { put: any[] },
  windows = [view({ kind: 'CATEGORY', id: 'c-juice', from: '06:00', until: '18:00' }, 'Juices'), view(ROLLS, 'Rolls')],
  onPut?: (c: Call) => ReturnType<typeof ok>
) {
  tokenStore.save('access', 'refresh');
  const api = mockApi((c) => {
    if (c.method === 'GET' && c.path === '/admin/categories') return ok({ categories: CATEGORIES });
    if (c.method === 'GET' && c.path === '/admin/category-groups') return ok({ groups: [], unassigned: [] });
    if (c.method === 'GET' && c.path === '/admin/settings/availability-windows') return ok({ windows, updated_at: null });
    if (c.method === 'PUT' && c.path === '/admin/settings/availability-windows') {
      if (onPut) return onPut(c);
      state.put.push(c.body);
      return ok({ windows: c.body.windows.map((w: any) => view(w, w.id)), updated_at: '2026-10-24T10:00:00Z' });
    }
    return undefined;
  });
  render(
    <MemoryRouter>
      <ToastProvider>
        <Categories />
      </ToastProvider>
    </MemoryRouter>
  );
  return api;
}

describe('Categories: Available hours', () => {
  it('shows the hours under a category that has them, and a sub-category without its own shows its main category\'s', async () => {
    renderCategories({ put: [] }, [view({ kind: 'CATEGORY', id: 'c-bev', from: '06:00', until: '18:00' }, 'Beverages')]);
    const juices = (await screen.findByText('Juices')).closest('tr')!;
    expect(await within(juices).findByText('Hours: 6 am - 6 pm (from Beverages)')).toBeInTheDocument();
    expect(within(screen.getByText('Beverages').closest('tr')!).getByText('Hours: 6 am - 6 pm')).toBeInTheDocument();
    expect(within(screen.getByText('Grocery').closest('tr')!).queryByText(/^Hours:/)).toBeNull();
  });

  it('saves only this category\'s entry and keeps the rest of the list', async () => {
    const user = userEvent.setup();
    const state = { put: [] as any[] };
    renderCategories(state);
    await user.click(await screen.findByRole('button', { name: 'Available hours for Grocery' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Available hours' }));
    const from = await dialog.findByLabelText('From');
    expect(from).toHaveValue('');
    await user.type(from, '08:30');
    await user.type(dialog.getByLabelText('Until'), '21:00');
    await user.click(dialog.getByRole('button', { name: 'Save hours' }));
    await waitFor(() => expect(state.put).toHaveLength(1));
    expect(state.put[0]).toEqual({
      windows: [
        { kind: 'CATEGORY', id: 'c-juice', from: '06:00', until: '18:00' },
        { kind: 'PRODUCT', id: 'p-roll', from: '07:00', until: '19:00' },
        { kind: 'CATEGORY', id: 'c-gro', from: '08:30', until: '21:00' },
      ],
    });
    const grocery = screen.getByText('Grocery').closest('tr')!;
    expect(await within(grocery).findByText('Hours: 8:30 am - 9 pm')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Available hours' })).toBeNull();
  });

  it('shows a sub-category\'s window in the dialog and removes it with Any time', async () => {
    const user = userEvent.setup();
    const state = { put: [] as any[] };
    renderCategories(state);
    await user.click(await screen.findByRole('button', { name: 'Available hours for Juices' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Available hours' }));
    await waitFor(() => expect(dialog.getByLabelText('From')).toHaveValue('06:00'));
    expect(dialog.getByLabelText('Until')).toHaveValue('18:00');
    await user.click(dialog.getByRole('button', { name: 'Any time' }));
    await user.click(dialog.getByRole('button', { name: 'Save hours' }));
    await waitFor(() => expect(state.put).toHaveLength(1));
    expect(state.put[0]).toEqual({ windows: [ROLLS] });
  });

  it('refuses one time alone and equal times without calling the API', async () => {
    const user = userEvent.setup();
    const state = { put: [] as any[] };
    renderCategories(state);
    await user.click(await screen.findByRole('button', { name: 'Available hours for Grocery' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Available hours' }));
    await user.type(await dialog.findByLabelText('From'), '09:00');
    await user.click(dialog.getByRole('button', { name: 'Save hours' }));
    expect(await dialog.findByText(/Choose both times/)).toBeInTheDocument();
    await user.type(dialog.getByLabelText('Until'), '09:00');
    await user.click(dialog.getByRole('button', { name: 'Save hours' }));
    expect(await dialog.findByText(/must differ/)).toBeInTheDocument();
    expect(state.put).toHaveLength(0);
  });

  it('shows the server\'s message when the save is refused', async () => {
    const user = userEvent.setup();
    renderCategories({ put: [] }, undefined, () => fail(400, 'CATEGORY_NOT_FOUND', 'One of the categories no longer exists.'));
    await user.click(await screen.findByRole('button', { name: 'Available hours for Grocery' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Available hours' }));
    await user.type(await dialog.findByLabelText('From'), '09:00');
    await user.type(dialog.getByLabelText('Until'), '17:00');
    await user.click(dialog.getByRole('button', { name: 'Save hours' }));
    expect(await dialog.findByText(/no longer exists/)).toBeInTheDocument();
  });
});

describe('categoryHours helpers', () => {
  const list = [
    { kind: 'CATEGORY' as const, id: 'a', from: '06:00', until: '18:00' },
    { kind: 'PRODUCT' as const, id: 'a', from: '07:00', until: '19:00' },
  ];

  it('replaces, adds or removes just the category entry', () => {
    expect(hoursById(list).get('a')).toEqual({ from: '06:00', until: '18:00' });
    expect(withCategoryHours(list, 'a', { from: '08:00', until: '09:00' })).toEqual([{ kind: 'CATEGORY', id: 'a', from: '08:00', until: '09:00' }, list[1]]);
    expect(withCategoryHours(list, 'b', { from: '08:00', until: '09:00' })).toHaveLength(3);
    expect(withCategoryHours(list, 'a', null)).toEqual([list[1]]);
  });

  it('parses the inputs and words the row text', () => {
    expect(parseHoursInput('', '')).toEqual({ hours: null });
    expect(parseHoursInput('06:00', '')).toHaveProperty('problem');
    expect(parseHoursInput('22:00', '02:00')).toEqual({ hours: { from: '22:00', until: '02:00' } });
    expect(hoursRowText({ id: 'x', parent_id: 'a' }, hoursById(list), [{ id: 'a', name: 'Juices' }])).toBe('Hours: 6 am - 6 pm (from Juices)');
  });
});

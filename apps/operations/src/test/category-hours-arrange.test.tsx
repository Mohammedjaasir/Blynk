import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { Category } from '../api/types';
import { hoursById, hoursRowText, parseHoursInput, withCategoryHours } from '../lib/categoryHours';
import { OPERATIONS_STAFF, fail, ok, renderAs } from './helpers';

/**
 * Categories on a phone (owner's brother, 2026-10-24: "I can't arrange the category order as well" and "I can't
 * find the time setting thing in the ops app for category or products"): a visible Arrange bar with big Up / Down
 * buttons and a pinned Save order, and an "Available hours" action per category over the availability-windows API.
 */
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

function category(id: string, name: string, order: number, parentId: string | null = null): Category {
  return {
    id,
    name,
    slug: name.toLowerCase(),
    description: null,
    image_url: null,
    display_order: order,
    is_active: true,
    product_count: 0,
    parent_id: parentId,
  };
}

const BEVERAGES = category('c-bev', 'Beverages', 10);
const GROCERY = category('c-gro', 'Grocery', 20);
const SNACKS = category('c-snk', 'Snacks', 30);
const JUICES = category('c-juice', 'Juices', 10, 'c-bev');
const TEA = category('c-tea', 'Tea', 20, 'c-bev');
const CATEGORIES = [BEVERAGES, JUICES, TEA, GROCERY, SNACKS];

const PRODUCT_WINDOW = { kind: 'PRODUCT' as const, id: 'p-roll', from: '07:00', until: '19:00' };
const view = (w: { kind: 'PRODUCT' | 'CATEGORY'; id: string; from: string; until: string }, name: string, parent: string | null = null) => ({
  ...w,
  name,
  parent_name: parent,
  open_now: true,
});

describe('Categories: Arrange order on a phone', () => {
  it('shows an Arrange bar, big Up/Down buttons, and a Save order bar that saves the top-level order', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/catalog/categories', {
      'GET /admin/categories': () => ok({ categories: CATEGORIES }),
      'PUT /admin/categories/order': () => ok({ categories: [] }),
    });
    expect(await screen.findByText(/Category order\./)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Arrange' }));

    // Save / Cancel are a pinned bar at the bottom, not in the page header.
    const bar = document.querySelector('.arrange-save-bar') as HTMLElement;
    expect(bar).not.toBeNull();
    expect(within(bar).getByRole('button', { name: 'Save order' })).toBeDisabled();
    expect(within(bar).getByRole('button', { name: 'Cancel' })).toBeEnabled();
    // Up / Down are labelled for a thumb.
    expect(screen.getByRole('button', { name: 'Move Snacks up' })).toHaveTextContent('Up');
    expect(screen.getByRole('button', { name: 'Move Grocery down' })).toHaveTextContent('Down');

    await user.click(screen.getByRole('button', { name: 'Move Snacks up' }));
    await user.click(screen.getByRole('button', { name: 'Move Snacks up' }));
    expect(api.find('PUT', '/admin/categories/order')).toHaveLength(0);
    await user.click(within(bar).getByRole('button', { name: 'Save order' }));
    await waitFor(() => expect(api.find('PUT', '/admin/categories/order')).toHaveLength(1));
    expect(api.find('PUT', '/admin/categories/order')[0].body).toEqual({ ids: ['c-snk', 'c-bev', 'c-gro'] });
  });

  it('arranges sub-categories inside their parent only, in a separate request', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/catalog/categories', {
      'GET /admin/categories': () => ok({ categories: CATEGORIES }),
      'PUT /admin/categories/order': () => ok({ categories: [] }),
    });
    await user.click(await screen.findByRole('button', { name: 'Arrange' }));
    // The first sub-category cannot go up, the last cannot go down: they never leave their parent.
    expect(screen.getByRole('button', { name: 'Move Juices up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Tea down' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Move Tea up' }));
    await user.click(screen.getByRole('button', { name: 'Move Grocery to the top' }));
    await user.click(screen.getByRole('button', { name: 'Save order' }));
    await waitFor(() => expect(api.find('PUT', '/admin/categories/order')).toHaveLength(2));
    const bodies = api.find('PUT', '/admin/categories/order').map((c) => c.body.ids);
    expect(bodies).toContainEqual(['c-gro', 'c-bev', 'c-snk']);
    expect(bodies).toContainEqual(['c-tea', 'c-juice']);
  });

  it('keeps the customer order: the list the page loads is the display_order the API returns', async () => {
    renderAs(OPERATIONS_STAFF, '/catalog/categories', {
      'GET /admin/categories': () => ok({ categories: CATEGORIES }),
    });
    await screen.findByText('Snacks');
    const titles = Array.from(document.querySelectorAll('.cat-row__title')).map((n) => n.textContent);
    expect(titles).toEqual(['Beverages', 'Juices', 'Tea', 'Grocery', 'Snacks']);
  });

  it('shows the server message when saving the order fails and sends nothing more', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, '/catalog/categories', {
      'GET /admin/categories': () => ok({ categories: CATEGORIES }),
      'PUT /admin/categories/order': () => fail(400, 'MIXED_CATEGORY_LEVELS', 'Arrange one level at a time.'),
    });
    await user.click(await screen.findByRole('button', { name: 'Arrange' }));
    await user.click(screen.getByRole('button', { name: 'Move Snacks to the top' }));
    await user.click(screen.getByRole('button', { name: 'Save order' }));
    expect(await screen.findByText(/Arrange one level at a time/)).toBeInTheDocument();
  });
});

describe('Categories: Available hours', () => {
  const handlers = (state: { put: any[] }, windows = [view({ kind: 'CATEGORY', id: 'c-juice', from: '06:00', until: '18:00' }, 'Juices', 'Beverages'), view(PRODUCT_WINDOW, 'Rolls')]) => ({
    'GET /admin/categories': () => ok({ categories: CATEGORIES }),
    'GET /admin/settings/availability-windows': () => ok({ windows, updated_at: null }),
    'PUT /admin/settings/availability-windows': (call: { body: { windows: any[] } }) => {
      state.put.push(call.body);
      return ok({ windows: call.body.windows.map((w) => view(w, w.id)), updated_at: '2026-10-24T10:00:00Z' });
    },
  });

  it('shows the hours on the row of a category that has them, and the main category\'s on a sub-category without', async () => {
    const state = { put: [] as any[] };
    renderAs(OPERATIONS_STAFF, '/catalog/categories', {
      ...handlers(state, [view({ kind: 'CATEGORY', id: 'c-bev', from: '06:00', until: '18:00' }, 'Beverages'), view({ kind: 'CATEGORY', id: 'c-tea', from: '08:00', until: '20:30' }, 'Tea', 'Beverages')]),
    });
    const bev = (await screen.findByText('Beverages')).closest('li')!;
    expect(await within(bev).findByText('Hours: 6 am - 6 pm')).toBeInTheDocument();
    const tea = screen.getByText('Tea').closest('li')!;
    expect(within(tea).getByText('Hours: 8 am - 8:30 pm')).toBeInTheDocument();
    const juices = screen.getByText('Juices').closest('li')!;
    expect(within(juices).getByText('Hours: 6 am - 6 pm (from Beverages)')).toBeInTheDocument();
    const grocery = screen.getByText('Grocery').closest('li')!;
    expect(within(grocery).queryByText(/^Hours:/)).toBeNull();
  });

  it('opens a From / Until dialog and saves only this category\'s entry, keeping every other one', async () => {
    const user = userEvent.setup();
    const state = { put: [] as any[] };
    renderAs(OPERATIONS_STAFF, '/catalog/categories', handlers(state));
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
    // The row shows the saved hours and the dialog closes.
    const grocery = screen.getByText('Grocery').closest('li')!;
    expect(await within(grocery).findByText('Hours: 8:30 am - 9 pm')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Available hours' })).toBeNull();
  });

  it('edits an existing window in place and clears it with both times empty', async () => {
    const user = userEvent.setup();
    const state = { put: [] as any[] };
    renderAs(OPERATIONS_STAFF, '/catalog/categories', handlers(state));
    await user.click(await screen.findByRole('button', { name: 'Available hours for Juices' }));
    let dialog = within(await screen.findByRole('dialog', { name: 'Available hours' }));
    await waitFor(() => expect(dialog.getByLabelText('From')).toHaveValue('06:00'));
    expect(dialog.getByLabelText('Until')).toHaveValue('18:00');
    await user.click(dialog.getByRole('button', { name: 'Any time' }));
    await user.click(dialog.getByRole('button', { name: 'Save hours' }));
    await waitFor(() => expect(state.put).toHaveLength(1));
    // Only the product's window is left.
    expect(state.put[0]).toEqual({ windows: [{ kind: 'PRODUCT', id: 'p-roll', from: '07:00', until: '19:00' }] });
    dialog = within(screen.queryByRole('dialog', { name: 'Available hours' }) ?? document.body);
    expect(screen.queryByText(/^Hours: 6 am/)).toBeNull();
  });

  it('refuses one time on its own and equal times without calling the API', async () => {
    const user = userEvent.setup();
    const state = { put: [] as any[] };
    renderAs(OPERATIONS_STAFF, '/catalog/categories', handlers(state));
    await user.click(await screen.findByRole('button', { name: 'Available hours for Snacks' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Available hours' }));
    await user.type(await dialog.findByLabelText('From'), '09:00');
    await user.click(dialog.getByRole('button', { name: 'Save hours' }));
    expect(await dialog.findByText(/Choose both times/)).toBeInTheDocument();
    await user.type(dialog.getByLabelText('Until'), '09:00');
    await user.click(dialog.getByRole('button', { name: 'Save hours' }));
    expect(await dialog.findByText(/must differ/)).toBeInTheDocument();
    expect(state.put).toHaveLength(0);
  });

  it('says what the server said when the save is refused', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, '/catalog/categories', {
      ...handlers({ put: [] }),
      'PUT /admin/settings/availability-windows': () => fail(400, 'CATEGORY_NOT_FOUND', 'One of the categories no longer exists.'),
    });
    await user.click(await screen.findByRole('button', { name: 'Available hours for Snacks' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Available hours' }));
    await user.type(await dialog.findByLabelText('From'), '09:00');
    await user.type(dialog.getByLabelText('Until'), '17:00');
    await user.click(dialog.getByRole('button', { name: 'Save hours' }));
    expect(await dialog.findByText(/no longer exists/)).toBeInTheDocument();
  });

  it('still lists the categories when the hours cannot be read', async () => {
    renderAs(OPERATIONS_STAFF, '/catalog/categories', {
      'GET /admin/categories': () => ok({ categories: CATEGORIES }),
      'GET /admin/settings/availability-windows': () => fail(500, 'INTERNAL', 'Something went wrong'),
    });
    expect(await screen.findByText('Snacks')).toBeInTheDocument();
    expect(screen.queryByText(/^Hours:/)).toBeNull();
  });
});

describe('categoryHours helpers', () => {
  const list = [
    { kind: 'CATEGORY' as const, id: 'a', from: '06:00', until: '18:00' },
    { kind: 'PRODUCT' as const, id: 'a', from: '07:00', until: '19:00' },
  ];

  it('only reads category windows', () => {
    expect(hoursById(list).get('a')).toEqual({ from: '06:00', until: '18:00' });
    expect(hoursById([list[1]]).size).toBe(0);
  });

  it('replaces, adds or removes just the category entry', () => {
    expect(withCategoryHours(list, 'a', { from: '08:00', until: '09:00' })).toEqual([
      { kind: 'CATEGORY', id: 'a', from: '08:00', until: '09:00' },
      list[1],
    ]);
    expect(withCategoryHours(list, 'b', { from: '08:00', until: '09:00' })).toHaveLength(3);
    expect(withCategoryHours(list, 'a', null)).toEqual([list[1]]);
    expect(withCategoryHours(list, 'zzz', null)).toEqual(list);
  });

  it('parses the two inputs', () => {
    expect(parseHoursInput('', '')).toEqual({ hours: null });
    expect(parseHoursInput('06:00', '')).toHaveProperty('problem');
    expect(parseHoursInput('06:00', '06:00')).toHaveProperty('problem');
    expect(parseHoursInput('22:00', '02:00')).toEqual({ hours: { from: '22:00', until: '02:00' } });
  });

  it('words the row text', () => {
    const hours = hoursById(list);
    expect(hoursRowText({ id: 'a' }, hours, [])).toBe('Hours: 6 am - 6 pm');
    expect(hoursRowText({ id: 'x', parent_id: 'a' }, hours, [{ id: 'a', name: 'Juices' }])).toBe('Hours: 6 am - 6 pm (from Juices)');
    expect(hoursRowText({ id: 'x' }, hours, [])).toBe('');
  });
});

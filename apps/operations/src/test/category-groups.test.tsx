import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { Category, CategoryGroup, GroupCategory } from '../api/types';
import { ADMIN_WITH_RIDER, OPERATIONS_STAFF, fail, ok, renderAs } from './helpers';

/**
 * Category groups (the titled rows of category tiles on the customer Home)
 * against a fake API shaped like `/admin/category-groups`: what each action
 * sends, and that every refusal is shown.
 */

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

function cat(id: string, name: string, groupId: string | null, order = 0): GroupCategory {
  return { id, name, slug: name.toLowerCase().replace(/\W+/g, '-'), image_url: null, is_active: true, group_id: groupId, group_sort_order: order };
}

function group(id: string, name: string, categories: GroupCategory[], overrides: Partial<CategoryGroup> = {}): CategoryGroup {
  return {
    id,
    name,
    sort_order: 0,
    is_active: true,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    categories,
    ...overrides,
  };
}

const VEG = cat('c1', 'Vegetables', 'g1', 0);
const DAIRY = cat('c2', 'Dairy', 'g1', 1);
const CHIPS = cat('c3', 'Chips', 'g2', 0);
const BAKERY = cat('c4', 'Bakery', null);

function overview() {
  return {
    groups: [group('g1', 'Grocery', [VEG, DAIRY]), group('g2', 'Snacks', [CHIPS], { sort_order: 1 })],
    unassigned: [BAKERY],
  };
}

const groupRow = (name: string) => screen.getByRole('listitem', { name });

describe('Category groups', () => {
  it('lists groups in order with their categories, and the unassigned ones', async () => {
    renderAs(OPERATIONS_STAFF, '/catalog/category-groups', { 'GET /admin/category-groups': () => ok(overview()) });

    await screen.findByRole('button', { name: 'Move Grocery up' });
    const rows = screen.getAllByRole('listitem').filter((li) => li.classList.contains('cat-group'));
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(['Grocery', 'Snacks']);
    expect(within(groupRow('Grocery')).getByText('Vegetables')).toBeInTheDocument();
    expect(within(groupRow('Grocery')).getByText('2 categories')).toBeInTheDocument();
    const unassigned = screen.getByRole('region', { name: 'Unassigned categories' });
    expect(within(unassigned).getByText('Bakery')).toBeInTheDocument();
    // The first group can't move up, the last can't move down.
    expect(screen.getByRole('button', { name: 'Move Grocery up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Snacks down' })).toBeDisabled();
  });

  it('is reachable from the Catalog hub', async () => {
    renderAs(ADMIN_WITH_RIDER, '/catalog', { 'GET /admin/category-groups': () => ok(overview()) });
    const card = (await screen.findByText('Category groups')).closest('a')!;
    expect(card).toHaveAttribute('href', '/catalog/category-groups');
    await waitFor(() => expect(within(card).getByText('2')).toBeInTheDocument());
  });

  it('moving a group down sends the full new order', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/category-groups', {
      'GET /admin/category-groups': () => ok(overview()),
      'PUT /admin/category-groups/order': () => ok({ groups: [] }),
    });
    await user.click(await screen.findByRole('button', { name: 'Move Grocery down' }));
    await waitFor(() => expect(api.find('PUT', '/admin/category-groups/order')).toHaveLength(1));
    expect(api.find('PUT', '/admin/category-groups/order')[0].body).toEqual({ group_ids: ['g2', 'g1'] });
  });

  it('creates a group with the trimmed name', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/category-groups', {
      'GET /admin/category-groups': () => ok(overview()),
      'POST /admin/category-groups': () => ({ status: 201, data: { group: group('g3', 'Household', []) } }),
    });
    await user.click(await screen.findByRole('button', { name: 'Add group' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Category group' }));
    await user.type(dialog.getByLabelText('Name'), '  Household ');
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('POST', '/admin/category-groups')).toHaveLength(1));
    expect(api.find('POST', '/admin/category-groups')[0].body).toEqual({ name: 'Household', is_active: true });
    expect(await screen.findByText('Household added.')).toBeInTheDocument();
  });

  it('shows a duplicate-name refusal in the dialog', async () => {
    const user = userEvent.setup();
    renderAs(ADMIN_WITH_RIDER, '/catalog/category-groups', {
      'GET /admin/category-groups': () => ok(overview()),
      'POST /admin/category-groups': () => fail(409, 'CATEGORY_GROUP_NAME_EXISTS', 'A group with this name already exists.'),
    });
    await user.click(await screen.findByRole('button', { name: 'Add group' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Category group' }));
    await user.type(dialog.getByLabelText('Name'), 'Grocery');
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    expect(await dialog.findByText('A group with this name already exists.')).toBeInTheDocument();
  });

  it('renames a group', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/category-groups', {
      'GET /admin/category-groups': () => ok(overview()),
      'PATCH /admin/category-groups/:id': () => ok({ group: group('g1', 'Grocery & Kitchen', []) }),
    });
    await user.click(await screen.findByRole('button', { name: 'Rename Grocery' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Category group' }));
    const input = dialog.getByLabelText('Name');
    await user.clear(input);
    await user.type(input, 'Grocery & Kitchen');
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/category-groups/g1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/category-groups/g1')[0].body).toEqual({ name: 'Grocery & Kitchen', is_active: true });
  });

  it('deactivates a group', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/category-groups', {
      'GET /admin/category-groups': () => ok(overview()),
      'PATCH /admin/category-groups/:id': () => ok({ group: group('g2', 'Snacks', [], { is_active: false }) }),
    });
    await user.click(await screen.findByRole('button', { name: 'Deactivate Snacks' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/category-groups/g2')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/category-groups/g2')[0].body).toEqual({ is_active: false });
    expect(await screen.findByText('Snacks is now inactive.')).toBeInTheDocument();
  });

  it('deletes a group only after confirming', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/category-groups', {
      'GET /admin/category-groups': () => ok(overview()),
      'DELETE /admin/category-groups/:id': () => ok({ group_id: 'g1', released_category_count: 2 }),
    });
    await user.click(await screen.findByRole('button', { name: 'Delete Grocery' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Delete group' }));
    expect(api.find('DELETE', '/admin/category-groups/g1')).toHaveLength(0);
    await user.click(dialog.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.find('DELETE', '/admin/category-groups/g1')).toHaveLength(1));
    expect(await screen.findByText('Grocery was deleted. 2 categories are now unassigned.')).toBeInTheDocument();
  });

  it('cancelling the delete confirm sends nothing', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/category-groups', { 'GET /admin/category-groups': () => ok(overview()) });
    await user.click(await screen.findByRole('button', { name: 'Delete Snacks' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Delete group' })).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
  });

  it('reorders categories inside a group with the full list', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/category-groups', {
      'GET /admin/category-groups': () => ok(overview()),
      'PUT /admin/category-groups/:id/categories': () => ok({ group: group('g1', 'Grocery', []) }),
    });
    await user.click(await screen.findByRole('button', { name: 'Move Dairy up in Grocery' }));
    await waitFor(() => expect(api.find('PUT', '/admin/category-groups/g1/categories')).toHaveLength(1));
    expect(api.find('PUT', '/admin/category-groups/g1/categories')[0].body).toEqual({ category_ids: ['c2', 'c1'] });
  });

  it('removes a category from a group', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/category-groups', {
      'GET /admin/category-groups': () => ok(overview()),
      'PUT /admin/category-groups/:id/categories': () => ok({ group: group('g1', 'Grocery', []) }),
    });
    await user.click(await screen.findByRole('button', { name: 'Remove Vegetables from Grocery' }));
    await waitFor(() => expect(api.find('PUT', '/admin/category-groups/g1/categories')).toHaveLength(1));
    expect(api.find('PUT', '/admin/category-groups/g1/categories')[0].body).toEqual({ category_ids: ['c2'] });
  });

  it('adds a category to the end of a group from the group picker (moving it from another group)', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/category-groups', {
      'GET /admin/category-groups': () => ok(overview()),
      'PUT /admin/category-groups/:id/categories': () => ok({ group: group('g1', 'Grocery', []) }),
    });
    await user.selectOptions(await screen.findByLabelText('Add a category to Grocery'), 'c3');
    await user.click(screen.getByRole('button', { name: 'Add to Grocery' }));
    await waitFor(() => expect(api.find('PUT', '/admin/category-groups/g1/categories')).toHaveLength(1));
    expect(api.find('PUT', '/admin/category-groups/g1/categories')[0].body).toEqual({ category_ids: ['c1', 'c2', 'c3'] });
  });

  it('adds an unassigned category to a chosen group', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/category-groups', {
      'GET /admin/category-groups': () => ok(overview()),
      'PUT /admin/category-groups/:id/categories': () => ok({ group: group('g2', 'Snacks', []) }),
    });
    const addButton = await screen.findByRole('button', { name: 'Add Bakery to group' });
    expect(addButton).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Group for Bakery'), 'g2');
    await user.click(addButton);
    await waitFor(() => expect(api.find('PUT', '/admin/category-groups/g2/categories')).toHaveLength(1));
    expect(api.find('PUT', '/admin/category-groups/g2/categories')[0].body).toEqual({ category_ids: ['c3', 'c4'] });
    expect(await screen.findByText('Bakery added to Snacks.')).toBeInTheDocument();
  });

  it('shows a refused change instead of swallowing it', async () => {
    const user = userEvent.setup();
    renderAs(ADMIN_WITH_RIDER, '/catalog/category-groups', {
      'GET /admin/category-groups': () => ok(overview()),
      'PUT /admin/category-groups/order': () => fail(400, 'INVALID_GROUP_ORDER', 'The order must list every group once.'),
    });
    await user.click(await screen.findByRole('button', { name: 'Move Snacks up' }));
    expect(await screen.findByText('The order must list every group once.')).toBeInTheDocument();
  });
});

describe('Category form Group select', () => {
  function category(overrides: Partial<Category> = {}): Category {
    return { id: 'c9', name: 'Bakery', slug: 'bakery', description: null, image_url: null, display_order: 1, is_active: true, group_id: null, ...overrides };
  }

  it('sends the chosen group_id when editing', async () => {
    const user = userEvent.setup();
    const c = category();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/categories', {
      'GET /admin/categories': () => ok({ categories: [c] }),
      'GET /admin/category-groups': () => ok(overview()),
      'PATCH /admin/categories/:id': () => ok({ category: c }),
    });
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Category' }));
    const select = dialog.getByLabelText('Group');
    await waitFor(() => expect(within(select).getByRole('option', { name: 'Snacks' })).toBeInTheDocument());
    await user.selectOptions(select, 'g2');
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/categories/c9')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/categories/c9')[0].body).toMatchObject({ group_id: 'g2' });
  });

  it('sends group_id null when moved to None, and nothing when the group is unchanged', async () => {
    const user = userEvent.setup();
    const c = category({ group_id: 'g1' });
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/categories', {
      'GET /admin/categories': () => ok({ categories: [c] }),
      'GET /admin/category-groups': () => ok(overview()),
      'PATCH /admin/categories/:id': () => ok({ category: c }),
    });
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    let dialog = within(screen.getByRole('dialog', { name: 'Category' }));
    await waitFor(() => expect(dialog.getByLabelText('Group')).toHaveValue('g1'));
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/categories/c9')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/categories/c9')[0].body).not.toHaveProperty('group_id');

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    dialog = within(screen.getByRole('dialog', { name: 'Category' }));
    await user.selectOptions(dialog.getByLabelText('Group'), '');
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/categories/c9')).toHaveLength(2));
    expect(api.find('PATCH', '/admin/categories/c9')[1].body).toMatchObject({ group_id: null });
  });

  it('includes group_id when creating a category in a group', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/categories', {
      'GET /admin/categories': () => ok({ categories: [] }),
      'GET /admin/category-groups': () => ok(overview()),
      'POST /admin/categories': () => ok({ category: category() }),
    });
    await user.click(await screen.findByRole('button', { name: 'Add category' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Category' }));
    await user.type(dialog.getByLabelText('Name'), 'Frozen');
    await waitFor(() => expect(within(dialog.getByLabelText('Group')).getByRole('option', { name: 'Grocery' })).toBeInTheDocument());
    await user.selectOptions(dialog.getByLabelText('Group'), 'g1');
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('POST', '/admin/categories')).toHaveLength(1));
    expect(api.find('POST', '/admin/categories')[0].body).toMatchObject({ name: 'Frozen', group_id: 'g1' });
  });
});

describe('Category form Inside category select (sub-categories)', () => {
  function category(id: string, name: string, parentId: string | null = null): Category {
    return { id, name, slug: name.toLowerCase(), description: null, image_url: null, display_order: 0, is_active: true, group_id: null, parent_id: parentId };
  }
  const rows = () => [category('c1', 'Bakery'), category('c2', 'Bread', 'c1'), category('c3', 'Dairy'), category('c4', 'Cakes', 'c1')];
  const routes = () => ({
    'GET /admin/categories': () => ok({ categories: rows() }),
    'GET /admin/category-groups': () => ok(overview()),
    'PATCH /admin/categories/:id': () => ok({ category: category('c9', 'x') }),
    'POST /admin/categories': () => ok({ category: category('c9', 'x') }),
  });

  it('lists each child indented right under its parent with an "In Bakery" line', async () => {
    renderAs(ADMIN_WITH_RIDER, '/catalog/categories', routes());
    await screen.findByText('Dairy');
    const items = screen.getAllByRole('listitem').filter((li) => li.classList.contains('cat-row'));
    expect(items.map((li) => li.querySelector('.cat-row__title')!.textContent)).toEqual(['Bakery', 'Bread', 'Cakes', 'Dairy']);
    expect(items.map((li) => li.classList.contains('cat-row--child'))).toEqual([false, true, true, false]);
    expect(screen.getAllByText('In Bakery')).toHaveLength(2);
  });

  it('offers only top-level categories other than itself, and sends parent_id when it changes', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/categories', routes());
    await screen.findByText('Dairy');
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[3]); // Dairy
    const dialog = within(screen.getByRole('dialog', { name: 'Category' }));
    const select = dialog.getByLabelText(/^Inside category/);
    expect(select).toHaveValue('');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['None (top level)', 'Bakery']);
    await user.selectOptions(select, 'c1');
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/categories/c3')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/categories/c3')[0].body).toMatchObject({ parent_id: 'c1' });
  });

  it('None clears the parent; unchanged leaves parent_id out', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/categories', routes());
    await screen.findByText('Dairy');
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[1]); // Bread
    let dialog = within(screen.getByRole('dialog', { name: 'Category' }));
    expect(dialog.getByLabelText(/^Inside category/)).toHaveValue('c1');
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/categories/c2')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/categories/c2')[0].body).not.toHaveProperty('parent_id');

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[1]);
    dialog = within(screen.getByRole('dialog', { name: 'Category' }));
    await user.selectOptions(dialog.getByLabelText(/^Inside category/), '');
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/categories/c2')).toHaveLength(2));
    expect(api.find('PATCH', '/admin/categories/c2')[1].body).toMatchObject({ parent_id: null });
  });

  it('keeps a category with sub-categories top level, and creates a child', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/catalog/categories', routes());
    await screen.findByText('Dairy');
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]); // Bakery
    let dialog = within(screen.getByRole('dialog', { name: 'Category' }));
    expect(dialog.getByLabelText(/^Inside category/)).toBeDisabled();
    await user.click(dialog.getByRole('button', { name: 'Cancel' }));

    await user.click(screen.getByRole('button', { name: 'Add category' }));
    dialog = within(screen.getByRole('dialog', { name: 'Category' }));
    await user.type(dialog.getByLabelText('Name'), 'Buns');
    await user.selectOptions(dialog.getByLabelText(/^Inside category/), 'c1');
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('POST', '/admin/categories')).toHaveLength(1));
    expect(api.find('POST', '/admin/categories')[0].body).toMatchObject({ name: 'Buns', parent_id: 'c1' });
  });
});

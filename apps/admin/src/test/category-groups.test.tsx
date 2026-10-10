import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { CategoryGroups } from '../pages/CategoryGroups';
import { Categories } from '../pages/Categories';
import { tokenStore } from '../api/client';
import type { CategoryGroup, GroupCategory } from '../api/types';

/**
 * Category groups (the titled rows of category tiles on the customer Home)
 * against a fake API shaped like /admin/category-groups, plus the category
 * form's Group select.
 */
type Call = { method: string; path: string; body: any };
type Reply = { status?: number; data?: unknown; error?: { code: string; message: string; details?: unknown } };

function mockApi(handler: (call: Call) => Reply | undefined) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const call = {
        method: (init?.method ?? 'GET').toUpperCase(),
        path: url.pathname.replace(/^.*\/api\/v1/, ''),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      };
      calls.push(call);
      const reply = handler(call) ?? { status: 404, error: { code: 'NOT_MOCKED', message: 'NOT_MOCKED' } };
      const status = reply.status ?? 200;
      const body = status < 400 ? { success: true, data: reply.data } : { success: false, error: reply.error };
      return { ok: status < 400, status, text: async () => JSON.stringify(body) } as Response;
    })
  );
  return { calls, find: (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path) };
}

const renderPage = (ui: React.ReactElement) =>
  render(
    <MemoryRouter>
      <ToastProvider>{ui}</ToastProvider>
    </MemoryRouter>
  );

function cat(id: string, name: string, groupId: string | null, order = 0): GroupCategory {
  return { id, name, slug: name.toLowerCase(), image_url: null, is_active: true, group_id: groupId, group_sort_order: order };
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

const overview = () => ({
  groups: [
    group('g1', 'Grocery', [cat('c1', 'Vegetables', 'g1', 0), cat('c2', 'Dairy', 'g1', 1)]),
    group('g2', 'Snacks', [cat('c3', 'Chips', 'g2', 0)], { sort_order: 1 }),
  ],
  unassigned: [cat('c4', 'Bakery', null)],
});

/** The overview for GETs; `extra` answers everything else. */
function groupsApi(extra: (call: Call) => Reply | undefined = () => undefined) {
  return mockApi((c) => {
    if (c.method === 'GET' && c.path === '/admin/category-groups') return { data: overview() };
    return extra(c);
  });
}

beforeEach(() => tokenStore.save('access', 'refresh'));
afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

describe('category groups page', () => {
  it('lists groups in order with their categories, and the unassigned ones', async () => {
    groupsApi();
    renderPage(<CategoryGroups />);

    await screen.findByRole('button', { name: 'Move Grocery up' });
    const panels = screen.getAllByRole('region').filter((r) => r.classList.contains('group-panel'));
    expect(panels.map((p) => p.getAttribute('aria-label'))).toEqual(['Grocery', 'Snacks']);
    const grocery = screen.getByRole('region', { name: 'Grocery' });
    expect(within(grocery).getByText('Vegetables')).toBeInTheDocument();
    expect(within(grocery).getByText('2 categories')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Unassigned categories' })).getByText('Bakery')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move Grocery up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Snacks down' })).toBeDisabled();
  });

  it('moving a group up sends the full new order', async () => {
    const user = userEvent.setup();
    const api = groupsApi((c) => (c.method === 'PUT' && c.path === '/admin/category-groups/order' ? { data: { groups: [] } } : undefined));
    renderPage(<CategoryGroups />);
    await user.click(await screen.findByRole('button', { name: 'Move Snacks up' }));
    await waitFor(() => expect(api.find('PUT', '/admin/category-groups/order')).toHaveLength(1));
    expect(api.find('PUT', '/admin/category-groups/order')[0]!.body).toEqual({ group_ids: ['g2', 'g1'] });
  });

  it('creates a group with the trimmed name', async () => {
    const user = userEvent.setup();
    const api = groupsApi((c) =>
      c.method === 'POST' && c.path === '/admin/category-groups' ? { status: 201, data: { group: group('g3', 'Household', []) } } : undefined
    );
    renderPage(<CategoryGroups />);
    await user.click(await screen.findByRole('button', { name: 'Add group' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Category group' }));
    await user.type(dialog.getByLabelText('Name'), '  Household ');
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('POST', '/admin/category-groups')).toHaveLength(1));
    expect(api.find('POST', '/admin/category-groups')[0]!.body).toEqual({ name: 'Household', is_active: true });
    expect(await screen.findByText('Household added.')).toBeInTheDocument();
  });

  it('keeps the dialog open with the duplicate-name refusal', async () => {
    const user = userEvent.setup();
    groupsApi((c) =>
      c.method === 'POST'
        ? { status: 409, error: { code: 'CATEGORY_GROUP_NAME_EXISTS', message: 'A group with this name already exists.' } }
        : undefined
    );
    renderPage(<CategoryGroups />);
    await user.click(await screen.findByRole('button', { name: 'Add group' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Category group' }));
    await user.type(dialog.getByLabelText('Name'), 'grocery');
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    expect(await dialog.findByText('A group with this name already exists.')).toBeInTheDocument();
  });

  it('renames a group', async () => {
    const user = userEvent.setup();
    const api = groupsApi((c) => (c.method === 'PATCH' ? { data: { group: group('g1', 'Grocery & Kitchen', []) } } : undefined));
    renderPage(<CategoryGroups />);
    await user.click(await screen.findByRole('button', { name: 'Rename Grocery' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Category group' }));
    const input = dialog.getByLabelText('Name');
    await user.clear(input);
    await user.type(input, 'Grocery & Kitchen');
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/category-groups/g1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/category-groups/g1')[0]!.body).toEqual({ name: 'Grocery & Kitchen', is_active: true });
  });

  it('deactivates a group', async () => {
    const user = userEvent.setup();
    const api = groupsApi((c) => (c.method === 'PATCH' ? { data: { group: group('g2', 'Snacks', [], { is_active: false }) } } : undefined));
    renderPage(<CategoryGroups />);
    await user.click(await screen.findByRole('button', { name: 'Deactivate Snacks' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/category-groups/g2')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/category-groups/g2')[0]!.body).toEqual({ is_active: false });
    expect(await screen.findByText('Snacks is now inactive.')).toBeInTheDocument();
  });

  it('deletes a group only after confirming', async () => {
    const user = userEvent.setup();
    const api = groupsApi((c) =>
      c.method === 'DELETE' && c.path === '/admin/category-groups/g1'
        ? { data: { group_id: 'g1', released_category_count: 2 } }
        : undefined
    );
    renderPage(<CategoryGroups />);
    await user.click(await screen.findByRole('button', { name: 'Delete Grocery' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete group' });
    expect(dialog).toHaveTextContent('Delete Grocery? Its categories stay, but become unassigned.');
    expect(api.find('DELETE', '/admin/category-groups/g1')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.find('DELETE', '/admin/category-groups/g1')).toHaveLength(1));
    expect(await screen.findByText('Grocery is deleted. 2 categories are now unassigned.')).toBeInTheDocument();
  });

  it('cancelling the delete sends nothing', async () => {
    const user = userEvent.setup();
    const api = groupsApi();
    renderPage(<CategoryGroups />);
    await user.click(await screen.findByRole('button', { name: 'Delete Snacks' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Delete group' })).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
  });

  it('has no order control for categories inside a group: order follows Categories → Arrange (owner, 2026-10-10)', async () => {
    groupsApi();
    renderPage(<CategoryGroups />);
    await screen.findByRole('button', { name: 'Move Grocery up' });
    // Groups still move among themselves; their categories don't.
    expect(screen.queryByRole('button', { name: /^Move Vegetables (up|down) in Grocery$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Move Dairy (up|down) in Grocery$/ })).toBeNull();
    // Membership editing stays.
    expect(screen.getByRole('button', { name: 'Remove Dairy from Grocery' })).toBeInTheDocument();
    const note = screen.getByRole('note');
    expect(note).toHaveTextContent('Order follows Categories → Arrange');
    expect(within(note).getByRole('link', { name: 'arrange them there' })).toHaveAttribute('href', '/categories');
  });

  it('removes a category from a group', async () => {
    const user = userEvent.setup();
    const api = groupsApi((c) => (c.method === 'PUT' ? { data: { group: group('g1', 'Grocery', []) } } : undefined));
    renderPage(<CategoryGroups />);
    await user.click(await screen.findByRole('button', { name: 'Remove Dairy from Grocery' }));
    await waitFor(() => expect(api.find('PUT', '/admin/category-groups/g1/categories')).toHaveLength(1));
    expect(api.find('PUT', '/admin/category-groups/g1/categories')[0]!.body).toEqual({ category_ids: ['c1'] });
    expect(await screen.findByText('Dairy removed from Grocery.')).toBeInTheDocument();
  });

  it("adds an unassigned category to the end of a group from the group's picker", async () => {
    const user = userEvent.setup();
    const api = groupsApi((c) => (c.method === 'PUT' ? { data: { group: group('g1', 'Grocery', []) } } : undefined));
    renderPage(<CategoryGroups />);
    await user.selectOptions(await screen.findByLabelText('Add a category to Grocery'), 'c4');
    await user.click(screen.getByRole('button', { name: 'Add to Grocery' }));
    await waitFor(() => expect(api.find('PUT', '/admin/category-groups/g1/categories')).toHaveLength(1));
    expect(api.find('PUT', '/admin/category-groups/g1/categories')[0]!.body).toEqual({ category_ids: ['c1', 'c2', 'c4'] });
  });

  it('adds an unassigned category to a chosen group from its row', async () => {
    const user = userEvent.setup();
    const api = groupsApi((c) => (c.method === 'PUT' ? { data: { group: group('g2', 'Snacks', []) } } : undefined));
    renderPage(<CategoryGroups />);
    const add = await screen.findByRole('button', { name: 'Add Bakery to group' });
    expect(add).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Group for Bakery'), 'g2');
    await user.click(add);
    await waitFor(() => expect(api.find('PUT', '/admin/category-groups/g2/categories')).toHaveLength(1));
    expect(api.find('PUT', '/admin/category-groups/g2/categories')[0]!.body).toEqual({ category_ids: ['c3', 'c4'] });
    expect(await screen.findByText('Bakery added to Snacks.')).toBeInTheDocument();
  });

  it('shows a refused change', async () => {
    const user = userEvent.setup();
    groupsApi((c) =>
      c.method === 'PUT' ? { status: 400, error: { code: 'INVALID_GROUP_ORDER', message: 'The order must list every group once.' } } : undefined
    );
    renderPage(<CategoryGroups />);
    await user.click(await screen.findByRole('button', { name: 'Move Grocery down' }));
    expect(await screen.findByText('The order must list every group once.')).toBeInTheDocument();
  });
});

describe('category form Group select', () => {
  const category = (groupId: string | null) => ({
    id: 'c9',
    name: 'Frozen',
    slug: 'frozen',
    description: null,
    image_url: null,
    display_order: 0,
    is_active: true,
    product_count: 0,
    group_id: groupId,
  });

  function api(groupId: string | null) {
    return groupsApi((c) => {
      if (c.method === 'GET' && c.path === '/admin/categories') return { data: { categories: [category(groupId)] } };
      if (c.method === 'PATCH' || c.method === 'POST') return { data: { category: category(groupId) } };
    });
  }

  it('sends the chosen group_id on save', async () => {
    const user = userEvent.setup();
    const calls = api(null);
    renderPage(<Categories />);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Category' }));
    const select = dialog.getByLabelText('Group');
    await waitFor(() => expect(within(select).getByRole('option', { name: 'Snacks' })).toBeInTheDocument());
    await user.selectOptions(select, 'g2');
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find('PATCH', '/admin/categories/c9')).toHaveLength(1));
    expect(calls.find('PATCH', '/admin/categories/c9')[0]!.body).toMatchObject({ group_id: 'g2' });
  });

  it('sends null for None, and leaves group_id out when unchanged', async () => {
    const user = userEvent.setup();
    const calls = api('g1');
    renderPage(<Categories />);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    let dialog = within(screen.getByRole('dialog', { name: 'Category' }));
    await waitFor(() => expect(dialog.getByLabelText('Group')).toHaveValue('g1'));
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find('PATCH', '/admin/categories/c9')).toHaveLength(1));
    expect(calls.find('PATCH', '/admin/categories/c9')[0]!.body).not.toHaveProperty('group_id');

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    dialog = within(screen.getByRole('dialog', { name: 'Category' }));
    await user.selectOptions(dialog.getByLabelText('Group'), '');
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find('PATCH', '/admin/categories/c9')).toHaveLength(2));
    expect(calls.find('PATCH', '/admin/categories/c9')[1]!.body).toMatchObject({ group_id: null });
  });

  it('includes group_id when creating a category', async () => {
    const user = userEvent.setup();
    const calls = api(null);
    renderPage(<Categories />);
    await user.click(await screen.findByRole('button', { name: 'Add category' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Category' }));
    await user.type(dialog.getByLabelText('Name'), 'Ice cream');
    await waitFor(() => expect(within(dialog.getByLabelText('Group')).getByRole('option', { name: 'Grocery' })).toBeInTheDocument());
    await user.selectOptions(dialog.getByLabelText('Group'), 'g1');
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find('POST', '/admin/categories')).toHaveLength(1));
    expect(calls.find('POST', '/admin/categories')[0]!.body).toMatchObject({ name: 'Ice cream', group_id: 'g1' });
  });
});

describe('category form Inside category select (sub-categories)', () => {
  const row = (id: string, name: string, parentId: string | null = null) => ({
    id,
    name,
    slug: name.toLowerCase(),
    description: null,
    image_url: null,
    display_order: 0,
    is_active: true,
    product_count: 0,
    group_id: null,
    parent_id: parentId,
  });
  const rows = () => [row('c1', 'Bakery'), row('c2', 'Bread', 'c1'), row('c3', 'Dairy'), row('c4', 'Cakes', 'c1')];

  function api() {
    return groupsApi((c) => {
      if (c.method === 'GET' && c.path === '/admin/categories') return { data: { categories: rows() } };
      if (c.method === 'PATCH' || c.method === 'POST') return { data: { category: row('c9', 'x') } };
    });
  }

  it('lists each child right under its parent with an "in Bakery" note', async () => {
    api();
    renderPage(<Categories />);
    await screen.findByText('Dairy');
    const names = screen.getAllByRole('row').slice(1).map((r) => r.querySelector('td')!.textContent);
    expect(names).toEqual(['Bakery', '↳ Bread in Bakery', '↳ Cakes in Bakery', 'Dairy']);
    expect(screen.getAllByText('in Bakery')).toHaveLength(2);
  });

  it('offers only top-level categories other than itself, and sends parent_id when it changes', async () => {
    const user = userEvent.setup();
    const calls = api();
    renderPage(<Categories />);
    await screen.findByText('Dairy');
    // Edit Dairy (the 4th row).
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[3]!);
    const dialog = within(screen.getByRole('dialog', { name: 'Category' }));
    const select = dialog.getByLabelText(/^Inside category/);
    expect(select).toHaveValue('');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['None (top level)', 'Bakery']);
    await user.selectOptions(select, 'c1');
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find('PATCH', '/admin/categories/c3')).toHaveLength(1));
    expect(calls.find('PATCH', '/admin/categories/c3')[0]!.body).toMatchObject({ parent_id: 'c1' });
  });

  it('None clears the parent; unchanged leaves parent_id out', async () => {
    const user = userEvent.setup();
    const calls = api();
    renderPage(<Categories />);
    await screen.findByText('Dairy');
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[1]!); // Bread
    let dialog = within(screen.getByRole('dialog', { name: 'Category' }));
    expect(dialog.getByLabelText(/^Inside category/)).toHaveValue('c1');
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find('PATCH', '/admin/categories/c2')).toHaveLength(1));
    expect(calls.find('PATCH', '/admin/categories/c2')[0]!.body).not.toHaveProperty('parent_id');

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[1]!);
    dialog = within(screen.getByRole('dialog', { name: 'Category' }));
    await user.selectOptions(dialog.getByLabelText(/^Inside category/), '');
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find('PATCH', '/admin/categories/c2')).toHaveLength(2));
    expect(calls.find('PATCH', '/admin/categories/c2')[1]!.body).toMatchObject({ parent_id: null });
  });

  it('"+ Add sidebar item" shows only on top-level rows, with its hint (owner, 2026-10-10)', async () => {
    api();
    renderPage(<Categories />);
    await screen.findByText('Dairy');
    const buttons = screen.getAllByRole('button', { name: /^\+ Add sidebar item to / });
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['+ Add sidebar item to Bakery', '+ Add sidebar item to Dairy']);
    expect(buttons[0]).toHaveTextContent('+ Add sidebar item');
    expect(buttons[0]).toHaveAttribute('title', "Shows in this category's left sidebar in the app");
    expect(screen.queryByRole('button', { name: '+ Add sidebar item to Bread' })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Add sidebar item to Cakes' })).toBeNull();
  });

  it('"+ Add sidebar item" opens Add category with Inside category preselected and sends parent_id', async () => {
    const user = userEvent.setup();
    const calls = api();
    renderPage(<Categories />);
    await user.click(await screen.findByRole('button', { name: '+ Add sidebar item to Bakery' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Category' }));
    expect(dialog.getByRole('heading', { name: 'Add sidebar item to Bakery' })).toBeInTheDocument();
    expect(dialog.getByLabelText(/^Inside category/)).toHaveValue('c1');
    await user.type(dialog.getByLabelText('Name'), 'Buns');
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find('POST', '/admin/categories')).toHaveLength(1));
    expect(calls.find('POST', '/admin/categories')[0]!.body).toMatchObject({ name: 'Buns', parent_id: 'c1' });

    // The plain "Add category" afterwards starts at top level again.
    await user.click(screen.getByRole('button', { name: 'Add category' }));
    const plain = within(screen.getByRole('dialog', { name: 'Category' }));
    expect(plain.getByRole('heading', { name: 'Add category' })).toBeInTheDocument();
    expect(plain.getByLabelText(/^Inside category/)).toHaveValue('');
  });

  it('keeps a category with sub-categories top level, and creates a child', async () => {
    const user = userEvent.setup();
    const calls = api();
    renderPage(<Categories />);
    await screen.findByText('Dairy');
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]!); // Bakery
    let dialog = within(screen.getByRole('dialog', { name: 'Category' }));
    expect(dialog.getByLabelText(/^Inside category/)).toBeDisabled();
    await user.click(dialog.getByRole('button', { name: 'Cancel' }));

    await user.click(screen.getByRole('button', { name: 'Add category' }));
    dialog = within(screen.getByRole('dialog', { name: 'Category' }));
    await user.type(dialog.getByLabelText('Name'), 'Buns');
    await user.selectOptions(dialog.getByLabelText(/^Inside category/), 'c1');
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find('POST', '/admin/categories')).toHaveLength(1));
    expect(calls.find('POST', '/admin/categories')[0]!.body).toMatchObject({ name: 'Buns', parent_id: 'c1' });
  });
});

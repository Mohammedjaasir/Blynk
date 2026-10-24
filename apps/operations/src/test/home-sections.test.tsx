import { cleanup, configure, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import {
  blankDraft,
  countdownText,
  fromLocalInput,
  moveItem,
  scheduleText,
  sectionProblem,
  sectionStatus,
  sectionsPayload,
  toLocalInput,
  type HomeSectionView,
} from '../lib/homeSections';
import { OPERATIONS_STAFF, ok, renderAs } from './helpers';

/**
 * Home sections (owner's brother, 2026-10-24): Catalog -> Home sections, the staff-made product
 * rails on the app's Home. The API contract is tested against PostgreSQL in
 * backend/api/tests/home-sections.test.ts.
 */
configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const base = { subtitle: null, is_active: true, starts_at: null, ends_at: null, show_countdown: false, max_items: 8, products: [] as { id: string; name: string }[] };
const SNACKS: HomeSectionView = { ...base, id: 's-snacks', title: 'Snacks', source: { kind: 'CATEGORY', category_id: 'c-snacks' }, status: 'LIVE', source_name: 'Snacks aisle' };
const WEEKEND: HomeSectionView = {
  ...base,
  id: 's-weekend',
  title: 'Weekend offers',
  source: { kind: 'PRODUCTS', product_ids: ['p-1', 'p-2'] },
  status: 'LIVE',
  source_name: '2 products',
  products: [
    { id: 'p-1', name: 'Mango juice' },
    { id: 'p-2', name: 'Cola' },
  ],
};

describe('home sections rules (same as the API)', () => {
  it('moves an item up or down and stops at the ends', () => {
    expect(moveItem(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });

  it('reads schedules in Sri Lanka time whatever the browser zone is', () => {
    expect(toLocalInput('2026-10-24T18:00:00+05:30')).toBe('2026-10-24T18:00');
    expect(toLocalInput('2026-10-24T12:30:00Z')).toBe('2026-10-24T18:00');
    expect(fromLocalInput('2026-10-24T18:00')).toBe('2026-10-24T18:00:00+05:30');
    expect(fromLocalInput('')).toBeNull();
    expect(toLocalInput(null)).toBe('');
  });

  it('works out the status like the API', () => {
    const at = new Date('2026-10-24T12:00:00+05:30');
    const s = { is_active: true, starts_at: null, ends_at: null };
    expect(sectionStatus(s, at)).toBe('LIVE');
    expect(sectionStatus({ ...s, is_active: false }, at)).toBe('OFF');
    expect(sectionStatus({ ...s, starts_at: '2026-10-24T13:00:00+05:30' }, at)).toBe('SCHEDULED');
    expect(sectionStatus({ ...s, ends_at: '2026-10-24T12:00:00+05:30' }, at)).toBe('ENDED');
  });

  it('writes the countdown as the app does', () => {
    const at = new Date('2026-10-24T12:00:00+05:30');
    expect(countdownText('2026-10-24T14:14:09+05:30', at)).toBe('Ends in 02:14:09');
    expect(countdownText('2026-10-26T16:10:30+05:30', at)).toBe('Ends in 2d 04:10');
    expect(countdownText('2026-10-24T12:00:00+05:30', at)).toBe('');
    expect(scheduleText({ starts_at: null, ends_at: '2026-10-24T18:00:00+05:30' })).toBe('Until 24 Oct, 6 pm');
  });

  it('names what is wrong with a section', () => {
    expect(sectionProblem(SNACKS)).toBeNull();
    expect(sectionProblem({ ...SNACKS, title: 'A' })).toMatch(/title/);
    expect(sectionProblem({ ...SNACKS, source: { kind: 'PRODUCTS', product_ids: [] } })).toMatch(/at least one product/);
    expect(sectionProblem({ ...SNACKS, show_countdown: true })).toMatch(/needs an end time/);
    expect(sectionProblem({ ...SNACKS, starts_at: '2026-10-24T18:00:00+05:30', ends_at: '2026-10-24T09:00:00+05:30' })).toMatch(/after the start/);
  });

  it('sends only what the API knows: no id for a new section, no countdown without an end', () => {
    const blank = { ...blankDraft(), title: ' Juices ', source: { kind: 'CATEGORY' as const, category_id: 'c-1' }, show_countdown: true };
    const { sections } = sectionsPayload([SNACKS, blank]);
    expect(sections[0]).toMatchObject({ id: 's-snacks', title: 'Snacks' });
    expect(sections[1]).toEqual({ title: 'Juices', subtitle: null, source: { kind: 'CATEGORY', category_id: 'c-1' }, is_active: true, starts_at: null, ends_at: null, show_countdown: false, max_items: 8 });
  });
});

describe('Catalog -> Home sections (Blynk Ops)', () => {
  const mocks = (state: { saved: any[] | null }, list: HomeSectionView[] = [SNACKS, WEEKEND]) => ({
    'GET /admin/settings/home-sections': () => ok({ sections: list, updated_at: null }),
    'PUT /admin/settings/home-sections': (call: { body: { sections: any[] } }) => {
      state.saved = call.body.sections;
      return ok({ sections: [], updated_at: '2026-10-24T10:00:00Z' });
    },
    'GET /admin/categories': () =>
      ok({
        categories: [
          { id: 'c-snacks', name: 'Snacks aisle', slug: 'snacks', is_active: true, display_order: 1, parent_id: null },
          { id: 'c-juice', name: 'Juices', slug: 'juices', is_active: true, display_order: 2, parent_id: null },
        ],
      }),
    'GET /admin/products': () => ok({ products: [{ id: 'p-3', name: 'Lime soda', sku: 'LS1', unit: '1 L', is_active: true }], pagination: {} }),
    'GET /admin/category-groups': () => ok({ groups: [], ungrouped: [] }),
  });

  it('lists the sections in order, reorders with Up and Down, and saves with PUT', async () => {
    const user = userEvent.setup();
    const state = { saved: null as any[] | null };
    renderAs(OPERATIONS_STAFF, '/catalog/home-sections', mocks(state));
    expect(await screen.findByText('Snacks')).toBeInTheDocument();
    expect(screen.getAllByText('Live now')).toHaveLength(2);
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Snacks up' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Move Weekend offers up' }));
    const rows = screen.getAllByTestId('home-section-row');
    expect(rows[0]).toHaveTextContent('Weekend offers');
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(state.saved?.map((s) => s.id)).toEqual(['s-weekend', 's-snacks']));
    expect(await screen.findByText('Home sections saved.')).toBeInTheDocument();
  });

  it('adds a category section with an end time and a countdown', async () => {
    const user = userEvent.setup();
    const state = { saved: null as any[] | null };
    renderAs(OPERATIONS_STAFF, '/catalog/home-sections', mocks(state, []));
    expect(await screen.findByText(/No sections yet/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add a section' }));

    // the whole Ops shell re-renders per keystroke: set the values directly
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Fresh juices' } });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'c-juice' } });
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2099-10-24T18:00' } });
    await user.click(screen.getByRole('switch', { name: 'Show a countdown to the end' }));
    expect(screen.getByTestId('preview-countdown')).toHaveTextContent(/^Ends in \d+d \d\d:\d\d$/);

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(state.saved).toEqual([
        {
          title: 'Fresh juices',
          subtitle: null,
          source: { kind: 'CATEGORY', category_id: 'c-juice' },
          is_active: true,
          starts_at: null,
          ends_at: '2099-10-24T18:00:00+05:30',
          show_countdown: true,
          max_items: 8,
        },
      ])
    );
  });

  it('picks products in order and removes one', async () => {
    const user = userEvent.setup();
    const state = { saved: null as any[] | null };
    renderAs(OPERATIONS_STAFF, '/catalog/home-sections', mocks(state, [WEEKEND]));
    await screen.findByText('Weekend offers');
    await user.click(screen.getByRole('button', { name: 'Edit Weekend offers' }));
    expect(screen.getAllByTestId('picked-product')).toHaveLength(2);

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'lime' } });
    await user.click(await screen.findByRole('button', { name: 'Choose Lime soda' }));
    expect(screen.getAllByTestId('picked-product')).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: 'Remove Cola from the section' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(state.saved?.[0].source).toEqual({ kind: 'PRODUCTS', product_ids: ['p-1', 'p-3'] }));
  });

  it('the Catalog hub links to it', async () => {
    renderAs(OPERATIONS_STAFF, '/catalog', mocks({ saved: null }));
    const card = await screen.findByRole('link', { name: /Home sections/ });
    expect(card).toHaveAttribute('href', '/catalog/home-sections');
  });
});

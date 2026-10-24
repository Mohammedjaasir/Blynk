import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { HomeSections } from '../pages/HomeSections';
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
import { mockApi, ok, type Call } from './mockApi';

/**
 * Home sections (owner's brother, 2026-10-24): the page that adds product rails to the app's Home.
 * The API contract is tested against PostgreSQL in backend/api/tests/home-sections.test.ts.
 */
vi.setConfig({ testTimeout: 20_000 });

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
    expect(countdownText(null, at)).toBe('');
  });

  it('describes a schedule in words', () => {
    expect(scheduleText({ starts_at: null, ends_at: null })).toMatch(/always on/);
    expect(scheduleText({ starts_at: null, ends_at: '2026-10-24T18:00:00+05:30' })).toBe('Until 24 Oct, 6 pm');
    expect(scheduleText({ starts_at: '2026-10-24T09:30:00+05:30', ends_at: '2026-10-24T18:00:00+05:30' })).toBe('24 Oct, 9:30 am to 24 Oct, 6 pm');
  });

  it('names what is wrong with a section', () => {
    const ok1 = { ...SNACKS };
    expect(sectionProblem(ok1)).toBeNull();
    expect(sectionProblem({ ...ok1, title: 'A' })).toMatch(/title/);
    expect(sectionProblem({ ...ok1, title: 'x'.repeat(29) })).toMatch(/at most 28/);
    expect(sectionProblem({ ...ok1, source: { kind: 'CATEGORY', category_id: '' } })).toMatch(/choose a category/);
    expect(sectionProblem({ ...ok1, source: { kind: 'PRODUCTS', product_ids: [] } })).toMatch(/at least one product/);
    expect(sectionProblem({ ...ok1, show_countdown: true })).toMatch(/needs an end time/);
    expect(sectionProblem({ ...ok1, starts_at: '2026-10-24T18:00:00+05:30', ends_at: '2026-10-24T09:00:00+05:30' })).toMatch(/after the start/);
    expect(sectionProblem({ ...ok1, max_items: 3 })).toMatch(/between 4 and 12/);
  });

  it('sends only what the API knows: no id for a new section, no countdown without an end', () => {
    const blank = { ...blankDraft(), title: ' Juices ', source: { kind: 'CATEGORY' as const, category_id: 'c-1' }, show_countdown: true };
    expect(sectionsPayload([SNACKS, blank])).toEqual({
      sections: [
        { id: 's-snacks', title: 'Snacks', subtitle: null, source: { kind: 'CATEGORY', category_id: 'c-snacks' }, is_active: true, starts_at: null, ends_at: null, show_countdown: false, max_items: 8 },
        { title: 'Juices', subtitle: null, source: { kind: 'CATEGORY', category_id: 'c-1' }, is_active: true, starts_at: null, ends_at: null, show_countdown: false, max_items: 8 },
      ],
    });
  });
});

describe('Home sections page', () => {
  beforeEach(() => tokenStore.save('access', 'refresh'));
  afterEach(() => {
    tokenStore.clear();
    vi.unstubAllGlobals();
  });

  const handler = (state: { saved: any[] | null }, list: HomeSectionView[] = [SNACKS, WEEKEND]) => (c: Call) => {
    if (c.method === 'GET' && c.path === '/admin/settings/home-sections') return ok({ sections: list, updated_at: null });
    if (c.method === 'PUT' && c.path === '/admin/settings/home-sections') {
      state.saved = c.body.sections;
      return ok({ sections: [], updated_at: '2026-10-24T10:00:00Z' });
    }
    if (c.method === 'GET' && c.path === '/admin/categories') {
      return ok({
        categories: [
          { id: 'c-snacks', name: 'Snacks aisle', slug: 'snacks', is_active: true, display_order: 1, parent_id: null },
          { id: 'c-juice', name: 'Juices', slug: 'juices', is_active: true, display_order: 2, parent_id: null },
        ],
      });
    }
    if (c.method === 'GET' && c.path === '/admin/products') {
      return ok({ products: [{ id: 'p-3', name: 'Lime soda', category_name: 'Juices', is_active: true }] });
    }
    return undefined;
  };

  const renderPage = () =>
    render(
      <MemoryRouter>
        <ToastProvider>
          <HomeSections />
        </ToastProvider>
      </MemoryRouter>
    );

  it('lists the sections in order with their status, and reorders with the Up and Down buttons, then saves with PUT', async () => {
    const user = userEvent.setup();
    const state = { saved: null as any[] | null };
    mockApi(handler(state));
    renderPage();
    expect(await screen.findByText('Snacks')).toBeInTheDocument();
    expect(screen.getAllByText('Live now')).toHaveLength(2);
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Snacks up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Weekend offers down' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Move Weekend offers up' }));
    const rows = screen.getAllByTestId('home-section-row');
    expect(rows[0]).toHaveTextContent('Weekend offers');
    expect(rows[1]).toHaveTextContent('Snacks');
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(state.saved?.map((s) => s.id)).toEqual(['s-weekend', 's-snacks']));
    expect(state.saved?.[0].source).toEqual({ kind: 'PRODUCTS', product_ids: ['p-1', 'p-2'] });
  });

  it('adds a category section with a schedule and a countdown, with a live preview', async () => {
    const user = userEvent.setup();
    const state = { saved: null as any[] | null };
    mockApi(handler(state, []));
    renderPage();
    expect(await screen.findByText(/No sections yet/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add a section' }));

    expect(screen.getByRole('alert')).toHaveTextContent(/title/);
    await user.type(screen.getByLabelText('Title'), 'Fresh juices');
    await user.type(screen.getByLabelText('Subtitle'), 'Cold until 6 pm');
    await user.selectOptions(screen.getByLabelText('Category'), 'c-juice');
    expect(screen.getByTestId('preview-title')).toHaveTextContent('Fresh juices');

    const ends = screen.getByLabelText('Ends');
    await user.click(screen.getByRole('switch', { name: 'Show a countdown to the end' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/needs an end time/);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.type(ends, '2099-10-24T18:00');
    expect(screen.getByTestId('preview-countdown')).toHaveTextContent(/^Ends in \d+d \d\d:\d\d$/);

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(state.saved).toEqual([
        {
          title: 'Fresh juices',
          subtitle: 'Cold until 6 pm',
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

  it('picks products for a section, keeps their order and removes one', async () => {
    const user = userEvent.setup();
    const state = { saved: null as any[] | null };
    mockApi(handler(state, [WEEKEND]));
    renderPage();
    await screen.findByText('Weekend offers');
    await user.click(screen.getByRole('button', { name: 'Edit Weekend offers' }));
    expect(screen.getAllByTestId('picked-product')).toHaveLength(2);

    await user.type(screen.getByLabelText('Search products'), 'lime');
    await user.click(await screen.findByRole('button', { name: /Lime soda/ }));
    expect(screen.getAllByTestId('picked-product')).toHaveLength(3);

    await user.click(screen.getByRole('button', { name: 'Move Lime soda up' }));
    await user.click(screen.getByRole('button', { name: 'Remove Cola from the section' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(state.saved?.[0].source).toEqual({ kind: 'PRODUCTS', product_ids: ['p-1', 'p-3'] }));
  });

  it('removes a section', async () => {
    const user = userEvent.setup();
    const state = { saved: null as any[] | null };
    mockApi(handler(state));
    renderPage();
    await screen.findByText('Snacks');
    await user.click(screen.getByRole('button', { name: 'Remove Snacks' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(state.saved?.map((s) => s.id)).toEqual(['s-weekend']));
  });
});

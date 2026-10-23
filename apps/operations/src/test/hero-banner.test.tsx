import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { HeroBannerSetting } from '../api/types';
import { HeroView } from '../components/HeroBannerPreview';
import { DEFAULT_HERO, heroPreviewModel } from '../lib/heroBanner';
import { OPERATIONS_STAFF, fail, ok, renderAs } from './helpers';

/**
 * Catalog -> Home banner (the purple hero banner at the top of the customer
 * app's Home), with its live preview. The API contract is tested against
 * PostgreSQL in backend/api/tests/hero-banner.test.ts; look and timings follow
 * docs/promo-surfaces.md §3.
 */

configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const stored = (over: Partial<HeroBannerSetting> = {}): HeroBannerSetting => ({
  ...DEFAULT_HERO,
  cta_target: null,
  status: 'AUTO',
  updated_at: null,
  ...over,
});

const catalogMocks = {
  'GET /admin/categories': () =>
    ok({
      categories: [{ id: 'c1', name: 'Rice', slug: 'rice', is_active: true, display_order: 1, parent_id: null }],
    }),
  'GET /admin/category-groups': () => ok({ groups: [], ungrouped: [] }),
  // the live switches the "Automatic" preview follows (owner, 2026-10-14: points instead of free delivery)
  'GET /admin/settings/points': () => ok({ enabled: true, earn_points: 1, earn_per_lkr: 100 }),
  'GET /admin/settings/checkout': () => ok({ new_customer_free_deliveries: { enabled: false, count: 2 } }),
};

describe('Home banner editor (Blynk Ops)', () => {
  it('switches to custom, plays edits live and saves them', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/catalog/home-banner', {
      ...catalogMocks,
      'GET /admin/settings/hero-banner': () => ok(stored()),
      'PATCH /admin/settings/hero-banner': (call) =>
        ok(stored({ ...(call.body as object), status: 'LIVE', updated_at: '2026-10-14T08:00:00.000Z' })),
    });

    expect(await screen.findByRole('heading', { name: 'Home banner' })).toBeInTheDocument();
    expect(screen.getByTestId('hero-status')).toHaveTextContent('Automatic');
    expect(screen.getByTestId('hero-banner')).toHaveTextContent('EARN');
    expect(screen.getByTestId('hero-banner')).not.toHaveTextContent('FREE');

    await user.click(within(screen.getByRole('group', { name: 'Banner words' })).getByRole('button', { name: 'Custom' }));
    // the whole Ops shell re-renders per keystroke: set the values directly
    fireEvent.change(screen.getByLabelText('First word (white)'), { target: { value: 'Weekend' } });
    fireEvent.change(screen.getByLabelText('Second word (yellow)'), { target: { value: 'Deals' } });
    expect(screen.getByTestId('hero-banner')).toHaveTextContent('WEEKEND');
    expect(screen.getByTestId('hero-line')).toHaveTextContent('Quality groceries, delivered with care');
    fireEvent.change(screen.getByLabelText(/^Button text/), { target: { value: 'Shop deals' } });
    expect(screen.getByTestId('hero-cta')).toHaveTextContent('SHOP DEALS');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/hero-banner')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/hero-banner')[0]!.body).toEqual({
      ...DEFAULT_HERO,
      mode: 'CUSTOM',
      title_1: 'WEEKEND',
      title_2: 'DEALS',
      cta_label: 'SHOP DEALS',
    });
    expect(await screen.findByText('Home banner saved.')).toBeInTheDocument();
    expect(screen.getByTestId('hero-status')).toHaveTextContent('Custom - live in the app');
  });

  it('an API refusal is shown inline', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, '/catalog/home-banner', {
      ...catalogMocks,
      'GET /admin/settings/hero-banner': () => ok(stored({ mode: 'CUSTOM', status: 'LIVE' })),
      'PATCH /admin/settings/hero-banner': () => fail(403, 'FORBIDDEN', 'Forbidden'),
    });
    await user.click(await screen.findByRole('button', { name: 'Reset to automatic' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('the Catalog hub links to it with its state', async () => {
    renderAs(OPERATIONS_STAFF, '/catalog', {
      'GET /admin/settings/hero-banner': () => ok(stored({ mode: 'CUSTOM', status: 'LIVE' })),
    });
    const card = await screen.findByRole('link', { name: /Home banner/ });
    expect(card).toHaveAttribute('href', '/catalog/home-banner');
    await waitFor(() => expect(card).toHaveTextContent('Custom'));
  });
});

describe('hero banner preview (Blynk Ops)', () => {
  it('lifts the next item after 2.48 s', () => {
    vi.useFakeTimers();
    render(<HeroView model={heroPreviewModel({ ...DEFAULT_HERO, mode: 'CUSTOM', items: ['milk', 'egg'] })} reduced={false} paused={false} />);
    expect(screen.getByTestId('hero-item')).toHaveTextContent('🥛');
    act(() => vi.advanceTimersByTime(2480));
    expect(screen.getByTestId('hero-item')).toHaveTextContent('🥚');
  });
});

describe('more slides in the editor (owner, 2026-10-23)', () => {
  it('checks each extra slide and sends them trimmed, in capitals', async () => {
    const { DEFAULT_HERO, heroPayload, heroProblem } = await import('../lib/heroBanner');
    const base = { ...DEFAULT_HERO, mode: 'CUSTOM' as const };
    expect(heroProblem(base)).toBeNull();
    expect(heroProblem({ ...base, slides: [{ title_1: 'Fresh', title_2: '', line: '', item: null }] })).toMatch(/Slide 2: write both title words/);
    expect(heroProblem({ ...base, slides: [{ title_1: 'A'.repeat(13), title_2: 'B', line: '', item: null }] })).toMatch(/Slide 2: keep each title word/);
    expect(heroProblem({ ...base, slides: [{ title_1: 'A', title_2: 'B', line: 'Hi {nope}', item: null }] })).toMatch(/unknown token/);
    expect(heroProblem({ ...base, slides: Array.from({ length: 5 }, () => ({ title_1: 'A', title_2: 'B', line: '', item: null })) })).toMatch(/At most 4 more slides/);
    const ok = { ...base, slides: [{ title_1: ' fresh ', title_2: 'juices', line: ' Cold ', item: 'bottle' as const }] };
    expect(heroProblem(ok)).toBeNull();
    expect(heroPayload(ok).slides).toEqual([{ title_1: 'FRESH', title_2: 'JUICES', line: 'Cold', item: 'bottle' }]);
  });
});

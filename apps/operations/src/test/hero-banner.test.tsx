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
    expect(screen.getByTestId('hero-banner')).toHaveTextContent('FREE');

    await user.click(within(screen.getByRole('group', { name: 'Banner words' })).getByRole('button', { name: 'Custom' }));
    // the whole Ops shell re-renders per keystroke: set the values directly
    fireEvent.change(screen.getByLabelText('First word (white)'), { target: { value: 'Weekend' } });
    fireEvent.change(screen.getByLabelText('Second word (yellow)'), { target: { value: 'Deals' } });
    expect(screen.getByTestId('hero-banner')).toHaveTextContent('WEEKEND');
    expect(screen.getByTestId('hero-line')).toHaveTextContent('Groceries starting at LKR 253');
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

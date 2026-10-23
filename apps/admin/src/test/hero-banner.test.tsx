import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { HeroBanner } from '../pages/HeroBanner';
import { HeroView } from '../components/HeroBannerPreview';
import { tokenStore } from '../api/client';
import type { HeroBannerSetting } from '../api/types';
import { DEFAULT_HERO, fillTokens, heroPreviewModel, heroProblem, heroSampleFrom, heroStatus } from '../lib/heroBanner';
import { fail, mockApi, ok, type Call } from './mockApi';

/**
 * Home banner editor (the purple hero banner at the top of the customer app's
 * Home) and its live preview. The API contract is tested against PostgreSQL in
 * backend/api/tests/hero-banner.test.ts; look and timings follow
 * docs/promo-surfaces.md §3.
 */

vi.setConfig({ testTimeout: 20_000 });

const stored = (over: Partial<HeroBannerSetting> = {}): HeroBannerSetting => ({
  ...DEFAULT_HERO,
  cta_target: null,
  status: 'AUTO',
  updated_at: null,
  ...over,
});

const catalogMocks = (c: Call) => {
  if (c.method === 'GET' && c.path === '/admin/categories') {
    return ok({
      categories: [
        { id: 'c1', name: 'Rice', slug: 'rice', is_active: true, display_order: 1, parent_id: null },
        { id: 'c2', name: 'Basmati', slug: 'basmati', is_active: true, display_order: 1, parent_id: 'c1' },
      ],
    });
  }
  if (c.method === 'GET' && c.path === '/admin/category-groups') return ok({ groups: [], ungrouped: [] });
  // the live switches the "Automatic" preview follows (owner, 2026-10-14: points instead of free delivery)
  if (c.method === 'GET' && c.path === '/admin/settings/points') return ok({ enabled: true, earn_points: 1, earn_per_lkr: 100 });
  if (c.method === 'GET' && c.path === '/admin/settings/checkout') return ok({ new_customer_free_deliveries: { enabled: false, count: 2 } });
  return undefined;
};

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <HeroBanner />
      </ToastProvider>
    </MemoryRouter>
  );
}

describe('hero banner rules (same as the API)', () => {
  it('checks the words fit, tokens are known and an item is chosen', () => {
    const custom = { ...DEFAULT_HERO, mode: 'CUSTOM' as const };
    expect(heroProblem(custom)).toBeNull();
    expect(heroProblem({ ...custom, title_1: 'A'.repeat(13) })).toMatch(/12 characters/);
    expect(heroProblem({ ...custom, title_2: ' ' })).toMatch(/second title word/);
    expect(heroProblem({ ...custom, lines: [''] })).toMatch(/at least 1 sub-line/);
    expect(heroProblem({ ...custom, lines: ['x'.repeat(41)] })).toMatch(/40 characters/);
    expect(heroProblem({ ...custom, lines: ['From {price}'] })).toMatch(/Unknown token \{price\}/);
    expect(heroProblem({ ...custom, lines: ['Earn {points_rule}'] })).toBeNull();
    expect(heroProblem({ ...custom, cta_label: 'X'.repeat(17) })).toMatch(/16 characters/);
    expect(heroProblem({ ...custom, items: [] })).toMatch(/at least 1 item/);
    expect(heroProblem({ ...custom, cta_destination_type: 'PRODUCT' })).toMatch(/product the button opens/);
    expect(heroStatus(DEFAULT_HERO)).toBe('AUTO');
    expect(heroStatus({ mode: 'CUSTOM', starts_at: '2999-01-01T00:00:00Z', ends_at: null })).toBe('SCHEDULED');
  });

  it('fills tokens like the app and skips a line whose token has no value', () => {
    expect(fillTokens('Groceries starting at {min_price}', { minPrice: 253, freeCount: 0 })).toBe('Groceries starting at LKR 253');
    expect(fillTokens('First {free_count} free', { minPrice: 253, freeCount: 0 })).toBeNull();
    expect(fillTokens('Earn {points_rule}', { minPrice: 253, freeCount: 0, pointsRule: '1 point for every LKR 100' })).toBe('Earn 1 point for every LKR 100');
    expect(fillTokens('Earn {points_rule}', { minPrice: 253, freeCount: 2, pointsRule: null })).toBeNull();
    // Automatic: Blynk Points while on (owner, 2026-10-14), else two catchy lines - no
    // free-delivery claim and no price any more (owner, 2026-10-15/16)
    const auto = heroPreviewModel(DEFAULT_HERO);
    expect(auto.title).toEqual(['EARN', 'POINTS']);
    expect(auto.lines).toEqual(['1 point for every LKR 100', 'Shop smart, earn more']);
    expect(auto.cta).toBe('ORDER NOW');
    const free = heroPreviewModel(DEFAULT_HERO, { minPrice: 253, freeCount: 2, pointsRule: null });
    expect(free.title).toEqual(['FRESH', 'GROCERIES']);
    expect(free.lines).toEqual(['Quality groceries, delivered with care', 'Fresh picks, every day']);
    expect(heroPreviewModel(DEFAULT_HERO, { minPrice: 99, freeCount: 2, pointsRule: '1 point for every LKR 100' }).title).toEqual(['EARN', 'POINTS']);
    expect(heroPreviewModel(DEFAULT_HERO, { minPrice: 99, freeCount: 0 }).title).toEqual(['FRESH', 'GROCERIES']);
  });

  it('previews the live switches: points on/off x free deliveries on/off', () => {
    const on = { enabled: true, earn_points: 1, earn_per_lkr: 100 };
    const off = { ...on, enabled: false };
    const freeOn = { new_customer_free_deliveries: { enabled: true, count: 2 } };
    const freeOff = { new_customer_free_deliveries: { enabled: false, count: 2 } };
    expect(heroSampleFrom(on, freeOff)).toEqual({ minPrice: 253, freeCount: 0, pointsRule: '1 point for every LKR 100' });
    expect(heroSampleFrom({ ...on, earn_points: 2, earn_per_lkr: 250 }, freeOn)).toEqual({ minPrice: 253, freeCount: 2, pointsRule: '2 points for every LKR 250' });
    expect(heroSampleFrom(off, freeOn)).toEqual({ minPrice: 253, freeCount: 2, pointsRule: null });
    expect(heroPreviewModel(DEFAULT_HERO, heroSampleFrom(off, freeOff)).title).toEqual(['FRESH', 'GROCERIES']);
    // not loaded (or refused): the sample
    expect(heroSampleFrom(null, null)).toEqual({ minPrice: 253, freeCount: 0, pointsRule: '1 point for every LKR 100' });
  });
});

describe('hero banner preview', () => {
  afterEach(() => vi.useRealTimers());

  it('lifts one item after another and rolls the sub-lines at the app\'s timing', () => {
    vi.useFakeTimers();
    const model = heroPreviewModel({ ...DEFAULT_HERO, mode: 'CUSTOM', title_1: 'Weekend', title_2: 'Deals', lines: ['Up to 20% off rice', 'From {min_price}'], items: ['milk', 'bread'] });
    render(<HeroView model={model} reduced={false} paused={false} />);
    expect(screen.getByTestId('hero-banner')).toHaveTextContent('WEEKEND');
    expect(screen.getByTestId('hero-item')).toHaveTextContent('🥛');
    expect(screen.getByTestId('hero-item')).toHaveClass('hb-item--exit');
    expect(screen.getByTestId('hero-line')).toHaveTextContent('Up to 20% off rice');
    act(() => vi.advanceTimersByTime(2480));
    expect(screen.getByTestId('hero-item')).toHaveTextContent('🍞');
    expect(screen.getByTestId('hero-item')).toHaveClass('hb-item--drop');
    act(() => vi.advanceTimersByTime(720));
    expect(screen.getByTestId('hero-line')).toHaveTextContent('From LKR 253');
  });

  it('paused stays put', () => {
    vi.useFakeTimers();
    render(<HeroView model={heroPreviewModel(DEFAULT_HERO)} reduced={false} paused />);
    act(() => vi.advanceTimersByTime(9000));
    expect(screen.getByTestId('hero-item')).toHaveTextContent('🍞');
    expect(screen.getByTestId('hero-line')).toHaveTextContent('1 point for every LKR 100');
  });
});

describe('Home banner editor', () => {
  beforeEach(() => tokenStore.save('access', 'refresh'));
  afterEach(() => {
    tokenStore.clear();
    vi.unstubAllGlobals();
  });

  it('starts automatic, switches to custom, previews edits live and saves them with PATCH', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => {
      if (c.path === '/admin/settings/hero-banner') {
        if (c.method === 'GET') return ok(stored());
        if (c.method === 'PATCH') return ok(stored({ ...c.body, status: 'LIVE', updated_at: '2026-10-14T08:00:00.000Z' }));
      }
      return catalogMocks(c);
    });
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Home banner' })).toBeInTheDocument();
    expect(screen.getByTestId('hero-status')).toHaveTextContent('Automatic');
    expect(screen.getByTestId('hero-banner')).toHaveTextContent('EARN');
    expect(screen.getByTestId('hero-banner')).not.toHaveTextContent('FREE');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await user.click(within(screen.getByRole('group', { name: 'Banner words' })).getByRole('button', { name: 'Custom' }));
    expect(screen.getByTestId('hero-tokens')).toHaveTextContent('{min_price}');
    expect(screen.getByTestId('hero-tokens')).toHaveTextContent('{points_rule}');
    await user.clear(screen.getByLabelText('First word (white)'));
    await user.type(screen.getByLabelText('First word (white)'), 'weekend');
    await user.clear(screen.getByLabelText('Second word (yellow)'));
    await user.type(screen.getByLabelText('Second word (yellow)'), 'deals');
    expect(screen.getByTestId('hero-banner')).toHaveTextContent('WEEKEND');
    expect(screen.getByTestId('hero-banner')).toHaveTextContent('DEALS');

    await user.clear(screen.getByLabelText('Sub-line 1'));
    await user.type(screen.getByLabelText('Sub-line 1'), 'Up to 20% off rice');
    expect(screen.getByTestId('hero-line')).toHaveTextContent('Up to 20% off rice');
    await user.click(screen.getByRole('button', { name: 'Add sub-line' }));
    // userEvent treats { as a special key: type it as text with {{
    await user.type(screen.getByLabelText('Sub-line 2'), 'Groceries starting at {{min_price}');

    const items = screen.getByRole('group', { name: 'Items in the beam' });
    await user.click(within(items).getByRole('button', { name: /Milk/ }));
    for (const name of [/Apple/, /Carrot/, /Egg/, /Broccoli/, /Banana/]) await user.click(within(items).getByRole('button', { name }));

    await user.selectOptions(screen.getByLabelText('The button opens'), 'CATEGORY');
    await user.selectOptions(screen.getByLabelText(/^Category or sub-category/), 'rice');
    expect(screen.getByText(/The button opens the category Rice/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/hero-banner')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/hero-banner')[0]!.body).toEqual({
      ...DEFAULT_HERO,
      mode: 'CUSTOM',
      title_1: 'WEEKEND',
      title_2: 'DEALS',
      lines: ['Up to 20% off rice', 'Groceries starting at {min_price}'],
      items: ['milk', 'bread'],
      cta_destination_type: 'CATEGORY',
      cta_destination_value: 'rice',
    });
    expect(await screen.findByText('Home banner saved.')).toBeInTheDocument();
  });

  it('reset to automatic saves the defaults; an API refusal is shown inline', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => {
      if (c.path === '/admin/settings/hero-banner') {
        if (c.method === 'GET') return ok(stored({ mode: 'CUSTOM', title_1: 'BIG', status: 'LIVE' }));
        return fail(400, 'VALIDATION_ERROR', 'Request validation failed');
      }
      return catalogMocks(c);
    });
    renderPage();
    expect(await screen.findByTestId('hero-status')).toHaveTextContent('Custom - live in the app');
    await user.click(screen.getByRole('button', { name: 'Reset to automatic' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/hero-banner')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/hero-banner')[0]!.body).toEqual(DEFAULT_HERO);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('shows a load error instead of a guessed banner', async () => {
    mockApi((c) => (c.path === '/admin/settings/hero-banner' ? fail(500, 'INTERNAL_SERVER_ERROR', 'Something went wrong') : catalogMocks(c)));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
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

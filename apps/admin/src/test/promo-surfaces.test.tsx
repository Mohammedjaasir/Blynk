import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { PromoBand } from '../pages/PromoBand';
import { Promotions } from '../pages/Promotions';
import { BandView } from '../components/PromoBandPreview';
import { PromoCarouselPreview } from '../components/PromoCarouselPreview';
import { tokenStore } from '../api/client';
import type { PromoBandSetting, Promotion } from '../api/types';
import {
  DEFAULT_BAND,
  autoTextColor,
  bandPreviewModel,
  bandProblem,
  bandStatus,
  readableTextColors,
} from '../lib/promoBand';
import { carouselWithDraft, slideLook } from '../lib/promoCarousel';
import { fail, mockApi, ok, type Call } from './mockApi';

/**
 * Promo band editor and the live previews (owner, 2026-10-14: "make sure
 * promotional banner edit option like this animation in the ops and admin").
 * The API contract is tested against PostgreSQL in
 * backend/api/tests/promo-band.test.ts; the look and timings follow
 * docs/promo-surfaces.md.
 */

// The editor flows type a lot; a loaded machine running the whole suite needs more than 5 s.
vi.setConfig({ testTimeout: 20_000 });

const stored = (over: Partial<PromoBandSetting> = {}): PromoBandSetting => ({
  ...DEFAULT_BAND,
  cta_target: null,
  status: 'LIVE',
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
  return undefined;
};

function renderPage(ui: React.ReactElement) {
  return render(
    <MemoryRouter>
      <ToastProvider>{ui}</ToastProvider>
    </MemoryRouter>
  );
}

describe('promo band rules (same as the API)', () => {
  it('offers only readable text colours and picks the most readable automatically', () => {
    expect(readableTextColors('YELLOW')).toEqual(['INK']);
    expect(readableTextColors('INK')).toEqual(['WHITE', 'YELLOW']);
    expect(autoTextColor('GREEN')).toBe('WHITE');
    expect(bandProblem({ ...DEFAULT_BAND, background: 'YELLOW', text_color: 'WHITE' })).toMatch(/hard to read/);
    expect(bandProblem({ ...DEFAULT_BAND, item_kind: 'IMAGE' })).toBe('Upload the item image.');
    expect(bandProblem({ ...DEFAULT_BAND, lines: ['x'.repeat(45)] })).toMatch(/44 characters/);
    expect(
      bandProblem({ ...DEFAULT_BAND, starts_at: '2026-10-20T00:00:00.000Z', ends_at: '2026-10-19T00:00:00.000Z' })
    ).toMatch(/after the start/);
    expect(bandProblem(DEFAULT_BAND)).toBeNull();
  });

  it('with nothing set the preview shows the app\'s own copy and look', () => {
    const m = bandPreviewModel(DEFAULT_BAND);
    expect(m.lines).toEqual(['Free delivery on your first 2 orders']);
    expect(m.ticks).toEqual(['No Platform Fee', 'No Packaging Fee']);
    expect(m.colors).toEqual({ start: '#FFE141', end: '#F2C600', text: '#1A1D2E' });
    expect(m.appCopy).toEqual({ lines: true, ticks: true });
    expect(bandStatus({ enabled: true, starts_at: '2999-01-01T00:00:00Z', ends_at: null })).toBe('SCHEDULED');
    expect(bandStatus({ enabled: false, starts_at: null, ends_at: null })).toBe('OFF');
  });
});

describe('promo band preview', () => {
  afterEach(() => vi.useRealTimers());

  it('draws the mascot, the item in the beam and slides between headlines at the app\'s timing', () => {
    vi.useFakeTimers();
    const model = bandPreviewModel({
      ...DEFAULT_BAND,
      lines: ['Fresh bread daily', 'Weekend deals'],
      item_kind: 'ILLUSTRATED',
      item_illustration: 'bread',
      mascot: 'RIDE',
    });
    render(<BandView model={model} reduced={false} paused={false} />);
    expect(screen.getByTestId('band-mascot')).toHaveClass('pb-mascot--ride');
    expect(screen.getByTestId('band-item')).toHaveTextContent('🍞');
    expect(screen.getByTestId('band-line')).toHaveTextContent('Fresh bread daily');
    act(() => vi.advanceTimersByTime(2800));
    expect(screen.getByTestId('band-line')).toHaveClass('pb-line--out');
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByTestId('band-line')).toHaveTextContent('Weekend deals');
    expect(screen.getByTestId('band-line')).toHaveClass('pb-line--in');
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByTestId('band-line')).toHaveTextContent('Fresh bread daily');
  });

  it('paused or a single headline stays put; no mascot and no item when switched off', () => {
    vi.useFakeTimers();
    const model = bandPreviewModel({ ...DEFAULT_BAND, lines: ['One line', 'Two lines'], mascot: 'OFF' });
    render(<BandView model={model} reduced={false} paused />);
    act(() => vi.advanceTimersByTime(9000));
    expect(screen.getByTestId('band-line')).toHaveTextContent('One line');
    expect(screen.queryByTestId('band-mascot')).toBeNull();
    expect(screen.queryByTestId('band-item')).toBeNull();
  });
});

describe('Promo band editor', () => {
  beforeEach(() => tokenStore.save('access', 'refresh'));
  afterEach(() => {
    tokenStore.clear();
    vi.unstubAllGlobals();
  });

  it('loads the band, previews edits live and saves them with PATCH', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => {
      if (c.path === '/admin/settings/promo-band') {
        if (c.method === 'GET') return ok(stored());
        if (c.method === 'PATCH') return ok(stored({ ...c.body, updated_at: '2026-10-14T08:00:00.000Z' }));
      }
      return catalogMocks(c);
    });
    renderPage(<PromoBand />);

    expect(await screen.findByRole('heading', { name: 'Promo band' })).toBeInTheDocument();
    expect(screen.getByTestId('band-status')).toHaveTextContent('Live in the app');
    // nothing set yet: the app's own words, the waving rider
    expect(screen.getByTestId('band-line')).toHaveTextContent('Free delivery on your first 2 orders');
    expect(screen.getByTestId('band-mascot')).toHaveClass('pb-mascot--wave');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Add headline' }));
    await user.type(screen.getByLabelText('Headline 1'), 'Fresh bread every morning');
    expect(screen.getByTestId('band-line')).toHaveTextContent('Fresh bread every morning');

    // ink background: ink text can no longer be picked; yellow text can
    await user.click(screen.getByRole('button', { name: 'Ink' }));
    const textGroup = screen.getByRole('group', { name: 'Text colour' });
    expect(within(textGroup).getByRole('button', { name: /^Aa Ink$/ })).toBeDisabled();
    await user.click(within(textGroup).getByRole('button', { name: /Yellow/ }));
    const band = screen.getByTestId('promo-band');
    expect(within(band).getByTestId('band-line')).toHaveStyle({ color: '#FFE141' });

    await user.click(screen.getByRole('button', { name: 'Illustrated item' }));
    await user.click(screen.getByRole('button', { name: /Bread/ }));
    expect(screen.getByTestId('band-item')).toHaveTextContent('🍞');

    await user.click(screen.getByRole('button', { name: /No mascot/ }));
    expect(screen.queryByTestId('band-mascot')).toBeNull();

    await user.selectOptions(screen.getByLabelText('The band opens'), 'CATEGORY');
    await user.selectOptions(screen.getByLabelText(/^Category or sub-category/), 'basmati');
    expect(screen.getByText(/Tapping the band opens the sub-category Rice › Basmati/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/promo-band')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/promo-band')[0]!.body).toEqual({
      ...DEFAULT_BAND,
      lines: ['Fresh bread every morning'],
      background: 'INK',
      text_color: 'YELLOW',
      item_kind: 'ILLUSTRATED',
      item_illustration: 'bread',
      mascot: 'OFF',
      cta_destination_type: 'CATEGORY',
      cta_destination_value: 'basmati',
    });
    expect(await screen.findByText('Promo band saved.')).toBeInTheDocument();
  });

  it('switching it off shows the status, and an API refusal is shown', async () => {
    const user = userEvent.setup();
    mockApi((c) => {
      if (c.path === '/admin/settings/promo-band') {
        if (c.method === 'GET') return ok(stored());
        return fail(400, 'VALIDATION_ERROR', 'Request validation failed');
      }
      return catalogMocks(c);
    });
    renderPage(<PromoBand />);
    await user.click(await screen.findByRole('switch', { name: 'Show the promo band on Home' }));
    expect(screen.getByTestId('band-status')).toHaveTextContent('Switched off');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('a schedule in the future reads as scheduled', async () => {
    mockApi((c) =>
      c.path === '/admin/settings/promo-band' && c.method === 'GET'
        ? ok(stored({ starts_at: '2999-01-01T00:00:00.000Z', status: 'SCHEDULED' }))
        : catalogMocks(c)
    );
    renderPage(<PromoBand />);
    expect(await screen.findByTestId('band-status')).toHaveTextContent('Scheduled');
    expect((screen.getByLabelText('Starts') as HTMLInputElement).value).toMatch(/^2999-01-0[12]T/);
  });

  it('shows a load error instead of a guessed band', async () => {
    mockApi((c) => (c.path === '/admin/settings/promo-band' ? fail(500, 'INTERNAL_SERVER_ERROR', 'Something went wrong') : catalogMocks(c)));
    renderPage(<PromoBand />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
  });
});

const promo = (over: Partial<Promotion>): Promotion => ({
  id: 'p1',
  title: 'Fresh fruit',
  subtitle: 'Picked this morning',
  image_url: null,
  background_type: 'SOLID',
  background_color: '#FFE141',
  background_color_end: null,
  background_image_url: null,
  cta_label: 'Shop now',
  cta_destination_type: 'CATALOG',
  cta_destination_value: null,
  display_order: 1,
  is_active: true,
  ...over,
});

describe('carousel preview', () => {
  afterEach(() => vi.useRealTimers());

  it('slide look follows the app: artwork has no words, dark backgrounds get white text', () => {
    expect(slideLook(promo({ background_color: '#1A1D2E' })).titleColor).toBe('#FFFFFF');
    const art = slideLook(promo({ background_type: 'ARTWORK', background_image_url: 'https://x/a.png', cta_label: null }));
    expect(art.showText).toBe(false);
    expect(art.wholeCardTap).toBe(true);
    expect(slideLook(promo({})).ctaColors).toEqual({ bg: '#1A1D2E', text: '#FFFFFF' });
    const rows = [promo({ id: 'a', display_order: 2 }), promo({ id: 'b', display_order: 1, is_active: false })];
    expect(carouselWithDraft(rows, promo({ id: 'draft', display_order: 1 })).map((r) => r.id)).toEqual(['draft', 'a']);
  });

  it('plays the carousel in order: 4 s per slide, dots follow, wraps to the first', () => {
    vi.useFakeTimers();
    render(
      <PromoCarouselPreview
        promotions={[promo({ id: 'b', title: 'Second', display_order: 2 }), promo({ id: 'a', title: 'First', display_order: 1 })]}
      />
    );
    expect(screen.getByTestId('carousel-slide')).toHaveAccessibleName('Slide 1 of 2: First');
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.getAllByTestId('carousel-slide').at(-1)).toHaveAccessibleName('Slide 2 of 2: Second');
    expect(screen.getByRole('tab', { name: 'Slide 2: Second' })).toHaveAttribute('aria-selected', 'true');
    act(() => vi.advanceTimersByTime(4500));
    expect(screen.getAllByTestId('carousel-slide').at(-1)).toHaveAccessibleName('Slide 1 of 2: First');
  });

  it('pause and "reduce motion" stop the auto-advance', () => {
    vi.useFakeTimers();
    render(<PromoCarouselPreview promotions={[promo({ id: 'a', title: 'First' }), promo({ id: 'b', title: 'Second', display_order: 2 })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    act(() => vi.advanceTimersByTime(12000));
    expect(screen.getByTestId('carousel-slide')).toHaveAccessibleName('Slide 1 of 2: First');
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    fireEvent.click(screen.getByLabelText(/Preview with "reduce motion"/));
    act(() => vi.advanceTimersByTime(12000));
    expect(screen.getByTestId('carousel-slide')).toHaveAccessibleName('Slide 1 of 2: First');
    expect(screen.getByTestId('carousel-motion')).toHaveAttribute('data-reduced', 'true');
    expect(screen.getByText(/does not move on by itself/)).toBeInTheDocument();
    // by hand still works
    fireEvent.click(screen.getByRole('button', { name: 'Next slide' }));
    expect(screen.getAllByTestId('carousel-slide').at(-1)).toHaveAccessibleName('Slide 2 of 2: Second');
  });

  it('the Promotions editor previews the slide live and in its place in the carousel', async () => {
    tokenStore.save('access', 'refresh');
    const user = userEvent.setup();
    mockApi((c) => {
      if (c.method === 'GET' && c.path === '/admin/promotions') {
        return ok({ promotions: [promo({ id: 'p1', title: 'Everyday Essentials' }), promo({ id: 'p2', title: 'Snack Time', display_order: 2 })] });
      }
      return catalogMocks(c);
    });
    renderPage(<Promotions />);
    await screen.findAllByText('Everyday Essentials');

    await user.click(screen.getByRole('button', { name: 'Watch the carousel' }));
    expect(screen.getByRole('figure', { name: 'The Home carousel, as customers see it' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add promotion' }));
    const dialog = screen.getByRole('dialog', { name: 'Promotion' });
    const headline = within(dialog).getByText('Headline').closest('label')!.querySelector('input')!;
    await user.type(headline, 'Big Rice Week');
    const figure = within(dialog).getByRole('figure', { name: 'This promotion in the customer app' });
    expect(within(figure).getByTestId('carousel-slide')).toHaveAccessibleName('Slide 1 of 1: Big Rice Week');

    await user.click(within(dialog).getByRole('button', { name: 'Whole carousel' }));
    expect(within(figure).getAllByRole('tab')).toHaveLength(3);
    tokenStore.clear();
    vi.unstubAllGlobals();
  });
});

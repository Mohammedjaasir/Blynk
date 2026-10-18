import { act, cleanup, configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { PromoBandSetting, Promotion } from '../api/types';
import { BandView } from '../components/PromoBandPreview';
import { PromoCarouselPreview } from '../components/PromoCarouselPreview';
import { DEFAULT_BAND, bandPreviewModel, readableTextColors } from '../lib/promoBand';
import { OPERATIONS_STAFF, fail, ok, renderAs } from './helpers';

/**
 * Catalog -> Promo band, and the live carousel previews in Promotions
 * (owner, 2026-10-14: "make sure promotional banner edit option like this
 * animation in the ops and admin"). The API contract is tested against
 * PostgreSQL in backend/api/tests/promo-band.test.ts; look and timings
 * follow docs/promo-surfaces.md.
 */

configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const stored = (over: Partial<PromoBandSetting> = {}): PromoBandSetting => ({
  ...DEFAULT_BAND,
  cta_target: null,
  status: 'LIVE',
  updated_at: null,
  ...over,
});

const catalogMocks = {
  'GET /admin/categories': () =>
    ok({
      categories: [
        { id: 'c1', name: 'Rice', slug: 'rice', is_active: true, display_order: 1, parent_id: null },
        { id: 'c2', name: 'Basmati', slug: 'basmati', is_active: true, display_order: 1, parent_id: 'c1' },
      ],
    }),
  'GET /admin/category-groups': () => ok({ groups: [], ungrouped: [] }),
};

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

describe('Promo band editor (Blynk Ops)', () => {
  it('loads the band, plays edits live and saves them', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/catalog/promo-band', {
      ...catalogMocks,
      'GET /admin/settings/promo-band': () => ok(stored()),
      'PATCH /admin/settings/promo-band': (call) => ok(stored({ ...(call.body as object), updated_at: '2026-10-14T08:00:00.000Z' })),
    });

    expect(await screen.findByRole('heading', { name: 'Promo band' })).toBeInTheDocument();
    expect(screen.getByTestId('band-status')).toHaveTextContent('Live in the app');
    expect(screen.getByTestId('band-line')).toHaveTextContent('Handpicked fresh, every single day');
    expect(screen.getByTestId('band-mascot')).toHaveClass('pb-mascot--wave');

    await user.click(screen.getByRole('button', { name: 'Add headline' }));
    await user.type(screen.getByLabelText('Headline 1'), 'Weekend rice deals');
    expect(screen.getByTestId('band-line')).toHaveTextContent('Weekend rice deals');

    await user.click(screen.getByRole('button', { name: 'Green' }));
    const textGroup = screen.getByRole('group', { name: 'Text colour' });
    expect(within(textGroup).getByRole('button', { name: /^Aa Ink$/ })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /Rider rides in/ }));
    expect(screen.getByTestId('band-mascot')).toHaveClass('pb-mascot--ride');

    await user.click(screen.getByRole('button', { name: 'Illustrated item' }));
    await user.click(screen.getByRole('button', { name: /Rice/ }));
    expect(screen.getByTestId('band-item')).toHaveTextContent('🍚');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/promo-band')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/promo-band')[0]!.body).toEqual({
      ...DEFAULT_BAND,
      lines: ['Weekend rice deals'],
      background: 'GREEN',
      mascot: 'RIDE',
      item_kind: 'ILLUSTRATED',
      item_illustration: 'rice',
    });
    expect(await screen.findByText('Promo band saved.')).toBeInTheDocument();
  });

  it('switching it off reads as off; the API refusal is shown', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, '/catalog/promo-band', {
      ...catalogMocks,
      'GET /admin/settings/promo-band': () => ok(stored()),
      'PATCH /admin/settings/promo-band': () => fail(403, 'FORBIDDEN', 'Forbidden'),
    });
    await user.click(await screen.findByRole('switch', { name: 'Show the promo band on Home' }));
    expect(screen.getByTestId('band-status')).toHaveTextContent('Switched off');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('the Catalog hub links to it with its state', async () => {
    renderAs(OPERATIONS_STAFF, '/catalog', {
      'GET /admin/settings/promo-band': () => ok(stored({ enabled: false, status: 'OFF' })),
    });
    const card = await screen.findByRole('link', { name: /Promo band/ });
    expect(card).toHaveAttribute('href', '/catalog/promo-band');
    await waitFor(() => expect(card).toHaveTextContent('Off'));
  });
});

describe('promo band preview (Blynk Ops)', () => {
  it('slides between headlines every 2.8 s and keeps the AA palette rule', () => {
    vi.useFakeTimers();
    expect(readableTextColors('GREEN')).toEqual(['WHITE']);
    render(<BandView model={bandPreviewModel({ ...DEFAULT_BAND, lines: ['First line', 'Second line'] })} reduced={false} paused={false} />);
    expect(screen.getByTestId('band-line')).toHaveTextContent('First line');
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByTestId('band-line')).toHaveTextContent('Second line');
  });
});

describe('carousel preview (Blynk Ops)', () => {
  it('auto-advances every 4 s in display order, and not under "reduce motion"', () => {
    vi.useFakeTimers();
    render(
      <PromoCarouselPreview promotions={[promo({ id: 'b', title: 'Second', display_order: 2 }), promo({ id: 'a', title: 'First' })]} />
    );
    expect(screen.getByTestId('carousel-slide')).toHaveAccessibleName('Slide 1 of 2: First');
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.getAllByTestId('carousel-slide').at(-1)).toHaveAccessibleName('Slide 2 of 2: Second');
    act(() => screen.getByLabelText(/Preview with "reduce motion"/).click());
    act(() => vi.advanceTimersByTime(12000));
    expect(screen.getAllByTestId('carousel-slide').at(-1)).toHaveAccessibleName('Slide 2 of 2: Second');
  });

  it('the Promotions editor plays the slide being edited, alone or in its place', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, '/catalog/promotions', {
      ...catalogMocks,
      'GET /admin/promotions': () => ok({ promotions: [promo({ id: 'p1', title: 'Everyday Essentials' })] }),
      'GET /promotions': () => ok({ promotions: [promo({ id: 'p1', title: 'Everyday Essentials' })] }),
    });
    await user.click(await screen.findByRole('button', { name: 'Watch the carousel' }));
    expect(screen.getByRole('figure', { name: 'The Home carousel, as customers see it' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add promotion' }));
    const dialog = screen.getByRole('dialog', { name: 'Promotion' });
    const name = within(dialog).getAllByRole('textbox')[0]!;
    await user.type(name, 'Big Rice Week');
    const figure = within(dialog).getByRole('figure', { name: 'This promotion in the customer app' });
    expect(within(figure).getByTestId('carousel-slide')).toHaveAccessibleName('Slide 1 of 1: Big Rice Week');
    await user.click(within(dialog).getByRole('button', { name: 'Whole carousel' }));
    expect(within(figure).getAllByRole('tab')).toHaveLength(2);
  });
});

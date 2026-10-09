import { cleanup, configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { BirthdayOfferSetting, OrderDetail } from '../api/types';
import { OrderBill } from '../components/OrderBill';
import { birthdayWhen, fillPercent, formatDayMonth, formatDayMonthYear, parseBirthdayPercent } from '../lib/birthday';
import { ADMIN_WITH_RIDER, ok, renderAs } from './helpers';

/** More -> Birthday offer (owner, 2026-10-09). */

configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const SETTING: BirthdayOfferSetting = {
  enabled: false,
  percent: 10,
  sms_enabled: true,
  sms_text: 'Happy birthday from Blynk! {percent}% off your order this week.',
  sms_preview: 'Happy birthday from Blynk! 10% off your order this week.',
  sms_parts: 1,
  window_days: 3,
  updated_at: null,
};

const BIRTHDAYS = {
  today: '2026-10-09',
  customers: [
    {
      id: 'c1',
      full_name: 'Nimali Perera',
      phone: '+94771234567',
      date_of_birth: '1990-10-09',
      birthday: '2026-10-09',
      days_until: 0,
      turning: 36,
      favourite_categories: [
        { id: 'k1', name: 'Bakery' },
        { id: 'k2', name: 'Fruits' },
      ],
      favourites_note: 'Love dark chocolate',
      offer_used: false,
    },
    {
      id: 'c2',
      full_name: null,
      phone: '+94770000000',
      date_of_birth: '2001-10-07',
      birthday: '2026-10-07',
      days_until: -2,
      turning: 25,
      favourite_categories: [],
      favourites_note: null,
      offer_used: true,
    },
  ],
};

function open(handlers: Parameters<typeof renderAs>[2] = {}) {
  return renderAs(ADMIN_WITH_RIDER, '/more/birthday-offer', {
    'GET /admin/settings/birthday-offer': () => ok(SETTING),
    'GET /admin/birthdays': () => ok(BIRTHDAYS),
    ...handlers,
  });
}

describe('Birthday offer helpers', () => {
  it('validates the percent like the backend', () => {
    expect(parseBirthdayPercent('12.5')).toEqual({ value: 12.5 });
    expect(parseBirthdayPercent('0')).toEqual({ error: 'The percentage must be more than 0.' });
    expect(parseBirthdayPercent('51')).toEqual({ error: 'The percentage can be at most 50.' });
    expect(parseBirthdayPercent('1.234')).toEqual({ error: 'Use at most 2 decimals.' });
    expect(parseBirthdayPercent('')).toEqual({ error: 'Enter a percentage from 1 to 50.' });
  });

  it('formats calendar days without a timezone shift', () => {
    expect(formatDayMonth('2026-10-12')).toBe('12 Oct');
    expect(formatDayMonthYear('1990-01-01')).toBe('1 Jan 1990');
    expect(formatDayMonthYear('1990-12-31')).toBe('31 Dec 1990');
    expect(birthdayWhen(0)).toBe('Today');
    expect(birthdayWhen(1)).toBe('Tomorrow');
    expect(birthdayWhen(2)).toBe('In 2 days');
    expect(birthdayWhen(-1)).toBe('Yesterday');
    expect(birthdayWhen(-2)).toBe('2 days ago');
    expect(fillPercent(' {percent}% off, {percent}! ', '15')).toBe('15% off, 15!');
  });
});

describe('Birthday offer screen', () => {
  it('is linked from More', async () => {
    renderAs(ADMIN_WITH_RIDER, '/more');
    expect(await screen.findByRole('link', { name: 'Birthday offer' })).toHaveAttribute('href', '/more/birthday-offer');
  });

  it('shows the saved settings and the server preview, then saves every control', async () => {
    const user = userEvent.setup();
    const { api } = open({
      'PATCH /admin/settings/birthday-offer': (call) => {
        const body = call.body as Partial<BirthdayOfferSetting>;
        const next = { ...SETTING, ...body, updated_at: '2026-10-09T04:00:00Z' };
        return ok({ ...next, sms_preview: next.sms_text.split('{percent}').join(String(next.percent)), sms_parts: 1 });
      },
    });
    const card = (await screen.findByRole('heading', { name: 'Birthday offer', level: 2 })).closest('section') as HTMLElement;
    const on = await within(card).findByRole('checkbox', { name: /^Birthday offer/ });
    const sms = within(card).getByRole('checkbox', { name: /^Birthday SMS/ });
    const percent = within(card).getByLabelText(/^Birthday discount/);
    const text = within(card).getByLabelText('Birthday SMS text');
    expect(on).not.toBeChecked();
    expect(sms).toBeChecked();
    expect(percent).toHaveValue('10');
    expect(within(card).getByLabelText('Birthday SMS preview')).toHaveTextContent(SETTING.sms_preview);
    expect(within(card).getByTestId('birthday-sms-count')).toHaveTextContent('1 SMS');

    // The preview follows the typing, filling {percent} locally.
    await user.click(on);
    await user.clear(percent);
    await user.type(percent, '15');
    expect(within(card).getByLabelText('Birthday SMS preview')).toHaveTextContent(
      'Happy birthday from Blynk! 15% off your order this week.'
    );
    await user.clear(text);
    await user.type(text, 'Wishes from Blynk: {{percent}% off today');
    expect(within(card).getByLabelText('Birthday SMS preview')).toHaveTextContent('Wishes from Blynk: 15% off today');

    await user.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.find('PATCH', '/admin/settings/birthday-offer')[0]?.body).toEqual({
        enabled: true,
        percent: 15,
        sms_enabled: true,
        sms_text: 'Wishes from Blynk: {percent}% off today',
      })
    );
    expect(await within(card).findByText('Birthday offer saved.')).toBeInTheDocument();
    expect(within(card).getByText(/Last changed/)).toBeInTheDocument();
  });

  it('refuses a bad percent or empty SMS before sending anything', async () => {
    const user = userEvent.setup();
    const { api } = open();
    const card = (await screen.findByRole('heading', { name: 'Birthday offer', level: 2 })).closest('section') as HTMLElement;
    const percent = await within(card).findByLabelText(/^Birthday discount/);
    await user.clear(percent);
    await user.type(percent, '60');
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    expect(await within(card).findByText('The percentage can be at most 50.')).toBeInTheDocument();

    await user.clear(percent);
    await user.type(percent, '10');
    await user.clear(within(card).getByLabelText('Birthday SMS text'));
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    expect(await within(card).findByText('Write the birthday SMS.')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/settings/birthday-offer')).toHaveLength(0);
  });

  it('shows the server error message', async () => {
    const user = userEvent.setup();
    open({
      'PATCH /admin/settings/birthday-offer': () => ({
        status: 400,
        error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: [{ message: 'percent must be at most 50' }] },
      }),
    });
    const card = (await screen.findByRole('heading', { name: 'Birthday offer', level: 2 })).closest('section') as HTMLElement;
    await user.click(await within(card).findByRole('button', { name: 'Save' }));
    expect(await within(card).findByText('percent must be at most 50')).toBeInTheDocument();
  });

  it('lists birthdays this week with when, age, favourites, note and gift used', async () => {
    const { api } = open();
    const list = await screen.findByRole('list', { name: 'Birthdays this week' });
    const rows = within(list).getAllByRole('listitem').filter((li) => li.classList.contains('birthday-row'));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Nimali Perera');
    expect(rows[0]).toHaveTextContent('Today · 9 Oct · turning 36');
    expect(rows[0]).toHaveTextContent('born 9 Oct 1990');
    expect(within(rows[0]!).getByText('Bakery')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Fruits')).toBeInTheDocument();
    expect(rows[0]).toHaveTextContent('Love dark chocolate');
    expect(within(rows[0]!).queryByText('Gift used')).not.toBeInTheDocument();
    expect(rows[1]).toHaveTextContent('Customer');
    expect(rows[1]).toHaveTextContent('2 days ago · 7 Oct · turning 25');
    expect(within(rows[1]!).getByText('Gift used')).toBeInTheDocument();
    expect(api.find('GET', '/admin/birthdays')[0]?.query).toMatchObject({ days: '7' });
  });

  it('says so when nobody has a birthday this week', async () => {
    open({ 'GET /admin/birthdays': () => ok({ today: '2026-10-09', customers: [] }) });
    expect(await screen.findByText('No birthdays this week')).toBeInTheDocument();
  });
});

describe('Order bill', () => {
  const ORDER = {
    payment_method: 'COD',
    subtotal_amount: 2000,
    delivery_fee: 250,
    discount_amount: 200,
    coupon_code: null,
    birthday_discount_amount: 200,
    total_amount: 2050,
  } as OrderDetail;

  it('shows a birthday gift instead of a coupon discount', () => {
    render(<OrderBill order={ORDER} />);
    const bill = screen.getByLabelText('Bill');
    expect(within(bill).getByText('Birthday gift')).toBeInTheDocument();
    expect(within(bill).queryByText(/^Discount/)).not.toBeInTheDocument();
    expect(bill).toHaveTextContent(/−LKR\s?200/);
  });

  it('keeps the coupon line when there is no birthday gift', () => {
    render(<OrderBill order={{ ...ORDER, birthday_discount_amount: 0, coupon_code: 'SAVE' }} />);
    expect(screen.getByText('Discount (SAVE)')).toBeInTheDocument();
  });
});

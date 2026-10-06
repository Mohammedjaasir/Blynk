import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { Coupons } from '../pages/Coupons';
import { tokenStore } from '../api/client';
import type { Coupon } from '../api/types';
import {
  colomboEndOf,
  colomboStartOf,
  couponState,
  describeDiscount,
  emptyForm,
  formFromCoupon,
  lastValidDay,
  toInput,
  validateForm,
} from '../lib/coupons';
import { respond, stubFetch } from './fetchStub';

/**
 * Coupons page (backend migration 018). The API rules - limits, the lock at
 * checkout, the error codes - are tested against PostgreSQL in
 * backend/api/tests/coupons.test.ts.
 */

function coupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: 'c1',
    code: 'WELCOME50',
    description: 'New customers',
    discount_type: 'FIXED',
    discount_value: 50,
    max_discount: null,
    min_subtotal: 500,
    first_order_only: true,
    starts_at: null,
    ends_at: null,
    usage_limit: 100,
    per_customer_limit: 1,
    is_active: true,
    usage_count: 3,
    created_at: '2026-09-29T04:30:00.000Z',
    ...overrides,
  };
}

/** A Field's control by the start of its label (the label also holds the hint). */
const labelled = (scope: HTMLElement, name: string) =>
  within(scope).getByLabelText(new RegExp(`^${name.replace(/[()]/g, '\\$&')}`));

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <Coupons />
      </ToastProvider>
    </MemoryRouter>
  );
}

describe('coupon rules (lib)', () => {
  it('describes each kind of discount', () => {
    expect(describeDiscount(coupon())).toBe('LKR 50 off');
    expect(describeDiscount(coupon({ discount_type: 'PERCENT', discount_value: 10, max_discount: 75 }))).toBe('10% off, up to LKR 75');
    expect(describeDiscount(coupon({ discount_type: 'FREE_DELIVERY', discount_value: 0 }))).toBe('Free delivery');
  });

  it('turns Sri Lanka days into instants and back', () => {
    expect(colomboStartOf('2026-10-01')).toBe('2026-09-30T18:30:00.000Z');
    // "Last day 31 Oct" = valid until the next Colombo midnight.
    expect(colomboEndOf('2026-10-31')).toBe('2026-10-31T18:30:00.000Z');
    expect(lastValidDay('2026-10-31T18:30:00.000Z')).toBe('2026-10-31');
  });

  it('validates the form like the API', () => {
    const f = { ...emptyForm(), code: 'ab', discount_value: '0', per_customer_limit: '0' };
    expect(Object.keys(validateForm(f, true)).sort()).toEqual(['code', 'discount_value', 'per_customer_limit']);
    const pct = { ...emptyForm(), code: 'SAVE10', discount_type: 'PERCENT' as const, discount_value: '150' };
    expect(validateForm(pct, true).discount_value).toMatch(/1 to 100/);
    const dates = { ...emptyForm(), code: 'SAVE10', discount_value: '10', starts_on: '2026-10-05', ends_on: '2026-10-01' };
    expect(validateForm(dates, true).ends_on).toBeTruthy();
    expect(validateForm({ ...emptyForm(), code: 'save10', discount_value: '10' }, true)).toEqual({});
  });

  it('builds the API body', () => {
    const body = toInput(
      { ...emptyForm(), code: 'save10', discount_type: 'PERCENT', discount_value: '10', max_discount: '75', ends_on: '2026-10-31' },
      true
    );
    expect(body).toMatchObject({
      code: 'SAVE10',
      discount_type: 'PERCENT',
      discount_value: 10,
      max_discount: 75,
      min_subtotal: null,
      starts_at: null,
      ends_at: '2026-10-31T18:30:00.000Z',
      per_customer_limit: 1,
      usage_limit: null,
    });
    expect(toInput(formFromCoupon(coupon()), false)).not.toHaveProperty('code');
    expect(toInput({ ...emptyForm(), discount_type: 'FREE_DELIVERY' }, false)).toMatchObject({ discount_value: 0, max_discount: null });
  });

  it('knows whether a coupon is usable now', () => {
    const now = new Date('2026-10-10T00:00:00Z');
    expect(couponState(coupon(), now)).toBe('live');
    expect(couponState(coupon({ is_active: false }), now)).toBe('off');
    expect(couponState(coupon({ starts_at: '2026-11-01T00:00:00Z' }), now)).toBe('scheduled');
    expect(couponState(coupon({ ends_at: '2026-10-01T00:00:00Z' }), now)).toBe('ended');
    expect(couponState(coupon({ usage_count: 100 }), now)).toBe('used-up');
  });
});

describe('Coupons page', () => {
  beforeEach(() => tokenStore.save('access', 'refresh'));
  afterEach(() => {
    tokenStore.clear();
    vi.unstubAllGlobals();
  });

  it('lists codes with their discount, conditions, usage and status', async () => {
    stubFetch(() => respond({ coupons: [coupon(), coupon({ id: 'c2', code: 'FREESHIP', discount_type: 'FREE_DELIVERY', discount_value: 0, min_subtotal: null, first_order_only: false, is_active: false, usage_count: 0, usage_limit: null })] }));
    renderPage();
    const table = await screen.findByRole('table', { name: 'Coupons' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('WELCOME50');
    expect(rows[0]).toHaveTextContent('LKR 50 off');
    expect(rows[0]).toHaveTextContent('First order only');
    expect(rows[0]).toHaveTextContent('Min. LKR 500');
    expect(rows[0]).toHaveTextContent('3 / 100');
    expect(rows[0]).toHaveTextContent('Live');
    // A used coupon cannot be deleted, only switched off.
    expect(within(rows[0]).queryByRole('button', { name: 'Delete WELCOME50' })).toBeNull();
    expect(rows[1]).toHaveTextContent('Free delivery');
    expect(rows[1]).toHaveTextContent('Switched off');
    expect(within(rows[1]).getByRole('button', { name: 'Switch on FREESHIP' })).toBeInTheDocument();
    expect(within(rows[1]).getByRole('button', { name: 'Delete FREESHIP' })).toBeInTheDocument();
  });

  it('creates a percentage coupon with a cap and a last day', async () => {
    const user = userEvent.setup();
    const api = stubFetch((method, _path, body) =>
      method === 'POST' ? respond({ coupon: coupon({ ...(body as object), id: 'new', usage_count: 0 } as Partial<Coupon>) }, 201) : respond({ coupons: [] })
    );
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'New coupon' }));
    const dialog = screen.getByRole('dialog', { name: 'New coupon' });
    await user.type(labelled(dialog, 'Code'), 'dasain10');
    await user.selectOptions(labelled(dialog, 'Type'), 'PERCENT');
    await user.type(labelled(dialog, 'Percentage off'), '10');
    await user.type(labelled(dialog, 'Maximum discount (LKR)'), '200');
    await user.type(labelled(dialog, 'Last day'), '2026-10-31');
    await user.clear(labelled(dialog, 'Uses per customer'));
    await user.type(labelled(dialog, 'Uses per customer'), '2');
    await user.click(within(dialog).getByRole('button', { name: 'Create coupon' }));
    expect(api.sent('POST', '/admin/coupons')).toEqual([
      expect.objectContaining({
        code: 'DASAIN10',
        discount_type: 'PERCENT',
        discount_value: 10,
        max_discount: 200,
        ends_at: '2026-10-31T18:30:00.000Z',
        per_customer_limit: 2,
        first_order_only: false,
        is_active: true,
      }),
    ]);
    const table = await screen.findByRole('table', { name: 'Coupons' });
    expect(table).toHaveTextContent('DASAIN10');
  });

  it('checks the form before sending and shows a taken code next to its field', async () => {
    const user = userEvent.setup();
    const api = stubFetch((method) =>
      method === 'POST' ? respond({ code: 'COUPON_CODE_TAKEN', message: 'taken' }, 409) : respond({ coupons: [] })
    );
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'New coupon' }));
    const dialog = screen.getByRole('dialog', { name: 'New coupon' });
    await user.click(within(dialog).getByRole('button', { name: 'Create coupon' }));
    expect(within(dialog).getByText('Use 4-20 letters or digits, no spaces.')).toBeInTheDocument();
    expect(within(dialog).getByText('Enter an amount above 0.')).toBeInTheDocument();
    expect(api.sent('POST', '/admin/coupons')).toHaveLength(0);

    await user.type(labelled(dialog, 'Code'), 'TAKEN1');
    await user.type(labelled(dialog, 'Amount off (LKR)'), '50');
    await user.click(within(dialog).getByRole('button', { name: 'Create coupon' }));
    expect(await within(dialog).findByText('Another coupon already uses this code.')).toBeInTheDocument();
  });

  it('switches a coupon off', async () => {
    const user = userEvent.setup();
    const api = stubFetch((method, _path, body) =>
      method === 'PATCH' ? respond({ coupon: coupon({ is_active: (body as { is_active: boolean }).is_active }) }) : respond({ coupons: [coupon()] })
    );
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Switch off WELCOME50' }));
    expect(api.sent('PATCH', '/admin/coupons/c1')).toEqual([{ is_active: false }]);
    expect(await screen.findByRole('button', { name: 'Switch on WELCOME50' })).toBeInTheDocument();
  });

  it('edits without the code (it cannot change)', async () => {
    const user = userEvent.setup();
    const api = stubFetch((method, _path, body) =>
      method === 'PATCH' ? respond({ coupon: coupon(body as Partial<Coupon>) }) : respond({ coupons: [coupon()] })
    );
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Edit WELCOME50' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit WELCOME50' });
    expect(labelled(dialog, 'Code')).toBeDisabled();
    const amount = labelled(dialog, 'Amount off (LKR)');
    await user.clear(amount);
    await user.type(amount, '75');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    const [sent] = api.sent('PATCH', '/admin/coupons/c1');
    expect(sent).not.toHaveProperty('code');
    expect(sent).toMatchObject({ discount_type: 'FIXED', discount_value: 75, min_subtotal: 500, first_order_only: true, usage_limit: 100 });
  });
});

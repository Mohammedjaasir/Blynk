import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { HourChart, Sales } from '../pages/Sales';
import { CustomerDetail, Customers } from '../pages/Customers';
import { Cash, differenceText } from '../pages/Cash';
import { tokenStore } from '../api/client';
import type { CashReconciliation, CustomerRow, SalesReport } from '../api/types';
import { respond, stubFetch } from './fetchStub';
import { customerExportFilename, customerSheetRows } from '../lib/customerExport';
import * as productImport from '../lib/productImport';

/**
 * Sales dashboard, customer list/detail and rider cash on the Admin site.
 * The figures and their SQL (Asia/Colombo days) are tested against
 * PostgreSQL in backend/api/tests/admin-reports.test.ts and
 * cash-reconciliation.test.ts; here, what the pages ask for and show.
 */

const hours = (filled: Record<number, number>) => Array.from({ length: 24 }, (_, hour) => ({ hour, orders: filled[hour] ?? 0 }));

function report(overrides: Partial<SalesReport> = {}): SalesReport {
  return {
    range: { from: '2026-09-30', to: '2026-09-30', timezone: 'Asia/Colombo' },
    order_count: 12,
    delivered_count: 10,
    delivered_revenue: 15400,
    average_basket: 1540,
    cancelled_count: 2,
    discount_given: 250,
    delivery_fees: 1000,
    top_by_quantity: [
      { product_id: 'p1', name: 'Milk 1L', quantity: 14, revenue: 4200 },
      { product_id: 'p2', name: 'Bread', quantity: 9, revenue: 1350 },
    ],
    top_by_revenue: [{ product_id: 'p1', name: 'Milk 1L', quantity: 14, revenue: 4200 }],
    orders_by_hour: hours({ 9: 5, 18: 7 }),
    ...overrides,
  };
}

function customer(overrides: Partial<CustomerRow> = {}): CustomerRow {
  return {
    id: 'u1',
    full_name: 'Fathima Rizna',
    phone: '+94771234567',
    email: null,
    is_active: true,
    created_at: '2026-09-01T04:30:00.000Z',
    orders_count: 7,
    delivered_count: 6,
    delivered_spend: 8450.5,
    last_order_at: '2026-09-29T10:00:00.000Z',
    sms_language: 'ta',
    sms_offers: true,
    ...overrides,
  };
}

const wrap = (ui: JSX.Element, path = '/') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>{ui}</ToastProvider>
    </MemoryRouter>
  );

beforeEach(() => tokenStore.save('access', 'refresh'));
afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

describe('Sales page', () => {
  it('shows the figures, best sellers and hour chart for today', async () => {
    const api = stubFetch(() => respond(report()));
    wrap(<Sales />);
    const figures = await screen.findByLabelText('Sales figures');
    expect(figures).toHaveTextContent('12Orders');
    expect(figures).toHaveTextContent('LKR 15,400Delivered revenue');
    expect(figures).toHaveTextContent('LKR 1,540Average basket');
    expect(figures).toHaveTextContent('2Cancelled');
    expect(figures).toHaveTextContent('LKR 250Discounts given');
    expect(figures).toHaveTextContent('LKR 1,000Delivery fees');
    const byQty = screen.getByRole('table', { name: 'Best sellers by quantity' });
    expect(within(byQty).getAllByRole('row')[1]).toHaveTextContent('Milk 1L');
    expect(within(byQty).getAllByRole('row')[1]).toHaveTextContent('14');
    expect(screen.getByRole('img', { name: /Busiest: 18:00 with 7/ })).toBeInTheDocument();
    expect(api.paths()).toEqual(['/admin/reports/sales?range=today']);
  });

  it('asks for the chosen period', async () => {
    const user = userEvent.setup();
    const api = stubFetch(() => respond(report()));
    wrap(<Sales />);
    await screen.findByLabelText('Sales figures');
    await user.click(screen.getByRole('button', { name: 'Last 7 days' }));
    await screen.findByLabelText('Sales figures');
    expect(api.paths()).toContain('/admin/reports/sales?range=last_7_days');
    expect(screen.getByRole('button', { name: 'Last 7 days' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('draws bars in proportion, tallest full height', () => {
    render(<HourChart hours={hours({ 3: 2, 10: 4 })} />);
    const h = (n: number) => Number(screen.getByTestId(`hour-${n}`).getAttribute('height'));
    expect(h(10)).toBeGreaterThan(0);
    expect(h(3)).toBeCloseTo(h(10) / 2);
    expect(h(0)).toBe(0);
  });

  it('says when a period has no orders', () => {
    render(<HourChart hours={hours({})} />);
    expect(screen.getByRole('img', { name: 'No orders in this period.' })).toBeInTheDocument();
  });
});

describe('Customers page', () => {
  it('lists customers with orders, spend and last order, and searches', async () => {
    const user = userEvent.setup();
    const api = stubFetch(() => respond({ customers: [customer()], pagination: { page: 1, limit: 25, total: 1, total_pages: 1 } }));
    wrap(<Customers />);
    const table = await screen.findByRole('table', { name: 'Customers' });
    const row = within(table).getAllByRole('row')[1];
    expect(row).toHaveTextContent('Fathima Rizna');
    expect(row).toHaveTextContent('+94771234567');
    expect(row).toHaveTextContent('7');
    expect(row).toHaveTextContent('LKR 8,450.5');
    expect(row).toHaveTextContent('29 Sept 2026');
    expect(within(row).getByRole('link', { name: 'Fathima Rizna' })).toHaveAttribute('href', '/customers/u1');

    await user.type(screen.getByRole('searchbox', { name: 'Search customers' }), '0771234');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.click(await screen.findByRole('button', { name: 'Top spend' }));
    await screen.findByRole('table', { name: 'Customers' });
    const paths = api.paths();
    expect(paths[0]).toBe('/admin/customers?sort=recent&page=1&limit=25');
    expect(paths).toContain('/admin/customers?search=0771234&sort=recent&page=1&limit=25');
    expect(paths).toContain('/admin/customers?search=0771234&sort=spend&page=1&limit=25');
  });

  it('shows each customer’s SMS language and whether offer SMS are on', async () => {
    stubFetch(() =>
      respond({
        customers: [customer(), customer({ id: 'u2', full_name: 'Kasun Perera', sms_language: null, sms_offers: false })],
        pagination: { page: 1, limit: 25, total: 2, total_pages: 1 },
      })
    );
    wrap(<Customers />);
    const table = await screen.findByRole('table', { name: 'Customers' });
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(expect.arrayContaining(['SMS language', 'Offers']));
    const [, first, second] = within(table).getAllByRole('row');
    expect(first).toHaveTextContent('Tamil');
    expect(first).toHaveTextContent('On');
    expect(second).toHaveTextContent('—');
    expect(second).toHaveTextContent('Off');
  });

  it('downloads every customer as Excel, not just the page on screen', async () => {
    const user = userEvent.setup();
    const download = vi.spyOn(productImport, 'downloadBlob').mockImplementation(() => {});
    const api = stubFetch((_m, path) =>
      path.startsWith('/admin/customers/export')
        ? respond({ customers: [{ full_name: 'Fathima Rizna', phone: '+94771234567', is_active: true, created_at: '2026-09-01T04:00:00.000Z', orders_count: 7, delivered_spend: 8450.5, last_order_at: null, sms_language: 'en', sms_offers: true }] })
        : respond({ customers: [customer()], pagination: { page: 1, limit: 25, total: 1, total_pages: 1 } })
    );
    wrap(<Customers />);
    await screen.findByRole('table', { name: 'Customers' });
    await user.click(screen.getByRole('button', { name: 'Download Excel' }));
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(api.paths()).toContain('/admin/customers/export');
    const [blob, name] = download.mock.calls[0]!;
    expect((blob as Blob).type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(name).toMatch(/^blynk-customers-\d{4}-\d{2}-\d{2}\.xlsx$/);
    download.mockRestore();
  });

  it('says so when the download fails', async () => {
    const user = userEvent.setup();
    stubFetch((_m, path) =>
      path.startsWith('/admin/customers/export')
        ? respond({ code: 'FORBIDDEN', message: 'Admins only.' }, 403)
        : respond({ customers: [customer()], pagination: { page: 1, limit: 25, total: 1, total_pages: 1 } })
    );
    wrap(<Customers />);
    await screen.findByRole('table', { name: 'Customers' });
    await user.click(screen.getByRole('button', { name: 'Download Excel' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download Excel' })).toBeEnabled();
  });

  it('the sheet has name, both phone forms, figures, SMS language and offers, and keeps phones as text', () => {
    const rows = customerSheetRows([
      { full_name: '  Fathima Rizna ', phone: '+94771234567', is_active: true, created_at: '2026-09-01T04:00:00.000Z', orders_count: 7, delivered_spend: 8450.5, last_order_at: '2026-09-29T10:00:00.000Z', sms_language: 'si', sms_offers: true },
      { full_name: null, phone: '+94712223344', is_active: false, created_at: '2026-09-02T04:00:00.000Z', orders_count: 0, delivered_spend: 0, last_order_at: null, sms_language: null, sms_offers: false },
    ]);
    expect(rows[0]).toEqual(['Name', 'Phone', 'Phone (SMS format)', 'Orders', 'Delivered spend (LKR)', 'Last order', 'Joined', 'Account', 'SMS language', 'Offers by SMS']);
    expect(rows[1]).toEqual(['Fathima Rizna', '+94771234567', '94771234567', 7, 8450.5, '29 Sept 2026', '1 Sept 2026', 'Active', 'Sinhala', 'On']);
    expect(rows[2]).toEqual(['', '+94712223344', '94712223344', 0, 0, 'Never', '2 Sept 2026', 'Blocked', 'Not set', 'Off']);
    expect(typeof rows[1]![2]).toBe('string');
    expect(customerExportFilename(new Date('2026-10-04T20:00:00.000Z'))).toBe('blynk-customers-2026-10-05.xlsx');
  });

  it('pages through results', async () => {
    const user = userEvent.setup();
    const api = stubFetch(() => respond({ customers: [customer()], pagination: { page: 1, limit: 25, total: 60, total_pages: 3 } }));
    wrap(<Customers />);
    await user.click(await screen.findByRole('button', { name: 'Next' }));
    await screen.findByRole('table', { name: 'Customers' });
    expect(api.paths()).toContain('/admin/customers?sort=recent&page=2&limit=25');
  });

  it('shows one customer, their orders, and an order with its discount', async () => {
    const user = userEvent.setup();
    stubFetch((_m, path) => {
      if (path.startsWith('/admin/customers/u1')) {
        return respond({
          customer: { ...customer(), last_login_at: null },
          orders: [
            {
              id: 'o1',
              order_number: 'BL-20260929-0042',
              order_status: 'DELIVERED',
              payment_status: 'PAID',
              subtotal_amount: 600,
              delivery_fee: 100,
              discount_amount: 50,
              total_amount: 650,
              coupon_code: 'WELCOME50',
              placed_at: '2026-09-29T10:00:00.000Z',
              delivered_at: '2026-09-29T10:30:00.000Z',
              cancelled_at: null,
              item_count: 3,
            },
          ],
          pagination: { page: 1, limit: 20, total: 1, total_pages: 1 },
        });
      }
      return respond({
        order: {
          id: 'o1',
          order_number: 'BL-20260929-0042',
          order_status: 'DELIVERED',
          payment_method: 'COD',
          payment_status: 'PAID',
          subtotal_amount: 600,
          delivery_fee: 100,
          discount_amount: 50,
          coupon_code: 'WELCOME50',
          total_amount: 650,
          placed_at: '2026-09-29T10:00:00.000Z',
          scheduled_for: null,
          delivery_recipient_name: 'Fathima',
          delivery_recipient_phone: '+94771234567',
          delivery_address_line1: 'No. 1, Main Street',
          delivery_address_line2: null,
          delivery_city: 'Beruwala',
          delivery_instructions: null,
          cancellation_reason: null,
          items: [{ id: 'i1', product_name_snapshot: 'Milk 1L', quantity: 3, item_status: 'PACKED' }],
          history: [],
          delivery: null,
        },
      });
    });
    wrap(
      <Routes>
        <Route path="/customers/:id" element={<CustomerDetail />} />
      </Routes>,
      '/customers/u1'
    );
    expect(await screen.findByRole('heading', { name: 'Fathima Rizna' })).toBeInTheDocument();
    expect(screen.getByLabelText('Customer figures')).toHaveTextContent('LKR 8,450.5Delivered spend');
    expect(screen.getByLabelText('Customer figures')).toHaveTextContent('TamilSMS language');
    expect(screen.getByLabelText('Customer figures')).toHaveTextContent('OnOffers by SMS');
    const history = screen.getByRole('table', { name: 'Order history' });
    expect(history).toHaveTextContent('#0042');
    expect(history).toHaveTextContent('Delivered');
    expect(history).toHaveTextContent('LKR 650');
    await user.click(screen.getByRole('button', { name: 'Show order #0042' }));
    const details = await screen.findByLabelText('Order #0042 details');
    expect(details).toHaveTextContent('Milk 1L');
    expect(details).toHaveTextContent('Discount (WELCOME50)−LKR 50');
    expect(details).toHaveTextContent('Total · cash to collectLKR 650');
  });
});

describe('Rider cash page', () => {
  const recon = (overrides: Partial<CashReconciliation> = {}): CashReconciliation => ({
    date: '2026-09-30',
    timezone: 'Asia/Colombo',
    riders: [
      { rider_id: 'r1', rider_name: 'Kamal', rider_phone: '+94779876543', deliveries: 4, handins: 1, collected: 2600, handed_in: 2500, difference: -100, status: 'SHORT' },
      { rider_id: 'r2', rider_name: 'Nimal', rider_phone: '+94779876544', deliveries: 2, handins: 1, collected: 900, handed_in: 900, difference: 0, status: 'BALANCED' },
    ],
    totals: { collected: 3500, handed_in: 3400, difference: -100, status: 'SHORT' },
    ...overrides,
  });

  it('words a difference', () => {
    expect(differenceText(-100, 'SHORT')).toBe('Short LKR 100');
    expect(differenceText(20.5, 'OVER')).toBe('Over LKR 20.5');
    expect(differenceText(0, 'BALANCED')).toBe('Balanced');
  });

  it('shows collected against handed in per rider, short highlighted', async () => {
    stubFetch((_m, path) => (path.startsWith('/admin/cash/handins') ? respond({ handins: [] }) : respond(recon())));
    wrap(<Cash />);
    const table = await screen.findByRole('table', { name: 'Cash by rider' });
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Kamal');
    expect(rows[1]).toHaveTextContent('LKR 2,600');
    expect(rows[1]).toHaveTextContent('LKR 2,500');
    expect(rows[1]).toHaveClass('cash-row--short');
    expect(within(rows[1]).getByText('Short LKR 100')).toHaveClass('cash-diff--short');
    expect(within(rows[2]).getByText('Balanced')).toHaveClass('cash-diff--balanced');
    expect(rows[3]).toHaveTextContent('All riders');
  });

  it('records a hand-in for the chosen rider and day', async () => {
    const user = userEvent.setup();
    const api = stubFetch((method, path) => {
      if (path === '/admin/riders') return respond({ riders: [{ id: 'r1', full_name: 'Kamal', phone: '+94779876543', vehicle_type: 'MOTORCYCLE', vehicle_registration_number: 'X', open_deliveries: 0 }] });
      if (method === 'POST') {
        return respond({ handin: { id: 'h1', rider_id: 'r1', rider_name: 'Kamal', amount: 100, handin_date: '2026-09-30', note: 'Evening', recorded_by_name: 'Admin', created_at: '' } }, 201);
      }
      if (path.startsWith('/admin/cash/handins')) return respond({ handins: [] });
      return respond(recon());
    });
    wrap(<Cash />);
    await user.click(await screen.findByRole('button', { name: 'Record hand-in for Kamal' }));
    const dialog = screen.getByRole('dialog', { name: 'Record hand-in' });
    await within(dialog).findByRole('option', { name: 'Kamal' });
    await user.click(within(dialog).getByRole('button', { name: 'Record' }));
    expect(within(dialog).getByText('Enter the amount handed in.')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/^Amount/), '100');
    await user.type(within(dialog).getByLabelText(/^Note/), 'Evening');
    const day = (within(dialog).getByLabelText(/^Day/) as HTMLInputElement).value;
    await user.click(within(dialog).getByRole('button', { name: 'Record' }));
    expect(api.sent('POST', '/admin/cash/handins')).toEqual([{ rider_id: 'r1', amount: 100, handin_date: day, note: 'Evening' }]);
  });

  it('says so when nobody handled cash that day', async () => {
    stubFetch((_m, path) => (path.startsWith('/admin/cash/handins') ? respond({ handins: [] }) : respond(recon({ riders: [] }))));
    wrap(<Cash />);
    expect(await screen.findByText('No cash this day')).toBeInTheDocument();
  });
});

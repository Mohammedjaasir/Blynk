import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../App';
import { tokenStore } from '../api/client';
import type {
  Category,
  Insights,
  PayoutRequest,
  Seller,
  SellerOrder,
  SellerProduct,
  Statement,
  Submission,
} from '../api/types';
import { fail, ok, type Call, type Reply } from './mockApi';

export const SELLER_USER = { id: 'u1', phone: '+94771234567', full_name: null, email: null, role: 'SELLER' };

export function seller(overrides: Partial<Seller> = {}): Seller {
  return {
    id: 's1',
    shop_name: 'Nimal Farm',
    contact_name: 'Nimal',
    address: 'Galle Road, Colombo',
    note: null,
    status: 'APPROVED',
    rejection_reason: null,
    commission_percent: 10,
    created_at: '2026-10-01T04:30:00.000Z',
    ...overrides,
  };
}

export function submission(overrides: Partial<Submission> = {}): Submission {
  return {
    id: 'sub1',
    kind: 'NEW',
    status: 'PENDING',
    product_id: null,
    payload: { name: 'Mango Jam', category_id: 'c-jam', unit: '250 g' },
    seller_price: 300,
    approved_selling_price: null,
    reject_reason: null,
    created_at: '2026-10-20T04:30:00.000Z',
    reviewed_at: null,
    ...overrides,
  };
}

export function product(overrides: Partial<SellerProduct> = {}): SellerProduct {
  return {
    id: 'p1',
    name: 'Kithul Treacle',
    category_id: 'c-jam',
    category_name: 'Spreads',
    unit: '350 ml',
    pack_size: null,
    description: 'Pure treacle',
    image_url: null,
    barcode: null,
    is_active: true,
    is_available: true,
    seller_price: 450,
    selling_price: 520,
    stock_on_hand: 12,
    stock_reserved: 0,
    stock_tracked: true,
    units_sold: 30,
    live: true,
    pending: null,
    last_rejected: null,
    ...overrides,
  };
}

export function order(overrides: Partial<SellerOrder> = {}): SellerOrder {
  return {
    id: 'o1',
    order_number: '1283',
    placed_at: '2026-10-30T08:45:00.000Z',
    status: 'NEW',
    ready_at: null,
    can_mark_ready: true,
    items: [
      { product_id: 'p1', name: 'Apple Pie', quantity: 2 },
      { product_id: 'p2', name: 'Samosa', quantity: 1 },
    ],
    seller_amount: 1250,
    ...overrides,
  };
}

export const CATEGORIES: Category[] = [
  { id: 'c-pantry', name: 'Pantry', parent_id: null },
  { id: 'c-jam', name: 'Spreads', parent_id: 'c-pantry' },
  { id: 'c-rice', name: 'Rice', parent_id: 'c-pantry' },
  { id: 'c-fruit', name: 'Fruit', parent_id: null },
];

export function statement(overrides: Partial<Statement> = {}): Statement {
  return {
    commission_percent: 10,
    gross: 10000,
    commission: 1000,
    earned: 9000,
    paid: 6000,
    due: 3000,
    lines: [
      { product_id: 'p1', name: 'Kithul Treacle', units: 20, gross: 9000 },
      { product_id: 'p2', name: 'Mango Jam', units: 5, gross: 1000 },
    ],
    payouts: [{ id: 'po1', amount: 6000, note: 'Bank transfer', paid_on: '2026-10-15' }],
    ...overrides,
  };
}

export function payoutRequest(overrides: Partial<PayoutRequest> = {}): PayoutRequest {
  return {
    id: 'pr1',
    amount: 3000,
    method: 'BANK',
    bank_details: 'BOC Aluthgama, M. Nimal, 0012345678',
    note: null,
    status: 'REQUESTED',
    decline_reason: null,
    created_at: '2026-10-22T04:30:00.000Z',
    handled_at: null,
    ...overrides,
  };
}

export function insights(overrides: Partial<Insights> = {}): Insights {
  return {
    period: { from: '2026-10-18', to: '2026-10-24' },
    top: [
      {
        product_id: 'p1',
        name: 'Kithul Treacle',
        image_url: null,
        units: 18,
        units_prev_period: 12,
        gross: 8100,
        stock_on_hand: 6,
        days_of_stock_left: 2.4,
        restock_suggested: true,
      },
      {
        product_id: 'p2',
        name: 'Mango Jam',
        image_url: null,
        units: 9,
        units_prev_period: 12,
        gross: 2700,
        stock_on_hand: 40,
        days_of_stock_left: 31,
        restock_suggested: false,
      },
      {
        product_id: 'p3',
        name: 'Jaggery',
        image_url: null,
        units: 4,
        units_prev_period: 0,
        gross: 1000,
        stock_on_hand: null,
        days_of_stock_left: null,
        restock_suggested: false,
      },
    ],
    totals: { units: 31, gross: 11800, units_prev: 24 },
    ...overrides,
  };
}

export interface World {
  seller?: Seller;
  products?: SellerProduct[];
  statement?: Statement;
  orders?: SellerOrder[];
  /** Extra handler tried first. */
  extra?: (call: Call) => Reply | undefined;
}

/** A fake API for a signed-in seller. Anything not listed answers 404 NOT_MOCKED. */
export function worldHandler(world: World = {}) {
  return (call: Call): Reply | undefined => {
    const extra = world.extra?.(call);
    if (extra) return extra;
    const key = `${call.method} ${call.path}`;
    switch (key) {
      case 'GET /auth/me':
        return ok(SELLER_USER);
      case 'GET /seller/me':
        return ok({ seller: world.seller ?? seller(), counts: { products: 1, pending: 0 } });
      case 'GET /seller/categories':
        return ok({ categories: CATEGORIES });
      case 'GET /seller/products':
        return ok({ products: world.products ?? [] });
      case 'GET /seller/orders':
        return ok({ orders: world.orders ?? [] });
      case 'GET /seller/statement':
        return ok(world.statement ?? statement());
      case 'POST /auth/logout':
        return ok({});
    }
    return fail(404, 'NOT_MOCKED');
  };
}

export function signInStoredSession() {
  tokenStore.save('access-token', 'refresh-token');
}

export const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;

export function renderApp(path = '/products') {
  return render(
    <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
      <AppRoutes />
    </MemoryRouter>
  );
}

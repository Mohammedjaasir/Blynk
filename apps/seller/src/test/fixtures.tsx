import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../App';
import { tokenStore } from '../api/client';
import type { Category, Seller, SellerProduct, Statement, Submission } from '../api/types';
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
    units_sold: 30,
    live: true,
    pending: null,
    last_rejected: null,
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

export interface World {
  seller?: Seller;
  products?: SellerProduct[];
  statement?: Statement;
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

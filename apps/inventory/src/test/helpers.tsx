import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { AuthUser, StockRow, Supplier } from '../api/types';
import { AppRoutes } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { ToastProvider } from '../components/ui';

/**
 * A fake Blynk API for component tests. Handlers are keyed "METHOD /path"
 * (path relative to /api/v1, no query string) and answer with the same JSON
 * envelope the real backend uses. Every call is recorded so tests can assert
 * on exactly what the app sent.
 */
export interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body: any;
}
type Reply = { status: number; data?: unknown; error?: { code?: string; message: string } };
type Handler = (call: Call) => Reply | unknown;

export const ok = (data: unknown): Reply => ({ status: 200, data });
export const fail = (status: number, code: string, message = code): Reply => ({ status, error: { code, message } });

export function mockApi(handlers: Record<string, Handler>) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const method = (init?.method ?? 'GET').toUpperCase();
    const call: Call = { method, path, query: url.searchParams, body: init?.body ? JSON.parse(String(init.body)) : null };
    calls.push(call);

    const key = Object.keys(handlers).find((k) => {
      const [m, pattern] = k.split(' ');
      if (m !== method) return false;
      const re = new RegExp(`^${pattern.replace(/:[a-zA-Z]+/g, '[^/]+')}$`);
      return re.test(path);
    });
    const raw = key ? await handlers[key](call) : fail(404, 'NOT_MOCKED', `No mock for ${method} ${path}`);
    const reply: Reply =
      raw && typeof raw === 'object' && 'status' in (raw as object) ? (raw as Reply) : { status: 200, data: raw };
    const body = reply.status < 400 ? { success: true, data: reply.data } : { success: false, error: reply.error };
    return { ok: reply.status < 400, status: reply.status, text: async () => JSON.stringify(body) } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    calls,
    find: (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path),
  };
}

export const ADMIN: AuthUser = { id: 'a1', phone: '+94775551122', full_name: 'Nawaz Mansoor', role: 'ADMIN' };
export const STAFF: AuthUser = { id: 's1', phone: '+94774443322', full_name: 'Kasun Perera', role: 'PACKING_STAFF' };

/**
 * Empty-but-valid answers for every list the app can load, so a test only
 * declares the endpoints it is about. Specific routes come first: handler
 * keys are matched in order.
 */
export const EMPTY_API: Record<string, Handler> = {
  'GET /admin/inventory/adjustments': () => ok(pageOf('adjustments', [])),
  'GET /admin/inventory': () => ok(pageOf('inventory', [])),
  'GET /admin/orders': () => ok(pageOf('orders', [])),
  'GET /admin/suppliers': () => ok({ suppliers: [] }),
};

/** Renders the real routes as a signed-in user (token + /auth/me). */
export function renderAs(user: AuthUser | null, route: string, handlers: Record<string, Handler> = {}) {
  if (user) tokenStore.save('test-access', 'test-refresh');
  const api = mockApi({ 'GET /auth/me': () => ok(user), ...EMPTY_API, ...handlers });
  const utils = render(
    <MemoryRouter initialEntries={[route]}>
      <ToastProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>
  );
  return { ...utils, api };
}

export function stockRow(overrides: Partial<StockRow> = {}): StockRow {
  return {
    inventory_id: 'inv-1',
    product_id: 'p-milk',
    product_name: 'Kotmale Fresh Milk 1L',
    product_sku: 'SKU-DAI-001',
    product_unit: '1 L',
    category_name: 'Dairy & Eggs',
    is_active: true,
    is_available: true,
    tracking_mode: 'TRACKED',
    quantity_on_hand: 47,
    quantity_reserved: 0,
    quantity_available: 47,
    low_stock_threshold: 5,
    is_low_stock: false,
    updated_at: '2026-09-18T10:00:00.000Z',
    ...overrides,
  };
}

export const pageOf = <T,>(key: string, rows: T[], page = 1, totalPages = 1) => ({
  [key]: rows,
  pagination: { page, limit: 50, total: rows.length, total_pages: totalPages },
});

export function supplier(overrides: Partial<Supplier> = {}): Supplier {
  return {
    id: 'sup-1',
    name: 'Dharga Town Central Grocery',
    code: 'SUP-DHARGA-MAIN',
    contact_person: 'M. Rizwan',
    contact_phone: '+94342270000',
    address: 'Main Street, Dharga Town',
    notes: null,
    is_active: true,
    updated_at: '2026-09-16T05:00:00.000Z',
    ...overrides,
  };
}

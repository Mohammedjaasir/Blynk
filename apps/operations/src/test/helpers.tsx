import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { AuthUser } from '../api/types';
import { AppRoutes } from '../App';
import { AuthProvider } from '../auth/AuthContext';

/**
 * A fake Blynk API for component tests. Handlers are keyed "METHOD /path"
 * (path relative to /api/v1, no query string) and answer with the same JSON
 * envelope the real backend uses. Every call is recorded so tests can assert
 * on exactly what the app sent. Mirrors `apps/rider/src/test/helpers.tsx`'s
 * pattern exactly (a fresh implementation, not an import).
 */
export interface Call {
  method: string;
  path: string;
  body: any;
  /** Parsed query-string params (decoded) - several Home (F2) calls share
   * one path (e.g. `/admin/orders` with a different `status` each time), so
   * a handler tells them apart via this rather than the path alone. */
  query: Record<string, string>;
}
type Reply = { status: number; data?: unknown; error?: { code?: string; message: string; details?: unknown } };
type Handler = (call: Call) => Reply | unknown | Promise<Reply | unknown>;

export const ok = (data: unknown): Reply => ({ status: 200, data });
export const fail = (status: number, code: string, message = code): Reply => ({ status, error: { code, message } });
/** Makes fetch itself throw, the way a dropped connection does. */
export const NETWORK_DOWN = Symbol('network-down');

export function mockApi(handlers: Record<string, Handler>) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const method = (init?.method ?? 'GET').toUpperCase();
    // Task F5's `uploadImage` sends a `FormData` body (multipart, no JSON
    // encoding - see client.ts's `send()`), which `String(form)` collapses
    // to the useless literal `"[object FormData]"` - `JSON.parse` on that
    // throws, which made the mocked `fetch` itself reject, which client.ts
    // then reports as a generic `NETWORK` error (masking the real cause).
    // Reading the FormData's own entries instead keeps every other
    // (JSON-body) call's behaviour identical.
    const isFormBody = typeof FormData !== 'undefined' && init?.body instanceof FormData;
    const call: Call = {
      method,
      path,
      body: isFormBody ? Object.fromEntries((init!.body as FormData).entries()) : init?.body ? JSON.parse(String(init.body)) : null,
      query: Object.fromEntries(url.searchParams),
    };
    calls.push(call);

    const key = Object.keys(handlers).find((k) => {
      const [m, pattern] = k.split(' ');
      if (m !== method) return false;
      return new RegExp(`^${pattern.replace(/:[a-zA-Z]+/g, '[^/]+')}$`).test(path);
    });
    const raw = key ? await handlers[key](call) : fail(404, 'NOT_MOCKED', `No mock for ${method} ${path}`);
    if (raw === NETWORK_DOWN) throw new TypeError('Failed to fetch');
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

// Test fixtures only - shaped exactly like the backend's /auth/me response.
export const ADMIN_WITH_RIDER: AuthUser = {
  id: 'u-admin-1',
  phone: '+94775551122',
  full_name: 'Nawaz Mansoor',
  email: null,
  role: 'ADMIN',
};
export const ADMIN_NO_RIDER: AuthUser = {
  id: 'u-admin-2',
  phone: '+94775551133',
  full_name: 'Shanika Silva',
  email: null,
  role: 'ADMIN',
};
/** Backend migration 014: an Operations staff account, no rider profile. */
export const OPERATIONS_STAFF: AuthUser = {
  id: 'u-ops-1',
  phone: '+94771112233',
  full_name: 'Ops Person',
  email: 'ops@blynk.test',
  role: 'OPERATIONS',
};
export const CUSTOMER: AuthUser = {
  id: 'u-cust',
  phone: '+94771234567',
  full_name: 'Ahmed Rizvi',
  email: null,
  role: 'CUSTOMER',
};
export const RIDER: AuthUser = {
  id: 'u-rider',
  phone: '+94779876543',
  full_name: 'Farhan Mohamed',
  email: null,
  role: 'RIDER',
};
export const STAFF: AuthUser = {
  id: 'u-staff',
  phone: '+94774443322',
  full_name: 'Kasun Perera',
  email: null,
  role: 'PACKING_STAFF',
};

/**
 * Renders the real routes as a signed-in user (token + /auth/me). By
 * default `GET /riders/deliveries` succeeds with an empty list (an
 * ADMIN_PLUS_RIDER outcome) - override the handler per test for the
 * ADMIN_ONLY / error cases. Also defaults Home's (F2) own endpoints to
 * empty-but-real responses, so a test that lands on `/` for an unrelated
 * reason (auth flow, routing, layout) doesn't have to know about Home's
 * data needs - override any of these per test the same way.
 */
export function renderAs(user: AuthUser | null, route: string, handlers: Record<string, Handler> = {}) {
  if (user) tokenStore.save('test-access', 'test-refresh');
  const api = mockApi({
    'GET /auth/me': () => ok(user),
    'POST /auth/logout': () => ok({}),
    'GET /riders/deliveries': () => ok({ deliveries: [] }),
    'GET /admin/orders': () => ok({ orders: [] }),
    'GET /admin/riders': () => ok({ riders: [] }),
    'GET /admin/dental/appointments': () =>
      ok({ appointments: [], pagination: { page: 1, limit: 100, total: 0, total_pages: 1 } }),
    // The signed-in shell reads low-stock alerts once (components/LowStock.tsx).
    'GET /admin/inventory/low-stock': () => ok({ items: [], counts: { low: 0, out: 0, total: 0 } }),
    ...handlers,
  });
  const utils = render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </MemoryRouter>
  );
  return { ...utils, api };
}

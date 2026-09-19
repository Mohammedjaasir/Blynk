import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { AuthUser, DeliveryDetail, DeliverySummary } from '../api/types';
import { AppRoutes } from '../App';
import { AuthProvider } from '../auth/AuthContext';

/**
 * A fake Blynk API for component tests. Handlers are keyed "METHOD /path"
 * (path relative to /api/v1, no query string) and answer with the same JSON
 * envelope the real backend uses. Every call is recorded so tests can assert
 * on exactly what the app sent.
 */
export interface Call {
  method: string;
  path: string;
  body: any;
}
type Reply = { status: number; data?: unknown; error?: { code?: string; message: string; details?: unknown } };
type Handler = (call: Call) => Reply | unknown | Promise<Reply | unknown>;

export const ok = (data: unknown): Reply => ({ status: 200, data });
export const fail = (status: number, code: string, message = code): Reply => ({ status, error: { code, message } });
/** Makes fetch itself throw, the way a dropped connection does. */
export const NETWORK_DOWN = Symbol('network-down');
/** Makes fetch abort, the way the client's 15s timeout does. */
export const TIMED_OUT = Symbol('timed-out');

export function mockApi(handlers: Record<string, Handler>) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const method = (init?.method ?? 'GET').toUpperCase();
    const call: Call = { method, path, body: init?.body ? JSON.parse(String(init.body)) : null };
    calls.push(call);

    const key = Object.keys(handlers).find((k) => {
      const [m, pattern] = k.split(' ');
      if (m !== method) return false;
      return new RegExp(`^${pattern.replace(/:[a-zA-Z]+/g, '[^/]+')}$`).test(path);
    });
    const raw = key ? await handlers[key](call) : fail(404, 'NOT_MOCKED', `No mock for ${method} ${path}`);
    if (raw === NETWORK_DOWN) throw new TypeError('Failed to fetch');
    if (raw === TIMED_OUT) throw Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
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

// Test fixtures only - shaped exactly like the backend's rider responses.
export const RIDER: AuthUser = { id: 'u-rider', phone: '+94779876543', full_name: 'Farhan Mohamed', role: 'RIDER' };
export const CUSTOMER: AuthUser = { id: 'u-cust', phone: '+94771234567', full_name: 'Ahmed Rizvi', role: 'CUSTOMER' };
export const STAFF: AuthUser = { id: 'u-staff', phone: '+94774443322', full_name: 'Kasun Perera', role: 'PACKING_STAFF' };
export const ADMIN: AuthUser = { id: 'u-admin', phone: '+94775551122', full_name: 'Nawaz Mansoor', role: 'ADMIN' };

export function summary(overrides: Partial<DeliverySummary> = {}): DeliverySummary {
  return {
    delivery_id: 'd-1',
    order_id: 'o-1',
    assignment_status: 'ASSIGNED',
    assigned_at: '2026-09-18T09:00:00.000Z',
    accepted_at: null,
    picked_up_at: null,
    order_number: 'BLK-20260918-0001',
    order_status: 'PACKED',
    total_amount: 610,
    payment_method: 'COD',
    payment_status: 'PENDING',
    delivery_recipient_name: 'Rider Test',
    delivery_recipient_phone: '+94771234567',
    delivery_address_line1: 'No. 1, Test Lane',
    delivery_address_line2: null,
    delivery_city: 'Dharga Town',
    delivery_instructions: null,
    ...overrides,
  };
}

export function detail(overrides: Partial<DeliveryDetail> = {}): DeliveryDetail {
  return {
    ...summary(),
    rider_id: 'r-1',
    cod_collected_amount: 0,
    delivered_at: null,
    failed_at: null,
    failure_reason: null,
    items: [{ id: 'i-1', product_name_snapshot: 'Kotmale Fresh Milk 1L', quantity: 1, item_status: 'SOURCED' }],
    ...overrides,
  };
}

/** Renders the real routes as a signed-in user (token + /auth/me). */
export function renderAs(user: AuthUser | null, route: string, handlers: Record<string, Handler> = {}) {
  if (user) tokenStore.save('test-access', 'test-refresh');
  const api = mockApi({
    'GET /auth/me': () => ok(user),
    'POST /auth/logout': () => ok({}),
    'GET /riders/deliveries': () => ok({ deliveries: [] }),
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

// Seller orders (owner, 2026-10-30): "Order #1283 is ready" (data.type rider_order_ready, delivery_id) is
// handled like "New delivery assigned": a tap opens that delivery, one that arrives with the app open
// shows the banner and re-reads the screens at once.
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import { AuthProvider } from '../auth/AuthContext';
import { RiderPush } from '../components/RiderPush';
import { ASSIGNMENT_EVENT, ORDER_READY_PUSH, defaultPushTitle, deliveryIdOf } from '../lib/riderPush';
import { RIDER, mockApi, ok } from './helpers';

const listeners: Record<string, (payload: any) => void> = {};
vi.mock('@capacitor/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@capacitor/core')>();
  return { ...actual, Capacitor: { ...actual.Capacitor, getPlatform: () => 'android' } };
});
vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    createChannel: vi.fn(async () => undefined),
    checkPermissions: vi.fn(async () => ({ receive: 'granted' })),
    requestPermissions: vi.fn(async () => ({ receive: 'granted' })),
    addListener: vi.fn(async (event: string, cb: (payload: any) => void) => {
      listeners[event] = cb;
      return { remove: async () => undefined };
    }),
    register: vi.fn(async () => undefined),
  },
}));

beforeEach(() => {
  for (const k of Object.keys(listeners)) delete listeners[k];
});

function renderPush() {
  tokenStore.save('test-access', 'test-refresh');
  mockApi({ 'GET /auth/me': () => ok(RIDER), 'POST /me/devices': () => ok({}) });
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AuthProvider>
        <RiderPush />
        <Routes>
          <Route path="/" element={<p>Deliveries home</p>} />
          <Route path="/deliveries/:id" element={<p>Opened a delivery</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('rider_order_ready push', () => {
  it('reads the delivery id and names an untitled ready push', () => {
    const data = { type: ORDER_READY_PUSH, delivery_id: 'd-9', order_id: 'o-9' };
    expect(deliveryIdOf(data)).toBe('d-9');
    expect(defaultPushTitle(data)).toBe('Order is ready');
    expect(defaultPushTitle({ type: 'RIDER_ASSIGNED' })).toBe('New delivery assigned');
  });

  it('a tap on the notification opens that delivery', async () => {
    renderPush();
    await screen.findByText('Deliveries home');
    await vi.waitFor(() => expect(listeners.pushNotificationActionPerformed).toBeDefined());
    await act(async () => {
      listeners.pushNotificationActionPerformed({
        notification: { data: { type: ORDER_READY_PUSH, delivery_id: 'd-9', order_id: 'o-9' } },
      });
    });
    expect(await screen.findByText('Opened a delivery')).toBeInTheDocument();
  });

  it('one that arrives with the app open shows the banner, re-reads the screens, and the banner opens the delivery', async () => {
    const user = userEvent.setup();
    renderPush();
    await screen.findByText('Deliveries home');
    await vi.waitFor(() => expect(listeners.pushNotificationReceived).toBeDefined());
    const reread = vi.fn();
    window.addEventListener(ASSIGNMENT_EVENT, reread);
    await act(async () => {
      listeners.pushNotificationReceived({
        title: 'Order #1283 is ready',
        body: 'Pick up at Blynk Western.',
        data: { type: ORDER_READY_PUSH, delivery_id: 'd-9', order_id: 'o-9' },
      });
    });
    window.removeEventListener(ASSIGNMENT_EVENT, reread);
    expect(reread).toHaveBeenCalled();
    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent('Order #1283 is ready');
    expect(banner).toHaveTextContent('Pick up at Blynk Western.');
    await user.click(screen.getByRole('button', { name: /Order #1283 is ready/ }));
    expect(await screen.findByText('Opened a delivery')).toBeInTheDocument();
  });
});

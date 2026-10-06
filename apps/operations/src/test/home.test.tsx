import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import { ADMIN_NO_RIDER, ADMIN_WITH_RIDER, fail, ok, renderAs, type Call } from './helpers';

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

/**
 * Home's own endpoint handlers (resources.ts's `orders`/`riders`/`dental`
 * blocks). `GET /admin/orders` is called four times with a different
 * `status`, and `GET /admin/dental/appointments` twice with a different
 * `to` - both share one path, so each handler tells the calls apart via
 * `call.query` (helpers.tsx's F2 addition) rather than the path alone.
 */
function homeHandlers(
  opts: {
    needingPacking?: unknown[];
    readyForRider?: unknown[];
    onTheRoad?: unknown[];
    completedToday?: unknown[];
    appointmentsToday?: unknown[];
    appointmentsUpcoming?: unknown[];
    activeRiders?: unknown[];
    myDeliveries?: unknown[];
  } = {}
) {
  return {
    'GET /admin/orders': (call: Call) => {
      switch (call.query.status) {
        case 'PLACED,ITEM_UNAVAILABLE':
          return ok({ orders: opts.needingPacking ?? [] });
        case 'PACKED':
          return ok({ orders: opts.readyForRider ?? [] });
        case 'OUT_FOR_DELIVERY':
          return ok({ orders: opts.onTheRoad ?? [] });
        case 'DELIVERED':
          return ok({ orders: opts.completedToday ?? [] });
        default:
          return fail(400, 'UNEXPECTED_STATUS', `unexpected status ${call.query.status}`);
      }
    },
    'GET /admin/dental/appointments': (call: Call) => {
      const appointments = call.query.to === call.query.from ? opts.appointmentsToday : opts.appointmentsUpcoming;
      const rows = appointments ?? [];
      return ok({ appointments: rows, pagination: { page: 1, limit: 100, total: rows.length, total_pages: 1 } });
    },
    'GET /admin/riders': () => ok({ riders: opts.activeRiders ?? [] }),
    'GET /riders/deliveries': () => ok({ deliveries: opts.myDeliveries ?? [] }),
  };
}

const ACTIVE_DELIVERY = {
  delivery_id: 'del-1',
  order_id: 'o-1',
  assignment_status: 'PICKED_UP',
  order_number: 'BL-20260922-0001',
  order_status: 'OUT_FOR_DELIVERY',
  delivery_recipient_name: 'Priya Fernando',
  delivery_address_line1: '12 Galle Road',
  delivery_city: 'Colombo 3',
};

describe('Home', () => {
  it('renders every section from real mocked API responses, each number traced to its own call', async () => {
    renderAs(
      ADMIN_WITH_RIDER,
      '/',
      homeHandlers({
        myDeliveries: [ACTIVE_DELIVERY],
        needingPacking: [{ id: 'o-1' }, { id: 'o-2' }],
        readyForRider: [{ id: 'o-3' }],
        onTheRoad: [{ id: 'o-4' }, { id: 'o-5' }, { id: 'o-6' }, { id: 'o-7' }],
        completedToday: [{ id: 'o-8' }, { id: 'o-9' }, { id: 'o-10' }, { id: 'o-11' }, { id: 'o-12' }, { id: 'o-13' }],
        appointmentsToday: [{ id: 'a-1' }, { id: 'a-2' }, { id: 'a-3' }],
        appointmentsUpcoming: [{ id: 'a-1' }, { id: 'a-2' }, { id: 'a-3' }, { id: 'a-4' }, { id: 'a-5' }],
        activeRiders: [{ id: 'r-1' }, { id: 'r-2' }, { id: 'r-3' }, { id: 'r-4' }, { id: 'r-5' }, { id: 'r-6' }, { id: 'r-7' }],
      })
    );

    // Active delivery card - real fields from the mocked row.
    expect(await screen.findByText('#BL-20260922-0001')).toBeInTheDocument();
    expect(screen.getByText('12 Galle Road')).toBeInTheDocument();
    expect(screen.getByText('Priya Fernando')).toBeInTheDocument();
    // Same status Delivery's own screens would show for PICKED_UP/OUT_FOR_DELIVERY
    // (lib/delivery.ts's statusLabel()), not the raw assignment_status enum
    // (design-audit I5).
    expect(screen.getByText('On the way')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open delivery' })).toHaveAttribute('href', '/delivery/del-1');

    // Figures row - every count distinct so each assertion is unambiguous.
    expect(screen.getByRole('link', { name: '4 On the road' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '6 Completed today' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '3 Appointments today' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '5 Upcoming (7 days)' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '7 Active riders' })).toBeInTheDocument();

    // Needs-a-look section.
    expect(screen.getByText('2 orders need packing.')).toBeInTheDocument();
    expect(screen.getByText('1 order is packed, waiting for a rider.')).toBeInTheDocument();
  });

  it('omits the Active delivery section entirely for an ADMIN_ONLY session (no fetch, no empty state)', async () => {
    const { api } = renderAs(ADMIN_NO_RIDER, '/', {
      ...homeHandlers(),
      'GET /riders/deliveries': () => fail(403, 'RIDER_PROFILE_NOT_FOUND'),
    });

    expect(await screen.findByText('Nothing needs attention right now.')).toBeInTheDocument();
    expect(screen.queryByText('Active delivery')).not.toBeInTheDocument();
    expect(screen.queryByText('No active delivery right now.')).not.toBeInTheDocument();
    // Only the login-time capability probe asked - Home itself never did.
    expect(api.find('GET', '/riders/deliveries')).toHaveLength(1);
  });

  it('shows the Active delivery section with a real active delivery for an ADMIN_PLUS_RIDER session', async () => {
    renderAs(ADMIN_WITH_RIDER, '/', homeHandlers({ myDeliveries: [ACTIVE_DELIVERY] }));
    expect(await screen.findByText('Active delivery')).toBeInTheDocument();
    expect(screen.getByText('#BL-20260922-0001')).toBeInTheDocument();
  });

  it('shows an honest empty state when the session has rider capability but no active delivery', async () => {
    renderAs(
      ADMIN_WITH_RIDER,
      '/',
      homeHandlers({ myDeliveries: [{ ...ACTIVE_DELIVERY, assignment_status: 'DELIVERED' }] })
    );
    expect(await screen.findByText('No active delivery right now.')).toBeInTheDocument();
  });

  it('shows honest empty states (not a blank gap) when nothing needs attention', async () => {
    renderAs(ADMIN_NO_RIDER, '/', homeHandlers());
    expect(await screen.findByText('Nothing needs attention right now.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '0 On the road' })).toBeInTheDocument();
  });

  it('shows a real error with a retry action on a fetch failure, and recovers once retried', async () => {
    const user = userEvent.setup();
    let shouldFail = true;
    const handlers = {
      ...homeHandlers(),
      'GET /admin/orders': () => (shouldFail ? fail(500, 'INTERNAL', 'boom') : ok({ orders: [] })),
    };
    renderAs(ADMIN_NO_RIDER, '/', handlers);

    expect(await screen.findByText('The Blynk API had a problem. Try again in a moment.')).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Try again' });

    shouldFail = false;
    await user.click(retry);

    expect(await screen.findByText('Nothing needs attention right now.')).toBeInTheDocument();
  });

  it('proves every figure traces to its own mocked response - a bigger mocked list produces a bigger displayed number', async () => {
    renderAs(ADMIN_NO_RIDER, '/', homeHandlers({ onTheRoad: [{ id: 'o-1' }] }));
    expect(await screen.findByRole('link', { name: '1 On the road' })).toBeInTheDocument();
    cleanup();
    tokenStore.clear();
    vi.unstubAllGlobals();

    renderAs(ADMIN_NO_RIDER, '/', homeHandlers({ onTheRoad: [{ id: 'o-1' }, { id: 'o-2' }, { id: 'o-3' }] }));
    expect(await screen.findByRole('link', { name: '3 On the road' })).toBeInTheDocument();
  });

  it('counts from pagination.total, not the 100-row page', async () => {
    renderAs(ADMIN_NO_RIDER, '/', {
      ...homeHandlers(),
      'GET /admin/orders': (call: Call) => {
        const total = { 'PLACED,ITEM_UNAVAILABLE': 130, PACKED: 101, OUT_FOR_DELIVERY: 250, DELIVERED: 180 }[call.query.status as string] ?? 0;
        const orders = Array.from({ length: Math.min(100, total) }, (_, i) => ({ id: `o-${i}` }));
        return ok({ orders, pagination: { page: 1, limit: 100, total, total_pages: Math.ceil(total / 100) } });
      },
      'GET /admin/dental/appointments': (call: Call) => {
        const total = call.query.to === call.query.from ? 120 : 340;
        const appointments = Array.from({ length: 100 }, (_, i) => ({ id: `a-${i}` }));
        return ok({ appointments, pagination: { page: 1, limit: 100, total, total_pages: Math.ceil(total / 100) } });
      },
    });
    expect(await screen.findByRole('link', { name: '250 On the road' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '180 Completed today' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '120 Appointments today' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '340 Upcoming (7 days)' })).toBeInTheDocument();
    expect(screen.getByText('130 orders need packing.')).toBeInTheDocument();
    expect(screen.getByText('101 orders are packed, waiting for a rider.')).toBeInTheDocument();
  });
});

import { apiRequest } from './client';
import type { OrderMapRange } from './insights';

/**
 * Customer addresses and one location of the delivery map (owner,
 * 2026-10-11: "see number of order for the particular location" and "record
 * the address of each customer in admin"). Staff only - ADMIN and OPERATIONS
 * (the Operations app has the same views). Server: backend/api/src/modules/
 * reports/customers.service.ts and order-map.service.ts.
 */

/** A saved address with how many of the customer's orders went to it. */
export interface SavedAddress {
  id: string;
  label: string;
  recipient_name: string;
  recipient_phone: string;
  alternate_phone: string | null;
  address_line1: string;
  address_line2: string | null;
  city: string;
  postal_code: string | null;
  latitude: number;
  longitude: number;
  delivery_instructions: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  orders: number;
  delivered: number;
  last_order_at: string | null;
}

/** An address the customer's orders went to that matches no saved address (since edited or deleted). */
export interface UsedAddress {
  address_line1: string;
  address_line2: string | null;
  city: string;
  latitude: number;
  longitude: number;
  recipient_name: string;
  recipient_phone: string;
  orders: number;
  delivered: number;
  last_order_at: string | null;
}

export interface CustomerAddresses {
  customer: { id: string; full_name: string | null; phone: string };
  addresses: SavedAddress[];
  other_addresses: UsedAddress[];
}

/** GET /admin/customer-addresses row: no spend figures. */
export interface AddressBookRow {
  id: string;
  full_name: string | null;
  phone: string;
  orders_count: number;
  last_order_at: string | null;
  addresses_count: number;
  /** The default (else newest) saved address as one line. */
  default_address: string | null;
}

export interface MapCellAddress {
  address_line1: string;
  address_line2: string | null;
  city: string;
  orders: number;
  delivered: number;
  revenue: number;
  customers: number;
  last_order_at: string;
  lat: number;
  lng: number;
}

export interface MapCellOrder {
  id: string;
  order_number: string;
  order_status: string;
  total_amount: number;
  placed_at: string;
  customer_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  recipient_name: string;
  recipient_phone: string;
  address_line1: string;
  address_line2: string | null;
  city: string;
  latitude: number;
  longitude: number;
}

/** GET /admin/reports/order-map/cell: one ~150 m square of the map. */
export interface MapCellDetail {
  range: OrderMapRange;
  status: 'delivered' | 'all';
  period: { from: string; to: string };
  cell: string;
  lat: number;
  lng: number;
  totals: { orders: number; delivered: number; revenue: number; customers: number; addresses: number };
  addresses: MapCellAddress[];
  /** Newest first, at most 200 (the totals count every order). */
  orders: MapCellOrder[];
  orders_shown: number;
}

export const addresses = {
  /** GET /admin/customers/:id/addresses */
  forCustomer: (customerId: string) => apiRequest<CustomerAddresses>(`/admin/customers/${encodeURIComponent(customerId)}/addresses`),
  /** GET /admin/customer-addresses */
  book: (params: { search?: string; page?: number; limit?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    query.set('page', String(params.page ?? 1));
    query.set('limit', String(params.limit ?? 25));
    return apiRequest<{ customers: AddressBookRow[]; pagination: { page: number; limit: number; total: number; total_pages: number } }>(
      `/admin/customer-addresses?${query.toString()}`
    );
  },
  /** GET /admin/reports/order-map/cell */
  mapCell: (range: OrderMapRange, status: 'delivered' | 'all', cell: string) =>
    apiRequest<MapCellDetail>(`/admin/reports/order-map/cell?${new URLSearchParams({ range, status, cell }).toString()}`),
};

/** A pin on Google Maps, for staff to open the exact spot. */
export const mapsLink = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}`;

/** "No. 1, Main Street, Upper floor, Dharga Town" */
export const addressText = (a: { address_line1: string; address_line2?: string | null; city: string }) =>
  [a.address_line1, a.address_line2, a.city].filter((part) => part && part.trim()).join(', ');

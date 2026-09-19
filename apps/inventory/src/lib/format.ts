import type { AdjustmentType, ItemStatus, OrderStatus } from '../api/types';

const money = new Intl.NumberFormat('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatMoney = (value: number) => `Rs. ${money.format(value)}`;

/** Signed quantity for ledger deltas: "+24", "−3" (true minus sign). */
export const formatDelta = (delta: number) => (delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`);

const dateTime = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const dateOnly = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatDate = (iso: string) => dateOnly.format(new Date(iso));

export const ADJUSTMENT_LABEL: Record<AdjustmentType, string> = {
  PURCHASE_RESTOCK: 'Restock',
  DAMAGE_WRITE_OFF: 'Damage write-off',
  INVENTORY_AUDIT_ADJUSTMENT: 'Audit correction',
  ORDER_FULFILLMENT: 'Order fulfilment',
  ORDER_RESERVATION: 'Order reservation',
  ORDER_CANCELLATION_RESTORE: 'Cancellation restore',
};

export const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  PENDING: 'To source',
  SOURCED: 'Sourced',
  PACKED: 'Packed',
  UNAVAILABLE: 'Unavailable',
  SUBSTITUTED: 'Substituted',
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PLACED: 'Placed',
  PACKED: 'Packed',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  FAILED: 'Failed',
  CUSTOMER_UNAVAILABLE: 'Customer unavailable',
  ITEM_UNAVAILABLE: 'Item unavailable',
};

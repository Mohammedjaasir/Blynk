import { describe, it, expect } from 'vitest';
import { ApiError } from '../api/client';
import type { SellerOrderStatus } from '../api/types';
import {
  MIXED_MESSAGE,
  NOT_NEW_MESSAGE,
  isOpen,
  itemLine,
  newOrderCount,
  orderLabel,
  orderTime,
  readyErrorMessage,
} from '../lib/orders';
import { order } from './fixtures';

describe('order helpers', () => {
  it('writes the order number with one #', () => {
    expect(orderLabel({ order_number: '1283' })).toBe('#1283');
    expect(orderLabel({ order_number: 1283 })).toBe('#1283');
    expect(orderLabel({ order_number: '#1283' })).toBe('#1283');
  });

  it('writes an item line', () => {
    expect(itemLine({ name: 'Apple Pie', quantity: 2 })).toBe('2 x Apple Pie');
  });

  it('counts only NEW orders for the badge', () => {
    const list = [
      order({ id: 'a', status: 'NEW' }),
      order({ id: 'b', status: 'NEW' }),
      order({ id: 'c', status: 'READY' }),
      order({ id: 'd', status: 'DELIVERED' }),
    ];
    expect(newOrderCount(list)).toBe(2);
    expect(newOrderCount([])).toBe(0);
  });

  it('knows open orders from finished ones', () => {
    const open: SellerOrderStatus[] = ['NEW', 'READY', 'ON_THE_WAY'];
    expect(open.every((status) => isOpen(order({ status })))).toBe(true);
    expect(isOpen(order({ status: 'DELIVERED' }))).toBe(false);
    expect(isOpen(order({ status: 'CANCELLED' }))).toBe(false);
  });

  it('shows the time in Colombo, with Today and Yesterday', () => {
    const now = new Date('2026-10-30T10:00:00.000Z'); // 15:30 in Colombo
    expect(orderTime('2026-10-30T08:45:00.000Z', now)).toBe('Today, 2:15 pm');
    expect(orderTime('2026-10-29T18:45:00.000Z', now)).toBe('Today, 12:15 am');
    expect(orderTime('2026-10-29T08:45:00.000Z', now)).toBe('Yesterday, 2:15 pm');
    expect(orderTime('2026-10-20T08:45:00.000Z', now)).toBe('20 Oct, 2:15 pm');
    expect(orderTime('nope', now)).toBe('');
  });

  it('turns the ready refusals into the seller words', () => {
    expect(readyErrorMessage(new ApiError('x', 409, 'SELLER_ORDER_MIXED'))).toBe(MIXED_MESSAGE);
    expect(MIXED_MESSAGE).toBe('Blynk will collect this order.');
    expect(readyErrorMessage(new ApiError('x', 409, 'ORDER_NOT_NEW'))).toBe(NOT_NEW_MESSAGE);
    expect(readyErrorMessage(new ApiError('Server is down', 500, 'INTERNAL'))).toBe('Server is down');
  });
});

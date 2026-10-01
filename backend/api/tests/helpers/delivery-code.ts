import { pool } from '../../src/database/connection.js';

/**
 * The customer's proof-of-delivery code (migration 016) for a delivery's
 * order, read straight from the table - what the customer would show the
 * rider. '0000' when the order has none, so a test that never dispatched
 * still sends a well-formed body and gets the lifecycle's own refusal.
 */
export async function deliveryCodeForDelivery(deliveryId: string): Promise<string> {
  const row = (
    await pool.query<{ code: string }>(
      `SELECT c.code FROM order_delivery_codes c JOIN deliveries d ON d.order_id = c.order_id WHERE d.id = $1`,
      [deliveryId]
    ).catch(() => ({ rows: [] as { code: string }[] }))
  ).rows[0];
  return row?.code ?? '0000';
}

export async function deliveryCodeForOrder(orderId: string): Promise<string | null> {
  const row = (await pool.query<{ code: string }>(`SELECT code FROM order_delivery_codes WHERE order_id = $1`, [orderId])).rows[0];
  return row?.code ?? null;
}

/** A 4-digit code that is not this one. */
export const wrongCode = (code: string) => (code === '1111' ? '2222' : '1111');

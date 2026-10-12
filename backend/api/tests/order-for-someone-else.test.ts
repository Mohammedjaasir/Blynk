import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { checkoutSettings, settingsService, ORDER_FOR_SOMEONE_ELSE_KEY } from '../src/modules/configuration/settings.service.js';
import { NotificationTemplates } from '../src/modules/notifications/notification.templates.js';
import { stockFixtures, tokens, auth, users } from './helpers/stock.js';
import { customerFixtures, expectCreated } from './helpers/customers.js';
import { deliveryCodeForOrder } from './helpers/delivery-code.js';

/**
 * Order for family / someone else (owner, 2026-10-12; migration 042): the
 * buyer gives a receiver (name + Sri Lankan mobile) for one order without
 * editing the saved address; order texts and the delivery code go to the
 * receiver, the buyer also follows by SMS; the rider and Ops see the receiver,
 * the note and "needs help". Two staff switches (Admin + Ops): "Allow ordering
 * for someone else" and "Send delivery code to receiver". The setting row and
 * the audit entries this file writes are restored / removed afterwards.
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-FSE-');
const people = customerFixtures(app, { idPrefix: 'c0c00043', phoneBase: '+947094300', name: 'For Someone Else Buyer' });
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const RECEIVER = { name: 'Amma Fathima', phone: '0709450001' };
const RECEIVER_E164 = '+94709450001';
const NOTE = 'Blue gate, ring twice - call 0771112223 if no answer';

let productId = '';
let savedRow: { value: unknown; description: string | null; created_at: Date; updated_at: Date } | undefined;
let testStart: Date;
const pinned = checkoutSettings.read;

const patchCheckout = (body: object, token = tokens.admin) =>
  request(app).patch('/api/v1/admin/settings/checkout').set(auth(token)).send(body);
const smsFor = async (orderId: string) =>
  (
    await pool.query(
      `SELECT notification_type, recipient, payload, idempotency_key FROM notifications WHERE order_id = $1 AND channel = 'SMS' ORDER BY created_at, idempotency_key`,
      [orderId]
    )
  ).rows as Array<{ notification_type: string; recipient: string; payload: Record<string, unknown>; idempotency_key: string }>;

/** PLACED -> PACKED -> assigned -> picked up (OUT_FOR_DELIVERY). */
async function dispatch(orderId: string) {
  expect((await fx.pack(orderId)).status).toBe(200);
  const a = await fx.assign(orderId);
  expect(a.status, JSON.stringify(a.body)).toBe(200);
  const deliveryId = a.body.data.delivery.id as string;
  expect((await fx.riderStep(deliveryId, { status: 'PICKED_UP' })).status).toBe(200);
  return deliveryId;
}

beforeAll(async () => {
  // The real switches (the suite-wide pin leaves them out = defaults).
  checkoutSettings.read = () => settingsService.getCheckoutSettings();
  await people.purge();
  await fx.setup();
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  savedRow = (
    await pool.query('SELECT value, description, created_at, updated_at FROM system_configurations WHERE key = $1', [ORDER_FOR_SOMEONE_ELSE_KEY])
  ).rows[0];
  await pool.query('DELETE FROM system_configurations WHERE key = $1', [ORDER_FOR_SOMEONE_ELSE_KEY]);
  productId = (await fx.product({ tracked: false })).productId;
});

afterAll(async () => {
  checkoutSettings.read = pinned;
  await people.cleanup();
  await fx.cleanup();
  await pool.query('DELETE FROM system_configurations WHERE key = $1', [ORDER_FOR_SOMEONE_ELSE_KEY]);
  if (savedRow) {
    await pool.query(
      `INSERT INTO system_configurations (key, value, description, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)`,
      [ORDER_FOR_SOMEONE_ELSE_KEY, JSON.stringify(savedRow.value), savedRow.description, savedRow.created_at, savedRow.updated_at]
    );
  }
  await pool.query(`DELETE FROM audit_logs WHERE action = 'CHECKOUT_SETTINGS_UPDATED' AND created_at >= $1`, [testStart]);
});

describe('Placing an order for someone else', () => {
  it('stores the receiver, the note and "needs help" on the order only; the saved address is unchanged', async () => {
    const me = await people.customer(1);
    const order = await expectCreated(
      await me.placeOrder([{ product_id: productId, quantity: 1 }], {
        for_someone_else: true,
        recipient: RECEIVER,
        delivery_note: NOTE,
        needs_help: true,
      })
    );
    expect(order).toMatchObject({
      delivery_recipient_name: RECEIVER.name,
      delivery_recipient_phone: RECEIVER_E164,
      ordered_for_someone_else: true,
      delivery_needs_help: true,
      delivery_instructions: NOTE,
    });
    const address = (await pool.query('SELECT recipient_name, recipient_phone, delivery_instructions FROM customer_addresses WHERE id = $1', [me.addressId])).rows[0];
    expect(address).toEqual({ recipient_name: me.fullName, recipient_phone: me.phone, delivery_instructions: null });

    // Ops / Admin see it on the order.
    const staff = await request(app).get(`/api/v1/admin/orders/${order.id}`).set(auth(opsToken));
    expect(staff.status).toBe(200);
    expect(staff.body.data.order).toMatchObject({
      ordered_for_someone_else: true,
      delivery_needs_help: true,
      delivery_recipient_name: RECEIVER.name,
      delivery_recipient_phone: RECEIVER_E164,
      delivery_instructions: NOTE,
    });
  });

  it('an ordinary order is as before: the address recipient, no flags', async () => {
    const me = await people.customer(2);
    const order = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }]));
    expect(order).toMatchObject({
      delivery_recipient_name: me.fullName,
      delivery_recipient_phone: me.phone,
      ordered_for_someone_else: false,
      delivery_needs_help: false,
      delivery_instructions: null,
    });
  });

  it('validates the receiver', async () => {
    const me = await people.customer(3);
    const place = (extra: object) => me.placeOrder([{ product_id: productId, quantity: 1 }], extra);
    expect((await place({ for_someone_else: true })).status).toBe(400);
    expect((await place({ recipient: RECEIVER })).status).toBe(400);
    expect((await place({ for_someone_else: true, recipient: { name: 'A', phone: RECEIVER.phone } })).status).toBe(400);
    const landline = await place({ for_someone_else: true, recipient: { name: 'Amma', phone: '0112345678' } });
    expect(landline.status).toBe(400);
    expect(JSON.stringify(landline.body)).toContain('Sri Lankan mobile');
    expect((await place({ for_someone_else: true, recipient: { name: 'Amma', phone: '+447700900123' } })).status).toBe(400);
    expect((await place({ for_someone_else: true, recipient: { ...RECEIVER, extra: 1 } })).status).toBe(400);
    expect((await place({ needs_help: 'yes' })).status).toBe(400);
    expect((await place({ delivery_note: 'x'.repeat(501) })).status).toBe(400);
  });
});

describe('Who gets the order texts', () => {
  it('receiver gets the code; the buyer follows (on the way, cancelled, delivered); the note never goes in an SMS', async () => {
    const me = await people.customer(4);
    const order = await expectCreated(
      await me.placeOrder([{ product_id: productId, quantity: 1 }], { for_someone_else: true, recipient: RECEIVER, delivery_note: NOTE })
    );
    const deliveryId = await dispatch(order.id);
    const code = await deliveryCodeForOrder(order.id);
    expect(code).toMatch(/^\d{4}$/);

    let sms = await smsFor(order.id);
    expect(sms.map((s) => [s.notification_type, s.recipient])).toEqual([
      ['OUT_FOR_DELIVERY', RECEIVER_E164],
      ['OUT_FOR_DELIVERY', me.phone],
    ]);
    const [toReceiver, toBuyer] = sms;
    expect(toReceiver.payload).toMatchObject({ delivery_code: code });
    expect(NotificationTemplates.render('OUT_FOR_DELIVERY', toReceiver.payload)).toContain(`Delivery code: ${code}`);
    expect(toBuyer.payload.delivery_code).toBeUndefined();
    expect(toBuyer.payload.to_buyer).toBe(true);
    expect(toBuyer.idempotency_key.endsWith('_BUYER')).toBe(true);
    expect(NotificationTemplates.render('OUT_FOR_DELIVERY', toBuyer.payload)).toBe(
      `Blynk: Order #${order.order_number} is on the way to your receiver.`
    );

    // The rider sees the receiver, the note and the flags.
    const rider = await request(app).get(`/api/v1/riders/deliveries/${deliveryId}`).set(auth(tokens.rider));
    expect(rider.status).toBe(200);
    expect(rider.body.data.delivery).toMatchObject({
      delivery_recipient_name: RECEIVER.name,
      delivery_recipient_phone: RECEIVER_E164,
      delivery_instructions: NOTE,
      ordered_for_someone_else: true,
      delivery_needs_help: false,
    });
    const list = await request(app).get('/api/v1/riders/deliveries').set(auth(tokens.rider));
    const mine = (list.body.data.deliveries as Array<Record<string, unknown>>).find((d) => d.order_id === order.id);
    expect(mine).toMatchObject({ ordered_for_someone_else: true, delivery_needs_help: false, delivery_recipient_phone: RECEIVER_E164 });

    // Delivered: the buyer is told (they are not at the door); the receiver is not texted.
    expect((await fx.riderStep(deliveryId, { status: 'ARRIVED_AT_CUSTOMER' })).status).toBe(200);
    expect((await fx.collect(deliveryId, (await fx.orderRow(order.id)).total)).status).toBe(200);
    sms = await smsFor(order.id);
    expect(sms.filter((s) => s.notification_type === 'DELIVERED').map((s) => s.recipient)).toEqual([me.phone]);
    expect(sms.filter((s) => s.notification_type === 'COD_PAYMENT_CONFIRMED')).toEqual([]);

    // The code reaches only the buyer's and the receiver's numbers; the note reaches no SMS.
    const all = (await pool.query(`SELECT recipient, payload FROM notifications WHERE order_id = $1`, [order.id])).rows;
    for (const row of all) {
      expect(JSON.stringify(row.payload)).not.toContain('Blue gate');
      if (JSON.stringify(row.payload).includes(code!)) expect([RECEIVER_E164, me.phone]).toContain(row.recipient);
    }
  });

  it('a cancellation reaches both; the buyer\'s own reason reaches neither', async () => {
    const me = await people.customer(5);
    const order = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }], { for_someone_else: true, recipient: RECEIVER }));
    const res = await request(app).post(`/api/v1/orders/${order.id}/cancel`).set(auth(me.token)).send({ reason: 'Wrong address, call 0771234000' });
    expect(res.status).toBe(200);
    const sms = await smsFor(order.id);
    expect(sms.map((s) => s.recipient).sort()).toEqual([me.phone, RECEIVER_E164].sort());
    for (const s of sms) {
      expect(s.notification_type).toBe('ORDER_CANCELLED');
      expect(NotificationTemplates.render('ORDER_CANCELLED', s.payload)).not.toContain('0771234000');
    }
  });

  it('"Send delivery code to receiver" off: only the buyer\'s text carries the code', async () => {
    const off = await patchCheckout({ order_for_someone_else: { send_code_to_receiver: false } }, opsToken);
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(off.body.data.order_for_someone_else).toEqual({ enabled: true, send_code_to_receiver: false });
    const me = await people.customer(6);
    const order = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }], { for_someone_else: true, recipient: RECEIVER }));
    await dispatch(order.id);
    const code = await deliveryCodeForOrder(order.id);
    const sms = await smsFor(order.id);
    const toReceiver = sms.find((s) => s.recipient === RECEIVER_E164)!;
    const toBuyer = sms.find((s) => s.recipient === me.phone)!;
    expect(toReceiver.payload.delivery_code).toBeUndefined();
    expect(NotificationTemplates.render('OUT_FOR_DELIVERY', toReceiver.payload)).not.toContain(code!);
    expect(toBuyer.payload).toMatchObject({ delivery_code: code, to_buyer: true });
    expect(NotificationTemplates.render('OUT_FOR_DELIVERY', toBuyer.payload)).toContain(code!);
    expect((await patchCheckout({ order_for_someone_else: { send_code_to_receiver: true } })).status).toBe(200);
  });

  it('an ordinary order still sends one text, with the code, to the recipient phone', async () => {
    const me = await people.customer(7);
    const order = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }]));
    await dispatch(order.id);
    const sms = await smsFor(order.id);
    expect(sms).toHaveLength(1);
    expect(sms[0]).toMatchObject({ notification_type: 'OUT_FOR_DELIVERY', recipient: me.phone });
    expect(sms[0].payload.delivery_code).toBe(await deliveryCodeForOrder(order.id));
    expect(sms[0].payload.to_buyer).toBeUndefined();
  });

  it('the receiver is the buyer\'s own number: one text, with the code', async () => {
    const me = await people.customer(8);
    const order = await expectCreated(
      await me.placeOrder([{ product_id: productId, quantity: 1 }], { for_someone_else: true, recipient: { name: 'Me again', phone: me.phone } })
    );
    await dispatch(order.id);
    const sms = await smsFor(order.id);
    expect(sms).toHaveLength(1);
    expect(sms[0].payload.delivery_code).toBe(await deliveryCodeForOrder(order.id));
  });
});

describe('"Allow ordering for someone else" (Admin + Ops)', () => {
  it('off: such an order is refused; ordinary orders go ahead; checkout-info says so', async () => {
    const off = await patchCheckout({ order_for_someone_else: { enabled: false } });
    expect(off.status).toBe(200);
    expect(off.body.data.order_for_someone_else).toEqual({ enabled: false, send_code_to_receiver: true });
    const me = await people.customer(9);
    const info = (await request(app).get('/api/v1/orders/checkout-info').set(auth(me.token))).body.data;
    expect(info.order_for_someone_else).toEqual({ enabled: false, send_code_to_receiver: true });
    const refused = await me.placeOrder([{ product_id: productId, quantity: 1 }], { for_someone_else: true, recipient: RECEIVER });
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('FOR_SOMEONE_ELSE_DISABLED');
    await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }]));

    const audit = (
      await pool.query("SELECT old_values, new_values FROM audit_logs WHERE action = 'CHECKOUT_SETTINGS_UPDATED' ORDER BY created_at DESC LIMIT 1")
    ).rows[0];
    expect(audit.new_values).toEqual({ key: 'checkout', order_for_someone_else: { enabled: false, send_code_to_receiver: true } });

    expect((await patchCheckout({ order_for_someone_else: { enabled: true } }, opsToken)).status).toBe(200);
    expect((await patchCheckout({ order_for_someone_else: {} })).status).toBe(400);
    expect((await patchCheckout({ order_for_someone_else: { enabled: 'yes' } })).status).toBe(400);
    expect((await patchCheckout({ order_for_someone_else: { enabled: false } }, tokens.staff)).status).toBe(403);
  });
});

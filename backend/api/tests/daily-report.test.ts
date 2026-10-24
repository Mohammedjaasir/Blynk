import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { DAILY_REPORT_KEY } from '../src/modules/configuration/daily-report.js';
import { inventoryService } from '../src/modules/inventory/inventory.service.js';
import { NotificationTemplates } from '../src/modules/notifications/notification.templates.js';
import { buildDailyReport } from '../src/modules/daily-report/daily-report.builder.js';
import { gatherDailyReportData } from '../src/modules/daily-report/daily-report.data.js';
import { SEND_NOW_COOLDOWN_MS, colomboDate, isAutoSendDue, runDailyReport } from '../src/modules/daily-report/daily-report.sender.js';
import { orderingClock } from '../src/utils/time.js';
import { RIDER_A, auth, stockFixtures, tokens, users } from './helpers/stock.js';

/**
 * The daily report (owner, 2026-10-25): the setting (GET|PUT /admin/settings/daily-report), the data
 * gatherer for one Colombo day, the once-a-day job (idempotent, late send, never the next day),
 * preview and send-now. Orders are written straight into the database on 14 March 2031 (Colombo),
 * so the figures are exactly this file's whatever else the shared database holds. The stored
 * setting, the outbox rows, the fixtures and the audit entries are put back afterwards.
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-DR-');
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const P1 = '+94770000101';
const P2 = '+94770000102';
const DAY = '2031-03-14';
const SETTING = '/api/v1/admin/settings/daily-report';
const PREVIEW = '/api/v1/admin/daily-report/preview';
const SEND_NOW = '/api/v1/admin/daily-report/send-now';
const USER_IDS = ['d0ff0001-0000-0000-0000-000000000001', 'd0ff0001-0000-0000-0000-000000000002', 'd0ff0001-0000-0000-0000-000000000003', 'd0ff0001-0000-0000-0000-000000000004'];

type SavedRow = { value: unknown; description: string | null; created_at: Date; updated_at: Date } | null;
let saved: SavedRow = null;
let testStart: Date;
let basketId = '';
let apple = '';
let bread = '';
let store = '';
let seq = 0;
const pinnedClock = orderingClock.now;

const put = (body: unknown, token = tokens.admin) => request(app).put(SETTING).set(auth(token)).send(body as object);
const get = (token = tokens.admin) => request(app).get(SETTING).set(auth(token));
const setRow = async (value: object | null) => {
  if (value === null) {
    await pool.query('DELETE FROM system_configurations WHERE key = $1', [DAILY_REPORT_KEY]);
    return;
  }
  await pool.query(
    `INSERT INTO system_configurations (key, value, description) VALUES ($1, $2::jsonb, 'test')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [DAILY_REPORT_KEY, JSON.stringify(value)]
  );
};
const stored = async () => (await pool.query('SELECT value FROM system_configurations WHERE key = $1', [DAILY_REPORT_KEY])).rows[0]?.value;
const outbox = async (like = 'daily-report%') =>
  (await pool.query(`SELECT * FROM notifications WHERE notification_type = 'DAILY_REPORT' AND idempotency_key LIKE $1 ORDER BY idempotency_key`, [like])).rows;
const clearOutbox = () => pool.query(`DELETE FROM notifications WHERE notification_type = 'DAILY_REPORT' AND recipient = ANY($1)`, [[P1, P2]]);

async function insertOrder(o: {
  status: string;
  placedAt: string;
  total: number;
  tip?: number;
  walletTip?: number;
  cod?: number;
  repeat?: boolean;
  items?: { product: string; qty: number; price: number }[];
}) {
  seq += 1;
  const id = (
    await pool.query(
      `INSERT INTO orders (order_number, idempotency_key, customer_id, dark_store_id, order_status, subtotal_amount, delivery_fee, total_amount,
                           delivery_recipient_name, delivery_recipient_phone, delivery_address_line1, delivery_city, delivery_latitude, delivery_longitude,
                           placed_at, rider_tip, rider_tip_wallet, repeat_basket_id)
       VALUES ($1, $2, $3, $4, $5, $6, 100, $7, 'DR Test', '+94770000999', 'No. 1, Test Lane', 'Dharga Town', 6.4351, 80.0243, $8, $9, $10, $11) RETURNING id`,
      [`TST-DR-${seq}-${Date.now()}`, `tst-dr-${seq}-${Date.now()}`, users.customer.id, store, o.status, o.total - 100 - (o.tip ?? 0), o.total, o.placedAt, o.tip ?? 0, o.walletTip ?? 0, o.repeat ? basketId : null]
    )
  ).rows[0].id as string;
  fx.created.orders.push(id);
  for (const it of o.items ?? []) {
    await pool.query(
      `INSERT INTO order_items (order_id, product_id, product_name_snapshot, sku_snapshot, unit_snapshot, unit_selling_price, estimated_unit_cost, markup_percentage_applied, quantity, subtotal)
       VALUES ($1, $2, (SELECT name FROM products WHERE id = $2), (SELECT sku FROM products WHERE id = $2), '1 pc', $3, 80, 25, $4, $5)`,
      [id, it.product, it.price, it.qty, it.price * it.qty]
    );
  }
  if (o.status === 'DELIVERED') {
    await pool.query(`INSERT INTO deliveries (order_id, rider_id, assignment_status, cod_collected_amount, delivered_at) VALUES ($1, $2, 'DELIVERED', $3, $4)`, [
      id,
      RIDER_A,
      o.cod ?? o.total,
      o.placedAt,
    ]);
  }
  return id;
}

beforeAll(async () => {
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  saved = (await pool.query('SELECT value, description, created_at, updated_at FROM system_configurations WHERE key = $1', [DAILY_REPORT_KEY])).rows[0] ?? null;
  await fx.setup();
  await clearOutbox();
  store = (await pool.query('SELECT id FROM dark_stores WHERE is_active = true LIMIT 1')).rows[0].id;
  apple = (await fx.product({ tracked: false })).productId;
  bread = (await fx.product({ tracked: false })).productId;
  await fx.product({ tracked: true, onHand: 0 }); // running low

  basketId = (
    await pool.query(
      `INSERT INTO repeat_baskets (user_id, name, items, frequency, place_at, status)
       VALUES ($1, 'DR basket', $2::jsonb, 'DAILY', '09:00', 'PAUSED') RETURNING id`,
      [users.customer.id, JSON.stringify([{ product_id: bread, variant_id: null, quantity: 1 }])]
    )
  ).rows[0].id;

  // The day (14 March 2031, Colombo = UTC+5:30).
  const a = await insertOrder({ status: 'DELIVERED', placedAt: '2031-03-14T03:00:00Z', total: 650, tip: 50, items: [{ product: apple, qty: 3, price: 100 }, { product: bread, qty: 2, price: 100 }] });
  const b = await insertOrder({ status: 'DELIVERED', placedAt: '2031-03-14T05:00:00Z', total: 300, walletTip: 25, items: [{ product: bread, qty: 2, price: 100 }] });
  await insertOrder({ status: 'CANCELLED', placedAt: '2031-03-14T05:10:00Z', total: 200, items: [{ product: apple, qty: 1, price: 100 }] });
  await insertOrder({ status: 'PLACED', placedAt: '2031-03-14T15:20:00Z', total: 150, repeat: true }); // 20:50
  // Neighbouring days are not counted (23:50 the day before, 00:10 the day after).
  await insertOrder({ status: 'DELIVERED', placedAt: '2031-03-13T18:20:00Z', total: 999, items: [{ product: apple, qty: 9, price: 100 }] });
  await insertOrder({ status: 'PLACED', placedAt: '2031-03-14T18:40:00Z', total: 888 });

  await pool.query(`INSERT INTO order_ratings (order_id, user_id, stars, created_at) VALUES ($1, $3, 5, '2031-03-14T10:00:00Z'), ($2, $3, 4, '2031-03-14T11:00:00Z')`, [a, b, users.customer.id]);
  const mk = (n: number, role: string, at: string) =>
    pool.query(`INSERT INTO users (id, phone, full_name, role, created_at) VALUES ($1, $2, 'DR new', $3, $4)`, [USER_IDS[n], `+9477000020${n}`, role, at]);
  await mk(0, 'CUSTOMER', '2031-03-14T04:00:00Z');
  await mk(1, 'CUSTOMER', '2031-03-14T12:00:00Z');
  await mk(2, 'RIDER', '2031-03-14T04:00:00Z'); // not a customer
  await mk(3, 'CUSTOMER', '2031-03-13T04:00:00Z'); // the day before
}, 90_000);

afterAll(async () => {
  orderingClock.now = pinnedClock;
  await clearOutbox();
  await fx.cleanup();
  await pool.query('DELETE FROM repeat_baskets WHERE id = $1', [basketId]);
  await pool.query('DELETE FROM users WHERE id = ANY($1)', [USER_IDS]);
  await pool.query(`DELETE FROM audit_logs WHERE action IN ('DAILY_REPORT_UPDATED', 'DAILY_REPORT_SENT_NOW') AND created_at >= $1`, [testStart]);
  if (!saved) {
    await pool.query('DELETE FROM system_configurations WHERE key = $1', [DAILY_REPORT_KEY]);
  } else {
    await pool.query(
      `INSERT INTO system_configurations (key, value, description, created_at, updated_at)
       VALUES ($1, $2::jsonb, $3, $4, $5)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description,
         created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at`,
      [DAILY_REPORT_KEY, JSON.stringify(saved.value), saved.description, saved.created_at, saved.updated_at]
    );
  }
}, 60_000);

describe('data gatherer (one Colombo day)', () => {
  it('counts the day, leaves out the rider tips and the neighbouring days', async () => {
    const d = await gatherDailyReportData(DAY);
    expect(d.date).toBe(DAY);
    expect(d.orders_placed).toBe(4);
    expect(d.orders_delivered).toBe(2);
    expect(d.orders_cancelled).toBe(1);
    // 650 - 50 cash tip + 300 = 900: the rider's tips (cash inside the total, and the wallet tip) are not sales.
    expect(d.sales_lkr).toBe(900);
    expect(d.avg_basket_lkr).toBe(450);
    // What the riders recorded at the door: 650 (tip included) + 300.
    expect(d.cash_collected_lkr).toBe(950);
    expect(d.tips_lkr).toBe(75);
    expect(d.repeat_orders).toBe(1);
    expect(d.new_customers).toBe(2);
    expect(d.avg_rating).toBe(4.5);
    expect(d.ratings_count).toBe(2);
  });

  it('top products are the delivered lines by quantity; low stock is the live running-low list', async () => {
    const d = await gatherDailyReportData(DAY);
    const names = (await pool.query('SELECT id, name FROM products WHERE id = ANY($1)', [[apple, bread]])).rows;
    const nameOf = (id: string) => names.find((r) => r.id === id).name as string;
    expect(d.top_products).toEqual([
      { name: nameOf(bread), quantity: 4 },
      { name: nameOf(apple), quantity: 3 },
    ]);
    const low = await inventoryService.listLowStock();
    expect(d.low_stock_count).toBe(low.counts.total);
    expect(d.low_stock_count).toBeGreaterThanOrEqual(1);
    expect(d.low_stock_names).toEqual(low.items.slice(0, 3).map((i) => i.display_name));
  });

  it('an empty day is all zeros', async () => {
    const d = await gatherDailyReportData('2031-03-20');
    expect([d.orders_placed, d.orders_delivered, d.orders_cancelled, d.sales_lkr, d.cash_collected_lkr, d.avg_basket_lkr, d.new_customers, d.repeat_orders]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(d.top_products).toEqual([]);
    expect(d.avg_rating).toBeNull();
  });

  it('builds the SMS text from it', async () => {
    const t = buildDailyReport(await gatherDailyReportData(DAY));
    expect(t).toMatch(/^Blynk Fri 14 Mar: Orders 4 placed, 2 delivered, 1 cancelled\. Sales LKR 900\. Cash LKR 950\. Avg basket LKR 450\. New customers 2\./);
    expect(t).toMatch(/Rating 4\.5 \(2\)\. Repeat orders 1\. Tips LKR 75\.$/);
    expect(t.length).toBeLessThanOrEqual(480);
  });
});

describe('setting: GET|PUT /admin/settings/daily-report', () => {
  it('is off, 21:00 and empty when nothing is stored', async () => {
    await setRow(null);
    const res = await get(opsToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ enabled: false, send_at: '21:00', phones: [], last_sent_date: null, last_sent_at: null, last_manual_at: null, updated_at: null });
  });

  it('Admin and Operations save it; numbers are normalised and not repeated; audited', async () => {
    const res = await put({ phones: ['077 000 0101', '0770000101', '+94770000102'], send_at: '20:30' }, opsToken);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ enabled: false, send_at: '20:30', phones: [P1, P2] });
    const on = await put({ enabled: true });
    expect(on.status).toBe(200);
    expect(on.body.data).toMatchObject({ enabled: true, send_at: '20:30', phones: [P1, P2] });
    expect((await get(opsToken)).body.data.enabled).toBe(true);
    const audits = await pool.query(`SELECT count(*)::int n FROM audit_logs WHERE action = 'DAILY_REPORT_UPDATED' AND created_at >= $1`, [testStart]);
    expect(audits.rows[0].n).toBeGreaterThanOrEqual(2);
  });

  it('keeps what the sender wrote (last sent, cooldown)', async () => {
    const v = await stored();
    await setRow({ ...v, last_sent_date: '2031-01-01', last_sent_at: '2031-01-01T15:31:00.000Z', last_sent_kind: 'auto', last_manual_at: '2031-01-01T10:00:00.000Z' });
    const res = await put({ send_at: '21:15' });
    expect(res.body.data).toMatchObject({ send_at: '21:15', last_sent_date: '2031-01-01', last_sent_kind: 'auto', last_sent_at: '2031-01-01T15:31:00.000Z', last_manual_at: '2031-01-01T10:00:00.000Z' });
  });

  it('refuses bad input', async () => {
    for (const body of [
      {},
      { send_at: '9pm' },
      { send_at: '24:00' },
      { phones: ['0112345678'] },
      { phones: ['abc'] },
      { phones: [1, 2] },
      { phones: ['0770000101', '0770000102', '0770000103', '0770000104', '0770000105', '0770000106'] },
      { enabled: 'yes' },
      { enabled: true, phones: [] },
      { extra: 1, enabled: false },
    ]) {
      const res = await put(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    // Switching on with no number saved at all.
    await setRow({ enabled: false, send_at: '21:00', phones: [] });
    const none = await put({ enabled: true });
    expect(none.status).toBe(400);
    expect((await stored()).enabled).toBe(false);
  });

  it('only Admin and Operations', async () => {
    for (const token of [tokens.customer, tokens.staff, tokens.rider]) {
      expect((await get(token)).status).toBe(403);
      expect((await put({ enabled: false }, token)).status).toBe(403);
      expect((await request(app).post(PREVIEW).set(auth(token))).status).toBe(403);
      expect((await request(app).post(SEND_NOW).set(auth(token))).status).toBe(403);
    }
    expect((await request(app).get(SETTING)).status).toBe(401);
    expect((await request(app).post(SEND_NOW)).status).toBe(401);
  });
});

describe('isAutoSendDue (Colombo time)', () => {
  const base = { enabled: true, send_at: '21:00', phones: [P1], last_sent_date: null, last_sent_at: null, last_sent_kind: null, last_manual_at: null } as const;
  const at = (hhmm: string, day = DAY) => new Date(`${day}T${hhmm}:00+05:30`);

  it('waits for send_at, then sends once, up to 23:30', () => {
    expect(isAutoSendDue(base, at('20:59'))).toBe(false);
    expect(isAutoSendDue(base, at('21:00'))).toBe(true);
    expect(isAutoSendDue(base, at('22:41'))).toBe(true);
    expect(isAutoSendDue(base, at('23:30'))).toBe(true);
    expect(isAutoSendDue(base, at('23:31'))).toBe(false);
  });

  it('is never due the next morning for yesterday, and the date is the Colombo one', () => {
    expect(isAutoSendDue(base, at('00:05', '2031-03-15'))).toBe(false);
    expect(colomboDate(new Date('2031-03-14T18:40:00Z'))).toBe('2031-03-15');
    expect(isAutoSendDue({ ...base, last_sent_date: DAY }, at('21:30'))).toBe(false);
    expect(isAutoSendDue({ ...base, last_sent_date: '2031-03-13' }, at('21:30'))).toBe(true);
  });

  it('off, or without numbers, is never due; a late send_at still has its window', () => {
    expect(isAutoSendDue({ ...base, enabled: false }, at('21:30'))).toBe(false);
    expect(isAutoSendDue({ ...base, phones: [] }, at('21:30'))).toBe(false);
    expect(isAutoSendDue({ ...base, send_at: '23:45' }, at('23:44'))).toBe(false);
    expect(isAutoSendDue({ ...base, send_at: '23:45' }, at('23:45'))).toBe(true);
    expect(isAutoSendDue({ ...base, send_at: '23:45' }, at('23:59'))).toBe(true);
  });
});

describe('the job: once a day, late the same evening, never the next day', () => {
  const at = (hhmm: string, day = DAY) => new Date(`${day}T${hhmm}:00+05:30`);

  it('sends one outbox row per number, once', async () => {
    await clearOutbox();
    await setRow({ enabled: true, send_at: '21:00', phones: [P1, P2] });
    expect((await runDailyReport({ now: at('20:59') })).sent).toBe(false);
    expect(await outbox()).toHaveLength(0);

    const first = await runDailyReport({ now: at('21:00') });
    expect(first).toEqual({ sent: true, date: DAY, queued: 2 });
    const rows = await outbox();
    expect(rows.map((r) => [r.idempotency_key, r.recipient, r.channel, r.status])).toEqual([
      [`daily-report:${DAY}:${P1}`, P1, 'SMS', 'QUEUED'],
      [`daily-report:${DAY}:${P2}`, P2, 'SMS', 'QUEUED'],
    ]);
    const text = rows[0].payload.text as string;
    expect(text).toMatch(/^Blynk Fri 14 Mar: Orders 4 placed, 2 delivered, 1 cancelled\. Sales LKR 900\./);
    expect(rows[0].payload.report_date).toBe(DAY);
    // The outbox sends the text exactly as written.
    expect(NotificationTemplates.render('DAILY_REPORT', rows[0].payload)).toBe(text);
    const s = await stored();
    expect(s).toMatchObject({ last_sent_date: DAY, last_sent_kind: 'auto' });

    // A minute later, an hour later, a second worker: nothing more.
    expect((await runDailyReport({ now: at('21:01') })).sent).toBe(false);
    expect((await runDailyReport({ now: at('22:30') })).sent).toBe(false);
    expect(await outbox()).toHaveLength(2);
    await clearOutbox();
  });

  it('two workers at the same moment send it once', async () => {
    await setRow({ enabled: true, send_at: '21:00', phones: [P1, P2] });
    const results = await Promise.all([runDailyReport({ now: at('21:05') }), runDailyReport({ now: at('21:05') }), runDailyReport({ now: at('21:05') })]);
    expect(results.filter((r) => r.sent)).toHaveLength(1);
    expect(await outbox()).toHaveLength(2);
    await clearOutbox();
  });

  it('a missed time sends late the same evening, but not after 23:30 and not the next day', async () => {
    await setRow({ enabled: true, send_at: '21:00', phones: [P1] });
    expect((await runDailyReport({ now: at('23:31') })).sent).toBe(false);
    expect((await runDailyReport({ now: at('08:00', '2031-03-15') })).sent).toBe(false); // before today's time: nothing about yesterday
    expect(await outbox()).toHaveLength(0);

    const late = await runDailyReport({ now: at('22:47') });
    expect(late).toEqual({ sent: true, date: DAY, queued: 1 });
    expect(await outbox()).toHaveLength(1);

    // The next evening is a new day with its own report and its own key.
    const next = await runDailyReport({ now: at('21:00', '2031-03-15') });
    expect(next).toMatchObject({ sent: true, date: '2031-03-15' });
    expect((await outbox()).map((r) => r.idempotency_key)).toEqual([`daily-report:${DAY}:${P1}`, `daily-report:2031-03-15:${P1}`]);
    await clearOutbox();
  });

  it('a key already in the outbox is not queued twice even if the setting lost its last_sent_date', async () => {
    await setRow({ enabled: true, send_at: '21:00', phones: [P1] });
    expect((await runDailyReport({ now: at('21:10') })).queued).toBe(1);
    const v = await stored();
    await setRow({ ...v, last_sent_date: null });
    const again = await runDailyReport({ now: at('21:11') });
    expect(again.queued).toBe(0);
    expect(await outbox()).toHaveLength(1);
    await clearOutbox();
  });

  it('off, or without numbers, queues nothing', async () => {
    await setRow({ enabled: false, send_at: '21:00', phones: [P1] });
    expect((await runDailyReport({ now: at('21:30') })).sent).toBe(false);
    await setRow(null);
    expect((await runDailyReport({ now: at('21:30') })).sent).toBe(false);
    expect(await outbox()).toHaveLength(0);
  });
});

describe('POST /admin/daily-report/preview and /send-now', () => {
  it('preview returns today so far (Colombo), with its length and SMS parts, and sends nothing', async () => {
    await setRow({ enabled: false, send_at: '21:00', phones: [P1] });
    const res = await request(app).post(PREVIEW).set(auth(opsToken));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.date).toBe('2026-10-06');
    expect(res.body.data.text).toMatch(/^Blynk Tue 6 Oct: Orders \d+ placed, \d+ delivered, \d+ cancelled\. Sales LKR /);
    expect(res.body.data.chars).toBe(res.body.data.text.length);
    expect(res.body.data.parts).toBeGreaterThanOrEqual(1);
    expect(res.body.data.parts).toBeLessThanOrEqual(3);
    expect(await outbox('daily-report%')).toHaveLength(0);
  });

  it('send-now needs a saved number', async () => {
    await setRow(null);
    const res = await request(app).post(SEND_NOW).set(auth(tokens.admin));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('DAILY_REPORT_NO_RECIPIENTS');
  });

  it('send-now queues to every number, is audited, does not count as the day\'s automatic report, and cools down for 2 minutes', async () => {
    await setRow({ enabled: false, send_at: '21:00', phones: [P1, P2] });
    const first = await request(app).post(SEND_NOW).set(auth(opsToken));
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.data).toMatchObject({ recipients: 2, date: '2026-10-06' });
    expect(first.body.data.text).toMatch(/^Blynk Tue 6 Oct:/);
    const rows = await outbox('daily-report-now:%');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.recipient).sort()).toEqual([P1, P2]);
    expect(rows.every((r) => r.payload.text === first.body.data.text)).toBe(true);
    const s = await stored();
    expect(s).toMatchObject({ last_sent_kind: 'manual', last_sent_date: null });
    expect(s.last_manual_at).toBe(first.body.data.sent_at);
    const audits = await pool.query(`SELECT count(*)::int n FROM audit_logs WHERE action = 'DAILY_REPORT_SENT_NOW' AND created_at >= $1`, [testStart]);
    expect(audits.rows[0].n).toBe(1);

    const again = await request(app).post(SEND_NOW).set(auth(tokens.admin));
    expect(again.status).toBe(429);
    expect(again.body.error.code).toBe('DAILY_REPORT_COOLDOWN');
    expect(again.body.error.details.retry_after_seconds).toBeGreaterThan(0);
    expect(again.body.error.details.retry_after_seconds).toBeLessThanOrEqual(SEND_NOW_COOLDOWN_MS / 1000);
    expect(await outbox('daily-report-now:%')).toHaveLength(2);

    // Three minutes on.
    await setRow({ ...s, last_manual_at: new Date(orderingClock.now().getTime() - 3 * 60_000).toISOString() });
    const third = await request(app).post(SEND_NOW).set(auth(tokens.admin));
    expect(third.status).toBe(200);
    expect(await outbox('daily-report-now:%')).toHaveLength(4);

    // The automatic report of the day is still to come.
    await setRow({ ...(await stored()), enabled: true });
    expect((await runDailyReport({ now: new Date('2026-10-06T15:31:00Z') })).sent).toBe(true);
    await clearOutbox();
  });

  it('leaves no QUEUED report rows behind', async () => {
    await clearOutbox();
    const left = await pool.query(`SELECT count(*)::int n FROM notifications WHERE notification_type = 'DAILY_REPORT' AND status = 'QUEUED'`);
    expect(left.rows[0].n).toBe(0);
  });
});

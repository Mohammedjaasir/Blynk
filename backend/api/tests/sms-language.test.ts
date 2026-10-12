import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { NotificationTemplates } from '../src/modules/notifications/notification.templates.js';
import { LOCALIZED_SMS } from '../src/modules/notifications/sms-i18n.js';
import {
  CUSTOMER_SMS_LANGUAGE_KEY,
  customerSmsLanguageFrom,
  resolveSmsLanguage,
  type CustomerSmsLanguageSetting,
} from '../src/modules/notifications/sms-language.js';
import { smsParts } from '../src/modules/sms-offers/sms-offers.service.js';
import { otpSmsText } from '../src/modules/auth/auth.service.js';
import { riderRejectedSms, smsReason } from '../src/modules/riders/rider.applications.js';
import { stockFixtures, tokens, auth, users } from './helpers/stock.js';
import { customerFixtures, expectCreated } from './helpers/customers.js';

/**
 * Customer SMS language (owner, 2026-10-12): English only (default, today's
 * texts), the customer's own pick with a staff fallback, or always Sinhala /
 * Tamil, for the transactional texts. The setting row and the audit entries
 * this file writes are restored / removed afterwards.
 */
const app = createApp();
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });

const ORDER = 'BL-20261012-1234';
const START = '2026-10-13T05:00:00.000Z'; // 13 Oct 2026, 10:30 AM Colombo

/** Every customer-facing localized type with a realistic payload. */
const PAYLOADS: Array<[string, Record<string, unknown>]> = [
  ['ORDER_PLACED', { order_number: ORDER, total_amount: 2450 }],
  ['ORDER_PLACED', { order_number: ORDER, total_amount: 2450, scheduled_for: START }],
  ['ORDER_CANCELLED', { order_number: ORDER, cancelled_by: 'customer', reason: null }],
  ['ORDER_CANCELLED', { order_number: ORDER, cancelled_by: 'store', reason: 'Out of stock' }],
  ['ITEM_UNAVAILABLE', { order_number: ORDER, item_name: 'Anchor Milk 400g', new_total_amount: 1999.5 }],
  ['RIDER_ASSIGNED', { order_number: ORDER, rider_name: 'Nimal', vehicle_registration_number: 'BCD-1234' }],
  ['OUT_FOR_DELIVERY', { order_number: ORDER, total_amount: 2450, delivery_code: '0482' }],
  ['OUT_FOR_DELIVERY', { order_number: ORDER, total_amount: 2450 }],
  ['OUT_FOR_DELIVERY', { order_number: ORDER, total_amount: 2450, delivery_code: '0482', to_buyer: true }],
  ['DELIVERED', { order_number: ORDER }],
  ['COD_PAYMENT_CONFIRMED', { order_number: ORDER, amount: 2450 }],
  ['DENTAL_APPOINTMENT_CONFIRMED', { doctor_name: 'Perera', clinic_name: 'Smile Care', start_at: START, consultation_fee_snapshot: 1500 }],
  ['DENTAL_APPOINTMENT_CANCELLED', { doctor_name: 'Perera', clinic_name: 'Smile Care', start_at: START, cancelled_by: 'clinic', reason: 'Doctor unwell' }],
  ['DENTAL_APPOINTMENT_REMINDER', { title: 'Appointment tomorrow', body: 'x', doctor_name: 'Perera', clinic_name: 'Smile Care', start_at: START }],
  ['RIDER_APPROVED', { text: 'english' }],
  ['RIDER_REJECTED', { text: 'english', reason: 'Licence not clear' }],
];

const SINHALA = /[඀-෿]/;
const TAMIL = /[஀-௿]/;

describe('SMS templates per language (pure)', () => {
  it('without lang (or lang en) every text is exactly the English one', () => {
    for (const [type, payload] of PAYLOADS) {
      const english = NotificationTemplates.render(type, payload);
      expect(NotificationTemplates.render(type, { ...payload, lang: 'en' })).toBe(english);
      expect(english).not.toMatch(SINHALA);
      expect(english).not.toMatch(TAMIL);
    }
    expect(NotificationTemplates.render('OUT_FOR_DELIVERY', { order_number: ORDER, total_amount: 2450, delivery_code: '0482' })).toBe(
      `Blynk: Order #${ORDER} is on the way. Delivery code: 0482, show it to the rider. Keep LKR 2450.00 ready.`
    );
  });

  it('Sinhala and Tamil keep the order number, code, amounts and time identical', () => {
    for (const [lang, script] of [
      ['si', SINHALA],
      ['ta', TAMIL],
    ] as const) {
      const out = (type: string, payload: Record<string, unknown>) => NotificationTemplates.render(type, { ...payload, lang });
      const onTheWay = out('OUT_FOR_DELIVERY', { order_number: ORDER, total_amount: 2450, delivery_code: '0482' });
      expect(onTheWay).toMatch(script);
      expect(onTheWay).toContain(`#${ORDER}`);
      expect(onTheWay).toContain('0482');
      expect(onTheWay).toContain('LKR 2450.00');
      expect(onTheWay.startsWith('Blynk')).toBe(true);
      expect(out('OUT_FOR_DELIVERY', { order_number: ORDER, total_amount: 2450 })).not.toContain('0482');
      expect(out('ITEM_UNAVAILABLE', { order_number: ORDER, item_name: 'Anchor Milk 400g', new_total_amount: 1999.5 })).toContain(
        'LKR 1999.50'
      );
      const dental = out('DENTAL_APPOINTMENT_CONFIRMED', { doctor_name: 'Perera', clinic_name: 'Smile Care', start_at: START });
      // The same clinic date/time as the English text.
      expect(dental).toContain('Oct 13, 2026 at 10:30 AM');
      expect(NotificationTemplates.render('DENTAL_APPOINTMENT_CONFIRMED', { doctor_name: 'Perera', clinic_name: 'Smile Care', start_at: START })).toContain('Oct 13, 2026 at 10:30 AM');
      expect(dental).toContain('Dr. Perera');
      expect(out('ORDER_PLACED', { order_number: ORDER, total_amount: 10, scheduled_for: START })).toContain('10:30 AM');
      for (const [type, payload] of PAYLOADS) {
        const text = out(type, payload);
        expect(text, `${lang} ${type}`).toMatch(script);
        expect(text).not.toContain('undefined');
        expect(text).not.toContain('null');
      }
    }
  });

  it('a customer-written reason is never sent, in any language', () => {
    for (const lang of ['en', 'si', 'ta']) {
      const cancelled = NotificationTemplates.render('ORDER_CANCELLED', {
        order_number: ORDER,
        cancelled_by: 'customer',
        reason: 'call my neighbour 0771111111',
        lang,
      });
      expect(cancelled).not.toContain('neighbour');
      const dental = NotificationTemplates.render('DENTAL_APPOINTMENT_CANCELLED', {
        doctor_name: 'Perera',
        clinic_name: 'Smile Care',
        start_at: START,
        cancelled_by: 'customer',
        reason: 'my secret text',
        lang,
      });
      expect(dental).not.toContain('secret');
    }
    // A staff reason is still sent.
    expect(NotificationTemplates.render('ORDER_CANCELLED', { order_number: ORDER, cancelled_by: 'store', reason: 'Out of stock', lang: 'ta' })).toContain(
      'Out of stock'
    );
  });

  it('an older reminder row (title/body only) still goes out in English', () => {
    expect(NotificationTemplates.render('DENTAL_APPOINTMENT_REMINDER', { title: 'Appointment tomorrow', body: 'See you', lang: 'si' })).toBe(
      'Blynk: Appointment tomorrow - See you'
    );
    // An older rider rejection row (text only) too.
    expect(NotificationTemplates.render('RIDER_REJECTED', { text: riderRejectedSms('No licence'), lang: 'ta' })).toBe(riderRejectedSms('No licence'));
    expect(smsReason('y'.repeat(400))).toHaveLength(120);
  });

  it('the sign-in code SMS holds only the code, the brand and its validity', () => {
    expect(otpSmsText('123456', 2)).toBe('123456 is your Blynk code. Valid 2 min. Do not share it.');
    for (const lang of ['si', 'ta'] as const) {
      const text = otpSmsText('123456', 2, lang);
      expect(text.startsWith('123456 ')).toBe(true);
      expect(text).toContain('Blynk');
      expect(text).toMatch(lang === 'si' ? SINHALA : TAMIL);
      expect(text.match(/\d+/g)).toEqual(['123456', '2']);
      // One Unicode SMS part.
      expect(smsParts(text)).toBe(1);
    }
  });

  it('SMS length sanity: every Sinhala / Tamil text is at most 2 Unicode parts, most just 1-2', () => {
    const report: string[] = [];
    for (const lang of ['si', 'ta'] as const) {
      for (const [type, payload] of PAYLOADS) {
        const text = NotificationTemplates.render(type, { ...payload, lang });
        const parts = smsParts(text);
        report.push(`${lang} ${type} ${text.length} chars ${parts} parts`);
        // Unicode: 70 in one part, 67 per part after that.
        expect(parts, `${lang} ${type}: ${text}`).toBeLessThanOrEqual(type.startsWith('DENTAL') ? 3 : 2);
      }
      // The texts that go out most often stay short.
      expect(smsParts(LOCALIZED_SMS[lang].delivered(ORDER))).toBe(1);
      expect(smsParts(LOCALIZED_SMS[lang].outForDeliveryToBuyer(ORDER, '0482'))).toBe(1);
      expect(smsParts(LOCALIZED_SMS[lang].outForDelivery(ORDER, '2450.00', '0482'))).toBe(1);
    }
    expect(report.length).toBe(PAYLOADS.length * 2);
  });
});

describe('Language mode selection (pure)', () => {
  const setting = (mode: CustomerSmsLanguageSetting['mode'], fallback: CustomerSmsLanguageSetting['fallback'] = 'en') => ({ mode, fallback });

  it('English only (the default) ignores the customer pick', () => {
    expect(customerSmsLanguageFrom(undefined)).toEqual({ mode: 'ENGLISH_ONLY', fallback: 'en' });
    expect(customerSmsLanguageFrom({ mode: 'NONSENSE', fallback: 'xx' })).toEqual({ mode: 'ENGLISH_ONLY', fallback: 'en' });
    for (const pick of ['si', 'ta', 'en', null] as const) expect(resolveSmsLanguage(setting('ENGLISH_ONLY', 'si'), pick)).toBe('en');
  });

  it("customer's choice uses the pick, else the fallback", () => {
    expect(resolveSmsLanguage(setting('CUSTOMER_CHOICE', 'si'), 'ta')).toBe('ta');
    expect(resolveSmsLanguage(setting('CUSTOMER_CHOICE', 'si'), 'en')).toBe('en');
    expect(resolveSmsLanguage(setting('CUSTOMER_CHOICE', 'si'), null)).toBe('si');
    expect(resolveSmsLanguage(setting('CUSTOMER_CHOICE', 'ta'), undefined)).toBe('ta');
  });

  it('a forced language wins over the pick', () => {
    expect(resolveSmsLanguage(setting('ALWAYS_SINHALA'), 'ta')).toBe('si');
    expect(resolveSmsLanguage(setting('ALWAYS_TAMIL'), 'si')).toBe('ta');
  });
});

// ---------------------------------------------------------------------------
// The setting through the API, and the language on queued order texts.
// ---------------------------------------------------------------------------
const fx = stockFixtures(app, 'TST-SMSL-');
const people = customerFixtures(app, { idPrefix: 'c0c00042', phoneBase: '+947094200', name: 'SMS Language Customer' });
let savedRow: { value: unknown; description: string | null; created_at: Date; updated_at: Date } | undefined;
let testStart: Date;
let productId = '';

const patch = (body: object, token = tokens.admin) =>
  request(app).patch('/api/v1/admin/settings/customer-sms-language').set(auth(token)).send(body);
const deleteRow = () => pool.query('DELETE FROM system_configurations WHERE key = $1', [CUSTOMER_SMS_LANGUAGE_KEY]);

beforeAll(async () => {
  await people.purge();
  await fx.setup();
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  savedRow = (
    await pool.query('SELECT value, description, created_at, updated_at FROM system_configurations WHERE key = $1', [CUSTOMER_SMS_LANGUAGE_KEY])
  ).rows[0];
  productId = (await fx.product({ tracked: false })).productId;
});

afterAll(async () => {
  await people.cleanup();
  await fx.cleanup();
  await deleteRow();
  if (savedRow) {
    await pool.query(
      `INSERT INTO system_configurations (key, value, description, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)`,
      [CUSTOMER_SMS_LANGUAGE_KEY, JSON.stringify(savedRow.value), savedRow.description, savedRow.created_at, savedRow.updated_at]
    );
  }
  await pool.query(`DELETE FROM audit_logs WHERE action = 'CUSTOMER_SMS_LANGUAGE_UPDATED' AND created_at >= $1`, [testStart]);
});

describe('Customer SMS language setting (Admin + Operations)', () => {
  beforeEach(deleteRow);

  it('defaults to English only, with sample texts in each language', async () => {
    const res = await request(app).get('/api/v1/admin/settings/customer-sms-language').set(auth(opsToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ mode: 'ENGLISH_ONLY', fallback: 'en', updated_at: null });
    const samples = res.body.data.samples as Array<{ lang: string; text: string; parts: number }>;
    expect(samples.map((s) => s.lang)).toEqual(['en', 'si', 'ta']);
    expect(samples[0]).toMatchObject({ parts: 1 });
    expect(samples[1].text).toMatch(SINHALA);
    expect(samples[2].text).toMatch(TAMIL);
  });

  it('Admin and Operations change it, audited; only the fields sent change', async () => {
    const a = await patch({ mode: 'CUSTOMER_CHOICE', fallback: 'si' });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(a.body.data).toMatchObject({ mode: 'CUSTOMER_CHOICE', fallback: 'si' });
    const b = await patch({ fallback: 'ta' }, opsToken);
    expect(b.body.data).toMatchObject({ mode: 'CUSTOMER_CHOICE', fallback: 'ta' });
    const audit = (
      await pool.query(
        "SELECT old_values, new_values FROM audit_logs WHERE action = 'CUSTOMER_SMS_LANGUAGE_UPDATED' ORDER BY created_at DESC LIMIT 2"
      )
    ).rows;
    expect(audit[0].new_values).toEqual({ key: CUSTOMER_SMS_LANGUAGE_KEY, mode: 'CUSTOMER_CHOICE', fallback: 'ta' });
    expect(audit[0].old_values).toEqual({ key: CUSTOMER_SMS_LANGUAGE_KEY, mode: 'CUSTOMER_CHOICE', fallback: 'si' });
    expect(audit[1].old_values).toEqual({ key: CUSTOMER_SMS_LANGUAGE_KEY });
  });

  it('validates the body and the role', async () => {
    expect((await patch({})).status).toBe(400);
    expect((await patch({ mode: 'FRENCH' })).status).toBe(400);
    expect((await patch({ fallback: 'fr' })).status).toBe(400);
    expect((await patch({ mode: 'ALWAYS_TAMIL', extra: 1 })).status).toBe(400);
    expect((await patch({ mode: 'ALWAYS_TAMIL' }, tokens.staff)).status).toBe(403);
    expect((await patch({ mode: 'ALWAYS_TAMIL' }, tokens.customer)).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/settings/customer-sms-language')).status).toBe(401);
  });
});

describe('Order texts carry the language chosen when queued', () => {
  const cancelSms = async (orderId: string) =>
    (
      await pool.query(`SELECT recipient, payload FROM notifications WHERE order_id = $1 AND notification_type = 'ORDER_CANCELLED'`, [
        orderId,
      ])
    ).rows;
  const placeAndCancel = async (me: Awaited<ReturnType<typeof people.customer>>) => {
    const order = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }]));
    const res = await fx.setStatus(order.id, 'CANCELLED', tokens.admin, 'Out of stock');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return await cancelSms(order.id);
  };

  beforeEach(deleteRow);

  it('English only (no row): the payload has no lang - exactly as before', async () => {
    const me = await people.customer(1);
    await pool.query("UPDATE users SET sms_language = 'si' WHERE id = $1", [me.id]);
    const rows = await placeAndCancel(me);
    expect(rows).toHaveLength(1);
    expect(rows[0].payload.lang).toBeUndefined();
    expect(NotificationTemplates.render('ORDER_CANCELLED', rows[0].payload)).toContain('has been cancelled (Out of stock)');
  });

  it("customer's choice: the customer's pick, else the fallback", async () => {
    expect((await patch({ mode: 'CUSTOMER_CHOICE', fallback: 'ta' })).status).toBe(200);
    const picked = await people.customer(2);
    await pool.query("UPDATE users SET sms_language = 'si' WHERE id = $1", [picked.id]);
    expect((await placeAndCancel(picked))[0].payload.lang).toBe('si');

    const never = await people.customer(3);
    await pool.query('UPDATE users SET sms_language = NULL WHERE id = $1', [never.id]);
    const rows = await placeAndCancel(never);
    expect(rows[0].payload.lang).toBe('ta');
    expect(NotificationTemplates.render('ORDER_CANCELLED', rows[0].payload)).toMatch(TAMIL);
  });

  it('a forced language overrides the pick', async () => {
    expect((await patch({ mode: 'ALWAYS_SINHALA' })).status).toBe(200);
    const me = await people.customer(4);
    await pool.query("UPDATE users SET sms_language = 'ta' WHERE id = $1", [me.id]);
    expect((await placeAndCancel(me))[0].payload.lang).toBe('si');
  });
});

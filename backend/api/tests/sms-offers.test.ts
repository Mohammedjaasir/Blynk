import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { orderingClock } from '../src/utils/time.js';
import { env } from '../src/config/env.js';
import { OPT_OUT_LINE, enabledOfferLanguages, languageFor, smsParts } from '../src/modules/sms-offers/sms-offers.service.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { tokens, auth } from './helpers/stock.js';
import { customerFixtures } from './helpers/customers.js';

/**
 * SMS offers (migration 027): each customer gets the offer in their own
 * language (or the fallback), opted-out customers get nothing, and Admin and
 * Operations can send. The shared database holds other customers too, so the
 * checks look at this file's customers' outbox rows only.
 */
const app = createApp();
const people = customerFixtures(app, { idPrefix: 'c0c00027', phoneBase: '+947092700', name: 'Zqxoffer Shopper' });
const offerIds: string[] = [];
const opsToken = generateAccessToken({ id: 'a0000001-0000-0000-0000-000000000003', phone: '+94775551122', role: 'OPERATIONS' });

type Shopper = Awaited<ReturnType<typeof people.customer>>;
let tamil: Shopper;
let unset: Shopper;
let optedOut: Shopper;

const TEXT = { si: 'අද දීමනාව: එළවළු 10% අඩුවට', ta: 'இன்றைய சலுகை: காய்கறிகள் 10% தள்ளுபடி', en: 'Today only: vegetables 10% off' };

const offerSms = async (offerId: string, userId: string) =>
  (await pool.query(`SELECT payload FROM notifications WHERE payload->>'offer_id' = $1 AND user_id = $2`, [offerId, userId])).rows;

const launchLanguages = env.SMS_OFFER_LANGUAGES;

beforeAll(async () => {
  // Most of this file is about Sinhala and Tamil; launch is English only.
  env.SMS_OFFER_LANGUAGES = 'si,ta,en';
  await people.purge();
  tamil = await people.customer(1);
  unset = await people.customer(2);
  optedOut = await people.customer(3);
  await request(app).patch('/api/v1/me').set(auth(tamil.token)).send({ sms_language: 'ta' }).expect(200);
  await request(app).patch('/api/v1/me').set(auth(optedOut.token)).send({ sms_language: 'en', sms_offers: false }).expect(200);
});

afterAll(async () => {
  env.SMS_OFFER_LANGUAGES = launchLanguages;
  for (const id of offerIds) {
    await pool.query(`DELETE FROM notifications WHERE payload->>'offer_id' = $1`, [id]);
    await pool.query(`DELETE FROM audit_logs WHERE entity_type = 'sms_offer' AND entity_id = $1`, [id]);
    await pool.query('DELETE FROM sms_offers WHERE id = $1', [id]);
  }
  await pool.query(`DELETE FROM notifications WHERE idempotency_key LIKE 'sms-offer-test:%'`);
  await people.cleanup();
});

describe('SMS parts', () => {
  it('counts plain text at 160 per SMS and Sinhala/Tamil at 70', () => {
    expect(smsParts('Hello')).toBe(1);
    expect(smsParts('a'.repeat(160))).toBe(1);
    expect(smsParts('a'.repeat(161))).toBe(2);
    expect(smsParts('த'.repeat(70))).toBe(1);
    expect(smsParts('த'.repeat(71))).toBe(2);
  });
});

describe('offer languages switch', () => {
  it('is English only unless SMS_OFFER_LANGUAGES says otherwise', () => {
    expect(enabledOfferLanguages('en')).toEqual(['en']);
    expect(enabledOfferLanguages('')).toEqual(['en']);
    expect(enabledOfferLanguages('si, ta,en')).toEqual(['si', 'ta', 'en']);
    expect(enabledOfferLanguages('fr')).toEqual(['en']);
  });

  it('sends a customer their language only while it is switched on', () => {
    expect(languageFor('ta', 'si', ['en'])).toBe('en');
    expect(languageFor(null, 'si', ['en'])).toBe('en');
    expect(languageFor('ta', 'si', ['si', 'ta', 'en'])).toBe('ta');
    expect(languageFor(null, 'si', ['si', 'ta', 'en'])).toBe('si');
  });
});

describe('customer SMS preferences', () => {
  it('saves the language and the offers switch on the profile', async () => {
    const res = await request(app).get('/api/v1/me').set(auth(optedOut.token)).expect(200);
    expect(res.body.data.profile.sms_language).toBe('en');
    expect(res.body.data.profile.sms_offers).toBe(false);
    const fresh = await request(app).get('/api/v1/me').set(auth(unset.token)).expect(200);
    expect(fresh.body.data.profile.sms_language).toBeNull();
    expect(fresh.body.data.profile.sms_offers).toBe(true);
  });

  it('refuses a language the app does not offer', async () => {
    await request(app).patch('/api/v1/me').set(auth(unset.token)).send({ sms_language: 'fr' }).expect(400);
  });
});

describe('sending an offer', () => {
  it('is for Admin and Operations only', async () => {
    const body = { audience: 'ALL', fallback_language: 'si', messages: TEXT };
    await request(app).post('/api/v1/admin/sms-offers/estimate').set(auth(tamil.token)).send(body).expect(403);
    await request(app).post('/api/v1/admin/sms-offers/estimate').set(auth(tokens.staff)).send(body).expect(403);
  });

  it('estimates recipients per language, leaving out customers who opted out', async () => {
    const res = await request(app)
      .post('/api/v1/admin/sms-offers/estimate')
      .set(auth(tokens.admin))
      .send({ audience: 'ALL', fallback_language: 'si', messages: TEXT })
      .expect(200);
    const e = res.body.data.estimate;
    expect(e.by_language.ta).toBeGreaterThanOrEqual(1);
    expect(e.opted_out).toBeGreaterThanOrEqual(1);
    expect(e.recipients).toBe(e.by_language.si + e.by_language.ta + e.by_language.en);
    expect(e.missing_languages).toEqual([]);
    expect(e.parts_per_sms.ta).toBe(smsParts(`${TEXT.ta}\n${OPT_OUT_LINE.ta}`));
  });

  it('refuses when a language some customers get has no text', async () => {
    const res = await request(app)
      .post('/api/v1/admin/sms-offers')
      .set(auth(tokens.admin))
      .send({ audience: 'ALL', fallback_language: 'si', messages: { si: TEXT.si } })
      .expect(400);
    expect(res.body.error.code).toBe('OFFER_TEXT_MISSING');
    expect(res.body.error.details.missing_languages).toContain('ta');
  });

  it('refuses outside 8 AM - 9 PM', async () => {
    const pinned = orderingClock.now;
    orderingClock.now = () => new Date('2026-10-06T17:00:00.000Z'); // 10:30 PM in Colombo
    try {
      const res = await request(app)
        .post('/api/v1/admin/sms-offers')
        .set(auth(tokens.admin))
        .send({ audience: 'ALL', fallback_language: 'si', messages: TEXT })
        .expect(422);
      expect(res.body.error.code).toBe('OUTSIDE_SENDING_HOURS');
    } finally {
      orderingClock.now = pinned;
    }
  });

  it('queues one SMS per customer in their language, with the opt-out line', async () => {
    const res = await request(app)
      .post('/api/v1/admin/sms-offers')
      .set(auth(opsToken))
      .send({ audience: 'ALL', fallback_language: 'si', messages: TEXT })
      .expect(201);
    const offer = res.body.data.offer;
    offerIds.push(offer.id);
    expect(offer.recipients).toBeGreaterThanOrEqual(2);

    const [toTamil] = await offerSms(offer.id, tamil.id);
    expect(toTamil.payload.text).toBe(`${TEXT.ta}\n${OPT_OUT_LINE.ta}`);
    const [toUnset] = await offerSms(offer.id, unset.id);
    expect(toUnset.payload.text).toBe(`${TEXT.si}\n${OPT_OUT_LINE.si}`); // the fallback
    expect(await offerSms(offer.id, optedOut.id)).toHaveLength(0);

    const list = await request(app).get('/api/v1/admin/sms-offers').set(auth(tokens.admin)).expect(200);
    expect(list.body.data.offers[0].id).toBe(offer.id);
    expect(list.body.data.offers[0].recipient_count).toBe(offer.recipients);
  });

  it('English only (launch): every customer gets the English text, whatever they picked', async () => {
    env.SMS_OFFER_LANGUAGES = 'en';
    try {
      const estimate = await request(app)
        .post('/api/v1/admin/sms-offers/estimate')
        .set(auth(tokens.admin))
        .send({ audience: 'ALL', fallback_language: 'si', messages: { en: TEXT.en } })
        .expect(200);
      expect(estimate.body.data.estimate.languages).toEqual(['en']);
      expect(estimate.body.data.estimate.missing_languages).toEqual([]);
      expect(estimate.body.data.estimate.by_language.ta).toBe(0);

      const res = await request(app)
        .post('/api/v1/admin/sms-offers')
        .set(auth(tokens.admin))
        .send({ audience: 'ALL', fallback_language: 'si', messages: { en: TEXT.en } })
        .expect(201);
      offerIds.push(res.body.data.offer.id);
      const [toTamil] = await offerSms(res.body.data.offer.id, tamil.id);
      expect(toTamil.payload.text).toBe(`${TEXT.en}
${OPT_OUT_LINE.en}`);
    } finally {
      env.SMS_OFFER_LANGUAGES = 'si,ta,en';
    }
  });

  it('sends a test to the staff member’s own phone only', async () => {
    const res = await request(app)
      .post('/api/v1/admin/sms-offers/test')
      .set(auth(tokens.admin))
      .send({ language: 'ta', message: TEXT.ta })
      .expect(202);
    expect(res.body.data.sent_to).toMatch(/^\+947\d{2}\*{4}\d{2}$/);
    const rows = (await pool.query(`SELECT recipient, payload FROM notifications WHERE idempotency_key LIKE 'sms-offer-test:%'`)).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].payload.text).toBe(`${TEXT.ta}\n${OPT_OUT_LINE.ta}`);
  });
});

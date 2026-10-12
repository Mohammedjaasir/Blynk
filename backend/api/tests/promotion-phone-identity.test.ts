import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool, db } from '../src/database/connection.js';
import { authRateLimiter } from '../src/modules/auth/auth.rate-limiter.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { evaluateCoupon } from '../src/modules/coupons/coupon.service.js';
import { freeDeliveryStatus } from '../src/modules/orders/free-delivery.js';
import { birthdayOfferStatus } from '../src/modules/birthday/birthday.offer.js';
import { applyReferralCode, referralCodeFor, referralSettings } from '../src/modules/referrals/referral.service.js';
import { referralProgramFrom } from '../src/modules/referrals/referral.rules.js';
import { phoneHash } from '../src/modules/users/phone-identity.js';
import { orderingClock } from '../src/utils/time.js';
import type { BirthdayOfferSetting } from '../src/modules/configuration/settings.service.js';
import { customerFixtures, expectCreated } from './helpers/customers.js';

/**
 * Security audit 2026-10 (migration 041): deleting the account (DELETE /me)
 * and registering again with the same number must not reset any per-customer
 * promotion limit. Usage is counted across every account that shares the
 * number's users.phone_hash.
 */
const app = createApp();
const people = customerFixtures(app, { idPrefix: 'c0c00041', phoneBase: '+947704100', name: 'Same Number Customer' });
const MILK = 'b0000001-0000-0000-0000-000000000001';
const ONCE = 'TSTONCE41';
const FIRST = 'TSTFIRST41';
const FREE = { enabled: true, count: 2, since: '2026-01-01T00:00:00.000Z' };
const BIRTHDAY: BirthdayOfferSetting = { enabled: true, percent: 15, sms_enabled: false, sms_text: '' };
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const couponError = async (code: string, customerId: string) => {
  try {
    await evaluateCoupon(db, { code, customerId, subtotal: 1000, deliveryFee: 100 });
    return null;
  } catch (err) {
    return (err as { code?: string }).code ?? 'UNKNOWN';
  }
};

describe('Promotion limits survive delete + re-register with the same number', () => {
  const realReferralRead = referralSettings.read;
  let samePhone = '';
  const newIds: string[] = [];

  beforeAll(async () => {
    await people.purge(3);
    await pool.query('DELETE FROM coupon_redemptions WHERE coupon_id IN (SELECT id FROM coupons WHERE code = ANY($1))', [[ONCE, FIRST]]);
    await pool.query('DELETE FROM coupons WHERE code = ANY($1)', [[ONCE, FIRST]]);
    await pool.query(
      `INSERT INTO coupons (code, discount_type, discount_value, per_customer_limit, first_order_only)
       VALUES ($1, 'FIXED', 100, 1, false), ($2, 'FIXED', 100, 5, true)`,
      [ONCE, FIRST]
    );
    // The program switch is read through referralSettings.read ("Tests may replace it").
    // The friend's reward (LKR 50) is smaller than the coupon (LKR 100), so the
    // first order takes the coupon (the larger discount wins; the other is not spent).
    referralSettings.read = async () => ({ ...referralProgramFrom({}), enabled: true, mode: 'LKR_OFF', friend_amount_lkr: 50 });
  });

  afterAll(async () => {
    referralSettings.read = realReferralRead;
    const userIds = [...newIds, ...[1, 2, 3].map((n) => `c0c00041-0000-0000-0000-${String(n).padStart(12, '0')}`)];
    await pool.query('DELETE FROM referral_rewards WHERE referral_id IN (SELECT id FROM referrals WHERE friend_id = ANY($1) OR inviter_id = ANY($1))', [userIds]);
    await pool.query('DELETE FROM referrals WHERE friend_id = ANY($1) OR inviter_id = ANY($1)', [userIds]);
    await pool.query('DELETE FROM referral_codes WHERE customer_id = ANY($1)', [userIds]);
    await pool.query('DELETE FROM coupon_redemptions WHERE coupon_id IN (SELECT id FROM coupons WHERE code = ANY($1))', [[ONCE, FIRST]]);
    await pool.query('DELETE FROM coupons WHERE code = ANY($1)', [[ONCE, FIRST]]);
    await pool.query('DELETE FROM audit_logs WHERE entity_id = ANY($1)', [userIds]);
    await pool.query('DELETE FROM refresh_tokens WHERE user_id = ANY($1)', [userIds]);
    if (samePhone) await pool.query('DELETE FROM otp_verifications WHERE phone = $1', [samePhone]);
    for (const id of newIds) {
      await pool.query('DELETE FROM customer_addresses WHERE user_id = $1', [id]);
      await pool.query('DELETE FROM users WHERE id = $1', [id]);
    }
    await people.cleanup();
  });

  it('a used coupon, free deliveries, the birthday gift and the referral stay used after DELETE /me and same-number sign-up', async () => {
    const inviter = await people.customer(1);
    const me = await people.customer(2);
    samePhone = me.phone;
    const now = orderingClock.now();
    // A birthday inside this week's window (the clock is pinned in tests).
    await pool.query("UPDATE users SET date_of_birth = '2001-10-06' WHERE id = $1", [me.id]);

    // Account #1: referred by a friend, then one order with the once-per-customer coupon.
    const code = await referralCodeFor(inviter.id);
    expect((await applyReferralCode(me.id, code)).status).toBe('PENDING');
    const order = await expectCreated(await me.placeOrder([{ product_id: MILK, quantity: 1 }], { coupon_code: ONCE }));
    const redeemed = await pool.query('SELECT 1 FROM coupon_redemptions WHERE order_id = $1 AND released_at IS NULL', [order.id]);
    expect(redeemed.rowCount).toBe(1);
    await pool.query("UPDATE orders SET order_status = 'DELIVERED' WHERE id = $1", [order.id]);
    const before = await birthdayOfferStatus(db, me.id, BIRTHDAY, now);
    expect(before.eligible).toBe(true);
    await pool.query(
      `INSERT INTO birthday_offer_redemptions (customer_id, order_id, offer_year, percent, discount_amount) VALUES ($1, $2, $3, 15, 50)`,
      [me.id, order.id, before.offer_year]
    );

    expect(await couponError(ONCE, me.id)).toBe('COUPON_LIMIT_REACHED');
    expect(await couponError(FIRST, me.id)).toBe('COUPON_FIRST_ORDER_ONLY');
    expect((await freeDeliveryStatus(db, me.id, FREE)).remaining).toBe(1);
    expect((await birthdayOfferStatus(db, me.id, BIRTHDAY, now)).used).toBe(true);

    // DELETE /me: the number is freed, its keyed hash is kept.
    expect((await request(app).delete('/api/v1/me').set(auth(me.token))).status).toBe(200);
    // Same number signs up again: a new account.
    authRateLimiter.reset();
    const otp = (await request(app).post('/api/v1/auth/otp/request').send({ phone: me.phone })).body.data.dev_otp;
    const signedIn = await request(app).post('/api/v1/auth/otp/verify').send({ phone: me.phone, otp });
    expect(signedIn.status).toBe(200);
    const newId = signedIn.body.data.user.id as string;
    newIds.push(newId);
    expect(newId).not.toBe(me.id);
    await pool.query("UPDATE users SET date_of_birth = '2001-10-06' WHERE id = $1", [newId]);

    // Previews: nothing came back.
    expect(await couponError(ONCE, newId)).toBe('COUPON_LIMIT_REACHED');
    expect(await couponError(FIRST, newId)).toBe('COUPON_FIRST_ORDER_ONLY');
    const free = await freeDeliveryStatus(db, newId, FREE);
    expect(free.used).toBe(1);
    expect(free.remaining).toBe(1);
    const birthday = await birthdayOfferStatus(db, newId, BIRTHDAY, now);
    expect(birthday.used).toBe(true);
    expect(birthday.eligible).toBe(false);
    await expect(applyReferralCode(newId, code)).rejects.toMatchObject({ statusCode: 409, code: 'REFERRAL_ALREADY_APPLIED' });

    // The locked order-creation path refuses the coupon too.
    const token = generateAccessToken({ id: newId, phone: me.phone, role: 'CUSTOMER' });
    const addressId = (
      await pool.query(
        `INSERT INTO customer_addresses (user_id, label, recipient_name, recipient_phone, address_line1, city, latitude, longitude, is_default)
         VALUES ($1, 'Test', 'Same Number', $2, 'No. 1, Test Lane', 'Dharga Town', 6.4351, 80.0243, true) RETURNING id`,
        [newId, me.phone]
      )
    ).rows[0].id;
    const again = await request(app)
      .post('/api/v1/orders')
      .set(auth(token))
      .send({ address_id: addressId, items: [{ product_id: MILK, quantity: 1 }], coupon_code: ONCE });
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe('COUPON_LIMIT_REACHED');

    // How: the deleted account freed the number but kept its keyed hash,
    // and the new account carries the same one.
    const deleted = (await pool.query('SELECT phone, phone_hash FROM users WHERE id = $1', [me.id])).rows[0];
    expect(deleted.phone).not.toBe(me.phone);
    expect(deleted.phone_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(deleted.phone_hash).toBe(phoneHash(me.phone));
    expect((await pool.query('SELECT phone_hash FROM users WHERE id = $1', [newId])).rows[0].phone_hash).toBe(deleted.phone_hash);
  });

  it('a different number is unaffected (control)', async () => {
    const other = await people.customer(3);
    expect(await couponError(ONCE, other.id)).toBeNull();
    expect(await couponError(FIRST, other.id)).toBeNull();
    expect((await freeDeliveryStatus(db, other.id, FREE)).remaining).toBe(2);
  });

  it('phoneHash is keyed, normalises the number, and is null for placeholders', () => {
    expect(phoneHash('0770410099')).toBe(phoneHash('+94770410099'));
    expect(phoneHash('0770410099')).not.toBe(phoneHash('0770410098'));
    expect(phoneHash('del:0123456789abcdef')).toBeNull();
    expect(phoneHash('nophone:0123456789ab')).toBeNull();
    expect(phoneHash(null)).toBeNull();
  });
});

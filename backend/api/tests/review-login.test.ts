import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { pool } from '../src/database/connection.js';
import { authRateLimiter } from '../src/modules/auth/auth.rate-limiter.js';
import { reviewLoginCode } from '../src/modules/auth/auth.service.js';

/**
 * Google Play review sign-in (2026-10-24): Play's reviewers cannot receive our SMS codes, so the one
 * number in REVIEW_LOGIN_PHONE signs in with the fixed REVIEW_LOGIN_OTP and no SMS is sent. Every
 * other number is unchanged.
 */
const app = createApp();
const REVIEW_PHONE = '+94700000991';
const OTHER_PHONE = '+94700000992';
const saved = { phone: env.REVIEW_LOGIN_PHONE, otp: env.REVIEW_LOGIN_OTP };

const cleanup = async () => {
  for (const phone of [REVIEW_PHONE, OTHER_PHONE]) {
    await pool.query('DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE phone = $1)', [phone]);
    await pool.query('DELETE FROM users WHERE phone = $1', [phone]);
    await pool.query('DELETE FROM otp_verifications WHERE phone = $1', [phone]);
  }
};

beforeAll(async () => {
  await cleanup();
  (env as { REVIEW_LOGIN_PHONE: string }).REVIEW_LOGIN_PHONE = REVIEW_PHONE;
  (env as { REVIEW_LOGIN_OTP: string }).REVIEW_LOGIN_OTP = '482913';
});

afterAll(async () => {
  (env as { REVIEW_LOGIN_PHONE: string }).REVIEW_LOGIN_PHONE = saved.phone;
  (env as { REVIEW_LOGIN_OTP: string }).REVIEW_LOGIN_OTP = saved.otp;
  await cleanup();
});

describe('Play review sign-in', () => {
  it('only the configured number gets the fixed code; off when either setting is empty', () => {
    expect(reviewLoginCode(REVIEW_PHONE, { REVIEW_LOGIN_PHONE: REVIEW_PHONE, REVIEW_LOGIN_OTP: '482913' })).toBe('482913');
    expect(reviewLoginCode(OTHER_PHONE, { REVIEW_LOGIN_PHONE: REVIEW_PHONE, REVIEW_LOGIN_OTP: '482913' })).toBeNull();
    expect(reviewLoginCode(REVIEW_PHONE, { REVIEW_LOGIN_PHONE: REVIEW_PHONE, REVIEW_LOGIN_OTP: '' })).toBeNull();
    expect(reviewLoginCode(REVIEW_PHONE, { REVIEW_LOGIN_PHONE: '', REVIEW_LOGIN_OTP: '482913' })).toBeNull();
  });

  it('the review number signs in with the fixed code', async () => {
    authRateLimiter.reset();
    const asked = await request(app).post('/api/v1/auth/otp/request').send({ phone: REVIEW_PHONE });
    expect(asked.status, JSON.stringify(asked.body)).toBe(200);
    expect(asked.body.data.dev_otp).toBe('482913');
    const verified = await request(app).post('/api/v1/auth/otp/verify').send({ phone: REVIEW_PHONE, otp: '482913' });
    expect(verified.status, JSON.stringify(verified.body)).toBe(200);
    expect(verified.body.data.user.role).toBe('CUSTOMER');
  });

  it('a wrong code is still refused, and other numbers still get a random code', async () => {
    authRateLimiter.reset();
    await request(app).post('/api/v1/auth/otp/request').send({ phone: REVIEW_PHONE });
    expect((await request(app).post('/api/v1/auth/otp/verify').send({ phone: REVIEW_PHONE, otp: '000000' })).status).toBe(401);
    const other = await request(app).post('/api/v1/auth/otp/request').send({ phone: OTHER_PHONE });
    expect(other.status).toBe(200);
    expect(other.body.data.dev_otp).not.toBe('482913');
  });
});

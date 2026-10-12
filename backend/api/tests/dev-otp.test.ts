import { describe, it, expect } from 'vitest';
import { validateEnv } from '../src/config/env.js';
import { shouldExposeDevOtp } from '../src/modules/auth/auth.service.js';

/**
 * dev_otp fails closed (security audit 2026-10): the sign-in code is in the
 * API response only under NODE_ENV=test, or NODE_ENV=development with
 * EXPOSE_DEV_OTP=true. Never in production, and never by default in
 * development (a server started without NODE_ENV is "development").
 */
const base = {
  DATABASE_URL: 'postgres://u:p@db.example:5432/x',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  OTP_SECRET: 'c'.repeat(20),
};

describe('dev_otp', () => {
  it('test: always; development: only with EXPOSE_DEV_OTP=true; production: never', () => {
    expect(shouldExposeDevOtp({ NODE_ENV: 'test', EXPOSE_DEV_OTP: false })).toBe(true);
    expect(shouldExposeDevOtp({ NODE_ENV: 'development', EXPOSE_DEV_OTP: false })).toBe(false);
    expect(shouldExposeDevOtp({ NODE_ENV: 'development', EXPOSE_DEV_OTP: true })).toBe(true);
    expect(shouldExposeDevOtp({ NODE_ENV: 'production', EXPOSE_DEV_OTP: true })).toBe(false);
  });

  it('EXPOSE_DEV_OTP defaults to off and parses "true"/"false"', () => {
    expect(validateEnv({ ...base, NODE_ENV: 'development' }).EXPOSE_DEV_OTP).toBe(false);
    expect(validateEnv({ ...base, NODE_ENV: 'development', EXPOSE_DEV_OTP: 'true' }).EXPOSE_DEV_OTP).toBe(true);
    expect(validateEnv({ ...base, NODE_ENV: 'development', EXPOSE_DEV_OTP: 'false' }).EXPOSE_DEV_OTP).toBe(false);
    // An unset NODE_ENV is development: no code in the response.
    const unset = validateEnv({ ...base });
    expect(shouldExposeDevOtp(unset)).toBe(false);
  });
});

import { describe, it, expect, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { authRateLimiter, type RateLimitCheck } from '../src/modules/auth/auth.rate-limiter.js';

/**
 * Client IP behind proxies (security audit 2026-10): Express `trust proxy`
 * comes from TRUST_PROXY (default: loopback, link-local and private ranges -
 * the Coolify/Traefik hop), and every per-IP limit keys on req.ip, never on
 * the raw X-Forwarded-For header. CF-Connecting-IP is used only when
 * TRUST_CLOUDFLARE_HEADER=true.
 *
 * Nothing is written: the session endpoint is refused (no code issued) right
 * after the limits are checked; the limiter is reset after each test.
 */
const PHONE = '0770009399'; // no account, no code
const original = { trustProxy: env.TRUST_PROXY, cf: env.TRUST_CLOUDFLARE_HEADER };

function ipKeys() {
  const keys: string[] = [];
  const real = authRateLimiter.checkLimits.bind(authRateLimiter);
  vi.spyOn(authRateLimiter, 'checkLimits').mockImplementation((checks: RateLimitCheck[]) => {
    for (const c of checks) if (c.key.includes('_ip:')) keys.push(c.key);
    real(checks);
  });
  return keys;
}

const session = (app: ReturnType<typeof createApp>, headers: Record<string, string>) =>
  request(app).post('/api/v1/riders/applications/session').set(headers).send({ phone: PHONE, otp: '123456' });
const verify = (app: ReturnType<typeof createApp>, headers: Record<string, string>) =>
  request(app).post('/api/v1/auth/otp/verify').set(headers).send({ phone: PHONE, otp: '123456', create_account: false });

afterEach(() => {
  vi.restoreAllMocks();
  env.TRUST_PROXY = original.trustProxy;
  env.TRUST_CLOUDFLARE_HEADER = original.cf;
  authRateLimiter.reset();
});

describe('client IP for rate limits', () => {
  it('defaults TRUST_PROXY to the local/private proxy ranges and CF header off', () => {
    expect(original.trustProxy).toBe('loopback, linklocal, uniquelocal');
    expect(original.cf).toBe(false);
  });

  it('distinct clients forwarded by a trusted proxy get distinct buckets', async () => {
    const app = createApp(); // the test client connects over loopback: a trusted hop
    const keys = ipKeys();
    expect((await session(app, { 'X-Forwarded-For': '203.0.113.7' })).status).toBe(401);
    expect((await session(app, { 'X-Forwarded-For': '198.51.100.9' })).status).toBe(401);
    expect((await verify(app, { 'X-Forwarded-For': '203.0.113.7' })).status).not.toBe(500);
    expect(keys).toEqual(['rider_doc_session_ip:203.0.113.7', 'rider_doc_session_ip:198.51.100.9', 'otp_verify_ip:203.0.113.7']);
  });

  it('a spoofed X-Forwarded-For from an untrusted peer is ignored: one bucket, the real peer', async () => {
    env.TRUST_PROXY = '10.255.255.1'; // loopback is not trusted now
    const app = createApp();
    const keys = ipKeys();
    await session(app, { 'X-Forwarded-For': '203.0.113.7' });
    await session(app, { 'X-Forwarded-For': '198.51.100.9, 203.0.113.7' });
    await verify(app, { 'X-Forwarded-For': '192.0.2.44' });
    expect(new Set(keys.map((k) => k.split(':').slice(1).join(':'))).size).toBe(1);
    for (const k of keys) expect(k).not.toMatch(/203\.0\.113|198\.51\.100|192\.0\.2/);
  });

  it('CF-Connecting-IP counts only when TRUST_CLOUDFLARE_HEADER=true', async () => {
    const off = ipKeys();
    await session(createApp(), { 'CF-Connecting-IP': '203.0.113.50', 'X-Forwarded-For': '198.51.100.1' });
    expect(off).toEqual(['rider_doc_session_ip:198.51.100.1']);
    vi.restoreAllMocks();

    env.TRUST_CLOUDFLARE_HEADER = true;
    const on = ipKeys();
    await session(createApp(), { 'CF-Connecting-IP': '203.0.113.50', 'X-Forwarded-For': '198.51.100.1' });
    // A header that is not an IP address is ignored.
    await session(createApp(), { 'CF-Connecting-IP': 'not-an-ip', 'X-Forwarded-For': '198.51.100.1' });
    expect(on).toEqual(['rider_doc_session_ip:203.0.113.50', 'rider_doc_session_ip:198.51.100.1']);
  });
});

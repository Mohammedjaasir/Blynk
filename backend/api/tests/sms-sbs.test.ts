import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { env } from '../src/config/env.js';
import { SBS_SMS_URL, SmsProvider } from '../src/modules/notifications/providers/sms.provider.js';

/**
 * SBS Telecom gateway (SMS_PROVIDER=sbs), against its documented contract:
 * POST /sms, HTTP Basic key:secret, JSON {to, text, from}, an
 * Idempotency-Key; 202 = accepted, 200 + duplicate:true = already sent.
 * The network is stubbed: no real SMS leaves a test run.
 */
describe('SMS via SBS Telecom', () => {
  const saved = { ...env };
  const reply = (status: number, body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

  beforeEach(() => {
    Object.assign(env, {
      NODE_ENV: 'development',
      SMS_PROVIDER: 'sbs',
      SMS_API_KEY: 'live_key_123',
      SMS_API_SECRET: 'live_secret_456',
      SMS_SENDER_ID: 'Blynk',
    });
  });
  afterEach(() => {
    Object.assign(env, saved);
    vi.unstubAllGlobals();
  });

  it('sends {to, text, from} with Basic auth and an idempotency key', async () => {
    const fetch = reply(202, { message_id: 'm-1', status: 'queued', charged: true });
    vi.stubGlobal('fetch', fetch);
    const sms = new SmsProvider();
    const result = await sms.send({ notificationId: 'n-1', recipient: '0771234567', message: 'Your code is 4821' });

    expect(result).toMatchObject({ success: true, providerName: 'sbstelecom', providerMessageId: 'm-1' });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(SBS_SMS_URL);
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from('live_key_123:live_secret_456').toString('base64')}`);
    expect(headers['Idempotency-Key']).toBe('blynk-n-1');
    expect(JSON.parse(String(init.body))).toEqual({ to: '94771234567', text: 'Your code is 4821', from: 'Blynk' });
  });

  it('uses the approved sender ID exactly as configured', async () => {
    env.SMS_SENDER_ID = 'Blynk QC';
    const fetch = reply(202, { message_id: 'm-2' });
    vi.stubGlobal('fetch', fetch);
    await new SmsProvider().send({ notificationId: 'n-2', recipient: '+94771234567', message: 'hi' });
    expect(JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body)).from).toBe('Blynk QC');
  });

  it('a replay of the same key counts as sent (it went out the first time)', async () => {
    vi.stubGlobal('fetch', reply(200, { message_id: 'm-1', status: 'duplicate', duplicate: true, charged: false }));
    const result = await new SmsProvider().send({ notificationId: 'n-1', recipient: '0771234567', message: 'x', idempotencyKey: 'order-7' });
    expect(result.success).toBe(true);
  });

  it('a refusal is permanent; rate limits and server errors are worth a retry', async () => {
    for (const [status, type] of [[401, 'PERMANENT'], [403, 'PERMANENT'], [402, 'PERMANENT'], [422, 'PERMANENT'], [429, 'TRANSIENT'], [503, 'TRANSIENT']] as const) {
      vi.stubGlobal('fetch', reply(status, { error: 'nope' }));
      const result = await new SmsProvider().send({ notificationId: 'n', recipient: '0771234567', message: 'x' });
      expect(result, `HTTP ${status}`).toMatchObject({ success: false, errorType: type });
    }
  });

  it('a network failure is transient', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET'); }));
    const result = await new SmsProvider().send({ notificationId: 'n', recipient: '0771234567', message: 'x' });
    expect(result).toMatchObject({ success: false, errorType: 'TRANSIENT' });
  });

  it('production refuses to run without the key and secret', async () => {
    Object.assign(env, { NODE_ENV: 'production', SMS_API_SECRET: undefined });
    const fetch = reply(202, {});
    vi.stubGlobal('fetch', fetch);
    const result = await new SmsProvider().send({ notificationId: 'n', recipient: '0771234567', message: 'x' });
    expect(result).toMatchObject({ success: false, errorType: 'PERMANENT' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the Idempotency-Key within the SBS limit of 80 characters (offer keys are 83)', async () => {
    const { sbsIdempotencyKey, SBS_IDEMPOTENCY_KEY_MAX } = await import('../src/modules/notifications/providers/sms.provider.js');
    const offerKey = `sms-offer:${'a'.repeat(36)}:${'b'.repeat(36)}`;
    const key = sbsIdempotencyKey(offerKey);
    expect(key.length).toBeLessThanOrEqual(SBS_IDEMPOTENCY_KEY_MAX);
    expect(sbsIdempotencyKey(offerKey)).toBe(key); // the same on a retry
    expect(sbsIdempotencyKey(`sms-offer:${'a'.repeat(36)}:${'c'.repeat(36)}`)).not.toBe(key);
    expect(sbsIdempotencyKey('n-1')).toBe('blynk-n-1');
  });
});

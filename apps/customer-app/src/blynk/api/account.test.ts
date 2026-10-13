import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MemoryStorage } from '../test/fixtures';

/* Fresh modules over a fake localStorage with a signed-in session. */
function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function load(role = 'CUSTOMER') {
  vi.resetModules();
  const session = await import('@/blynk/auth/session');
  session.signIn({ access_token: 'a1', refresh_token: 'r1', user: { id: 'u1', phone: '+94771234567', role, full_name: 'Nimal', email: null } });
  const api = await import('./account');
  const client = await import('./client');
  return { ...api, ...client, session };
}

beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const profile = (over: Record<string, unknown> = {}) => ({
  id: 'u1', phone: '+94771234567', email: null, full_name: 'Nimal', role: 'CUSTOMER',
  sms_language: 'si', sms_offers: true, date_of_birth: null, ...over,
});

test('SMS language and offers each PATCH /me with only that field, with the bearer token', async () => {
  const { updateProfile, smsLanguagePatch, smsOffersPatch, API_BASE_URL } = await load();
  const f = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(json(200, { success: true, data: { profile: profile({ sms_language: 'ta' }) } }))
    .mockResolvedValueOnce(json(200, { success: true, data: { profile: profile({ sms_offers: false }) } }));
  const a = await updateProfile(smsLanguagePatch('ta'));
  const b = await updateProfile(smsOffersPatch(false));
  expect(f).toHaveBeenNthCalledWith(1, `${API_BASE_URL}/me`, expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ sms_language: 'ta' }) }));
  expect(f).toHaveBeenNthCalledWith(2, `${API_BASE_URL}/me`, expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ sms_offers: false }) }));
  expect((f.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer a1' });
  expect(a.sms_language).toBe('ta');
  expect(b.sms_offers).toBe(false);
});

test('parseProfile: unknown language is "not chosen", offers default on, date trimmed to YYYY-MM-DD', async () => {
  const { parseProfile } = await load();
  const p = parseProfile({ id: 'u1', phone: '+94771234567', sms_language: 'fr' as never, date_of_birth: '1990-05-04T00:00:00.000Z' });
  expect(p.sms_language).toBeNull();
  expect(p.sms_offers).toBe(true);
  expect(p.date_of_birth).toBe('1990-05-04');
  expect(parseProfile({ sms_offers: false }).sms_offers).toBe(false);
});

test('aboutYouPatch sends only what changed; an emptied birthday clears it; staff never send email', async () => {
  const { aboutYouPatch } = await load();
  const before = { full_name: 'Nimal', email: null, date_of_birth: '1990-05-04', role: 'CUSTOMER' };
  expect(aboutYouPatch(before, { full_name: ' Nimal ', email: '', date_of_birth: '1990-05-04' })).toEqual({});
  expect(aboutYouPatch(before, { full_name: 'Nimal  Perera', email: 'N@Mail.com ', date_of_birth: null }))
    .toEqual({ full_name: 'Nimal Perera', email: 'n@mail.com', date_of_birth: null });
  expect(aboutYouPatch({ ...before, role: 'RIDER' }, { full_name: 'Nimal', email: 'r@x.lk', date_of_birth: '1990-05-04' })).toEqual({});
});

test('getProfile keeps the session user (name, email, role) in step', async () => {
  const { getProfile, session } = await load();
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, { success: true, data: { profile: profile({ full_name: 'Kamala', email: 'k@x.lk', role: 'OPERATIONS' }) } }));
  await getProfile();
  expect(session.getSession()?.user).toMatchObject({ full_name: 'Kamala', email: 'k@x.lk', role: 'OPERATIONS' });
});

test('deleteAccount: DELETE /me, then signed out here with reason "deleted" and no server logout', async () => {
  const { deleteAccount, session, API_BASE_URL } = await load();
  const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, { success: true, data: { deleted: true } }));
  const ended: string[] = [];
  session.onSessionEnd((s, reason) => ended.push(`${s.accessToken}:${reason}`));
  await deleteAccount();
  expect(f).toHaveBeenCalledTimes(1);
  expect(f).toHaveBeenCalledWith(`${API_BASE_URL}/me`, expect.objectContaining({ method: 'DELETE' }));
  expect(session.getSession()).toBeNull();
  expect(ended).toEqual(['a1:deleted']);
});

test('deleteAccount refused while an order is open: stays signed in, the server message comes through', async () => {
  const { deleteAccount, session } = await load();
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(409, {
    success: false, error: { code: 'ACTIVE_ORDERS_EXIST', message: 'Finish or cancel your open orders first.', details: { open_orders: 1 } },
  }));
  const { accountErrorText } = await import('@/blynk/account/errors');
  const err = await deleteAccount().catch((e) => e);
  expect(err).toMatchObject({ status: 409, code: 'ACTIVE_ORDERS_EXIST' });
  expect(accountErrorText(err)).toBe('Finish or cancel your open orders first.');
  expect(session.getSession()).not.toBeNull();
});

test('feedbackBody: category and message required, rating optional and whole, message trimmed', async () => {
  const { feedbackBody } = await load();
  expect(feedbackBody({ category: null, message: ' ', rating: null }))
    .toEqual({ ok: false, category: 'Choose what your feedback is about.', message: 'Write a message first.' });
  expect(feedbackBody({ category: 'DELIVERY', message: ' Fast rider ', rating: 5 }))
    .toEqual({ ok: true, body: { category: 'DELIVERY', message: 'Fast rider', rating: 5 } });
  expect(feedbackBody({ category: 'APP', message: 'ok', rating: null })).toEqual({ ok: true, body: { category: 'APP', message: 'ok' } });
  expect(feedbackBody({ category: 'APP', message: 'x'.repeat(2001), rating: null }).ok).toBe(false);
});

test('sendFeedback POSTs /feedback', async () => {
  const { sendFeedback, API_BASE_URL } = await load();
  const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(201, { success: true, data: { feedback: { id: 'f1' } } }));
  await sendFeedback({ category: 'PRODUCTS', message: 'More fruit', rating: 4 });
  expect(f).toHaveBeenCalledWith(`${API_BASE_URL}/feedback`, expect.objectContaining({
    method: 'POST', body: JSON.stringify({ category: 'PRODUCTS', message: 'More fruit', rating: 4 }),
  }));
});

test('canEditEmail: customers only', async () => {
  const { canEditEmail } = await load();
  expect(canEditEmail('CUSTOMER')).toBe(true);
  expect(canEditEmail('RIDER')).toBe(false);
  expect(canEditEmail('OPERATIONS')).toBe(false);
});

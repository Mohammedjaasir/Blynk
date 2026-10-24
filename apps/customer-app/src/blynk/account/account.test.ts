import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/blynk/api/client';
import { MemoryStorage } from '../test/fixtures';
import { createSessionCleaner, noticeFor, SESSION_NOTICES } from './cleanup';
import { deleteReducer, runDelete, type DeleteEvent, type DeleteState } from './deleteFlow';

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/* ------------------------------------------------------------------ logout cleanup */

const steps = () => ({
  stopTracking: vi.fn(),
  clearCart: vi.fn(),
  clearAddresses: vi.fn(),
  clearCheckout: vi.fn(),
  pushSignedOut: vi.fn(),
  notify: vi.fn(),
});
const ended = { accessToken: 'a1', refreshToken: 'r1', user: { id: 'u1', phone: '+94771234567', role: 'CUSTOMER', full_name: 'Nimal', email: null } };

test('the cleaner clears every piece of user state and unregisters push with the old access token', () => {
  const s = steps();
  createSessionCleaner(s)(ended, 'logout');
  expect(s.stopTracking).toHaveBeenCalledOnce();
  expect(s.clearCart).toHaveBeenCalledOnce();
  expect(s.clearAddresses).toHaveBeenCalledOnce();
  expect(s.clearCheckout).toHaveBeenCalledOnce();
  expect(s.pushSignedOut).toHaveBeenCalledWith('a1');
  expect(s.notify).not.toHaveBeenCalled(); // a logout the customer asked for needs no message
});

test('one failing step does not stop the rest', () => {
  const s = steps();
  s.clearCart.mockImplementation(() => { throw new Error('boom'); });
  createSessionCleaner(s)(ended, 'rejected');
  expect(s.clearAddresses).toHaveBeenCalled();
  expect(s.pushSignedOut).toHaveBeenCalled();
  expect(s.notify).toHaveBeenCalledWith(SESSION_NOTICES.ended);
});

test('notices: refused login and deleted account are told; a logout is not', () => {
  expect(noticeFor('rejected')).toBe(SESSION_NOTICES.ended);
  expect(noticeFor('deleted')).toBe(SESSION_NOTICES.deleted);
  expect(noticeFor('logout')).toBeNull();
});

test('signOut runs the end handlers once with the old session, then revokes the refresh token', async () => {
  vi.resetModules();
  const session = await import('@/blynk/auth/session');
  const { API_BASE_URL } = await import('@/blynk/api/client');
  const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, { success: true, data: {} }));
  const s = steps();
  session.onSessionEnd(createSessionCleaner(s));
  session.signIn({ access_token: 'a1', refresh_token: 'r1', user: ended.user });
  session.signOut();
  session.signOut(); // already signed out: nothing more
  expect(session.getSession()).toBeNull();
  expect(s.pushSignedOut).toHaveBeenCalledTimes(1);
  expect(s.pushSignedOut).toHaveBeenCalledWith('a1');
  expect(f).toHaveBeenCalledTimes(1);
  expect(f).toHaveBeenCalledWith(`${API_BASE_URL}/auth/logout`, expect.objectContaining({ body: JSON.stringify({ refresh_token: 'r1' }) }));
});

/* ------------------------------------------------------------------ delete account flow */

test('delete flow: open -> confirm -> deleting -> done', () => {
  let s: DeleteState = { step: 'closed' };
  const go = (e: DeleteEvent) => { s = deleteReducer(s, e); };
  go({ type: 'open' });
  expect(s).toEqual({ step: 'confirm', error: null });
  go({ type: 'confirm' });
  expect(s).toEqual({ step: 'deleting' });
  go({ type: 'confirm' }); // a second tap while deleting is ignored
  go({ type: 'cancel' }); // and cannot cancel mid-delete
  expect(s).toEqual({ step: 'deleting' });
  go({ type: 'deleted' });
  expect(s).toEqual({ step: 'done' });
});

test('delete flow: a refusal goes back to confirm with the server reason; cancel closes', async () => {
  let s: DeleteState = { step: 'confirm', error: null };
  const dispatch = (e: DeleteEvent) => { s = deleteReducer(s, e); };
  const ok = await runDelete(dispatch, async () => {
    throw new ApiError('Finish or cancel your open orders first.', 409, 'ACTIVE_ORDERS_EXIST');
  });
  expect(ok).toBe(false);
  expect(s).toEqual({ step: 'confirm', error: 'Finish or cancel your open orders first.' });
  const net = await runDelete(dispatch, async () => { throw new ApiError("We couldn't reach Blynk. Check your connection and try again.", 0, 'NETWORK_ERROR'); });
  expect(net).toBe(false);
  expect(s).toMatchObject({ step: 'confirm', error: expect.stringContaining("couldn't reach Blynk") });
  dispatch({ type: 'cancel' });
  expect(s).toEqual({ step: 'closed' });
});

test('delete flow: success resolves true', async () => {
  let s: DeleteState = { step: 'confirm', error: null };
  const ok = await runDelete((e) => { s = deleteReducer(s, e); }, async () => undefined);
  expect(ok).toBe(true);
  expect(s).toEqual({ step: 'done' });
});

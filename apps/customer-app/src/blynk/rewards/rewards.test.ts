import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { MemoryStorage } from '../test/fixtures';
import {
  birthdayBannerText, creditLabel, entryLabel, entryPoints, howItWorks, parseBirthdayOffer, parsePoints, parseReferral,
  pointsBalanceText, referralAppliedText, rewardDescription,
} from './models';

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function load(signedIn = true) {
  vi.resetModules();
  const session = await import('@/blynk/auth/session');
  if (signedIn) {
    session.signIn({ access_token: 'a1', refresh_token: 'r1', user: { id: 'u1', phone: '+94771234567', role: 'CUSTOMER', full_name: 'Nimal', email: null } });
  }
  const api = await import('./api');
  const startup = await import('@/blynk/share/startup');
  const client = await import('@/blynk/api/client');
  return { ...api, ...startup, ...client, session };
}

beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('referral, points and birthday parsing', () => {
  test('GET /me/referral', () => {
    const info = parseReferral({
      enabled: true, code: ' NIMAL42 ', reward: { mode: 'LKR_OFF', friend_amount_lkr: '150', inviter_amount_lkr: 100 },
      invited_count: 3, rewarded_count: '1', credits: [{ mode: 'FREE_DELIVERY', amount_lkr: 0 }, { mode: 'BOGUS' }],
      referred_by: { first_name: ' Kamal ', status: 'pending' }, can_apply_code: false,
    })!;
    expect(info.code).toBe('NIMAL42');
    expect(info.rewardedCount).toBe(1);
    expect(info.credits).toEqual([{ mode: 'FREE_DELIVERY', amountLkr: 0 }]);
    expect(info.referredBy).toEqual({ firstName: 'Kamal', status: 'PENDING' });
    expect(rewardDescription(info.reward!)).toBe(
      'Your friend gets LKR 150 off their first order. You get LKR 100 off your next order after their first order is delivered.',
    );
    expect(creditLabel(info.credits[0])).toBe('A free delivery');
    expect(creditLabel({ mode: 'LKR_OFF', amountLkr: 75 })).toBe('LKR 75 off');
    expect(parseReferral({ code: 'X' })).toBeNull();
  });

  test('applied wording', () => {
    expect(referralAppliedText(null)).toBe('Referral code applied. Your first order gets the reward.');
    expect(referralAppliedText('Kamal')).toBe('Referral code applied. Kamal invited you, and your first order gets the reward.');
  });

  test('GET /me/points', () => {
    const p = parsePoints({
      enabled: true, balance: 120, value_lkr: '120',
      program: { earn_points: 1, earn_per_lkr: 100, lkr_per_point: 0.5, min_redeem_points: 50, max_redeem_percent: 20, expiry_months: 12 },
      history: [
        { id: 'h1', kind: 'EARN', points: 40, order_number: 'BL-1001', created_at: '2026-10-01T10:00:00Z', expires_at: '2027-10-01T10:00:00Z' },
        { id: 'h2', kind: 'redeem', points: -20, order_number: null },
        { id: 'h3', kind: 'UNKNOWN', points: 5 },
      ],
    })!;
    expect(pointsBalanceText(p.balance, p.valueLkr)).toBe('120 Blynk Points = LKR 120');
    expect(pointsBalanceText(1, 0.5)).toBe('1 Blynk Point = LKR 0.50');
    expect(p.history.map((e) => entryLabel(e))).toEqual(['Earned on order BL-1001', 'Used on an order']);
    expect(entryPoints(40)).toBe('+40');
    expect(entryPoints(-20)).toBe('-20');
    expect(howItWorks(p.program!)).toEqual([
      'Earn 1 point for every LKR 100 you spend on items, once your order is delivered.',
      'Each point is worth LKR 0.50 at checkout.',
      'Use points once you have 50 or more.',
      'Points can pay up to 20% of an order.',
      'Points expire 12 months after you earn them.',
    ]);
    expect(parsePoints({ balance: 1 })).toBeNull();
  });

  test('birthday_offer: only a percent the app can word is a gift', () => {
    const o = parseBirthdayOffer({ enabled: true, eligible: true, percent: 10 })!;
    expect(birthdayBannerText(o)).toBe('Happy birthday! 10% off one order this week');
    expect(birthdayBannerText(parseBirthdayOffer({ enabled: true, eligible: true, percent: '12.5' })!)).toBe('Happy birthday! 12.5% off one order this week');
    expect(parseBirthdayOffer({ enabled: true, eligible: true, percent: 100 })!.eligible).toBe(false);
    expect(parseBirthdayOffer({ enabled: true, eligible: true })).toBeNull();
    expect(parseBirthdayOffer(null)).toBeNull();
  });
});

describe('a friend\'s code from a link', () => {
  test('?ref= is kept until sign-in, then applied once with POST /me/referral/apply and forgotten', async () => {
    const { captureFromPage, readPendingReferral, applyPendingReferral, API_BASE_URL, session } = await load(false);
    captureFromPage({ search: '?ref=nimal42', hash: '', pathname: '/app/' });
    expect(readPendingReferral()).toBe('NIMAL42');
    const f = vi.spyOn(globalThis, 'fetch');
    // signed out: nothing is sent, the code waits
    expect(await applyPendingReferral()).toBeNull();
    expect(f).not.toHaveBeenCalled();
    expect(readPendingReferral()).toBe('NIMAL42');

    session.signIn({ access_token: 'a1', refresh_token: 'r1', user: { id: 'u1', phone: '+94771234567', role: 'CUSTOMER', full_name: null, email: null } });
    f.mockResolvedValue(json(201, { success: true, data: { inviter_first_name: 'Kamal' } }));
    expect(await applyPendingReferral()).toBe('Referral code applied. Kamal invited you, and your first order gets the reward.');
    expect(f).toHaveBeenCalledWith(`${API_BASE_URL}/me/referral/apply`, expect.objectContaining({ method: 'POST', body: JSON.stringify({ code: 'NIMAL42' }) }));
    expect((f.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer a1' });
    expect(readPendingReferral()).toBeNull();
    // once: nothing left to apply
    expect(await applyPendingReferral()).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });

  test('a refusal forgets the code quietly', async () => {
    const { writePendingReferral, readPendingReferral, applyPendingReferral } = await load();
    writePendingReferral('OWNCODE');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(409, { success: false, error: { code: 'REFERRAL_ALREADY_APPLIED', message: 'Already applied.' } }));
    expect(await applyPendingReferral()).toBeNull();
    expect(readPendingReferral()).toBeNull();
  });

  test('a network failure, rate limit or server fault keeps the code for next time', async () => {
    const { writePendingReferral, readPendingReferral, applyPendingReferral } = await load();
    writePendingReferral('NIMAL42');
    const f = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
    expect(await applyPendingReferral()).toBeNull();
    expect(readPendingReferral()).toBe('NIMAL42');
    f.mockResolvedValue(json(429, { success: false, error: { code: 'RATE_LIMITED', message: 'Slow down.' } }));
    expect(await applyPendingReferral()).toBeNull();
    expect(readPendingReferral()).toBe('NIMAL42');
    f.mockResolvedValue(json(500, { success: false }));
    expect(await applyPendingReferral()).toBeNull();
    expect(readPendingReferral()).toBe('NIMAL42');
  });

  test('a code typed by hand is checked before it is sent', async () => {
    const { applyReferralCode } = await load();
    const f = vi.spyOn(globalThis, 'fetch');
    expect(await applyReferralCode('  ')).toMatchObject({ ok: false, invalidCode: true, text: 'Enter a code.' });
    expect(await applyReferralCode('a-b')).toMatchObject({ ok: false, invalidCode: true });
    expect(f).not.toHaveBeenCalled();
    f.mockResolvedValue(json(400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'code: bad' } }));
    expect(await applyReferralCode('abcd')).toMatchObject({ ok: false, status: 400, text: "That doesn't look like a referral code. Check it and try again." });
  });
});

describe('page address at start-up', () => {
  test('#/p/<id> becomes a route to open once, and the hash is cleared', async () => {
    const { captureFromPage, takePendingRoute } = await load(false);
    const replaceState = vi.fn();
    captureFromPage({ search: '', hash: '#/p/abc-1', pathname: '/app/' }, { replaceState });
    expect(replaceState).toHaveBeenCalledWith(null, '', '/app/');
    expect(takePendingRoute()).toBe('/p/abc-1');
    expect(takePendingRoute()).toBeNull();
  });
  test('no hash: nothing to open and the address is left alone', async () => {
    const { captureFromPage, takePendingRoute } = await load(false);
    const replaceState = vi.fn();
    captureFromPage({ search: '?x=1', hash: '', pathname: '/app/home' }, { replaceState });
    expect(replaceState).not.toHaveBeenCalled();
    expect(takePendingRoute()).toBeNull();
  });
});

describe('reward calls', () => {
  test('points and referral are read with the bearer token', async () => {
    const { fetchPoints, fetchReferral, fetchBirthdayOffer, API_BASE_URL } = await load();
    const f = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json(200, { success: true, data: { enabled: true, balance: 3, value_lkr: 3, history: [] } }))
      .mockResolvedValueOnce(json(200, { success: true, data: { enabled: false, code: '' } }))
      .mockResolvedValueOnce(json(200, { success: true, data: { profile: { birthday_offer: { enabled: true, eligible: true, percent: 10 } } } }));
    expect((await fetchPoints()).balance).toBe(3);
    expect((await fetchReferral()).enabled).toBe(false);
    expect((await fetchBirthdayOffer())?.eligible).toBe(true);
    expect(f.mock.calls.map((c) => c[0])).toEqual([`${API_BASE_URL}/me/points`, `${API_BASE_URL}/me/referral`, `${API_BASE_URL}/me`]);
  });
});

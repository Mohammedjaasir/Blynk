import { apiRequest } from './client';
import type { AuthUser, CodSettlement, DeliveryDetail, DeliverySummary, RiderDay } from './types';

/** Existing Blynk OTP auth - the same endpoints every Blynk app uses. */
export const authApi = {
  requestOtp: (phone: string) =>
    apiRequest<{ dev_otp?: string }>('/auth/otp/request', { method: 'POST', body: { phone }, auth: false }),
  verifyOtp: (phone: string, otp: string) =>
    apiRequest<{ access_token: string; refresh_token: string; user: AuthUser }>('/auth/otp/verify', {
      method: 'POST',
      body: { phone, otp },
      auth: false,
    }),
  /**
   * Email + password sign-in (rider accounts made on Staff accounts, backend
   * STAFF_PASSWORD_ROLES): the same lockout and disabled checks as staff.
   */
  passwordLogin: (email: string, password: string) =>
    apiRequest<{ access_token: string; refresh_token: string; user: AuthUser }>('/auth/staff/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
    }),
  me: () => apiRequest<AuthUser>('/auth/me'),
  logout: () => apiRequest('/auth/logout', { method: 'POST' }),
};

/**
 * The existing rider endpoints. The backend decides, under row locks, whether
 * each step is allowed; these calls only ask. The rider id is never sent - the
 * API derives it from the signed-in account.
 */
export const deliveriesApi = {
  list: async () =>
    (await apiRequest<{ deliveries: DeliverySummary[] }>('/riders/deliveries')).deliveries,
  detail: async (id: string) =>
    (await apiRequest<{ delivery: DeliveryDetail }>(`/riders/deliveries/${id}`)).delivery,
  pickUp: (id: string) => setStatus(id, { status: 'PICKED_UP' }),
  arrive: (id: string) => setStatus(id, { status: 'ARRIVED_AT_CUSTOMER' }),
  fail: (id: string, reason: string) => setStatus(id, { status: 'FAILED', failure_reason: reason }),
  /**
   * amount must be the total the API reported; the API rejects anything else.
   * deliveryCode is the customer's 4-digit proof-of-delivery code.
   */
  collectCod: async (id: string, amount: number, deliveryCode: string) =>
    (
      await apiRequest<{ settlement: CodSettlement }>(`/riders/deliveries/${id}/collect-cod`, {
        method: 'POST',
        body: { amount, delivery_code: deliveryCode },
      })
    ).settlement,
  sendLocation: (id: string, point: { latitude: number; longitude: number; accuracy: number; captured_at: string }) =>
    apiRequest<{ accepted: boolean; reason?: string }>(`/riders/deliveries/${id}/location`, {
      method: 'POST',
      body: point,
    }),
};

/** "My day": today's and this week's counts and cash, for the signed-in rider only. */
export const dayApi = {
  get: () => apiRequest<RiderDay>('/riders/me/day'),
};

async function setStatus(id: string, body: Record<string, unknown>) {
  return (
    await apiRequest<{ delivery: DeliveryDetail }>(`/riders/deliveries/${id}/status`, { method: 'PATCH', body })
  ).delivery;
}

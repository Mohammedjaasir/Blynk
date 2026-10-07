import { apiRequest, tokenStore } from './client';
import type {
  AuthUser,
  CodSettlement,
  DeliveryDetail,
  DeliverySummary,
  RiderApplication,
  RiderApplicationInput,
  RiderDay,
} from './types';

/**
 * Existing Blynk OTP auth - the same endpoints every Blynk app uses. Riders
 * sign in with their phone and an SMS code only (2026-10-07): the API answers
 * a rider's email + password with 403 PHONE_SIGN_IN_REQUIRED, so the app
 * never offers it.
 */
export const authApi = {
  requestOtp: (phone: string) =>
    apiRequest<{ dev_otp?: string }>('/auth/otp/request', { method: 'POST', body: { phone }, auth: false }),
  verifyOtp: (phone: string, otp: string) =>
    apiRequest<{ access_token: string; refresh_token: string; user: AuthUser }>('/auth/otp/verify', {
      method: 'POST',
      // Rider sign-in never creates an account: an unknown number is refused
      // (404 ACCOUNT_NOT_FOUND) instead of becoming a new customer. A rider
      // whose application is waiting or was turned down is refused with 403
      // RIDER_PENDING_APPROVAL / RIDER_APPLICATION_REJECTED.
      body: { phone, otp, create_account: false },
      auth: false,
    }),
  me: () => apiRequest<AuthUser>('/auth/me'),
  // Send the refresh token so the server revokes it: without it the route
  // knows neither the session nor the user, and the session outlives sign-out.
  logout: () =>
    apiRequest('/auth/logout', { method: 'POST', body: tokenStore.refresh ? { refresh_token: tokenStore.refresh } : {} }),
};

/**
 * Riders apply in the app; Ops or Admin approve. No session: the SMS code
 * (from authApi.requestOtp) proves the phone. 201 means the application is
 * waiting for review.
 */
export const applicationsApi = {
  submit: async (input: RiderApplicationInput) =>
    (
      await apiRequest<{ application: RiderApplication }>('/riders/applications', {
        method: 'POST',
        body: { ...input },
        auth: false,
      })
    ).application,
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

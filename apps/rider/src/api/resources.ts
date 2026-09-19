import { apiRequest } from './client';
import type { AuthUser, CodSettlement, DeliveryDetail, DeliverySummary } from './types';

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
  /** amount must be the total the API reported; the API rejects anything else. */
  collectCod: async (id: string, amount: number) =>
    (
      await apiRequest<{ settlement: CodSettlement }>(`/riders/deliveries/${id}/collect-cod`, {
        method: 'POST',
        body: { amount },
      })
    ).settlement,
};

async function setStatus(id: string, body: Record<string, unknown>) {
  return (
    await apiRequest<{ delivery: DeliveryDetail }>(`/riders/deliveries/${id}/status`, { method: 'PATCH', body })
  ).delivery;
}

import { apiRequest } from './client';

/**
 * Refer a friend and Blynk Points (owner, 2026-10-10). Kept in its own file
 * so the shared resources/types modules need no edits. ADMIN and OPERATIONS
 * may use every call; the server audits each change.
 */

export type ReferralMode = 'LKR_OFF' | 'FREE_DELIVERY';
export type ReferralStatus = 'PENDING' | 'REWARDED' | 'CAPPED' | 'NO_REWARD';

/** `GET|PATCH /admin/settings/referrals`. */
export interface ReferralSetting {
  enabled: boolean;
  mode: ReferralMode;
  /** LKR off the friend's first order (LKR_OFF only). */
  friend_amount_lkr: number;
  /** LKR off the inviter's next order (LKR_OFF only). */
  inviter_amount_lkr: number;
  /** Most inviter rewards per inviter per month. */
  monthly_cap: number;
  updated_at: string | null;
}

export type ReferralSettingInput = Partial<Omit<ReferralSetting, 'updated_at'>>;

export interface ReferralReward {
  mode: ReferralMode;
  amount_lkr: number;
  discount_amount: number;
  /** false: still waiting for the order it will be used on. */
  used: boolean;
  order_number: string | null;
  created_at: string;
}

export interface ReferralPerson {
  id: string;
  name: string | null;
  phone: string;
}

/** One row of `GET /admin/referrals`. */
export interface Referral {
  id: string;
  code: string;
  status: ReferralStatus;
  created_at: string;
  completed_at: string | null;
  inviter: ReferralPerson;
  friend: ReferralPerson;
  qualifying_order_number: string | null;
  friend_reward: ReferralReward | null;
  inviter_reward: ReferralReward | null;
}

export interface ReferralPage {
  referrals: Referral[];
  summary: Record<ReferralStatus, number>;
  pagination: { page: number; limit: number; total: number; total_pages: number };
}

/** `GET|PATCH /admin/settings/points`. */
export interface PointsSetting {
  enabled: boolean;
  earn_points: number;
  earn_per_lkr: number;
  lkr_per_point: number;
  min_redeem_points: number;
  max_redeem_percent: number;
  /** 0 = never. */
  expiry_months: number;
  updated_at: string | null;
}

export type PointsSettingInput = Partial<Omit<PointsSetting, 'updated_at'>>;

export type PointsKind = 'EARN' | 'REDEEM' | 'REFUND' | 'EXPIRE' | 'ADJUST';

export interface PointsEntry {
  id: string;
  kind: PointsKind;
  /** Signed: + added, - taken. */
  points: number;
  remaining: number;
  expires_at: string | null;
  reason: string | null;
  created_at: string;
  order_number: string | null;
  actor_name: string | null;
}

/** `GET /admin/customers/:id/points`. */
export interface CustomerPoints {
  customer_id: string;
  enabled: boolean;
  balance: number;
  value_lkr: number;
  history: PointsEntry[];
}

const PATH_REFERRALS = '/admin/settings/referrals';
const PATH_POINTS = '/admin/settings/points';

export const referralPoints = {
  getReferralSetting: () => apiRequest<ReferralSetting>(PATH_REFERRALS),
  /** Send only what changed - the server refuses an empty body. */
  setReferralSetting: (body: ReferralSettingInput) =>
    apiRequest<ReferralSetting>(PATH_REFERRALS, { method: 'PATCH', body: { ...body } }),
  listReferrals: (params: { status?: ReferralStatus | null; page?: number; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.status) q.set('status', params.status);
    q.set('page', String(params.page ?? 1));
    q.set('limit', String(params.limit ?? 50));
    return apiRequest<ReferralPage>(`/admin/referrals?${q.toString()}`);
  },
  getPointsSetting: () => apiRequest<PointsSetting>(PATH_POINTS),
  setPointsSetting: (body: PointsSettingInput) =>
    apiRequest<PointsSetting>(PATH_POINTS, { method: 'PATCH', body: { ...body } }),
  customerPoints: (customerId: string) =>
    apiRequest<CustomerPoints>(`/admin/customers/${encodeURIComponent(customerId)}/points`),
  adjustPoints: (customerId: string, body: { points: number; reason: string }) =>
    apiRequest<CustomerPoints>(`/admin/customers/${encodeURIComponent(customerId)}/points/adjust`, {
      method: 'POST',
      body: { ...body },
    }),
};

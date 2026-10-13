import { apiGet, apiPatch, apiPost } from '@/blynk/api/client';
import { authed, updateUser, type SessionUser, type VerifyResult } from './session';

/* Sign-in and registration calls (backend contract: .superpowers/sdd/tokri-exact/auth-brief.md). */

export type OtpRequestResult = { message: string; expires_in_seconds: number; dev_otp?: string };

export const requestOtp = (phone: string) => apiPost<OtpRequestResult>('/auth/otp/request', { phone });

export const verifyOtp = (phone: string, otp: string) => apiPost<VerifyResult>('/auth/otp/verify', { phone, otp });

export type ProfilePatch = { full_name?: string; date_of_birth?: string; email?: string; sms_language?: 'si' | 'ta' | 'en' };
export type Profile = Partial<SessionUser> & { date_of_birth?: string | null; [k: string]: unknown };

/** PATCH /me, then keep the stored user in step. */
export async function saveProfile(patch: ProfilePatch): Promise<Profile> {
  const { profile } = await authed((t) => apiPatch<{ profile: Profile }>('/me', patch, t));
  const keep: Partial<SessionUser> = {};
  if (profile && 'full_name' in profile) keep.full_name = (profile.full_name as string | null) ?? null;
  else if (patch.full_name !== undefined) keep.full_name = patch.full_name;
  if (profile && 'email' in profile) keep.email = (profile.email as string | null) ?? null;
  updateUser(keep);
  return profile;
}

export type ReferralInfo = { enabled: boolean; can_apply_code: boolean };

export const getReferral = () => authed((t) => apiGet<ReferralInfo>('/me/referral', t));

export const applyReferral = (code: string) => authed((t) => apiPost<unknown>('/me/referral/apply', { code }, t));

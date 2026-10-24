import { API_WORDS } from '@/blynk/api/words';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/blynk/api/client';
import { authed, endSession, updateUser, type SessionUser } from '@/blynk/auth/session';

/*
 * The customer's own account (backend/api/src/modules/users, feedback):
 *   GET /me            the profile (name, phone, email, date of birth, SMS language and offers)
 *   PATCH /me          change any of those; answers with the full profile
 *   DELETE /me         delete (anonymise) a CUSTOMER account; 409 ACTIVE_ORDERS_EXIST while an
 *                      order is still open
 *   POST /feedback     { category, message, rating? } (5 an hour)
 */

export type SmsLanguage = 'si' | 'ta' | 'en';

/** The three SMS languages, in Flutter's order and with its labels (Models/user_model.dart). */
export const SMS_LANGUAGES: { wire: SmsLanguage; label: string }[] = [
  { wire: 'si', label: 'සිංහල (Sinhala)' },
  { wire: 'ta', label: 'தமிழ் (Tamil)' },
  { wire: 'en', label: 'English' },
];

export const smsLanguageOf = (v: unknown): SmsLanguage | null =>
  v === 'si' || v === 'ta' || v === 'en' ? v : null;

export interface AccountProfile {
  id: string;
  phone: string;
  email: string | null;
  full_name: string | null;
  role: string;
  sms_language: SmsLanguage | null;
  /** false once "Offers by SMS" is off. */
  sms_offers: boolean;
  /** YYYY-MM-DD or null. */
  date_of_birth: string | null;
  birthday_offer?: unknown;
  [k: string]: unknown;
}

/** Normalise the profile the server sends (unknown language -> null, offers default on). */
export function parseProfile(raw: Partial<AccountProfile> | null | undefined): AccountProfile {
  const p = raw ?? {};
  return {
    ...p,
    id: String(p.id ?? ''),
    phone: String(p.phone ?? ''),
    email: typeof p.email === 'string' && p.email ? p.email : null,
    full_name: typeof p.full_name === 'string' ? p.full_name : null,
    role: String(p.role ?? 'CUSTOMER'),
    sms_language: smsLanguageOf(p.sms_language),
    sms_offers: p.sms_offers !== false,
    date_of_birth: typeof p.date_of_birth === 'string' && p.date_of_birth ? p.date_of_birth.slice(0, 10) : null,
  };
}

/** Only customers set an email here; staff emails are managed on the Admin Staff page. */
export const canEditEmail = (role: string | null | undefined) => (role ?? 'CUSTOMER') === 'CUSTOMER';

/** PATCH /me body. Only the fields that changed are sent; null clears the date of birth. */
export type AccountPatch = {
  full_name?: string;
  email?: string;
  date_of_birth?: string | null;
  sms_language?: SmsLanguage;
  sms_offers?: boolean;
};

/** The PATCH /me body for one preference change (exported for tests). */
export const smsLanguagePatch = (language: SmsLanguage): AccountPatch => ({ sms_language: language });
export const smsOffersPatch = (on: boolean): AccountPatch => ({ sms_offers: on });

/**
 * The PATCH /me body for the "About you" form: only what changed, trimmed; an emptied date of
 * birth is sent as null (clears it), an emptied email is not sent (the server cannot clear it).
 */
export function aboutYouPatch(
  before: Pick<AccountProfile, 'full_name' | 'email' | 'date_of_birth' | 'role'>,
  form: { full_name: string; email: string; date_of_birth: string | null },
): AccountPatch {
  const out: AccountPatch = {};
  const name = form.full_name.trim().replace(/\s+/g, ' ');
  if (name && name !== (before.full_name ?? '')) out.full_name = name;
  const email = form.email.trim().toLowerCase();
  if (canEditEmail(before.role) && email && email !== (before.email ?? '')) out.email = email;
  if ((form.date_of_birth ?? null) !== (before.date_of_birth ?? null)) out.date_of_birth = form.date_of_birth;
  return out;
}

export const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) && v.trim().length <= 255;

function keepSessionUser(p: AccountProfile) {
  const keep: Partial<SessionUser> = { full_name: p.full_name, email: p.email };
  if (p.role) keep.role = p.role;
  updateUser(keep);
}

export async function getProfile(signal?: AbortSignal): Promise<AccountProfile> {
  const { profile } = await authed((t) => apiGet<{ profile: AccountProfile }>('/me', t, signal));
  const p = parseProfile(profile);
  keepSessionUser(p);
  return p;
}

export async function updateProfile(patch: AccountPatch): Promise<AccountProfile> {
  const { profile } = await authed((t) => apiPatch<{ profile: AccountProfile }>('/me', patch, t));
  const p = parseProfile(profile);
  keepSessionUser(p);
  return p;
}

/**
 * DELETE /me. On success the session ends here like a logout (reason 'deleted': no server
 * logout, the account and its sessions are gone) and the end handlers clear local state.
 * A refusal (409 ACTIVE_ORDERS_EXIST, 403 for staff accounts) or a network failure throws and
 * the customer stays signed in.
 */
export async function deleteAccount(): Promise<void> {
  await authed((t) => apiDelete<{ deleted: true }>('/me', t));
  endSession('deleted');
}

/* ------------------------------------------------------------------ feedback */

export type FeedbackCategory = 'APP' | 'DELIVERY' | 'PRODUCTS' | 'OTHER';

/** Flutter's chips (Services/Providers/feedback.provider.dart). */
export const FEEDBACK_CATEGORIES: { wire: FeedbackCategory; label: string }[] = [
  { wire: 'APP', label: 'App' },
  { wire: 'DELIVERY', label: 'Delivery' },
  { wire: 'PRODUCTS', label: 'Products' },
  { wire: 'OTHER', label: 'Other' },
];

export const FEEDBACK_MAX = 2000;

export type FeedbackBody = { category: FeedbackCategory; message: string; rating?: number };

/** The POST /feedback body, or the reason it cannot be sent (Flutter's inline errors). */
export function feedbackBody(
  input: { category: FeedbackCategory | null; message: string; rating: number | null },
): { ok: true; body: FeedbackBody } | { ok: false; category?: string; message?: string } {
  const message = input.message.trim();
  const errs: { category?: string; message?: string } = {};
  if (!input.category) errs.category = API_WORDS.feedbackCategory;
  if (!message) errs.message = API_WORDS.feedbackEmpty;
  else if (message.length > FEEDBACK_MAX) errs.message = API_WORDS.feedbackLong(FEEDBACK_MAX);
  if (errs.category || errs.message) return { ok: false, ...errs };
  const body: FeedbackBody = { category: input.category as FeedbackCategory, message };
  if (input.rating && input.rating >= 1 && input.rating <= 5) body.rating = Math.round(input.rating);
  return { ok: true, body };
}

export const sendFeedback = (body: FeedbackBody) => authed((t) => apiPost<unknown>('/feedback', body, t));
